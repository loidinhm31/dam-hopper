pub mod model;
pub mod store;

#[cfg(test)]
mod tests;

pub use model::*;
pub use store::*;

/// Maximum length of an item title in characters.
pub const MAX_TITLE_CHARS: usize = 200;

/// Maximum size of a note body in bytes (8 KiB).
pub const MAX_NOTE_BYTES: usize = 8192;

/// Maximum length of an external resource identifier in characters.
pub const MAX_EXTERNAL_ID_CHARS: usize = 200;

/// Maximum size of an activity event JSON payload in bytes (4 KiB).
pub const MAX_EVENT_PAYLOAD_BYTES: usize = 4096;

/// Maximum length of an agent harness label in characters.
pub const MAX_HARNESS_LABEL_CHARS: usize = 64;

/// Maximum length of an agent run identifier in characters.
pub const MAX_RUN_ID_CHARS: usize = 128;

/// Maximum number of projects returned in an overview response.
pub const MAX_OVERVIEW_PROJECTS: usize = 100;

/// Maximum number of open items returned in an overview response.
pub const MAX_OVERVIEW_ITEMS: usize = 500;

/// Maximum number of active/running sessions returned in an overview response.
pub const MAX_OVERVIEW_SESSIONS: usize = 100;

/// Default limit for event history keyset pagination.
pub const DEFAULT_HISTORY_LIMIT: usize = 50;

/// Maximum limit for event history keyset pagination.
pub const MAX_HISTORY_LIMIT: usize = 100;

/// Default retention for activity events in days (90 days).
pub const DEFAULT_EVENT_RETENTION_DAYS: u32 = 90;

/// Default grace retention for soft-deleted notes in days (7 days).
pub const DEFAULT_DELETED_NOTE_RETENTION_DAYS: u32 = 7;

/// Maximum hierarchy depth allowed (Plan -> Phase -> Task).
pub const MAX_HIERARCHY_DEPTH: usize = 3;
