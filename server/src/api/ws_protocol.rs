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

    // FS — subscribe
    #[serde(rename = "fs:subscribe_tree")]
    FsSubTree { req_id: u64, project: String, path: String },
    #[serde(rename = "fs:unsubscribe_tree")]
    FsUnsubTree { sub_id: u64 },

    // FS — read (supports range reads for large files)
    #[serde(rename = "fs:read")]
    FsRead {
        req_id: u64,
        project: String,
        path: String,
        offset: Option<u64>,
        len: Option<u64>,
    },

    // FS — write protocol (begin → chunk* → commit)
    #[serde(rename = "fs:write_begin")]
    FsWriteBegin {
        req_id: u64,
        project: String,
        path: String,
        /// Client's last-known mtime (Unix seconds). Server rejects if stale.
        expected_mtime: i64,
        /// Total byte size of the content being written (used for cap check).
        size: u64,
    },
    #[serde(rename = "fs:write_chunk")]
    FsWriteChunk {
        write_id: u64,
        seq: u32,
        eof: bool,
        /// Base64-encoded chunk bytes.
        data: String,
    },
    #[serde(rename = "fs:write_commit")]
    FsWriteCommit { write_id: u64 },
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

    // FS — tree
    #[serde(rename = "fs:tree_snapshot")]
    TreeSnapshot { req_id: u64, sub_id: u64, nodes: Vec<TreeNode> },
    #[serde(rename = "fs:event")]
    FsEventMsg { sub_id: u64, event: FsEventDto },
    #[serde(rename = "fs:error")]
    FsError { req_id: u64, code: String, message: String },

    // FS — read
    #[serde(rename = "fs:read_result")]
    FsReadResult {
        req_id: u64,
        ok: bool,
        /// MIME type if detectable.
        #[serde(skip_serializing_if = "Option::is_none")]
        mime: Option<String>,
        /// True if content is binary (hex preview in client).
        binary: bool,
        /// Unix seconds; present on success.
        #[serde(skip_serializing_if = "Option::is_none")]
        mtime: Option<i64>,
        /// File size in bytes; present on success and on TOO_LARGE.
        #[serde(skip_serializing_if = "Option::is_none")]
        size: Option<u64>,
        /// Base64-encoded file content (text and binary files ≤5 MB).
        #[serde(skip_serializing_if = "Option::is_none")]
        data: Option<String>,
        /// Error code when ok=false (e.g. "TOO_LARGE", "NOT_FOUND").
        #[serde(skip_serializing_if = "Option::is_none")]
        code: Option<String>,
    },

    // FS — write
    #[serde(rename = "fs:write_ack")]
    FsWriteAck { req_id: u64, write_id: u64 },
    #[serde(rename = "fs:write_chunk_ack")]
    FsWriteChunkAck { write_id: u64, seq: u32 },
    #[serde(rename = "fs:write_result")]
    FsWriteResult {
        write_id: u64,
        ok: bool,
        #[serde(skip_serializing_if = "Option::is_none")]
        new_mtime: Option<i64>,
        /// True when the server rejected the write due to a concurrent modification.
        conflict: bool,
        #[serde(skip_serializing_if = "Option::is_none")]
        error: Option<String>,
    },
}

/// Wire message — either a JSON text frame, raw binary frame, or close signal.
pub enum WireMsg {
    Text(String),
    Binary(Vec<u8>),
    /// Signal the writer task to send a close frame with the given code.
    CloseOverflow,
}
