use std::fmt;
use std::fs::{self, File, OpenOptions};
use std::io::Write;
use std::path::{Path, PathBuf};
use std::sync::{Arc, Mutex};
use std::time::{Duration, Instant, SystemTime, UNIX_EPOCH};

use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};

use super::process::ContainmentIdentity;

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
    /// Containment identity of the last launched browser tree (or the durable pre-launch
    /// intent token); reconciled under the profile lock before any relaunch.
    #[serde(flatten)]
    pub containment: ContainmentIdentity,
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
    #[serde(flatten)]
    pub containment: ContainmentIdentity,
}

pub fn now_unix_ms() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_millis() as u64)
        .unwrap_or(0)
}

/// Durable file the fault injector can fail.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum FaultTarget {
    Metadata,
    Tombstone,
    UserData,
}

/// Durability step the fault injector can fail.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum FaultStep {
    /// `fsync` of the temp file before rename.
    FileSync,
    /// Atomic rename of the temp file over the final name.
    Rename,
    /// `fsync` of the principal directory after a rename/unlink/create/delete.
    DirSync,
    /// Unlink of the tombstone.
    Unlink,
    /// Recursive deletion of `user-data/`.
    Delete,
    /// Recreation of `user-data/`.
    Recreate,
}

#[derive(Debug)]
struct FaultRule {
    target: FaultTarget,
    step: FaultStep,
    skip: usize,
    times: usize,
}

/// Deterministic fault injection at each persisted boundary (tests only; empty in production).
#[derive(Debug, Default)]
pub struct ProfileFaults {
    rules: Mutex<Vec<FaultRule>>,
}

impl ProfileFaults {
    /// Fails `times` occurrences of `step` on `target`, after letting `skip` occurrences pass.
    pub fn fail(&self, target: FaultTarget, step: FaultStep, skip: usize, times: usize) {
        self.rules.lock().unwrap().push(FaultRule {
            target,
            step,
            skip,
            times,
        });
    }

    pub fn clear(&self) {
        self.rules.lock().unwrap().clear();
    }

    fn check(&self, target: FaultTarget, step: FaultStep) -> std::io::Result<()> {
        let mut rules = self.rules.lock().unwrap();
        let Some(rule) = rules
            .iter_mut()
            .find(|r| r.target == target && r.step == step && r.times > 0)
        else {
            return Ok(());
        };
        if rule.skip > 0 {
            rule.skip -= 1;
            return Ok(());
        }
        rule.times -= 1;
        Err(std::io::Error::other(format!(
            "injected {step:?} failure on {target:?}"
        )))
    }
}

/// Creates `path` exclusively with mode 0600 from the first instant (no permission window).
fn create_private(path: &Path) -> std::io::Result<File> {
    let mut options = OpenOptions::new();
    options.write(true).create_new(true);
    #[cfg(unix)]
    {
        use std::os::unix::fs::OpenOptionsExt;
        options.mode(0o600);
    }
    options.open(path)
}

/// `fsync` of a directory: makes entries created, renamed or removed in it durable.
#[cfg(unix)]
fn sync_directory(dir: &Path) -> std::io::Result<()> {
    File::open(dir)?.sync_all()
}

