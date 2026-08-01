-- Keep root-page scans bounded by the stable cursor ordering.
CREATE INDEX idx_agent_runs_parent_ended
    ON agent_runs(parent_run_id, ended_at_utc_ms DESC, run_id DESC);
