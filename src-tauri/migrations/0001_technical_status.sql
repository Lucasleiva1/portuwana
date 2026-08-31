CREATE TABLE IF NOT EXISTS technical_status (
    key TEXT PRIMARY KEY NOT NULL,
    value TEXT NOT NULL,
    updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

INSERT OR IGNORE INTO technical_status (key, value)
VALUES ('schema.version', '1');
