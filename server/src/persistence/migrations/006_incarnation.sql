-- Distinguishes concrete PTY lifetimes when a public session ID is reused.
ALTER TABLE sessions ADD COLUMN incarnation INTEGER NOT NULL DEFAULT 0;

CREATE INDEX IF NOT EXISTS idx_sessions_incarnation
    ON sessions(id, incarnation);
