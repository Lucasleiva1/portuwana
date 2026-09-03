import type Database from "@tauri-apps/plugin-sql";
import { describe, expect, it, vi } from "vitest";
import {
  defaultLocalSettings,
  LocalPersistence,
} from "../src/storage/LocalPersistence";

function databaseMock(options: { settings?: unknown[]; intents?: unknown[] } = {}) {
  const execute = vi.fn(async (_query: string, _bindings?: unknown[]) => ({
    rowsAffected: 1,
    lastInsertId: 1,
  }));
  const select = vi.fn(async (query: string, _bindings?: unknown[]) => {
    if (query.includes("FROM app_settings")) {
      return options.settings ?? [];
    }
    if (query.includes("relevant_intents_json")) {
      return options.intents ?? [{ relevantIntentsJson: "[]" }];
    }
    return [];
  });
  const database = { execute, select } as unknown as Database;
  return { database, execute, select };
}

describe("local persistence", () => {
  it("seeds settings, restores valid values and closes interrupted sessions", async () => {
    const mock = databaseMock({
      settings: [
        { key: "subtitles", valueJson: "false" },
        { key: "dictionaryAssistant", valueJson: '"male"' },
      ],
    });
    const settings = await new LocalPersistence(mock.database).initialize();

    expect(settings).toEqual({
      ...defaultLocalSettings,
      subtitles: false,
      dictionaryAssistant: "male",
    });
    expect(mock.execute.mock.calls[0]?.[0]).toContain("status = 'abandoned'");
    expect(mock.execute).toHaveBeenCalledWith(
      "INSERT OR IGNORE INTO app_settings (key, value_json) VALUES ($1, $2)",
      ["volume", "1"],
    );
  });

  it("persists lesson progress and a complete session without audio payloads", async () => {
    const mock = databaseMock({
      intents: [{ relevantIntentsJson: '["greet"]' }],
    });
    const persistence = new LocalPersistence(mock.database);
    const sessionId = await persistence.beginLessonSession("airport-arrival-01");
    await persistence.recordTurn(sessionId, "collect_luggage", true);
    await persistence.saveLessonProgress({
      lessonId: "airport-arrival-01",
      score: 88,
      power: 72,
      dimensions: {
        communication: 80,
        comprehension: 78,
        pronunciation: 65,
        autonomy: 70,
      },
      completed: true,
    });
    await persistence.finishLessonSession({
      sessionId,
      status: "completed",
      finalScore: 88,
      pronunciation: 65,
    });

    expect(sessionId).toEqual(expect.any(String));
    const serializedCalls = JSON.stringify(mock.execute.mock.calls);
    expect(serializedCalls).toContain("lesson_progress");
    expect(serializedCalls).toContain("lesson_sessions");
    expect(serializedCalls).toContain("collect_luggage");
    expect(serializedCalls).not.toContain("audio_bytes");
    expect(serializedCalls).not.toContain("wavBlob");
    expect(mock.select).not.toHaveBeenCalledWith(
      expect.stringContaining("relevant_intents_json"),
      expect.anything(),
    );
    expect(serializedCalls).toContain("json_each");
  });

  it("upserts user settings as JSON", async () => {
    const mock = databaseMock();
    await new LocalPersistence(mock.database).setSetting(
      "dictionarySourcePath",
      "D:\\diccionarios",
    );
    expect(mock.execute).toHaveBeenCalledWith(
      expect.stringContaining("ON CONFLICT(key) DO UPDATE"),
      ["dictionarySourcePath", '"D:\\\\diccionarios"'],
    );
  });

  it("serializes writes and lets callers flush the pending queue", async () => {
    let releaseFirstWrite: (() => void) | undefined;
    const firstWrite = new Promise<void>((resolve) => {
      releaseFirstWrite = resolve;
    });
    const mock = databaseMock();
    mock.execute
      .mockImplementationOnce(async () => {
        await firstWrite;
        return { rowsAffected: 1, lastInsertId: 1 };
      })
      .mockResolvedValue({ rowsAffected: 1, lastInsertId: 1 });
    const persistence = new LocalPersistence(mock.database);

    const first = persistence.setSetting("subtitles", false);
    const second = persistence.setSetting("dictionaryAssistant", "male");
    await vi.waitFor(() => expect(mock.execute).toHaveBeenCalledTimes(1));

    releaseFirstWrite?.();
    await persistence.flush();
    await Promise.all([first, second]);

    expect(mock.execute).toHaveBeenCalledTimes(2);
  });
});
