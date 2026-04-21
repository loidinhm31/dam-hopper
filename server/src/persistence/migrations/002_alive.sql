-- Track alive state so restore only respawns sessions that were running
-- at the time the server was stopped. Dead sessions stay in the DB for
-- buffer replay but are not re-spawned.

ALTER TABLE sessions ADD COLUMN alive INTEGER NOT NULL DEFAULT 1;

CREATE INDEX IF NOT EXISTS idx_sessions_alive ON sessions(alive);
