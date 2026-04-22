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
    #[serde(rename = "terminal:attach")]
    TermAttach {
        id: String,
        /// Client's last received byte offset (optional, for delta replay)
        from_offset: Option<u64>,
    },

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

    // Terminal buffer replay (response to terminal:attach)
    #[serde(rename = "terminal:buffer")]
    TermBuffer {
        id: String,
        /// Base64-encoded buffer content (lossy UTF-8)
        data: String,
        /// Current buffer byte offset (client stores for next attach)
        offset: u64,
    },

    // Terminal exit — enhanced with restart metadata
    #[serde(rename = "terminal:exit")]
    TermExit {
        id: String,
        #[serde(rename = "exitCode")]
        exit_code: Option<i32>,
        #[serde(rename = "willRestart")]
        will_restart: bool,
        /// Milliseconds until restart attempt (present if willRestart=true).
        #[serde(rename = "restartIn", skip_serializing_if = "Option::is_none")]
        restart_in: Option<u64>,
        /// Cumulative restart counter (present if willRestart=true after first restart).
        #[serde(rename = "restartCount", skip_serializing_if = "Option::is_none")]
        restart_count: Option<u32>,
    },

    // Process restarted successfully
    #[serde(rename = "process:restarted")]
    ProcessRestarted {
        id: String,
        #[serde(rename = "restartCount")]
        restart_count: u32,
        #[serde(rename = "previousExitCode")]
        previous_exit_code: Option<i32>,
    },

    // FS — tree
    #[serde(rename = "fs:tree_snapshot")]
    TreeSnapshot { req_id: u64, sub_id: u64, nodes: Vec<TreeNode> },
    #[serde(rename = "fs:event")]
    FsEventMsg { sub_id: u64, event: FsEventDto },
    #[serde(rename = "fs:error")]
    FsError { req_id: u64, code: String, message: String },

    // FS — overflow notice (subscription dropped)
    #[serde(rename = "fs:overflow")]
    FsOverflow {
        sub_id: u64,
        message: String,
    },

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

    // Tunnel lifecycle events (server → client push)
    #[serde(rename = "tunnel:created")]
    TunnelCreated {
        id: String,
        port: u16,
        label: String,
        driver: String,
        status: String,
        #[serde(rename = "startedAt")]
        started_at: i64,
    },

    #[serde(rename = "tunnel:ready")]
    TunnelReady {
        id: String,
        url: String,
    },

    #[serde(rename = "tunnel:failed")]
    TunnelFailed {
        id: String,
        error: String,
    },

    #[serde(rename = "tunnel:stopped")]
    TunnelStopped {
        id: String,
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

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_terminal_exit_enhanced_serialization() {
        // Full payload with all optional fields
        let msg_full = ServerMsg::TermExit {
            id: "test-123".to_string(),
            exit_code: Some(1),
            will_restart: true,
            restart_in: Some(2000),
            restart_count: Some(3),
        };
        let json_full = serde_json::to_value(&msg_full).unwrap();
        assert_eq!(json_full["kind"], "terminal:exit");
        assert_eq!(json_full["id"], "test-123");
        assert_eq!(json_full["exitCode"], 1);
        assert_eq!(json_full["willRestart"], true);
        assert_eq!(json_full["restartIn"], 2000);
        assert_eq!(json_full["restartCount"], 3);

        // Minimal payload (no restart)
        let msg_min = ServerMsg::TermExit {
            id: "test-456".to_string(),
            exit_code: Some(0),
            will_restart: false,
            restart_in: None,
            restart_count: None,
        };
        let json_min = serde_json::to_value(&msg_min).unwrap();
        assert_eq!(json_min["kind"], "terminal:exit");
        assert_eq!(json_min["exitCode"], 0);
        assert_eq!(json_min["willRestart"], false);
        // Optional fields should not be present
        assert!(json_min.get("restartIn").is_none());
        assert!(json_min.get("restartCount").is_none());
    }

    #[test]
    fn test_process_restarted_serialization() {
        let msg = ServerMsg::ProcessRestarted {
            id: "test-789".to_string(),
            restart_count: 5,
            previous_exit_code: Some(1),
        };
        let json = serde_json::to_value(&msg).unwrap();
        assert_eq!(json["kind"], "process:restarted");
        assert_eq!(json["id"], "test-789");
        assert_eq!(json["restartCount"], 5);
        assert_eq!(json["previousExitCode"], 1);

        // With null previous exit code
        let msg_null = ServerMsg::ProcessRestarted {
            id: "test-999".to_string(),
            restart_count: 1,
            previous_exit_code: None,
        };
        let json_null = serde_json::to_value(&msg_null).unwrap();
        assert_eq!(json_null["previousExitCode"], serde_json::Value::Null);
    }

    #[test]
    fn test_fs_overflow_serialization() {
        let msg = ServerMsg::FsOverflow {
            sub_id: 42,
            message: "Buffer overflow detected".to_string(),
        };
        let json = serde_json::to_value(&msg).unwrap();
        assert_eq!(json["kind"], "fs:overflow");
        assert_eq!(json["sub_id"], 42);
        assert_eq!(json["message"], "Buffer overflow detected");
    }

    #[test]
    fn test_backward_compatible_exit_parsing() {
        // Old clients should still be able to parse basic exit events
        let json_str = r#"{"kind":"terminal:exit","id":"legacy","exitCode":0,"willRestart":false}"#;
        let parsed: Result<serde_json::Value, _> = serde_json::from_str(json_str);
        assert!(parsed.is_ok());
        let val = parsed.unwrap();
        assert_eq!(val["kind"], "terminal:exit");
        assert_eq!(val["exitCode"], 0);
    }

    #[test]
    fn test_tunnel_created_serialization() {
        let msg = ServerMsg::TunnelCreated {
            id: "abc-123".to_string(),
            port: 3000,
            label: "frontend".to_string(),
            driver: "cloudflared".to_string(),
            status: "starting".to_string(),
            started_at: 1714000000000,
        };
        let json = serde_json::to_value(&msg).unwrap();
        assert_eq!(json["kind"], "tunnel:created");
        assert_eq!(json["id"], "abc-123");
        assert_eq!(json["port"], 3000);
        assert_eq!(json["label"], "frontend");
        assert_eq!(json["status"], "starting");
        assert_eq!(json["startedAt"], 1714000000000i64);
    }

    #[test]
    fn test_tunnel_ready_serialization() {
        let msg = ServerMsg::TunnelReady {
            id: "abc-123".to_string(),
            url: "https://example.trycloudflare.com".to_string(),
        };
        let json = serde_json::to_value(&msg).unwrap();
        assert_eq!(json["kind"], "tunnel:ready");
        assert_eq!(json["id"], "abc-123");
        assert_eq!(json["url"], "https://example.trycloudflare.com");
    }

    #[test]
    fn test_tunnel_failed_serialization() {
        let msg = ServerMsg::TunnelFailed {
            id: "abc-123".to_string(),
            error: "timeout waiting for URL".to_string(),
        };
        let json = serde_json::to_value(&msg).unwrap();
        assert_eq!(json["kind"], "tunnel:failed");
        assert_eq!(json["error"], "timeout waiting for URL");
    }

    #[test]
    fn test_tunnel_stopped_serialization() {
        let msg = ServerMsg::TunnelStopped {
            id: "abc-123".to_string(),
        };
        let json = serde_json::to_value(&msg).unwrap();
        assert_eq!(json["kind"], "tunnel:stopped");
        assert_eq!(json["id"], "abc-123");
    }
}
