use super::enums::*;
use serde::{Deserialize, Serialize};

/// Server-side tracked workspace identity corresponding to a canonical config locator.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct WorkflowWorkspace {
    pub id: String,
    #[serde(skip_serializing)] // Never reveal canonical filesystem locator to client
    pub locator: String,
    pub name: String,
    pub created_at: u64,
    pub updated_at: u64,
}

/// Work item: Plan, Phase, or Task.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct WorkflowItem {
    pub id: String,
    pub workspace_id: String,
    pub project_name: String,
    pub worktree_path: Option<String>,
    pub parent_id: Option<String>,
    pub kind: ItemKind,
    pub title: String,
    pub summary: Option<String>,
    pub status: ItemStatus,
    pub sort_order: i64,
    pub source: WorkflowSource,
    pub created_at: u64,
    pub updated_at: u64,
    pub completed_at: Option<u64>,
    pub archived_at: Option<u64>,
}

/// Manual work session recording work time against a target and optional work item.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct WorkflowSession {
    pub id: String,
    pub workspace_id: String,
    pub project_name: String,
    pub worktree_path: Option<String>,
    pub item_id: Option<String>,
    pub status: SessionStatus,
    pub started_at: u64,
    pub ended_at: Option<u64>,
    pub source: WorkflowSource,
    pub created_at: u64,
    pub updated_at: u64,
}

/// Correlation link between a work session and an external terminal or agent resource.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct WorkflowResourceLink {
    pub id: String,
    pub session_id: String,
    pub resource_type: ResourceLinkType,
    pub external_id: String,
    pub incarnation: Option<u64>,
    pub harness_label: Option<String>,
    pub run_id: Option<String>,
    pub observed_state: ResourceObservedState,
    pub suggested_end_time: Option<u64>,
    pub first_seen_at: u64,
    pub last_seen_at: u64,
    pub link_source: WorkflowSource,
    pub created_at: u64,
    pub updated_at: u64,
}

/// Durable text note attached to an item or session.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct WorkflowNote {
    pub id: String,
    pub workspace_id: String,
    pub item_id: Option<String>,
    pub session_id: Option<String>,
    pub body: String,
    pub source: WorkflowSource,
    pub created_at: u64,
    pub updated_at: u64,
    pub deleted_at: Option<u64>,
}

/// Append-only activity event for auditability and timeline display.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct WorkflowEvent {
    pub id: String,
    pub workspace_id: String,
    pub event_type: WorkflowEventType,
    pub source: WorkflowSource,
    pub project_name: Option<String>,
    pub worktree_path: Option<String>,
    pub item_id: Option<String>,
    pub session_id: Option<String>,
    pub occurred_at: u64,
    pub recorded_at: u64,
    pub payload_json: Option<String>,
    pub expires_at: Option<u64>,
}

/// Summary of project-level workflow activity.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ProjectSummary {
    pub project_name: String,
    pub worktree_path: Option<String>,
    pub plan_count: u32,
    pub task_count: u32,
    pub running_session_count: u32,
    pub last_activity_at: Option<u64>,
}

/// Factual descendant task progress (only present if descendant tasks exist).
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ItemProgress {
    pub total_tracked_tasks: u32,
    pub completed_tracked_tasks: u32,
}

/// Hierarchical overview node for Plans, Phases, and Tasks.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ItemOverviewNode {
    pub item: WorkflowItem,
    pub progress: Option<ItemProgress>,
    pub notes: Vec<WorkflowNote>,
    pub active_sessions: Vec<WorkflowSession>,
    pub children: Vec<ItemOverviewNode>,
}

/// Overview representation for the workflow context surface.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct WorkflowOverview {
    pub workspace_id: String,
    pub server_time_ms: u64,
    pub projects: Vec<ProjectSummary>,
    pub plans: Vec<ItemOverviewNode>,
    pub standalone_tasks: Vec<ItemOverviewNode>,
    pub running_sessions: Vec<WorkflowSession>,
    pub recent_events: Vec<WorkflowEvent>,
    pub truncated: bool,
}
