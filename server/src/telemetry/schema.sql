-- Fresh Codex-only telemetry schema. Existing development databases are
-- discarded and recreated when their schema is not this version.
PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS codex_usage_events (
    dedupe_id TEXT PRIMARY KEY NOT NULL CHECK (
        length(dedupe_id) = 64 AND dedupe_id NOT GLOB '*[^0-9a-f]*'
    ),
    occurred_at_utc_ms INTEGER NOT NULL CHECK (
        typeof(occurred_at_utc_ms) = 'integer'
        AND occurred_at_utc_ms BETWEEN 1 AND 4102444800000
    ),
    session_fingerprint TEXT CHECK (
        session_fingerprint IS NULL OR (
            length(session_fingerprint) = 64
            AND session_fingerprint NOT GLOB '*[^0-9a-f]*'
        )
    ),
    model TEXT CHECK (
        model IS NULL OR (
            length(model) BETWEEN 1 AND 64
            AND model NOT GLOB '*[^-A-Za-z0-9._/:]*'
            AND substr(model, 1, 1) GLOB '[A-Za-z0-9]'
            AND substr(model, -1, 1) GLOB '[A-Za-z0-9]'
            AND instr(model, '://') = 0
            AND instr(model, '//') = 0
            AND instr(model, '..') = 0
        )
    ),
    source_version TEXT NOT NULL CHECK (
        source_version = 'unknown' OR (
            length(source_version) BETWEEN 1 AND 32
            AND source_version NOT GLOB '*[^0-9.-]*'
        )
    ),
    source_quality TEXT NOT NULL CHECK (source_quality IN ('verified', 'unverified')),
    status TEXT NOT NULL CHECK (
        length(status) BETWEEN 1 AND 128
        AND status NOT GLOB '*[^A-Za-z0-9._-]*'
    ),
    counter_semantic TEXT NOT NULL CHECK (counter_semantic IN ('delta', 'cumulative')),
    token_quality TEXT NOT NULL CHECK (token_quality IN ('exact', 'partial', 'unavailable')),
    input_tokens INTEGER CHECK (input_tokens IS NULL OR (typeof(input_tokens) = 'integer' AND input_tokens BETWEEN 0 AND 1000000000000)),
    cached_input_tokens INTEGER CHECK (cached_input_tokens IS NULL OR (typeof(cached_input_tokens) = 'integer' AND cached_input_tokens BETWEEN 0 AND 1000000000000)),
    output_tokens INTEGER CHECK (output_tokens IS NULL OR (typeof(output_tokens) = 'integer' AND output_tokens BETWEEN 0 AND 1000000000000)),
    reasoning_tokens INTEGER CHECK (reasoning_tokens IS NULL OR (typeof(reasoning_tokens) = 'integer' AND reasoning_tokens BETWEEN 0 AND 1000000000000)),
    duration_ms INTEGER CHECK (duration_ms IS NULL OR (typeof(duration_ms) = 'integer' AND duration_ms BETWEEN 0 AND 604800000))
);

CREATE INDEX IF NOT EXISTS idx_codex_usage_events_occurred
    ON codex_usage_events(occurred_at_utc_ms);
CREATE INDEX IF NOT EXISTS idx_codex_usage_events_session
    ON codex_usage_events(session_fingerprint, occurred_at_utc_ms);

CREATE TABLE IF NOT EXISTS codex_sessions (
    session_fingerprint TEXT PRIMARY KEY NOT NULL CHECK (
        length(session_fingerprint) = 64 AND session_fingerprint NOT GLOB '*[^0-9a-f]*'
    ),
    model TEXT CHECK (
        model IS NULL OR (
            length(model) BETWEEN 1 AND 64
            AND model NOT GLOB '*[^-A-Za-z0-9._/:]*'
            AND substr(model, 1, 1) GLOB '[A-Za-z0-9]'
            AND substr(model, -1, 1) GLOB '[A-Za-z0-9]'
            AND instr(model, '://') = 0
            AND instr(model, '//') = 0
            AND instr(model, '..') = 0
        )
    ),
    source_version TEXT NOT NULL CHECK (
        source_version = 'unknown' OR (
            length(source_version) BETWEEN 1 AND 32
            AND source_version NOT GLOB '*[^0-9.-]*'
        )
    ),
    source_quality TEXT NOT NULL CHECK (source_quality IN ('verified', 'unverified')),
    started_at_utc_ms INTEGER NOT NULL CHECK (
        typeof(started_at_utc_ms) = 'integer'
        AND started_at_utc_ms BETWEEN 1 AND 4102444800000
    ),
    ended_at_utc_ms INTEGER CHECK (
        ended_at_utc_ms IS NULL
        OR (typeof(ended_at_utc_ms) = 'integer' AND ended_at_utc_ms BETWEEN 1 AND 4102444800000)
    ),
    status TEXT NOT NULL CHECK (
        length(status) BETWEEN 1 AND 128
        AND status NOT GLOB '*[^A-Za-z0-9._-]*'
    ),
    counter_semantic TEXT NOT NULL CHECK (counter_semantic IN ('delta', 'cumulative')),
    token_quality TEXT NOT NULL CHECK (token_quality IN ('exact', 'partial', 'unavailable')),
    response_count INTEGER NOT NULL DEFAULT 0 CHECK (typeof(response_count) = 'integer' AND response_count BETWEEN 0 AND 9000000000000000000),
    duration_ms_sum INTEGER CHECK (duration_ms_sum IS NULL OR (typeof(duration_ms_sum) = 'integer' AND duration_ms_sum >= 0)),
    input_tokens INTEGER CHECK (input_tokens IS NULL OR (typeof(input_tokens) = 'integer' AND input_tokens BETWEEN 0 AND 9000000000000000000)),
    cached_input_tokens INTEGER CHECK (cached_input_tokens IS NULL OR (typeof(cached_input_tokens) = 'integer' AND cached_input_tokens BETWEEN 0 AND 9000000000000000000)),
    output_tokens INTEGER CHECK (output_tokens IS NULL OR (typeof(output_tokens) = 'integer' AND output_tokens BETWEEN 0 AND 9000000000000000000)),
    reasoning_tokens INTEGER CHECK (reasoning_tokens IS NULL OR (typeof(reasoning_tokens) = 'integer' AND reasoning_tokens BETWEEN 0 AND 9000000000000000000)),
    updated_at_utc_ms INTEGER NOT NULL CHECK (
        typeof(updated_at_utc_ms) = 'integer'
        AND updated_at_utc_ms BETWEEN 1 AND 4102444800000
    )
);

