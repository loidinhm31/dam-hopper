use std::io::Write as _;
use std::path::PathBuf;
use std::time::UNIX_EPOCH;

use crate::fs::error::FsError;

/// Max upload size: 100 MB.
pub const MAX_UPLOAD_BYTES: u64 = 100 * 1024 * 1024;

// ---------------------------------------------------------------------------
// In-flight upload state (per connection, keyed by upload_id)
// ---------------------------------------------------------------------------

pub struct UploadState {
    /// Temporary file co-located with the target directory (same FS partition).
    pub temp: tempfile::NamedTempFile,
    /// Validated absolute target path (may not exist yet).
    pub target_abs: PathBuf,
    /// Total bytes accumulated so far.
    pub bytes_written: u64,
    /// Declared total size from upload_begin; enforced at chunk and commit.
    pub expected_len: u64,
    /// Next expected seq (monotonic).
    pub next_seq: u64,
}

impl UploadState {
    /// Open a new NamedTempFile in the same directory as `target_abs`.
    pub fn new(target_abs: PathBuf, expected_len: u64) -> Result<Self, FsError> {
        let parent = target_abs.parent().ok_or_else(|| {
            FsError::Io(std::io::Error::new(
                std::io::ErrorKind::InvalidInput,
                "upload target has no parent directory",
            ))
        })?;
        let temp = tempfile::NamedTempFile::new_in(parent).map_err(FsError::Io)?;
        Ok(Self { temp, target_abs, bytes_written: 0, expected_len, next_seq: 0 })
    }

    /// Append chunk bytes. Enforces running byte count ≤ declared len AND ≤ 100 MB cap.
    pub fn append_chunk(&mut self, data: &[u8]) -> Result<(), FsError> {
        let new_total = self.bytes_written + data.len() as u64;
        if new_total > self.expected_len.max(MAX_UPLOAD_BYTES) {
            return Err(FsError::TooLarge(new_total));
        }
        self.temp.write_all(data).map_err(FsError::Io)?;
        self.bytes_written = new_total;
        self.next_seq += 1;
        Ok(())
    }

    /// Finalize: verify byte count, optionally fsync, atomic rename to target.
    ///
    /// Returns the new mtime (Unix seconds) of the committed file.
    pub fn commit(self, fsync: bool) -> Result<i64, FsError> {
        if self.bytes_written != self.expected_len {
            return Err(FsError::MutationRefused(format!(
                "upload commit: bytes_written {} ≠ expected_len {}",
                self.bytes_written, self.expected_len,
            )));
        }

        if fsync {
            self.temp.as_file().sync_data().map_err(FsError::Io)?;
        }

        let target = self.target_abs.clone();
        self.temp.persist(&target).map_err(|e| FsError::Io(e.error))?;

        let meta = std::fs::metadata(&target).map_err(FsError::Io)?;
        let mtime = meta
            .modified()
            .ok()
            .and_then(|t| t.duration_since(UNIX_EPOCH).ok())
            .map(|d| d.as_secs() as i64)
            .unwrap_or(0);

        Ok(mtime)
    }
}
