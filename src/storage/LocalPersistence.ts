import type Database from "@tauri-apps/plugin-sql";
import type { PortuguesePowerDimensions } from "../lesson/portuguesePower";
import { logger } from "../logging/logger";

export interface LocalSettings {
  volume: number;
  speechRate: number;
  subtitles: boolean;
  helpPreference: "progressive" | "minimal" | "always";
  inputDeviceId: string | null;
  selectedVoiceProvider: string | null;
  selectedVoice: string | null;
  dictionarySourcePath: string | null;
  dictionaryAssistant: "female" | "male";
}

interface SettingRow {
  key: string;
  valueJson: string;
}

export const defaultLocalSettings: LocalSettings = {
  volume: 1,
  speechRate: 1,
  subtitles: true,
  helpPreference: "progressive",
  inputDeviceId: null,
  selectedVoiceProvider: null,
  selectedVoice: null,
  dictionarySourcePath: null,
  dictionaryAssistant: "female",
};

export class LocalPersistence {
  #writeQueue: Promise<void> = Promise.resolve();

  constructor(private readonly database: Database) {}

  flush(): Promise<void> {
    return this.#writeQueue;
  }

  async initialize(): Promise<LocalSettings> {
    await this.abandonInterruptedSessions();
    for (const [key, value] of Object.entries(defaultLocalSettings)) {
      await this.database.execute(
        "INSERT OR IGNORE INTO app_settings (key, value_json) VALUES ($1, $2)",
        [key, JSON.stringify(value)],
      );
    }
    return this.getSettings();
  }

  async getSettings(): Promise<LocalSettings> {
    const rows = await this.database.select<SettingRow[]>(
      "SELECT key, value_json AS valueJson FROM app_settings",
    );
    const settings: LocalSettings = { ...defaultLocalSettings };
    for (const row of rows) {
      if (!(row.key in settings)) {
        continue;
      }
      try {
        Object.assign(settings, { [row.key]: JSON.parse(row.valueJson) });
      } catch {
        await logger.warn("settings.invalidValue", { key: row.key });
      }
    }
    return settings;
  }