CREATE INDEX IF NOT EXISTS idx_codex_sessions_ended
    ON codex_sessions(ended_at_utc_ms DESC, session_fingerprint DESC);
CREATE INDEX IF NOT EXISTS idx_codex_sessions_started
    ON codex_sessions(started_at_utc_ms, session_fingerprint);
CREATE INDEX IF NOT EXISTS idx_codex_sessions_order
    ON codex_sessions(
        coalesce(ended_at_utc_ms, started_at_utc_ms) DESC,
        session_fingerprint DESC
    );

CREATE TABLE IF NOT EXISTS codex_daily_rollups (
    utc_day TEXT NOT NULL CHECK (
        length(utc_day) = 10
        AND utc_day GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]'
    ),
    model TEXT NOT NULL DEFAULT '' CHECK (
        model = '' OR (
            length(model) BETWEEN 1 AND 64
            AND model NOT GLOB '*[^-A-Za-z0-9._/:]*'
            AND substr(model, 1, 1) GLOB '[A-Za-z0-9]'
            AND substr(model, -1, 1) GLOB '[A-Za-z0-9]'
            AND instr(model, '://') = 0
            AND instr(model, '//') = 0
            AND instr(model, '..') = 0
        )
    ),
    input_tokens_sum INTEGER NOT NULL DEFAULT 0 CHECK (typeof(input_tokens_sum) = 'integer' AND input_tokens_sum BETWEEN 0 AND 9000000000000000000),
    cached_input_tokens_sum INTEGER NOT NULL DEFAULT 0 CHECK (typeof(cached_input_tokens_sum) = 'integer' AND cached_input_tokens_sum BETWEEN 0 AND 9000000000000000000),
    output_tokens_sum INTEGER NOT NULL DEFAULT 0 CHECK (typeof(output_tokens_sum) = 'integer' AND output_tokens_sum BETWEEN 0 AND 9000000000000000000),
    reasoning_tokens_sum INTEGER NOT NULL DEFAULT 0 CHECK (typeof(reasoning_tokens_sum) = 'integer' AND reasoning_tokens_sum BETWEEN 0 AND 9000000000000000000),
    input_tokens_count INTEGER NOT NULL DEFAULT 0 CHECK (typeof(input_tokens_count) = 'integer' AND input_tokens_count BETWEEN 0 AND 9000000000000000000),
    cached_input_tokens_count INTEGER NOT NULL DEFAULT 0 CHECK (typeof(cached_input_tokens_count) = 'integer' AND cached_input_tokens_count BETWEEN 0 AND 9000000000000000000),
    output_tokens_count INTEGER NOT NULL DEFAULT 0 CHECK (typeof(output_tokens_count) = 'integer' AND output_tokens_count BETWEEN 0 AND 9000000000000000000),
    reasoning_tokens_count INTEGER NOT NULL DEFAULT 0 CHECK (typeof(reasoning_tokens_count) = 'integer' AND reasoning_tokens_count BETWEEN 0 AND 9000000000000000000),
    response_count INTEGER NOT NULL DEFAULT 0 CHECK (typeof(response_count) = 'integer' AND response_count BETWEEN 0 AND 9000000000000000000),
    duration_ms_sum INTEGER CHECK (duration_ms_sum IS NULL OR (typeof(duration_ms_sum) = 'integer' AND duration_ms_sum >= 0)),
    source_mask INTEGER NOT NULL DEFAULT 0 CHECK (typeof(source_mask) = 'integer' AND source_mask IN (0, 1)),
    PRIMARY KEY (utc_day, model)
);

CREATE INDEX IF NOT EXISTS idx_codex_daily_rollups_day
    ON codex_daily_rollups(utc_day, model);

CREATE TABLE IF NOT EXISTS telemetry_health (
    name TEXT PRIMARY KEY NOT NULL CHECK (
        length(name) BETWEEN 1 AND 128
        AND name NOT GLOB '*[^A-Za-z0-9._-]*'
    ),
    value INTEGER NOT NULL CHECK (typeof(value) = 'integer' AND value BETWEEN 0 AND 9223372036854775807),
    updated_at_utc_ms INTEGER NOT NULL CHECK (
        typeof(updated_at_utc_ms) = 'integer'
        AND updated_at_utc_ms BETWEEN 1 AND 4102444800000
    )
);
