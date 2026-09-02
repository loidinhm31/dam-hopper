use serde::{Deserialize, Serialize};
use std::fmt;
use std::str::FromStr;
use thiserror::Error;

/// Domain error for validation and model constraints.
#[derive(Debug, Clone, PartialEq, Eq, Error)]
pub enum WorkflowModelError {
    #[error("Title cannot be empty")]
    TitleEmpty,

    #[error("Title exceeds maximum length of {max} characters (got {actual})")]
    TitleTooLong { actual: usize, max: usize },

    #[error("Note body cannot be empty")]
    NoteEmpty,

    #[error("Note body exceeds maximum size of {max} bytes (got {actual})")]
    NoteTooLong { actual: usize, max: usize },
    #[error("Note must target at least one item or session")]
    NoteTargetMissing,


    #[error("External ID cannot be empty")]
    ExternalIdEmpty,

    #[error("External ID exceeds maximum length of {max} characters (got {actual})")]
    ExternalIdTooLong { actual: usize, max: usize },

    #[error("Event payload exceeds maximum size of {max} bytes (got {actual})")]
    PayloadTooLong { actual: usize, max: usize },

    #[error("Harness label exceeds maximum length of {max} characters (got {actual})")]
    HarnessLabelTooLong { actual: usize, max: usize },

    #[error("Run ID exceeds maximum length of {max} characters (got {actual})")]
    RunIdTooLong { actual: usize, max: usize },

    #[error("Invalid item status transition from '{from}' to '{to}'")]
    InvalidItemTransition { from: ItemStatus, to: ItemStatus },

    #[error("Invalid session status transition from '{from}' to '{to}'")]
    InvalidSessionTransition {
        from: SessionStatus,
        to: SessionStatus,
    },

    #[error("Invalid parent kind for child '{child_kind:?}': parent is '{parent_kind:?}'")]
    InvalidParentKind {
        child_kind: ItemKind,
        parent_kind: Option<ItemKind>,
    },

    #[error("Invalid timestamp order: started_at ({started_at}) is after ended_at ({ended_at})")]
    InvalidTimestampOrder { started_at: u64, ended_at: u64 },

    #[error("Parent item belongs to a different workspace, project, or target scope")]
    InvalidHierarchyScope,

    #[error("Hierarchy cycle detected for item '{0}'")]
    CycleDetected(String),

    #[error("Hierarchy depth exceeds maximum of {max} levels (got {actual})")]
    DepthExceeded { actual: usize, max: usize },

    #[error("Unknown {kind} value: '{value}'")]
    UnknownEnumValue {
        kind: &'static str,
        value: String,
    },
}

/// The kind of workflow work item.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum ItemKind {
    Plan,
    Phase,
    Task,
}

impl ItemKind {
    pub fn as_str(&self) -> &'static str {
        match self {
            Self::Plan => "plan",
            Self::Phase => "phase",
            Self::Task => "task",
        }
    }
}

impl fmt::Display for ItemKind {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        write!(f, "{}", self.as_str())
    }
}

impl FromStr for ItemKind {
    type Err = WorkflowModelError;

    fn from_str(s: &str) -> Result<Self, Self::Err> {
        match s.to_ascii_lowercase().as_str() {
            "plan" => Ok(Self::Plan),
            "phase" => Ok(Self::Phase),
            "task" => Ok(Self::Task),
            _ => Err(WorkflowModelError::UnknownEnumValue {
                kind: "ItemKind",
                value: s.to_string(),
            }),
        }
    }
}

/// Semantic status of a workflow work item.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum ItemStatus {
    Backlog,
    Next,
    InProgress,
    Blocked,
    Done,
    Canceled,
}

