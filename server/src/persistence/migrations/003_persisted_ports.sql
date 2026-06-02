-- Persist stdout-detected development ports across server restarts.

CREATE TABLE IF NOT EXISTS persisted_ports (
    session_id TEXT NOT NULL,
    port INTEGER NOT NULL,
    project TEXT,
    updated_at INTEGER NOT NULL,
    PRIMARY KEY (session_id, port)
);

CREATE INDEX IF NOT EXISTS idx_persisted_ports_session ON persisted_ports(session_id);
