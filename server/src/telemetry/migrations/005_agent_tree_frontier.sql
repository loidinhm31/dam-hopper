-- Bound legacy tree-detail frontier reads by root, parent, stable order, and limit.
CREATE INDEX idx_agent_runs_root_parent_started
    ON agent_runs(root_run_id, parent_run_id, started_at_utc_ms, run_id);
