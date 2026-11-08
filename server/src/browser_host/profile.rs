use std::fmt;
use std::fs::{self, File, OpenOptions};
use std::path::{Path, PathBuf};
use std::time::{Duration, Instant, SystemTime, UNIX_EPOCH};

use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};

#[derive(Debug)]
pub enum ProfileError {
    Io(std::io::Error),
    LockBusy(String),
    LockFailed(String),
    CorruptMetadata(String),
    ResetFailed(String),
    CleanupPending(String),
    PermissionError(String),
}

impl fmt::Display for ProfileError {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            Self::Io(err) => write!(f, "profile I/O error: {err}"),
            Self::LockBusy(msg) => write!(f, "profile lock busy: {msg}"),
            Self::LockFailed(msg) => write!(f, "profile lock failed: {msg}"),
            Self::CorruptMetadata(msg) => write!(f, "corrupt profile metadata: {msg}"),
            Self::ResetFailed(msg) => write!(f, "profile reset failed: {msg}"),
            Self::CleanupPending(msg) => write!(f, "profile cleanup pending: {msg}"),
            Self::PermissionError(msg) => write!(f, "profile permission error: {msg}"),
        }
    }
}

impl std::error::Error for ProfileError {}

impl From<std::io::Error> for ProfileError {
    fn from(err: std::io::Error) -> Self {
        Self::Io(err)
    }
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ManagerMetadata {
    pub subject: String,
    pub is_dev: bool,
    pub profile_epoch: u64,
    pub browser_incarnation: Option<String>,
    pub updated_at_unix_ms: u64,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub last_reset_operation_id: Option<String>,
    pub process_pid: Option<u32>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub process_pgid: Option<i32>,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum ResetStage {
    Initiated,
    Terminating,
    DeletingUserData,
    RecreatingUserData,
    Failed,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ResetTombstone {
    pub operation_id: String,
    pub target_profile_epoch: u64,
    pub stage: ResetStage,
    pub created_at_unix_ms: u64,
    pub updated_at_unix_ms: u64,
    pub error: Option<String>,
    pub process_pid: Option<u32>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub process_pgid: Option<i32>,
}

pub fn now_unix_ms() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_millis() as u64)
        .unwrap_or(0)
}

/// An exclusive advisory OS lock for a principal profile.
///
/// Holds open `manager.lock`. The lock is released on drop.
/// Stable lock inode across credential deletion: the lock file itself is never deleted.
pub struct ProfileLock {
    file: File,
    path: PathBuf,
}

impl ProfileLock {
    pub fn try_acquire(path: &Path) -> Result<Self, ProfileError> {
        let file = OpenOptions::new()
            .read(true)
            .write(true)
            .create(true)
            .truncate(false)
            .open(path)
            .map_err(|e| ProfileError::LockFailed(format!("cannot open {}: {e}", path.display())))?;

        #[cfg(unix)]
        {
            use std::os::unix::io::AsRawFd;
            let fd = file.as_raw_fd();
            let ret = unsafe { libc::flock(fd, libc::LOCK_EX | libc::LOCK_NB) };
            if ret != 0 {
                let err = std::io::Error::last_os_error();
                if err.raw_os_error() == Some(libc::EWOULDBLOCK) || err.raw_os_error() == Some(libc::EAGAIN) {
                    return Err(ProfileError::LockBusy(format!(
                        "profile is locked by another process: {}",
                        path.display()
                    )));
                }
                return Err(ProfileError::LockFailed(format!(
                    "flock failed on {}: {err}",
                    path.display()
                )));
            }
            Ok(Self {
                file,
                path: path.to_path_buf(),
            })
        }
        #[cfg(not(unix))]
        {
            Ok(Self {
                file,
                path: path.to_path_buf(),
            })
        }
    }

    pub async fn acquire_with_timeout(path: &Path, max_wait: Duration) -> Result<Self, ProfileError> {
        let start = Instant::now();
        loop {
            match Self::try_acquire(path) {
                Ok(lock) => return Ok(lock),
                Err(ProfileError::LockBusy(_)) => {
                    if start.elapsed() >= max_wait {
                        return Err(ProfileError::LockBusy(format!(
                            "timed out waiting for profile lock on {}",
                            path.display()
                        )));
                    }
                    tokio::time::sleep(Duration::from_millis(50)).await;
                }
                Err(other) => return Err(other),
            }
        }
    }

