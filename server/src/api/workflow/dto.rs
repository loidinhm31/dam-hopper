use serde::{Deserialize, Serialize};

use crate::workflow::model::{
    ItemKind, ItemStatus, ResourceLinkType, ResourceObservedState, SessionStatus,
    WorkflowEventType, WorkflowSource,
};
use crate::workspace_target::ProjectTargetRef;

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct EventsQuery {
    pub cursor: Option<String>,
    pub limit: Option<usize>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct CreateItemRequest {
    pub request_id: String,
    pub target: ProjectTargetRef,
    pub parent_id: Option<String>,
    pub kind: ItemKind,
    pub title: String,
    pub summary: Option<String>,
    pub status: Option<ItemStatus>,
    pub sort_order: Option<i64>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct PatchItemRequest {
    pub request_id: String,
    pub updated_at: String,
    pub title: Option<String>,
    #[serde(default)]
    pub summary: Option<Option<String>>,
    pub status: Option<ItemStatus>,
    pub sort_order: Option<i64>,
    pub target: Option<ProjectTargetRef>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct DeleteRequest {
    pub request_id: String,
    pub updated_at: String,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct CreateSessionRequest {
    pub request_id: String,
    pub target: ProjectTargetRef,
    pub item_id: Option<String>,
    pub started_at: String,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct EndSessionRequest {
    pub request_id: String,
    pub ended_at: String,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct AbandonRequest {
    pub request_id: String,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct LinkRequest {
    pub request_id: String,
    pub resource_type: ResourceLinkType,
    pub external_id: String,
    pub incarnation: Option<u64>,
    pub harness_label: Option<String>,
    pub run_id: Option<String>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct UnlinkRequest {
    pub request_id: String,
    pub updated_at: String,
    pub resource_type: ResourceLinkType,
    pub external_id: String,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct CreateNoteRequest {
    pub request_id: String,
    pub item_id: Option<String>,
    pub session_id: Option<String>,
    pub body: String,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct PurgeRequest {
    pub request_id: Option<String>,
    pub before: Option<String>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct PurgeQuery {
    pub before: Option<String>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct MutationDto<T: Serialize> {
    pub resource: T,
    pub replayed: bool,
    pub event_id: String,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct TombstoneDto {
    pub resource_type: String,
    pub id: String,
    pub deleted_at: String,
    pub parent_id: Option<String>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct TargetDto {
    pub project: String,
    pub worktree_path: Option<String>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ItemDto {
    pub id: String,
    pub target: TargetDto,
    pub parent_id: Option<String>,
    pub kind: ItemKind,
    pub title: String,
    pub summary: Option<String>,
    pub status: ItemStatus,
    pub sort_order: i64,
    pub source: WorkflowSource,
    pub created_at: String,
    pub updated_at: String,
    pub completed_at: Option<String>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SessionDto {
    pub id: String,
    pub target: TargetDto,
    pub item_id: Option<String>,
    pub status: SessionStatus,
    pub started_at: String,
    pub ended_at: Option<String>,
    pub source: WorkflowSource,
    pub created_at: String,
    pub updated_at: String,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct NoteDto {
    pub id: String,
    pub item_id: Option<String>,
    pub session_id: Option<String>,
    pub body: String,
    pub source: WorkflowSource,
    pub created_at: String,
    pub updated_at: String,
    pub deleted_at: Option<String>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct LinkDto {
    pub id: String,
    pub session_id: String,
    pub resource_type: ResourceLinkType,
    pub external_id: String,
    pub incarnation: Option<u64>,
    pub harness_label: Option<String>,
    pub run_id: Option<String>,
    pub observed_state: ResourceObservedState,
    pub suggested_end_time: Option<String>,
    pub first_seen_at: String,
    pub last_seen_at: String,
    pub link_source: WorkflowSource,
    pub created_at: String,
    pub updated_at: String,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct EventDto {
    pub id: String,
    pub event_type: WorkflowEventType,
    pub source: WorkflowSource,
    pub target: Option<TargetDto>,
    pub item_id: Option<String>,
    pub session_id: Option<String>,
    pub occurred_at: String,
    pub recorded_at: String,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ProjectDto {
    pub project: String,
    pub target: Option<TargetDto>,
    pub plan_count: u32,
    pub task_count: u32,
    pub running_session_count: u32,
    pub last_activity_at: Option<String>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ItemProgressDto {
    pub total_tracked_tasks: u32,
    pub completed_tracked_tasks: u32,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ItemOverviewNodeDto {
    pub item: ItemDto,
    pub progress: Option<ItemProgressDto>,
    pub notes: Vec<NoteDto>,
    pub active_sessions: Vec<SessionDto>,
    pub children: Vec<ItemOverviewNodeDto>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct WorkspaceDto {
    pub id: String,
    pub name: String,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct OverviewDto {
    pub workspace: WorkspaceDto,
    pub server_time: String,
    pub projects: Vec<ProjectDto>,
    pub plans: Vec<ItemOverviewNodeDto>,
    pub standalone_tasks: Vec<ItemOverviewNodeDto>,
    pub running_sessions: Vec<SessionDto>,
    pub recent_events: Vec<EventDto>,
    pub truncated: bool,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct EventsDto {
    pub events: Vec<EventDto>,
    pub next_cursor: Option<String>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PurgeDto {
    pub events_deleted: usize,
    pub notes_deleted: usize,
}