impl ItemStatus {
    pub fn as_str(&self) -> &'static str {
        match self {
            Self::Backlog => "backlog",
            Self::Next => "next",
            Self::InProgress => "in_progress",
            Self::Blocked => "blocked",
            Self::Done => "done",
            Self::Canceled => "canceled",
        }
    }

    pub fn is_open(&self) -> bool {
        matches!(self, Self::Backlog | Self::Next | Self::InProgress | Self::Blocked)
    }

    pub fn is_completed(&self) -> bool {
        matches!(self, Self::Done)
    }
}

impl fmt::Display for ItemStatus {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        write!(f, "{}", self.as_str())
    }
}

impl FromStr for ItemStatus {
    type Err = WorkflowModelError;

    fn from_str(s: &str) -> Result<Self, Self::Err> {
        match s.to_ascii_lowercase().as_str() {
            "backlog" => Ok(Self::Backlog),
            "next" => Ok(Self::Next),
            "in_progress" => Ok(Self::InProgress),
            "blocked" => Ok(Self::Blocked),
            "done" => Ok(Self::Done),
            "canceled" => Ok(Self::Canceled),
            _ => Err(WorkflowModelError::UnknownEnumValue {
                kind: "ItemStatus",
                value: s.to_string(),
            }),
        }
    }
}

/// Lifecycle status of a work session.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum SessionStatus {
    Running,
    Ended,
    Abandoned,
}

impl SessionStatus {
    pub fn as_str(&self) -> &'static str {
        match self {
            Self::Running => "running",
            Self::Ended => "ended",
            Self::Abandoned => "abandoned",
        }
    }

    pub fn is_active(&self) -> bool {
        matches!(self, Self::Running)
    }
}

impl fmt::Display for SessionStatus {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        write!(f, "{}", self.as_str())
    }
}

impl FromStr for SessionStatus {
    type Err = WorkflowModelError;

    fn from_str(s: &str) -> Result<Self, Self::Err> {
        match s.to_ascii_lowercase().as_str() {
            "running" => Ok(Self::Running),
            "ended" => Ok(Self::Ended),
            "abandoned" => Ok(Self::Abandoned),
            _ => Err(WorkflowModelError::UnknownEnumValue {
                kind: "SessionStatus",
                value: s.to_string(),
            }),
        }
    }
}

/// Type of linked external resource.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum ResourceLinkType {
    Terminal,
    Agent,
}

impl ResourceLinkType {
    pub fn as_str(&self) -> &'static str {
        match self {
            Self::Terminal => "terminal",
            Self::Agent => "agent",
        }
    }
}

impl fmt::Display for ResourceLinkType {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        write!(f, "{}", self.as_str())
    }
}

impl FromStr for ResourceLinkType {
    type Err = WorkflowModelError;

    fn from_str(s: &str) -> Result<Self, Self::Err> {
        match s.to_ascii_lowercase().as_str() {
            "terminal" => Ok(Self::Terminal),
            "agent" => Ok(Self::Agent),
            _ => Err(WorkflowModelError::UnknownEnumValue {
                kind: "ResourceLinkType",
                value: s.to_string(),
            }),
        }
    }
}

/// Observed health/state of an external linked resource.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum ResourceObservedState {
    Attached,
    Exited,
    Stale,
    Detached,
    Crashed,
    Unknown,
}

impl ResourceObservedState {
    pub fn as_str(&self) -> &'static str {
        match self {
            Self::Attached => "attached",
            Self::Exited => "exited",
            Self::Stale => "stale",
            Self::Detached => "detached",
            Self::Crashed => "crashed",
            Self::Unknown => "unknown",
        }
    }
}

impl fmt::Display for ResourceObservedState {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        write!(f, "{}", self.as_str())
    }
}

impl FromStr for ResourceObservedState {
    type Err = WorkflowModelError;

    fn from_str(s: &str) -> Result<Self, Self::Err> {
        match s.to_ascii_lowercase().as_str() {
            "attached" => Ok(Self::Attached),
            "exited" => Ok(Self::Exited),
            "stale" => Ok(Self::Stale),
            "detached" => Ok(Self::Detached),
            "crashed" => Ok(Self::Crashed),
            "unknown" => Ok(Self::Unknown),
            _ => Err(WorkflowModelError::UnknownEnumValue {
                kind: "ResourceObservedState",
                value: s.to_string(),
            }),
        }
    }
}

