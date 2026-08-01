-- Runtime-managed migration. TelemetryStore applies this file and user_version
-- atomically; operators must not execute migration files manually.
ALTER TABLE agent_runs ADD COLUMN root_run_id TEXT;
ALTER TABLE agent_runs ADD COLUMN parent_run_id TEXT;
ALTER TABLE agent_runs ADD COLUMN role TEXT;
ALTER TABLE agent_runs ADD COLUMN source_version TEXT;
ALTER TABLE agent_runs ADD COLUMN lineage_quality TEXT;
ALTER TABLE agent_runs ADD COLUMN token_quality TEXT;
ALTER TABLE agent_runs ADD COLUMN counter_semantic TEXT;
ALTER TABLE agent_runs ADD COLUMN counter_updated_at_utc_ms INTEGER;
ALTER TABLE agent_runs ADD COLUMN input_tokens INTEGER;
ALTER TABLE agent_runs ADD COLUMN cached_input_tokens INTEGER;
ALTER TABLE agent_runs ADD COLUMN output_tokens INTEGER;
ALTER TABLE agent_runs ADD COLUMN reasoning_tokens INTEGER;
ALTER TABLE agent_runs ADD COLUMN updated_at_utc_ms INTEGER;

ALTER TABLE agent_usage_events ADD COLUMN terminal_fingerprint TEXT;
ALTER TABLE agent_usage_events ADD COLUMN summary_applied INTEGER NOT NULL DEFAULT 0;

CREATE TABLE agent_run_terminals (
    run_id TEXT NOT NULL REFERENCES agent_runs(run_id) ON DELETE CASCADE,
    terminal_fingerprint TEXT NOT NULL,
    first_seen_at_utc_ms INTEGER NOT NULL,
    last_seen_at_utc_ms INTEGER NOT NULL,
    PRIMARY KEY (run_id, terminal_fingerprint)
);

CREATE INDEX idx_agent_runs_ended_run
    ON agent_runs(ended_at_utc_ms DESC, run_id DESC);
CREATE INDEX idx_agent_runs_started
    ON agent_runs(started_at_utc_ms);
CREATE INDEX idx_agent_runs_root
    ON agent_runs(root_run_id, started_at_utc_ms, run_id);
CREATE INDEX idx_agent_run_terminals_terminal
    ON agent_run_terminals(terminal_fingerprint, run_id);
CREATE INDEX idx_agent_usage_events_summary_pending
    ON agent_usage_events(summary_applied) WHERE summary_applied = 0;
