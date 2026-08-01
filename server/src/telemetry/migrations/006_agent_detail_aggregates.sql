-- Cover aggregate and terminal enrichment reads used by session-detail responses.
CREATE INDEX idx_agent_runs_root_aggregate
    ON agent_runs(
        root_run_id,
        lineage_quality,
        token_quality,
        input_tokens,
        cached_input_tokens,
        output_tokens,
        reasoning_tokens
    );
CREATE INDEX idx_agent_run_terminals_run_bounds
    ON agent_run_terminals(run_id, terminal_fingerprint, first_seen_at_utc_ms, last_seen_at_utc_ms);