#[cfg(not(unix))]
fn sync_directory(_dir: &Path) -> std::io::Result<()> {
    Ok(())
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
            .map_err(|e| {
                ProfileError::LockFailed(format!("cannot open {}: {e}", path.display()))
            })?;

        #[cfg(unix)]
        {
            use std::os::unix::io::AsRawFd;
            let fd = file.as_raw_fd();
            let ret = unsafe { libc::flock(fd, libc::LOCK_EX | libc::LOCK_NB) };
            if ret != 0 {
                let err = std::io::Error::last_os_error();
                if err.raw_os_error() == Some(libc::EWOULDBLOCK)
                    || err.raw_os_error() == Some(libc::EAGAIN)
                {
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

    pub async fn acquire_with_timeout(
        path: &Path,
        max_wait: Duration,
    ) -> Result<Self, ProfileError> {
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
    faults: Arc<ProfileFaults>,
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
            faults: Arc::new(ProfileFaults::default()),
        })
    }

    /// Routes every durable step of this profile through `faults` (tests only).
    pub fn with_faults(mut self, faults: Arc<ProfileFaults>) -> Self {
        self.faults = faults;
        self
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

    /// Ensure restricted principal directory exists with mode 0700, with its new directory
    /// entries durable (each created directory's parent is synced).
    pub fn ensure_principal_dir(&self) -> Result<(), ProfileError> {
        if let Some(parent) = self.principal_dir.parent() {
            if !parent.exists() {
                fs::create_dir_all(parent)?;
                #[cfg(unix)]
                {
                    use std::os::unix::fs::PermissionsExt;
                    let _ = fs::set_permissions(parent, fs::Permissions::from_mode(0o700));
                }
                if let Some(root) = parent.parent() {
                    sync_directory(root)?;
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
            if let Some(parent) = self.principal_dir.parent() {
                sync_directory(parent)?;
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

    /// `fsync` of the principal directory (durability barrier for entries created, renamed
    /// or removed in it).
    fn sync_principal_dir_for(&self, target: FaultTarget) -> Result<(), ProfileError> {
        self.faults.check(target, FaultStep::DirSync)?;
        sync_directory(&self.principal_dir)?;
        Ok(())
    }

    /// Makes every prior unlink/rename in the principal directory durable.
    pub fn sync_principal_dir(&self) -> Result<(), ProfileError> {
        self.sync_principal_dir_for(FaultTarget::Tombstone)
    }

    /// Durable atomic replacement of `final_path`: the 0600 temp file is synced, renamed over
    /// the final name, and the principal directory is synced. Returns `Ok` only after every
    /// barrier succeeded; a temp file is never left behind on failure.
    fn write_durably(
        &self,
        target: FaultTarget,
        final_path: &Path,
        stem: &str,
        bytes: &[u8],
    ) -> Result<(), ProfileError> {
        self.ensure_principal_dir()?;
        let tmp_file = self.principal_dir.join(format!(
            "{stem}.tmp.{}.{}",
            std::process::id(),
            uuid::Uuid::new_v4().simple()
        ));
        let staged = (|| -> std::io::Result<()> {
            let mut file = create_private(&tmp_file)?;
            file.write_all(bytes)?;
            self.faults.check(target, FaultStep::FileSync)?;
            file.sync_all()?;
            drop(file);
            self.faults.check(target, FaultStep::Rename)?;
            fs::rename(&tmp_file, final_path)
        })();
        if let Err(err) = staged {
            let _ = fs::remove_file(&tmp_file);
            return Err(err.into());
        }
        self.sync_principal_dir_for(target)
    }

    /// Read-only metadata load: `Ok(None)` when the profile was never initialized. Never
    /// writes, so it is safe without the profile lock (capability probing, epoch lookup).
    pub fn load_metadata(&self) -> Result<Option<ManagerMetadata>, ProfileError> {
        let content = match fs::read_to_string(&self.metadata_file) {
            Ok(content) => content,
            Err(err) if err.kind() == std::io::ErrorKind::NotFound => return Ok(None),
            Err(err) => return Err(err.into()),
        };
        serde_json::from_str::<ManagerMetadata>(&content)
            .map(Some)
            .map_err(|err| {
                ProfileError::CorruptMetadata(format!(
                    "cannot parse {}: {err}",
                    self.metadata_file.display()
                ))
            })
    }

    /// Loads the metadata, writing the default record only while holding this profile's flock
    /// (`lock` is the proof). The existence check is repeated under the lock, so a record
    /// persisted by another process is never overwritten with defaults.
    pub fn load_or_init_metadata_locked(
        &self,
        lock: &ProfileLock,
    ) -> Result<ManagerMetadata, ProfileError> {
        if lock.path != self.lock_file {
            return Err(ProfileError::LockFailed(format!(
                "lock {} does not belong to profile {}",
                lock.path.display(),
                self.lock_file.display()
            )));
        }
        if let Some(meta) = self.load_metadata()? {
            return Ok(meta);
        }
        let meta = ManagerMetadata {
            subject: self.subject.clone(),
            is_dev: self.is_dev,
            profile_epoch: 1,
            browser_incarnation: None,
            updated_at_unix_ms: now_unix_ms(),
            last_reset_operation_id: None,
            containment: ContainmentIdentity::default(),
        };
        self.save_metadata(&meta)?;
        Ok(meta)
    }

    /// Load or initialize manager metadata. An existing record is read without the lock; a
    /// missing one is initialized under the profile flock acquired here (`LockBusy` when
    /// another holder owns it: initialization is never done outside the lock).
    pub fn load_or_init_metadata(&self) -> Result<ManagerMetadata, ProfileError> {
        if let Some(meta) = self.load_metadata()? {
            return Ok(meta);
        }
        let lock = self.try_lock()?;
        self.load_or_init_metadata_locked(&lock)
    }

    /// Save manager metadata durably (0600, synced temp, atomic rename, synced directory).
    pub fn save_metadata(&self, meta: &ManagerMetadata) -> Result<(), ProfileError> {
        let json = serde_json::to_string_pretty(meta).map_err(|e| {
            ProfileError::CorruptMetadata(format!("cannot serialize metadata: {e}"))
        })?;
        self.write_durably(
            FaultTarget::Metadata,
            &self.metadata_file,
            "manager.json",
            json.as_bytes(),
        )
    }

    /// Check if a reset tombstone exists.
    pub fn load_tombstone(&self) -> Result<Option<ResetTombstone>, ProfileError> {
        if !self.reset_file.exists() {
            return Ok(None);
        }
        let content = fs::read_to_string(&self.reset_file)?;
        let tombstone = serde_json::from_str::<ResetTombstone>(&content).map_err(|e| {
            ProfileError::CorruptMetadata(format!(
                "cannot parse tombstone {}: {e}",
                self.reset_file.display()
            ))
        })?;
        Ok(Some(tombstone))
    }

    /// Save reset tombstone durably (0600, synced temp, atomic rename, synced directory).
    pub fn save_tombstone(&self, tombstone: &ResetTombstone) -> Result<(), ProfileError> {
        let json = serde_json::to_string_pretty(tombstone).map_err(|e| {
            ProfileError::CorruptMetadata(format!("cannot serialize tombstone: {e}"))
        })?;
        self.write_durably(
            FaultTarget::Tombstone,
            &self.reset_file,
            "reset.json",
            json.as_bytes(),
        )
    }

    /// Remove the reset tombstone and make the removal durable. Idempotent: a retry after a
    /// failed directory sync repeats the sync even though the file is already gone.
    pub fn clear_tombstone(&self) -> Result<(), ProfileError> {
        self.faults
            .check(FaultTarget::Tombstone, FaultStep::Unlink)?;
        match fs::remove_file(&self.reset_file) {
            Ok(()) => {}
            Err(e) if e.kind() == std::io::ErrorKind::NotFound => {}
            Err(e) => return Err(e.into()),
        }
        self.sync_principal_dir_for(FaultTarget::Tombstone)
    }

    /// Checks if a managed profile directory and user-data dir exist.
    pub fn has_managed_profile(&self) -> bool {
        self.user_data_dir.exists() && self.user_data_dir.is_dir()
    }

    /// Delete user-data directory completely and make the deletion durable.
    ///
    /// Preserves manager.lock, manager.json, and reset.json.
    pub fn delete_user_data(&self) -> Result<(), ProfileError> {
        self.faults
            .check(FaultTarget::UserData, FaultStep::Delete)?;
        match fs::remove_dir_all(&self.user_data_dir) {
            Ok(()) => {}
            Err(e) if e.kind() == std::io::ErrorKind::NotFound => {}
            Err(e) => return Err(e.into()),
        }
        self.sync_principal_dir_for(FaultTarget::UserData)
    }

    /// Recreate empty user-data directory with 0700 permissions, durably.
    pub fn recreate_user_data(&self) -> Result<(), ProfileError> {
        self.faults
            .check(FaultTarget::UserData, FaultStep::Recreate)?;
        self.ensure_user_data_dir()?;
        self.sync_principal_dir_for(FaultTarget::UserData)
    }
}
