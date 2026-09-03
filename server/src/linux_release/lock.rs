//! Nonblocking deployment lock using system file locking.

use super::error::ReleaseError;
use std::fs::{self, File, OpenOptions};
use std::os::unix::fs::OpenOptionsExt;
use std::os::unix::io::AsRawFd;
use std::path::Path;

/// RAII guard holding exclusive deployment lock.
#[derive(Debug)]
pub struct DeploymentLock {
    file: File,
}

impl DeploymentLock {
    /// Acquire nonblocking exclusive lock on the given path.
    pub fn acquire(path: &Path) -> Result<Self, ReleaseError> {
        if let Some(parent) = path.parent() {
            fs::create_dir_all(parent).map_err(|e| ReleaseError::Io {
                action: "create lock directory",
                details: e.to_string(),
            })?;
        }

        let file = OpenOptions::new()
            .read(true)
            .write(true)
            .create(true)
            .truncate(false)
            .mode(0o600)
            .open(path)
            .map_err(|e| {
                ReleaseError::DeploymentLockError(format!("open '{}': {e}", path.display()))
            })?;

        let fd = file.as_raw_fd();
        let ret = unsafe { libc::flock(fd, libc::LOCK_EX | libc::LOCK_NB) };

        if ret != 0 {
            let err = std::io::Error::last_os_error();
            if err.raw_os_error() == Some(libc::EWOULDBLOCK)
                || err.raw_os_error() == Some(libc::EAGAIN)
            {
                return Err(ReleaseError::DeploymentLockBusy);
            }
            return Err(ReleaseError::DeploymentLockError(format!(
                "flock '{}': {err}",
                path.display()
            )));
        }

        Ok(Self { file })
    }
}

impl Drop for DeploymentLock {
    fn drop(&mut self) {
        let fd = self.file.as_raw_fd();
        unsafe {
            libc::flock(fd, libc::LOCK_UN);
        }
    }
}
