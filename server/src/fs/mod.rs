pub mod error;
pub mod ops;
pub mod sandbox;

pub use error::FsError;
pub use ops::{DirEntry, FileStat, MAX_READ_BYTES};
pub use sandbox::WorkspaceSandbox;

use std::path::PathBuf;
use std::sync::{Arc, Mutex};

/// Workspace-scoped filesystem subsystem.
///
/// Cheap to clone (Arc). Mirrors `PtySessionManager` lifecycle pattern.
/// The inner Mutex is intentionally `std::sync::Mutex` — never held across
/// an `.await` point; clone fields out before any async call.
#[derive(Clone)]
pub struct FsSubsystem {
    inner: Arc<Mutex<Inner>>,
}

struct Inner {
    sandbox: Option<WorkspaceSandbox>,
    // watcher: Option<...>  -- Phase 02
}

impl FsSubsystem {
    /// Construct synchronously. If workspace root cannot be canonicalized
    /// (e.g. path doesn't exist), the sandbox is stored as `None` and IDE
    /// FS operations will return `FsError::Unavailable` at request time.
    pub fn new(ws_root: PathBuf) -> Self {
        let sandbox = match WorkspaceSandbox::new(ws_root) {
            Ok(s) => Some(s),
            Err(e) => {
                tracing::warn!(error = %e, "WorkspaceSandbox init failed — IDE FS ops unavailable");
                None
            }
        };
        Self {
            inner: Arc::new(Mutex::new(Inner { sandbox })),
        }
    }

    /// Returns a cloned sandbox handle, or `Err(Unavailable)` if init failed.
    ///
    /// Clone is cheap (just a PathBuf clone). Call site must not hold the
    /// returned sandbox while awaiting — it owns no locks.
    pub fn sandbox(&self) -> Result<WorkspaceSandbox, FsError> {
        self.inner
            .lock()
            .expect("FsSubsystem: Mutex poisoned")
            .sandbox
            .clone()
            .ok_or(FsError::Unavailable)
    }
}
