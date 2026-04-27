use crate::fs::upload::UploadState;
use crate::fs::FsError;

/// Encrypted upload session — wraps `UploadState` with the OPAQUE session_id
/// used to look up the AES export_key at commit time.
pub struct EncUploadState {
    pub inner: UploadState,
    /// OPAQUE session_id — used at FsPutCommit to look up export_key.
    pub session_id: String,
}

impl EncUploadState {
    pub fn new(
        target_abs: std::path::PathBuf,
        expected_len: u64,
        session_id: String,
    ) -> Result<Self, FsError> {
        Ok(Self {
            inner: UploadState::new(target_abs, expected_len)?,
            session_id,
        })
    }
}
