-- Preserve the server-validated worktree target that owns a terminal session.
ALTER TABLE sessions ADD COLUMN worktree_path TEXT;

CREATE INDEX IF NOT EXISTS idx_sessions_worktree_path
    ON sessions(project, worktree_path);
