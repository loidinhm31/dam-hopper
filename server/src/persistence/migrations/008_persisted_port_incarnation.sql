-- Bind persisted port candidates to the concrete PTY incarnation that
-- discovered them. This prevents a stale reader from deleting a replacement's
-- candidate when a public session id is reused.
ALTER TABLE persisted_ports ADD COLUMN incarnation INTEGER NOT NULL DEFAULT 0;

CREATE INDEX IF NOT EXISTS idx_persisted_ports_session_incarnation
    ON persisted_ports(session_id, incarnation);
