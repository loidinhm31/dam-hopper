-- Migration 010: Workflow Tracking and Continuity
-- Additive tables for workspaces, work items (plans/phases/tasks), sessions, resource links, notes, and activity events.

CREATE TABLE IF NOT EXISTS workflow_workspaces (
    id TEXT PRIMARY KEY,
    locator TEXT NOT NULL UNIQUE,
    name TEXT NOT NULL,
    created_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS workflow_items (
    id TEXT PRIMARY KEY,
    workspace_id TEXT NOT NULL REFERENCES workflow_workspaces(id) ON DELETE CASCADE,
    project_name TEXT NOT NULL,
    worktree_path TEXT,
    parent_id TEXT REFERENCES workflow_items(id) ON DELETE CASCADE,
    kind TEXT NOT NULL CHECK(kind IN ('plan', 'phase', 'task')),
    title TEXT NOT NULL,
    summary TEXT,
    status TEXT NOT NULL CHECK(status IN ('backlog', 'next', 'in_progress', 'blocked', 'done', 'canceled')),
    sort_order INTEGER NOT NULL DEFAULT 0,
    source TEXT NOT NULL DEFAULT 'manual',
    created_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL,
    completed_at INTEGER,
    archived_at INTEGER
);

CREATE TABLE IF NOT EXISTS workflow_sessions (
    id TEXT PRIMARY KEY,
    workspace_id TEXT NOT NULL REFERENCES workflow_workspaces(id) ON DELETE CASCADE,
    project_name TEXT NOT NULL,
    worktree_path TEXT,
    item_id TEXT REFERENCES workflow_items(id) ON DELETE SET NULL,
    status TEXT NOT NULL CHECK(status IN ('running', 'ended', 'abandoned')),
    started_at INTEGER NOT NULL,
    ended_at INTEGER,
    source TEXT NOT NULL DEFAULT 'manual',
    created_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS workflow_resource_links (
    id TEXT PRIMARY KEY,
    session_id TEXT NOT NULL REFERENCES workflow_sessions(id) ON DELETE CASCADE,
    resource_type TEXT NOT NULL CHECK(resource_type IN ('terminal', 'agent')),
    external_id TEXT NOT NULL,
    incarnation INTEGER,
    harness_label TEXT,
    run_id TEXT,
    observed_state TEXT NOT NULL DEFAULT 'attached' CHECK(observed_state IN ('attached', 'exited', 'stale', 'detached', 'crashed', 'unknown')),
    suggested_end_time INTEGER,
    first_seen_at INTEGER NOT NULL,
    last_seen_at INTEGER NOT NULL,
    link_source TEXT NOT NULL DEFAULT 'manual',
    created_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL,
    UNIQUE(session_id, resource_type, external_id)
);

CREATE TABLE IF NOT EXISTS workflow_notes (
    id TEXT PRIMARY KEY,
    workspace_id TEXT NOT NULL REFERENCES workflow_workspaces(id) ON DELETE CASCADE,
    item_id TEXT REFERENCES workflow_items(id) ON DELETE CASCADE,
    session_id TEXT REFERENCES workflow_sessions(id) ON DELETE CASCADE,
    body TEXT NOT NULL,
    source TEXT NOT NULL DEFAULT 'manual',
    created_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL,
    deleted_at INTEGER,
    CHECK(item_id IS NOT NULL OR session_id IS NOT NULL)
);

CREATE TABLE IF NOT EXISTS workflow_events (
    id TEXT PRIMARY KEY,
    workspace_id TEXT NOT NULL REFERENCES workflow_workspaces(id) ON DELETE CASCADE,
    event_type TEXT NOT NULL,
    source TEXT NOT NULL DEFAULT 'manual',
    project_name TEXT,
    worktree_path TEXT,
    item_id TEXT,
    session_id TEXT,
    occurred_at INTEGER NOT NULL,
    recorded_at INTEGER NOT NULL,
    payload_json TEXT,
    expires_at INTEGER
);

CREATE INDEX IF NOT EXISTS idx_wf_items_workspace_proj_status ON workflow_items(workspace_id, project_name, status, updated_at);
CREATE INDEX IF NOT EXISTS idx_wf_items_parent ON workflow_items(parent_id);
CREATE INDEX IF NOT EXISTS idx_wf_sessions_workspace_proj_status ON workflow_sessions(workspace_id, project_name, status, updated_at);
CREATE INDEX IF NOT EXISTS idx_wf_sessions_item ON workflow_sessions(item_id);
CREATE INDEX IF NOT EXISTS idx_wf_links_session ON workflow_resource_links(session_id);
CREATE INDEX IF NOT EXISTS idx_wf_links_external ON workflow_resource_links(resource_type, external_id);
CREATE INDEX IF NOT EXISTS idx_wf_notes_item ON workflow_notes(item_id);
CREATE INDEX IF NOT EXISTS idx_wf_notes_session ON workflow_notes(session_id);
CREATE INDEX IF NOT EXISTS idx_wf_notes_deleted ON workflow_notes(deleted_at);
CREATE INDEX IF NOT EXISTS idx_wf_events_workspace_recorded ON workflow_events(workspace_id, recorded_at DESC, id);
CREATE INDEX IF NOT EXISTS idx_wf_events_expires ON workflow_events(expires_at);
