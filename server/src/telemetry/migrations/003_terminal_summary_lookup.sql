-- Persist only the already-derived terminal fingerprint so session audit
-- labels can use an indexed join without scanning or exposing raw run IDs.
ALTER TABLE terminal_runs ADD COLUMN terminal_fingerprint TEXT;
CREATE UNIQUE INDEX idx_terminal_runs_fingerprint
    ON terminal_runs(terminal_fingerprint)
    WHERE terminal_fingerprint IS NOT NULL;
CREATE INDEX idx_agent_runs_parent
    ON agent_runs(parent_run_id, started_at_utc_ms, run_id);