/// Provenance/source of workflow actions and mutations.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum WorkflowSource {
    Manual,
    Terminal,
    Git,
    Agent,
    System,
}

impl WorkflowSource {
    pub fn as_str(&self) -> &'static str {
        match self {
            Self::Manual => "manual",
            Self::Terminal => "terminal",
            Self::Git => "git",
            Self::Agent => "agent",
            Self::System => "system",
        }
    }
}

impl fmt::Display for WorkflowSource {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        write!(f, "{}", self.as_str())
    }
}

impl FromStr for WorkflowSource {
    type Err = WorkflowModelError;

    fn from_str(s: &str) -> Result<Self, Self::Err> {
        match s.to_ascii_lowercase().as_str() {
            "manual" => Ok(Self::Manual),
            "terminal" => Ok(Self::Terminal),
            "git" => Ok(Self::Git),
            "agent" => Ok(Self::Agent),
            "system" => Ok(Self::System),
            _ => Err(WorkflowModelError::UnknownEnumValue {
                kind: "WorkflowSource",
                value: s.to_string(),
            }),
        }
    }
}

/// Typed event classification for activity history.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum WorkflowEventType {
    ItemCreated,
    ItemUpdated,
    ItemStatusChanged,
    ItemDeleted,
    SessionStarted,
    SessionEnded,
    SessionAbandoned,
    SessionUpdated,
    ResourceLinked,
    ResourceUnlinked,
    ResourceObserved,
    NoteAdded,
    NoteDeleted,
    WorkspacePurged,
}

impl WorkflowEventType {
    pub fn as_str(&self) -> &'static str {
        match self {
            Self::ItemCreated => "item_created",
            Self::ItemUpdated => "item_updated",
            Self::ItemStatusChanged => "item_status_changed",
            Self::ItemDeleted => "item_deleted",
            Self::SessionStarted => "session_started",
            Self::SessionEnded => "session_ended",
            Self::SessionAbandoned => "session_abandoned",
            Self::SessionUpdated => "session_updated",
            Self::ResourceLinked => "resource_linked",
            Self::ResourceUnlinked => "resource_unlinked",
            Self::ResourceObserved => "resource_observed",
            Self::NoteAdded => "note_added",
            Self::NoteDeleted => "note_deleted",
            Self::WorkspacePurged => "workspace_purged",
        }
    }
}

impl fmt::Display for WorkflowEventType {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        write!(f, "{}", self.as_str())
    }
}

impl FromStr for WorkflowEventType {
    type Err = WorkflowModelError;

    fn from_str(s: &str) -> Result<Self, Self::Err> {
        match s.to_ascii_lowercase().as_str() {
            "item_created" => Ok(Self::ItemCreated),
            "item_updated" => Ok(Self::ItemUpdated),
            "item_status_changed" => Ok(Self::ItemStatusChanged),
            "item_deleted" => Ok(Self::ItemDeleted),
            "session_started" => Ok(Self::SessionStarted),
            "session_ended" => Ok(Self::SessionEnded),
            "session_abandoned" => Ok(Self::SessionAbandoned),
            "session_updated" => Ok(Self::SessionUpdated),
            "resource_linked" => Ok(Self::ResourceLinked),
            "resource_unlinked" => Ok(Self::ResourceUnlinked),
            "resource_observed" => Ok(Self::ResourceObserved),
            "note_added" => Ok(Self::NoteAdded),
            "note_deleted" => Ok(Self::NoteDeleted),
            "workspace_purged" => Ok(Self::WorkspacePurged),
            _ => Err(WorkflowModelError::UnknownEnumValue {
                kind: "WorkflowEventType",
                value: s.to_string(),
            }),
        }
    }
}
