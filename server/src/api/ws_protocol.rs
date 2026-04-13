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
        /// Optional encoding: "base64" (default) or "binary".
        #[serde(default)]
        encoding: Option<String>,
    },
    #[serde(rename = "fs:write_chunk")]
    FsWriteChunk {
        write_id: u64,
        seq: u32,
        eof: bool,
        /// Base64-encoded chunk bytes.
        data: String,
    },
    /// JSON header for a write chunk; raw bytes arrive in the NEXT binary WS frame.
    #[serde(rename = "fs:write_chunk_binary")]
    FsWriteChunkBinary {
        write_id: u64,
        seq: u32,
    },
    #[serde(rename = "fs:write_commit")]
    FsWriteCommit { write_id: u64 },

    // FS — mutating ops (create/rename/delete/move)
    #[serde(rename = "fs:op")]
    FsOp {
        req_id: u64,
        /// "create_file" | "create_dir" | "rename" | "delete" | "move"
        op: String,
        project: String,
        /// Source path (relative to project root).
        path: String,
        /// Destination path for rename/move (relative to project root).
        new_path: Option<String>,
        /// Allow .git/ writes for delete op.
        #[serde(default)]
        force_git: bool,
    },

    // FS — upload protocol (begin → chunk(binary)* → commit)
    #[serde(rename = "fs:upload_begin")]
    FsUploadBegin {
        req_id: u64,
        /// Client-chosen identifier for this upload session.
        upload_id: String,
        project: String,
        /// Target directory (relative to project root).
        dir: String,
        /// Filename only — must not contain path separators.
        filename: String,
        /// Declared total file size in bytes.
        len: u64,
    },
    /// JSON header for an upload chunk; raw bytes arrive in the NEXT binary WS frame.
    #[serde(rename = "fs:upload_chunk")]
    FsUploadChunk {
        upload_id: String,
        seq: u64,
    },
    #[serde(rename = "fs:upload_commit")]
    FsUploadCommit {
        req_id: u64,
        upload_id: String,
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

    // FS — mutating op result
    #[serde(rename = "fs:op_result")]
    FsOpResult {
        req_id: u64,
        ok: bool,
        #[serde(skip_serializing_if = "Option::is_none")]
        error: Option<String>,
    },

    // FS — upload results
    #[serde(rename = "fs:upload_begin_ok")]
    FsUploadBeginOk { req_id: u64, upload_id: String },
    #[serde(rename = "fs:upload_chunk_ack")]
    FsUploadChunkAck { upload_id: String, seq: u64 },
    #[serde(rename = "fs:upload_result")]
    FsUploadResult {
        req_id: u64,
        upload_id: String,
        ok: bool,
        #[serde(skip_serializing_if = "Option::is_none")]
        new_mtime: Option<i64>,
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
