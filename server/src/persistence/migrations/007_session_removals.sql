-- Durable high-water marks prevent an in-flight SessionCreated from
-- resurrecting an identity after the user removes it.
CREATE TABLE IF NOT EXISTS session_removals (
    id TEXT PRIMARY KEY,
    incarnation INTEGER NOT NULL,
    updated_at INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_session_removals_incarnation
    ON session_removals(id, incarnation);
