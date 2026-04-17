-- Initial schema for session persistence
-- Tracks live session metadata and scrollback buffers across server restarts

CREATE TABLE IF NOT EXISTS sessions (
    id TEXT PRIMARY KEY,
    project TEXT,
    command TEXT NOT NULL,
    cwd TEXT NOT NULL,
    session_type TEXT NOT NULL,
    restart_policy TEXT NOT NULL DEFAULT 'never',
    restart_max_retries INTEGER NOT NULL DEFAULT 5,
    env_json TEXT,  -- JSON-encoded HashMap<String, String>
    cols INTEGER NOT NULL DEFAULT 120,
    rows INTEGER NOT NULL DEFAULT 32,
    created_at INTEGER NOT NULL,  -- Unix timestamp ms
    updated_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS session_buffers (
    session_id TEXT PRIMARY KEY REFERENCES sessions(id) ON DELETE CASCADE,
    data BLOB NOT NULL,
    total_written INTEGER NOT NULL,
    updated_at INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_sessions_project ON sessions(project);
CREATE INDEX IF NOT EXISTS idx_sessions_updated ON sessions(updated_at);