  async setSetting<Key extends keyof LocalSettings>(
    key: Key,
    value: LocalSettings[Key],
  ): Promise<void> {
    return this.#enqueueWrite(async () => {
      await this.database.execute(
        `INSERT INTO app_settings (key, value_json, updated_at)
         VALUES ($1, $2, CURRENT_TIMESTAMP)
         ON CONFLICT(key) DO UPDATE SET
           value_json = excluded.value_json,
           updated_at = CURRENT_TIMESTAMP`,
        [key, JSON.stringify(value)],
      );
      await logger.info("settings.saved", { key });
    });
  }

  async beginLessonSession(lessonId: string): Promise<string> {
    return this.#enqueueWrite(async () => {
      const sessionId = createSessionId();
      await this.database.execute(
        `INSERT INTO lesson_progress (
           lesson_id, started_at, attempts, last_activity_at
         ) VALUES ($1, CURRENT_TIMESTAMP, 1, CURRENT_TIMESTAMP)
         ON CONFLICT(lesson_id) DO UPDATE SET
           started_at = COALESCE(lesson_progress.started_at, CURRENT_TIMESTAMP),
           attempts = lesson_progress.attempts + 1,
           last_activity_at = CURRENT_TIMESTAMP`,
        [lessonId],
      );
      await this.database.execute(
        `INSERT INTO lesson_sessions (id, lesson_id, started_at)
         VALUES ($1, $2, CURRENT_TIMESTAMP)`,
        [sessionId, lessonId],
      );
      await logger.info("session.started", { sessionId, lessonId });
      return sessionId;
    });
  }

  async recordTurn(
    sessionId: string,
    intent: string | null,
    helpUsed: boolean,
  ): Promise<void> {
    return this.#enqueueWrite(async () => {
      await this.database.execute(
        `UPDATE lesson_sessions
         SET turn_count = turn_count + 1,
             help_count = help_count + $2,
             relevant_intents_json = CASE
               WHEN $3 IS NULL OR EXISTS (
                 SELECT 1
                 FROM json_each(
                   CASE
                     WHEN json_valid(relevant_intents_json)
                       THEN relevant_intents_json
                     ELSE '[]'
                   END
                 )
                 WHERE value = $3
               ) THEN CASE
                 WHEN json_valid(relevant_intents_json)
                   THEN relevant_intents_json
                 ELSE '[]'
               END
               ELSE json_insert(
                 CASE
                   WHEN json_array_length(
                     CASE
                       WHEN json_valid(relevant_intents_json)
                         THEN relevant_intents_json
                       ELSE '[]'
                     END
                   ) >= 30
                     THEN json_remove(relevant_intents_json, '$[0]')
                   WHEN json_valid(relevant_intents_json)
                     THEN relevant_intents_json
                   ELSE '[]'
                 END,
                 '$[#]',
                 $3
               )
             END
         WHERE id = $1 AND status = 'active'`,
        [sessionId, helpUsed ? 1 : 0, intent],
      );
    });
  }

  async saveLessonProgress(input: {
    lessonId: string;
    score: number;
    power: number;
    dimensions: PortuguesePowerDimensions;
    completed: boolean;
  }): Promise<void> {
    const { lessonId, score, power, dimensions, completed } = input;
    return this.#enqueueWrite(async () => {
      await this.database.execute(
        `INSERT INTO lesson_progress (
           lesson_id, started_at, completed_at, best_score, last_score,
           communication, comprehension, pronunciation, autonomy,
           portuguese_power, last_activity_at
         ) VALUES (
           $1, CURRENT_TIMESTAMP,
           CASE WHEN $8 = 1 THEN CURRENT_TIMESTAMP ELSE NULL END,
           $2, $2, $3, $4, $5, $6, $7, CURRENT_TIMESTAMP
         )
         ON CONFLICT(lesson_id) DO UPDATE SET
           completed_at = CASE
             WHEN $8 = 1 THEN CURRENT_TIMESTAMP
             ELSE lesson_progress.completed_at
           END,
           best_score = MAX(lesson_progress.best_score, $2),
           last_score = $2,
           communication = $3,
           comprehension = $4,
           pronunciation = $5,
           autonomy = $6,
           portuguese_power = $7,
           last_activity_at = CURRENT_TIMESTAMP`,
        [
          lessonId,
          score,
          dimensions.communication,
          dimensions.comprehension,
          dimensions.pronunciation,
          dimensions.autonomy,
          power,
          completed ? 1 : 0,
        ],
      );
    });
  }

  async finishLessonSession(input: {
    sessionId: string;
    status: "completed" | "abandoned";
    finalScore: number;
    pronunciation: number | null;
  }): Promise<void> {
    return this.#enqueueWrite(async () => {
      await this.database.execute(
        `UPDATE lesson_sessions
         SET ended_at = CURRENT_TIMESTAMP,
             duration_ms = CAST(
               (julianday(CURRENT_TIMESTAMP) - julianday(started_at)) * 86400000
               AS INTEGER
             ),
             status = $2,
             final_score = $3,
             aggregate_pronunciation = $4
         WHERE id = $1 AND status = 'active'`,
        [input.sessionId, input.status, input.finalScore, input.pronunciation],
      );
      await logger.info("session.finished", {
        sessionId: input.sessionId,
        status: input.status,
      });
    });
  }

  #enqueueWrite<Result>(operation: () => Promise<Result>): Promise<Result> {
    const result = this.#writeQueue.then(operation);
    this.#writeQueue = result.then(
      () => undefined,
      () => undefined,
    );
    return result;
  }

  private async abandonInterruptedSessions(): Promise<void> {
    await this.database.execute(
      `UPDATE lesson_sessions
       SET ended_at = COALESCE(ended_at, CURRENT_TIMESTAMP),
           duration_ms = COALESCE(
             duration_ms,
             CAST(
               (julianday(CURRENT_TIMESTAMP) - julianday(started_at)) * 86400000
               AS INTEGER
             )
           ),
           status = 'abandoned'
       WHERE status = 'active'`,
    );
  }
}

function createSessionId(): string {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) {
    return crypto.randomUUID();
  }
  return `session-${Date.now()}-${Math.random().toString(16).slice(2)}`;
}
