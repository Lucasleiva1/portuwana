CREATE TABLE IF NOT EXISTS local_profile (
    id TEXT PRIMARY KEY NOT NULL DEFAULT 'default',
    display_name TEXT NOT NULL DEFAULT 'Viajante',
    native_language TEXT NOT NULL DEFAULT 'es',
    learning_language TEXT NOT NULL DEFAULT 'pt-BR',
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

INSERT OR IGNORE INTO local_profile (id) VALUES ('default');

CREATE TABLE IF NOT EXISTS lesson_progress (
    lesson_id TEXT PRIMARY KEY NOT NULL,
    started_at TEXT,
    completed_at TEXT,
    attempts INTEGER NOT NULL DEFAULT 0,
    best_score REAL NOT NULL DEFAULT 0,
    last_score REAL NOT NULL DEFAULT 0,
    communication REAL NOT NULL DEFAULT 0,
    comprehension REAL NOT NULL DEFAULT 0,
    pronunciation REAL NOT NULL DEFAULT 0,
    autonomy REAL NOT NULL DEFAULT 0,
    portuguese_power REAL NOT NULL DEFAULT 0,
    last_activity_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS lesson_sessions (
    id TEXT PRIMARY KEY NOT NULL,
    lesson_id TEXT NOT NULL,
    started_at TEXT NOT NULL,
    ended_at TEXT,
    duration_ms INTEGER,
    status TEXT NOT NULL DEFAULT 'active'
        CHECK (status IN ('active', 'completed', 'abandoned')),
    turn_count INTEGER NOT NULL DEFAULT 0,
    help_count INTEGER NOT NULL DEFAULT 0,
    relevant_intents_json TEXT NOT NULL DEFAULT '[]',
    final_score REAL,
    aggregate_pronunciation REAL,
    FOREIGN KEY (lesson_id) REFERENCES lesson_progress(lesson_id)
        ON UPDATE CASCADE ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_lesson_sessions_lesson_started
    ON lesson_sessions (lesson_id, started_at DESC);

CREATE TABLE IF NOT EXISTS app_settings (
    key TEXT PRIMARY KEY NOT NULL,
    value_json TEXT NOT NULL,
    updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS dictionary_sources (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    source_key TEXT NOT NULL UNIQUE,
    display_name TEXT NOT NULL,
    family TEXT NOT NULL,
    file_path TEXT,
    file_name TEXT,
    file_size INTEGER,
    file_modified_at TEXT,
    file_hash TEXT,
    version_label TEXT,
    license_label TEXT NOT NULL DEFAULT 'REVIEW_REQUIRED',
    redistribution_notes TEXT,
    detected_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    imported_at TEXT,
    status TEXT NOT NULL DEFAULT 'detected',
    processed_count INTEGER NOT NULL DEFAULT 0,
    accepted_count INTEGER NOT NULL DEFAULT 0,
    error_count INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS dictionary_builds (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    schema_version INTEGER NOT NULL,
    build_version TEXT NOT NULL UNIQUE,
    status TEXT NOT NULL,
    started_at TEXT NOT NULL,
    completed_at TEXT,
    source_path TEXT,
    sources_json TEXT NOT NULL DEFAULT '[]',
    term_count INTEGER NOT NULL DEFAULT 0,
    translation_count INTEGER NOT NULL DEFAULT 0,
    relation_count INTEGER NOT NULL DEFAULT 0,
    error_count INTEGER NOT NULL DEFAULT 0,
    database_size_bytes INTEGER NOT NULL DEFAULT 0,
    fts_enabled INTEGER NOT NULL DEFAULT 0,
    notes TEXT
);

CREATE TABLE IF NOT EXISTS dictionary_entries (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    term TEXT NOT NULL,
    language TEXT NOT NULL CHECK (language IN ('es', 'pt')),
    normalized TEXT NOT NULL,
    search_key TEXT NOT NULL,
    part_of_speech TEXT NOT NULL DEFAULT '',
    grammatical_gender TEXT,
    grammatical_number TEXT,
    definition TEXT,
    locale TEXT,
    common_score INTEGER NOT NULL DEFAULT 50,
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    UNIQUE (language, normalized, part_of_speech)
);

CREATE INDEX IF NOT EXISTS idx_dictionary_entries_exact
    ON dictionary_entries (language, normalized, common_score DESC);
CREATE INDEX IF NOT EXISTS idx_dictionary_entries_search_key
    ON dictionary_entries (language, search_key, common_score DESC);

CREATE TABLE IF NOT EXISTS dictionary_senses (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    entry_id INTEGER NOT NULL,
    sense_order INTEGER NOT NULL DEFAULT 0,
    definition TEXT,
    context_label TEXT NOT NULL DEFAULT '',
    locale TEXT NOT NULL DEFAULT '',
    UNIQUE (entry_id, definition, context_label, locale),
    FOREIGN KEY (entry_id) REFERENCES dictionary_entries(id)
        ON UPDATE CASCADE ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS dictionary_translations (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    entry_id INTEGER NOT NULL,
    translated_term TEXT NOT NULL,
    translated_language TEXT NOT NULL CHECK (translated_language IN ('es', 'pt')),
    normalized_translation TEXT NOT NULL,
    context_label TEXT NOT NULL DEFAULT '',
    locale TEXT NOT NULL DEFAULT '',
    direct INTEGER NOT NULL DEFAULT 1,
    source_priority INTEGER NOT NULL DEFAULT 50,
    target_entry_id INTEGER,
    UNIQUE (
        entry_id,
        translated_language,
        normalized_translation,
        context_label,
        locale
    ),
    FOREIGN KEY (entry_id) REFERENCES dictionary_entries(id)
        ON UPDATE CASCADE ON DELETE CASCADE,
    FOREIGN KEY (target_entry_id) REFERENCES dictionary_entries(id)
        ON UPDATE CASCADE ON DELETE SET NULL
);

CREATE INDEX IF NOT EXISTS idx_dictionary_translations_reverse
    ON dictionary_translations (
        translated_language,
        normalized_translation,
        source_priority DESC
    );

CREATE TABLE IF NOT EXISTS dictionary_relations (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    entry_id INTEGER NOT NULL,
    relation_type TEXT NOT NULL,
    related_term TEXT NOT NULL,
    related_language TEXT NOT NULL,
    normalized_related_term TEXT NOT NULL,
    context_label TEXT NOT NULL DEFAULT '',
    UNIQUE (entry_id, relation_type, related_language, normalized_related_term),
    FOREIGN KEY (entry_id) REFERENCES dictionary_entries(id)
        ON UPDATE CASCADE ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS dictionary_entry_sources (
    entry_id INTEGER NOT NULL,
    source_id INTEGER NOT NULL,
    external_reference TEXT NOT NULL DEFAULT '',
    PRIMARY KEY (entry_id, source_id, external_reference),
    FOREIGN KEY (entry_id) REFERENCES dictionary_entries(id)
        ON UPDATE CASCADE ON DELETE CASCADE,
    FOREIGN KEY (source_id) REFERENCES dictionary_sources(id)
        ON UPDATE CASCADE ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS dictionary_translation_sources (
    translation_id INTEGER NOT NULL,
    source_id INTEGER NOT NULL,
    external_reference TEXT NOT NULL DEFAULT '',
    PRIMARY KEY (translation_id, source_id, external_reference),
    FOREIGN KEY (translation_id) REFERENCES dictionary_translations(id)
        ON UPDATE CASCADE ON DELETE CASCADE,
    FOREIGN KEY (source_id) REFERENCES dictionary_sources(id)
        ON UPDATE CASCADE ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS dictionary_search_index (
    entry_id INTEGER PRIMARY KEY NOT NULL,
    language TEXT NOT NULL,
    term TEXT NOT NULL,
    normalized TEXT NOT NULL,
    search_key TEXT NOT NULL,
    translations TEXT NOT NULL DEFAULT '',
    FOREIGN KEY (entry_id) REFERENCES dictionary_entries(id)
        ON UPDATE CASCADE ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_dictionary_search_exact
    ON dictionary_search_index (language, normalized);
CREATE INDEX IF NOT EXISTS idx_dictionary_search_key
    ON dictionary_search_index (language, search_key);

CREATE TABLE IF NOT EXISTS dictionary_search_history (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    term TEXT NOT NULL,
    normalized TEXT NOT NULL,
    direction TEXT NOT NULL,
    chosen_result TEXT,
    searched_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_dictionary_history_recent
    ON dictionary_search_history (searched_at DESC);

CREATE TABLE IF NOT EXISTS vocabulary_favorites (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    term TEXT NOT NULL,
    language TEXT NOT NULL,
    normalized TEXT NOT NULL,
    primary_translation TEXT NOT NULL,
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    UNIQUE (language, normalized, primary_translation)
);

CREATE INDEX IF NOT EXISTS idx_vocabulary_favorites_recent
    ON vocabulary_favorites (created_at DESC);

UPDATE technical_status
SET value = '2', updated_at = CURRENT_TIMESTAMP
WHERE key = 'schema.version';
