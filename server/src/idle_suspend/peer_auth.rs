use std::path::{Path, PathBuf};

/// Extracted credentials of a Unix domain socket peer.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct PeerCredentials {
    pub pid: u32,
    pub uid: u32,
    pub gid: u32,
}

impl PeerCredentials {
    pub fn new(pid: u32, uid: u32, gid: u32) -> Self {
        Self { pid, uid, gid }
    }

    #[cfg(target_os = "linux")]
    pub fn from_unix_stream(stream: &tokio::net::UnixStream) -> Result<Self, PeerAuthError> {
        let ucred = stream.peer_cred().map_err(|e| PeerAuthError::Io(e.to_string()))?;
        let pid = ucred.pid().ok_or(PeerAuthError::MissingPid)? as u32;
        let uid = ucred.uid();
        let gid = ucred.gid();
        Ok(Self { pid, uid, gid })
    }
}

/// Errors occurring during peer authentication against enrolled policy.
#[derive(Debug, thiserror::Error, PartialEq, Eq)]
pub enum PeerAuthError {
    #[error("Missing peer PID in socket credentials")]
    MissingPid,
    #[error("Peer UID {actual} does not match expected enrolled UID {expected}")]
    UidMismatch { expected: u32, actual: u32 },
    #[error("Peer PID {actual} does not match expected enrolled MainPID {expected}")]
    PidMismatch { expected: u32, actual: u32 },
    #[error("Failed to read enrolled PID file at {0}: {1}")]
    PidFileReadError(PathBuf, String),
    #[error("Enrolled PID file at {0} contains invalid PID")]
    InvalidPidFile(PathBuf),
    #[error("Socket I/O error retrieving credentials: {0}")]
    Io(String),
}

impl From<std::io::Error> for PeerAuthError {
    fn from(err: std::io::Error) -> Self {
        Self::Io(err.to_string())
    }
}

/// Enrolled peer identity specification for the privileged helper.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct EnrolledPeerPolicy {
    /// Expected UID of the unprivileged server process.
    pub expected_uid: Option<u32>,
    /// Expected PID of the unprivileged server process (e.g. systemd MainPID).
    pub expected_pid: Option<u32>,
    /// Path to file containing current enrolled PID (e.g. /run/dam-hopper/server.pid).
    pub pid_file_path: Option<PathBuf>,
}

impl EnrolledPeerPolicy {
    /// Create a static policy expecting exact UID and PID.
    pub fn new_exact(uid: u32, pid: u32) -> Self {
        Self {
            expected_uid: Some(uid),
            expected_pid: Some(pid),
            pid_file_path: None,
        }
    }

    /// Create a policy tracking a dynamic PID file (e.g. /run/dam-hopper/server.pid).
    pub fn new_with_pid_file(uid: u32, pid_file: impl AsRef<Path>) -> Self {
        Self {
            expected_uid: Some(uid),
            expected_pid: None,
            pid_file_path: Some(pid_file.as_ref().to_path_buf()),
        }
    }

    /// Permissive policy used ONLY in unit tests with simulated connections.
    #[cfg(test)]
    pub fn new_test_permissive() -> Self {
        Self {
            expected_uid: None,
            expected_pid: None,
            pid_file_path: None,
        }
    }

    /// Resolve the expected PID, either from static field or from the pid file.
    pub fn resolve_expected_pid(&self) -> Result<Option<u32>, PeerAuthError> {
        if let Some(pid) = self.expected_pid {
            return Ok(Some(pid));
        }
        if let Some(path) = &self.pid_file_path {
            let content = std::fs::read_to_string(path)
                .map_err(|e| PeerAuthError::PidFileReadError(path.clone(), e.to_string()))?;
            let pid = content
                .trim()
                .parse::<u32>()
                .map_err(|_| PeerAuthError::InvalidPidFile(path.clone()))?;
            return Ok(Some(pid));
        }
        Ok(None)
    }

    /// Verify the caller's peer credentials.
    pub fn verify_credentials(&self, cred: &PeerCredentials) -> Result<(), PeerAuthError> {
        if let Some(expected_uid) = self.expected_uid {
            if cred.uid != expected_uid {
                return Err(PeerAuthError::UidMismatch {
                    expected: expected_uid,
                    actual: cred.uid,
                });
            }
        }

        if let Some(expected_pid) = self.resolve_expected_pid()? {
            if cred.pid != expected_pid {
                return Err(PeerAuthError::PidMismatch {
                    expected: expected_pid,
                    actual: cred.pid,
                });
            }
        }

        Ok(())
    }
}
