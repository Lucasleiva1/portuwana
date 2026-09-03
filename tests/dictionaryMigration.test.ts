import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const migration = readFileSync(
  resolve("src-tauri/migrations/0002_local_learning_dictionary.sql"),
  "utf8",
);

describe("phase 7 SQLite migration", () => {
  it.each([
    "local_profile",
    "lesson_progress",
    "lesson_sessions",
    "app_settings",
    "dictionary_sources",
    "dictionary_builds",
    "dictionary_entries",
    "dictionary_translations",
    "dictionary_relations",
    "dictionary_search_history",
    "vocabulary_favorites",
  ])("creates %s", (table) => {
    expect(migration).toContain(`CREATE TABLE IF NOT EXISTS ${table}`);
  });

  it("keeps source traceability and inverse-search indexes", () => {
    expect(migration).toContain("dictionary_entry_sources");
    expect(migration).toContain("dictionary_translation_sources");
    expect(migration).toContain("idx_dictionary_translations_reverse");
    expect(migration).toContain("SET value = '2'");
  });

  it("persists history and favorites with stable uniqueness rules", () => {
    expect(migration).toContain("searched_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP");
    expect(migration).toContain("primary_translation TEXT NOT NULL");
    expect(migration).toContain(
      "UNIQUE (language, normalized, primary_translation)",
    );
  });
});
