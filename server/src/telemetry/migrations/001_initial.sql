PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS terminal_runs (
    run_id TEXT PRIMARY KEY,
    project TEXT,
    shell TEXT NOT NULL,
    started_at_utc_ms INTEGER NOT NULL,
    ended_at_utc_ms INTEGER,
    capture_quality TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS command_events (
    run_id TEXT NOT NULL REFERENCES terminal_runs(run_id) ON DELETE CASCADE,
    sequence INTEGER NOT NULL,
    occurred_at_utc_ms INTEGER NOT NULL,
    duration_ms INTEGER,
    exit_code INTEGER,
    outcome TEXT NOT NULL,
    category TEXT NOT NULL,
    executable TEXT,
    argument_count INTEGER NOT NULL,
    fingerprint TEXT NOT NULL,
    capture_quality TEXT NOT NULL,
    PRIMARY KEY (run_id, sequence)
);

CREATE INDEX IF NOT EXISTS idx_command_events_occurred ON command_events(occurred_at_utc_ms);
CREATE INDEX IF NOT EXISTS idx_command_events_category ON command_events(category, occurred_at_utc_ms);

CREATE TABLE IF NOT EXISTS agent_runs (
    run_id TEXT PRIMARY KEY,
    provider TEXT NOT NULL,
    model TEXT,
    started_at_utc_ms INTEGER NOT NULL,
    ended_at_utc_ms INTEGER,
    status TEXT NOT NULL,
    correlation_quality TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS agent_usage_events (
    dedupe_id TEXT PRIMARY KEY,
    occurred_at_utc_ms INTEGER NOT NULL,
    conversation_fingerprint TEXT,
    model TEXT,
    source_version TEXT NOT NULL,
    correlation_quality TEXT NOT NULL,
    counter_semantic TEXT NOT NULL,
    input_tokens INTEGER,
    cached_input_tokens INTEGER,
    output_tokens INTEGER,
    reasoning_tokens INTEGER
);
CREATE INDEX IF NOT EXISTS idx_agent_usage_events_occurred ON agent_usage_events(occurred_at_utc_ms);

CREATE TABLE IF NOT EXISTS daily_usage_rollups (
    utc_day TEXT NOT NULL,
    project TEXT NOT NULL DEFAULT '',
    shell TEXT NOT NULL DEFAULT '',
    category TEXT NOT NULL DEFAULT '',
    model TEXT NOT NULL DEFAULT '',
    command_count INTEGER NOT NULL DEFAULT 0,
    succeeded_count INTEGER NOT NULL DEFAULT 0,
    failed_count INTEGER NOT NULL DEFAULT 0,
    interrupted_count INTEGER NOT NULL DEFAULT 0,
    unknown_count INTEGER NOT NULL DEFAULT 0,
    duration_ms_sum INTEGER NOT NULL DEFAULT 0,
    input_tokens_sum INTEGER NOT NULL DEFAULT 0,
    cached_input_tokens_sum INTEGER NOT NULL DEFAULT 0,
    output_tokens_sum INTEGER NOT NULL DEFAULT 0,
    reasoning_tokens_sum INTEGER NOT NULL DEFAULT 0,
    PRIMARY KEY (utc_day, project, shell, category, model)
);

CREATE TABLE IF NOT EXISTS telemetry_health (
    name TEXT PRIMARY KEY,
    value INTEGER NOT NULL,
    updated_at_utc_ms INTEGER NOT NULL
);

PRAGMA user_version = 1;
