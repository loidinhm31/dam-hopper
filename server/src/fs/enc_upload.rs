use crate::fs::upload::UploadState;
use crate::fs::FsError;

/// Encrypted upload session — wraps `UploadState` with the OPAQUE session_id
/// used to look up the aes_key at commit time.
pub struct EncUploadState {
    pub inner: UploadState,
    /// OPAQUE session_id — used at FsPutCommit to look up aes_key.
    pub session_id: String,
    /// Optional mtime the client observed when starting upload; checked for conflict at commit.
    pub expected_mtime: Option<i64>,
}

impl EncUploadState {
    pub fn new(
        target_abs: std::path::PathBuf,
        expected_len: u64,
        session_id: String,
        expected_mtime: Option<i64>,
    ) -> Result<Self, FsError> {
        Ok(Self {
            inner: UploadState::new(target_abs, expected_len)?,
            session_id,
            expected_mtime,
        })
    }
}
