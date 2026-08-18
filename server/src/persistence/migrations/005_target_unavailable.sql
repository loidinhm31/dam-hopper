-- Retain target-scoped terminal identity when a registered worktree disappears.
ALTER TABLE sessions ADD COLUMN target_unavailable INTEGER NOT NULL DEFAULT 0;

CREATE INDEX IF NOT EXISTS idx_sessions_target_unavailable
    ON sessions(target_unavailable);