    pub fn path(&self) -> &Path {
        &self.path
    }
}

impl Drop for ProfileLock {
    fn drop(&mut self) {
        #[cfg(unix)]
        {
            use std::os::unix::io::AsRawFd;
            unsafe {
                libc::flock(self.file.as_raw_fd(), libc::LOCK_UN);
            }
        }
    }
}

#[derive(Debug, Clone)]
pub struct ManagedProfile {
    subject: String,
    is_dev: bool,
    principal_dir: PathBuf,
    lock_file: PathBuf,
    metadata_file: PathBuf,
    reset_file: PathBuf,
    user_data_dir: PathBuf,
}

impl ManagedProfile {
    pub fn new(profile_root: &Path, subject: &str, is_dev: bool) -> Result<Self, ProfileError> {
        let mut hasher = Sha256::new();
        hasher.update(subject.as_bytes());
        let hash = hex::encode(hasher.finalize());

        let namespace = if is_dev { "dev" } else { "prod" };
        let principal_dir = profile_root.join(namespace).join(hash);

        let lock_file = principal_dir.join("manager.lock");
        let metadata_file = principal_dir.join("manager.json");
        let reset_file = principal_dir.join("reset.json");
        let user_data_dir = principal_dir.join("user-data");

        Ok(Self {
            subject: subject.to_string(),
            is_dev,
            principal_dir,
            lock_file,
            metadata_file,
            reset_file,
            user_data_dir,
        })
    }

    pub fn subject(&self) -> &str {
        &self.subject
    }

    pub fn is_dev(&self) -> bool {
        self.is_dev
    }

    pub fn principal_dir(&self) -> &Path {
        &self.principal_dir
    }

    pub fn lock_file(&self) -> &Path {
        &self.lock_file
    }

    pub fn metadata_file(&self) -> &Path {
        &self.metadata_file
    }

    pub fn reset_file(&self) -> &Path {
        &self.reset_file
    }

    pub fn user_data_dir(&self) -> &Path {
        &self.user_data_dir
    }

    /// Try to acquire exclusive OS lock for this profile.
    pub fn try_lock(&self) -> Result<ProfileLock, ProfileError> {
        self.ensure_principal_dir()?;
        ProfileLock::try_acquire(&self.lock_file)
    }

    /// Acquire exclusive OS lock for this profile, waiting up to `max_wait`.
    pub async fn lock_with_timeout(&self, max_wait: Duration) -> Result<ProfileLock, ProfileError> {
        self.ensure_principal_dir()?;
        ProfileLock::acquire_with_timeout(&self.lock_file, max_wait).await
    }

    /// Ensure restricted principal directory exists with mode 0700.
    pub fn ensure_principal_dir(&self) -> Result<(), ProfileError> {
        if let Some(parent) = self.principal_dir.parent() {
            if !parent.exists() {
                fs::create_dir_all(parent)?;
                #[cfg(unix)]
                {
                    use std::os::unix::fs::PermissionsExt;
                    let _ = fs::set_permissions(parent, fs::Permissions::from_mode(0o700));
                }
            }
        }
        if !self.principal_dir.exists() {
            fs::create_dir_all(&self.principal_dir)?;
            #[cfg(unix)]
            {
                use std::os::unix::fs::PermissionsExt;
                let _ = fs::set_permissions(&self.principal_dir, fs::Permissions::from_mode(0o700));
            }
        }
        Ok(())
    }

    /// Ensure `user-data` directory exists with mode 0700.
    pub fn ensure_user_data_dir(&self) -> Result<(), ProfileError> {
        self.ensure_principal_dir()?;
        if !self.user_data_dir.exists() {
            fs::create_dir_all(&self.user_data_dir)?;
            #[cfg(unix)]
            {
                use std::os::unix::fs::PermissionsExt;
                let _ = fs::set_permissions(&self.user_data_dir, fs::Permissions::from_mode(0o700));
            }
        }
        Ok(())
    }

