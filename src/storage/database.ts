import { isTauri } from "@tauri-apps/api/core";
import Database from "@tauri-apps/plugin-sql";
import { logger } from "../logging/logger";

interface TechnicalStatusRow {
  key: string;
  value: string;
}

export type DatabaseInitialization =
  | {
      status: "ready";
      database: Database;
      schemaVersion: string;
    }
  | {
      status: "unavailable";
      reason: string;
    };

let databasePromise: Promise<DatabaseInitialization> | null = null;

export function initializeDatabase(): Promise<DatabaseInitialization> {
  if (databasePromise) {
    return databasePromise;
  }

  databasePromise = initialize().catch((error: unknown) => {
    databasePromise = null;
    throw error;
  });
  return databasePromise;
}

async function initialize(): Promise<DatabaseInitialization> {
  if (!isTauri()) {
    return {
      status: "unavailable",
      reason: "SQLite is available only inside the Tauri runtime",
    };
  }

  const database = await Database.load("sqlite:portuwana.db");
  const rows = await database.select<TechnicalStatusRow[]>(
    "SELECT key, value FROM technical_status WHERE key = $1",
    ["schema.version"],
  );
  const schemaVersion = rows[0]?.value ?? "unknown";

  await logger.info("database.ready", { schemaVersion });

  return { status: "ready", database, schemaVersion };
}
