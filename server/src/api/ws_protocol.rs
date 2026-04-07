/// WS message envelope — hard cut (no legacy shim).
///
/// Inbound: `{"kind": "...", ...fields}`
/// Outbound: same tag field.
///
/// **Migration note:** This replaces the old `{"type": "..."}` envelope.
/// Server + web must be updated atomically in the same PR (validated 2026-04-08).
use serde::{Deserialize, Serialize};

use crate::fs::{FsEvent, TreeNode};

// ---------------------------------------------------------------------------
// Inbound
// ---------------------------------------------------------------------------

#[derive(Debug, Deserialize)]
#[serde(tag = "kind")]
pub enum ClientMsg {
    // Terminal
    #[serde(rename = "terminal:write")]
    TermWrite { id: String, data: String },
    #[serde(rename = "terminal:resize")]
    TermResize { id: String, cols: u16, rows: u16 },

    // FS
    #[serde(rename = "fs:subscribe_tree")]
    FsSubTree { req_id: u64, project: String, path: String },
    #[serde(rename = "fs:unsubscribe_tree")]
    FsUnsubTree { sub_id: u64 },
    #[serde(rename = "fs:read")]
    FsRead {
        req_id: u64,
        project: String,
        path: String,
        offset: Option<u64>,
        len: Option<u64>,
    },
}

// ---------------------------------------------------------------------------
// Outbound
// ---------------------------------------------------------------------------

/// DTO carrying FS event data over the wire. Mirrors `FsEvent` but with
/// string paths (easier JSON consumer) and a flattened rename structure.
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct FsEventDto {
    pub kind: String,
    /// Absolute path (destination for renames).
    pub path: String,
    /// Rename source path, `null` for non-rename events.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub from: Option<String>,
}

impl From<FsEvent> for FsEventDto {
    fn from(ev: FsEvent) -> Self {
        FsEventDto {
            kind: format!("{:?}", ev.kind).to_lowercase(),
            path: ev.path.to_string_lossy().replace('\\', "/"),
            from: ev.from.map(|p| p.to_string_lossy().replace('\\', "/")),
        }
    }
}

#[derive(Debug, Serialize)]
#[serde(tag = "kind")]
pub enum ServerMsg {
    // Terminal output
    #[serde(rename = "terminal:output")]
    TermOutput { id: String, data: String },

    // FS
    #[serde(rename = "fs:tree_snapshot")]
    TreeSnapshot { req_id: u64, sub_id: u64, nodes: Vec<TreeNode> },
    #[serde(rename = "fs:event")]
    FsEventMsg { sub_id: u64, event: FsEventDto },
    #[serde(rename = "fs:error")]
    FsError { req_id: u64, code: String, message: String },
    #[serde(rename = "fs:read_result")]
    FsReadResult {
        req_id: u64,
        ok: bool,
        mime: Option<String>,
        binary: bool,
        /// Base64-encoded file content (only for text/small binary files).
        #[serde(skip_serializing_if = "Option::is_none")]
        data: Option<String>,
    },
}

/// Wire message — either a JSON text frame, raw binary frame, or close signal.
pub enum WireMsg {
    Text(String),
    Binary(Vec<u8>),
    /// Signal the writer task to send a close frame with the given code.
    CloseOverflow,
}