    /// Load or initialize manager metadata.
    pub fn load_or_init_metadata(&self) -> Result<ManagerMetadata, ProfileError> {
        if self.metadata_file.exists() {
            let content = fs::read_to_string(&self.metadata_file)?;
            match serde_json::from_str::<ManagerMetadata>(&content) {
                Ok(meta) => Ok(meta),
                Err(err) => Err(ProfileError::CorruptMetadata(format!(
                    "cannot parse {}: {err}",
                    self.metadata_file.display()
                ))),
            }
        } else {
            let meta = ManagerMetadata {
                subject: self.subject.clone(),
                is_dev: self.is_dev,
                profile_epoch: 1,
                browser_incarnation: None,
                updated_at_unix_ms: now_unix_ms(),
                last_reset_operation_id: None,
                process_pid: None,
                process_pgid: None,
            };
            self.save_metadata(&meta)?;
            Ok(meta)
        }
    }

    /// Save manager metadata atomically (0600 on Unix).
    pub fn save_metadata(&self, meta: &ManagerMetadata) -> Result<(), ProfileError> {
        self.ensure_principal_dir()?;
        let json = serde_json::to_string_pretty(meta).map_err(|e| {
            ProfileError::CorruptMetadata(format!("cannot serialize metadata: {e}"))
        })?;

        let tmp_file = self.principal_dir.join(format!("manager.json.tmp.{}.{}", std::process::id(), uuid::Uuid::new_v4().simple()));
        fs::write(&tmp_file, json.as_bytes())?;

        #[cfg(unix)]
        {
            use std::os::unix::fs::PermissionsExt;
            let _ = fs::set_permissions(&tmp_file, fs::Permissions::from_mode(0o600));
        }

        fs::rename(&tmp_file, &self.metadata_file)?;
        Ok(())
    }

    /// Check if a reset tombstone exists.
    pub fn load_tombstone(&self) -> Result<Option<ResetTombstone>, ProfileError> {
        if !self.reset_file.exists() {
            return Ok(None);
        }
        let content = fs::read_to_string(&self.reset_file)?;
        let tombstone = serde_json::from_str::<ResetTombstone>(&content).map_err(|e| {
            ProfileError::CorruptMetadata(format!("cannot parse tombstone {}: {e}", self.reset_file.display()))
        })?;
        Ok(Some(tombstone))
    }

    /// Save reset tombstone atomically (0600 on Unix).
    pub fn save_tombstone(&self, tombstone: &ResetTombstone) -> Result<(), ProfileError> {
        self.ensure_principal_dir()?;
        let json = serde_json::to_string_pretty(tombstone).map_err(|e| {
            ProfileError::CorruptMetadata(format!("cannot serialize tombstone: {e}"))
        })?;

        let tmp_file = self.principal_dir.join(format!("reset.json.tmp.{}.{}", std::process::id(), uuid::Uuid::new_v4().simple()));
        fs::write(&tmp_file, json.as_bytes())?;

        #[cfg(unix)]
        {
            use std::os::unix::fs::PermissionsExt;
            let _ = fs::set_permissions(&tmp_file, fs::Permissions::from_mode(0o600));
        }

        fs::rename(&tmp_file, &self.reset_file)?;
        Ok(())
    }

    /// Clear reset tombstone.
    pub fn clear_tombstone(&self) -> Result<(), ProfileError> {
        if self.reset_file.exists() {
            fs::remove_file(&self.reset_file)?;
        }
        Ok(())
    }

    /// Checks if a managed profile directory and user-data dir exist.
    pub fn has_managed_profile(&self) -> bool {
        self.user_data_dir.exists() && self.user_data_dir.is_dir()
    }

    /// Delete user-data directory completely.
    ///
    /// Preserves manager.lock, manager.json, and reset.json.
    pub fn delete_user_data(&self) -> Result<(), ProfileError> {
        if self.user_data_dir.exists() {
            fs::remove_dir_all(&self.user_data_dir)?;
        }
        Ok(())
    }

    /// Recreate empty user-data directory with 0700 permissions.
    pub fn recreate_user_data(&self) -> Result<(), ProfileError> {
        self.ensure_user_data_dir()
    }
}
