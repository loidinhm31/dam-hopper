pub mod audit;
pub mod decrypt;
pub mod enc_upload;
pub mod error;
pub mod event;
pub mod image_ticket;
// Phase 01 establishes these crate-private primitives; Phase 02 consumes them in handlers.
#[allow(dead_code)]
pub(crate) mod media_session;
#[allow(dead_code)]
pub(crate) mod media_ticket;
pub mod mutate;
pub mod ops;
pub mod sandbox;
pub(crate) mod secure_path;
pub mod upload;
pub mod video_ticket;
pub mod watcher;

pub use decrypt::{decrypt_and_write, decrypt_blob, DecryptResult};
pub use enc_upload::EncUploadState;
pub use error::FsError;
pub use event::FsEvent;
pub(crate) use image_ticket::ImageTicketIssue;
pub use image_ticket::{
    image_mime, is_supported_image, ImageStreamTicketStore, ImageTicketPurpose, ImageTicketRecord,
};
pub use media_ticket::MediaAuthContext;
pub(crate) use media_ticket::{
    MediaFileVersion, MediaTicketAuthorization, MediaTicketKind, MediaTicketPurpose,
    MediaTicketRecord, MediaTicketStore,
};
pub use mutate::{assert_safe_mutation, create_dir, create_file, delete, move_path, rename};
pub use ops::{
    atomic_persist_with_check, atomic_write_with_check, DirEntry, FileStat, SearchMatch,
    MAX_READ_BYTES,
};
pub use sandbox::{ProjectSandbox, WorkspaceSandbox};
pub use upload::{UploadState, MAX_UPLOAD_BYTES};
pub(crate) use video_ticket::VideoTicketIssue;
pub use video_ticket::{
    is_supported_video, VideoFileVersion, VideoStreamTicketStore, VideoTicketPurpose,
    VideoTicketRecord,
};
pub use watcher::FsWatcherManager;
use watcher::{WatcherKey, WatcherLease};

use std::collections::HashMap;
use std::path::{Path, PathBuf};
use std::sync::{Arc, Mutex};
use std::time::UNIX_EPOCH;

use serde::Serialize;
use tokio::sync::broadcast;

use crate::workspace_target::ResolvedProjectTarget;

/// A single node in the tree snapshot — relative path from the subscribed root.
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct TreeNode {
    /// Forward-slash-normalized path relative to the subscribed root.
    pub path: String,
    pub name: String,
    /// `"file"` or `"dir"`
    pub kind: String,
    pub size: u64,
    pub mtime: i64,
    pub is_symlink: bool,
}

struct SubInfo {
    /// Exact directory watcher generation owned by this subscription.
    watcher_lease: WatcherLease,
    /// Absolute path prefix used to filter broadcast events.
    filter_prefix: PathBuf,
}

/// Project-scoped filesystem subsystem.
///
/// Cheap to clone (Arc). Mirrors `PtySessionManager` lifecycle pattern.
/// The inner Mutex is intentionally `std::sync::Mutex` — never held across
/// an `.await` point; clone fields out before any async call.
#[derive(Clone)]
pub struct FsSubsystem {
    inner: Arc<Mutex<Inner>>,
}

struct Inner {
    sandbox: Option<ProjectSandbox>,
    watcher_mgr: FsWatcherManager,
    subs: HashMap<u64, SubInfo>,
    next_sub_id: u64,
}

impl FsSubsystem {
    /// Construct synchronously. If any project root cannot be canonicalized
    /// (e.g. path doesn't exist), the sandbox is stored as `None` and IDE
    /// FS operations will return `FsError::Unavailable` at request time.
    pub fn new(projects: Vec<(String, PathBuf)>) -> Self {
        let sandbox = match ProjectSandbox::new(projects) {
            Ok(s) => Some(s),
            Err(e) => {
                tracing::warn!(error = %e, "ProjectSandbox init failed — IDE FS ops unavailable");
                None
            }
        };
        Self {
            inner: Arc::new(Mutex::new(Inner {
                sandbox,
                watcher_mgr: FsWatcherManager::new(),
                subs: HashMap::new(),
                next_sub_id: 1,
            })),
        }
    }

    /// Reinitialize sandbox roots after a workspace switch.
    ///
    /// Replaces the sandbox in-place so all existing `FsSubsystem` clones
    /// (including the one in `AppState`) see the new root immediately.
    /// Clears active subscriptions since they belong to the old workspace.
    pub fn reinit_sandbox(&self, projects: Vec<(String, PathBuf)>) {
        let sandbox = match ProjectSandbox::new(projects) {
            Ok(s) => Some(s),
            Err(e) => {
                tracing::warn!(error = %e, "ProjectSandbox reinit failed — IDE FS ops unavailable");
                None
            }
        };
        let mut inner = self.inner.lock().unwrap_or_else(|p| p.into_inner());
        inner.sandbox = sandbox;
        let watcher_leases: Vec<WatcherLease> = inner
            .subs
            .drain()
            .map(|(_, info)| info.watcher_lease)
            .collect();
        for watcher_lease in watcher_leases {
            inner.watcher_mgr.release(&watcher_lease);
        }
    }

    /// Returns a cloned sandbox handle, or `Err(Unavailable)` if init failed.
    ///
    /// Clone is cheap (just a PathBuf clone). Call site must not hold the
    /// returned sandbox while awaiting — it owns no locks.
    pub fn sandbox(&self) -> Result<ProjectSandbox, FsError> {
        self.inner
            .lock()
            .unwrap_or_else(|p| p.into_inner())
            .sandbox
            .clone()
            .ok_or(FsError::Unavailable)
    }

    /// Subscribe to tree events for `filter_abs_path` within `project`.
    ///
    /// The watcher root is derived from the selected project's canonical root.
    /// `filter_abs_path` is the path the client cares about — events outside it
    /// are dropped by the pump task in ws.rs.
    ///
    /// Returns `(sub_id, broadcast::Receiver<FsEvent>)`. The caller is
    /// responsible for generating the initial snapshot via `tree_snapshot`.
    pub fn subscribe_tree(
        &self,
        project: &str,
        filter_abs_path: PathBuf,
    ) -> Result<(u64, broadcast::Receiver<FsEvent>), FsError> {
        let mut inner = self.inner.lock().expect("FsSubsystem: Mutex poisoned");
        let sandbox = inner.sandbox.as_ref().ok_or(FsError::Unavailable)?;
        let watcher_root = sandbox.project_root(project).ok_or(FsError::NotFound)?;
        if !filter_abs_path.starts_with(&watcher_root) {
            return Err(FsError::PathEscape);
        }
        let watcher_key = WatcherKey {
            project: project.to_owned(),
            target_key: "root".to_owned(),
            root: watcher_root,
        };
        Self::subscribe_with_key(&mut inner, watcher_key, filter_abs_path)
    }

    /// Subscribe beneath a server-resolved project target.
    pub fn subscribe_target_tree(
        &self,
        target: &ResolvedProjectTarget,
        filter_abs_path: PathBuf,
    ) -> Result<(u64, broadcast::Receiver<FsEvent>), FsError> {
        let mut inner = self.inner.lock().expect("FsSubsystem: Mutex poisoned");
        let sandbox = inner.sandbox.as_ref().ok_or(FsError::Unavailable)?;
        let configured_root = sandbox
            .project_root(target.project())
            .ok_or(FsError::NotFound)?;
        if configured_root != *target.configured_root()
            || !target.available()
            || !filter_abs_path.starts_with(target.target_path())
        {
            return Err(FsError::PathEscape);
        }
        let watcher_key = WatcherKey {
            project: target.project().to_owned(),
            target_key: target.target_key().to_owned(),
            root: target.target_path().to_path_buf(),
        };
        Self::subscribe_with_key(&mut inner, watcher_key, filter_abs_path)
    }

    /// Subscribe strictly to events within an actual directory under a server-resolved project target.
    /// Sets `WatcherKey.root` to `directory_abs_path`.
    pub fn subscribe_target_directory(
        &self,
        target: &ResolvedProjectTarget,
        directory_abs_path: PathBuf,
    ) -> Result<(u64, broadcast::Receiver<FsEvent>), FsError> {
        let mut inner = self.inner.lock().expect("FsSubsystem: Mutex poisoned");
        let sandbox = inner.sandbox.as_ref().ok_or(FsError::Unavailable)?;
        let configured_root = sandbox
            .project_root(target.project())
            .ok_or(FsError::NotFound)?;
        if configured_root != *target.configured_root()
            || !target.available()
            || !directory_abs_path.starts_with(target.target_path())
        {
            return Err(FsError::PathEscape);
        }
        let watcher_key = WatcherKey {
            project: target.project().to_owned(),
            target_key: target.target_key().to_owned(),
            root: directory_abs_path.clone(),
        };
        Self::subscribe_with_key(&mut inner, watcher_key, directory_abs_path)
    }

    fn subscribe_with_key(
        inner: &mut Inner,
        watcher_key: WatcherKey,
        filter_abs_path: PathBuf,
    ) -> Result<(u64, broadcast::Receiver<FsEvent>), FsError> {
        let (watcher_lease, rx) = inner.watcher_mgr.subscribe(&watcher_key)?;
        let sub_id = inner.next_sub_id;
        inner.next_sub_id += 1;
        inner.subs.insert(
            sub_id,
            SubInfo {
                watcher_lease,
                filter_prefix: filter_abs_path,
            },
        );
        Ok((sub_id, rx))
    }

    /// Release a subscription. Decrements watcher refcount; drops watcher if last.
    pub fn unsubscribe_tree(&self, sub_id: u64) {
        let mut inner = self.inner.lock().expect("FsSubsystem: Mutex poisoned");
        if let Some(info) = inner.subs.remove(&sub_id) {
            inner.watcher_mgr.release(&info.watcher_lease);
        }
    }

    /// Returns the filter prefix path for a subscription — used by the pump task
    /// to skip events that don't belong to this subscriber.
    pub fn sub_filter_prefix(&self, sub_id: u64) -> Option<PathBuf> {
        self.inner
            .lock()
            .unwrap_or_else(|p| p.into_inner())
            .subs
            .get(&sub_id)
            .map(|s| s.filter_prefix.clone())
    }

    /// For tests: refcount of watcher at `root`.
    #[cfg(test)]
    pub fn watcher_refcount(&self, root: &Path) -> usize {
        self.inner
            .lock()
            .unwrap_or_else(|p| p.into_inner())
            .watcher_mgr
            .refcount(root)
    }
}

/// Generate a depth-1 tree snapshot for `abs_path`.
///
/// Synchronous (uses `std::fs`) so it can be called from a `spawn_blocking`
/// context without holding any async executor thread.
pub fn tree_snapshot_sync(abs_path: &Path) -> Result<Vec<TreeNode>, FsError> {
    let rd = std::fs::read_dir(abs_path).map_err(map_io_sync)?;
    let mut nodes = Vec::new();

    for entry in rd {
        let entry = entry.map_err(|e| FsError::Io(e))?;
        let path = entry.path();
        let name = entry.file_name().to_string_lossy().into_owned();

        let link_meta = std::fs::symlink_metadata(&path).map_err(map_io_sync)?;
        let is_symlink = link_meta.file_type().is_symlink();
        // metadata() follows symlinks — kind reflects the target, not the link itself.
        // is_symlink=true lets clients distinguish symlinks from regular entries.
        let meta = std::fs::metadata(&path).unwrap_or(link_meta);

        let kind = if meta.is_dir() { "dir" } else { "file" }.to_string();
        let mtime = meta
            .modified()
            .ok()
            .and_then(|t| t.duration_since(UNIX_EPOCH).ok())
            .map(|d| d.as_secs() as i64)
            .unwrap_or(0);

        // Relative path from abs_path, forward-slash normalized
        let rel = path
            .strip_prefix(abs_path)
            .unwrap_or(&path)
            .to_string_lossy()
            .replace('\\', "/");

        nodes.push(TreeNode {
            path: rel,
            name,
            kind,
            size: meta.len(),
            mtime,
            is_symlink,
        });
    }

    // Dirs first, then files; each group alphabetical
    nodes.sort_by(|a, b| match (a.kind.as_str(), b.kind.as_str()) {
        ("dir", "file") => std::cmp::Ordering::Less,
        ("file", "dir") => std::cmp::Ordering::Greater,
        _ => a.name.cmp(&b.name),
    });

    Ok(nodes)
}

#[cfg(test)]
mod tests {
    use super::FsSubsystem;

    #[test]
    fn reinit_sandbox_releases_active_watchers() {
        let tmp = tempfile::tempdir().unwrap();
        let alpha = tmp.path().join("alpha");
        let beta = tmp.path().join("beta");
        std::fs::create_dir_all(&alpha).unwrap();
        std::fs::create_dir_all(&beta).unwrap();

        let fs = FsSubsystem::new(vec![("alpha".into(), alpha.clone())]);
        let (sub_id, _rx) = fs.subscribe_tree("alpha", alpha.clone()).unwrap();
        assert_eq!(fs.watcher_refcount(&alpha), 1);

        fs.reinit_sandbox(vec![("beta".into(), beta)]);

        assert_eq!(fs.watcher_refcount(&alpha), 0);
        fs.unsubscribe_tree(sub_id);
    }

    #[cfg(any(unix, windows))]
    #[tokio::test]
    async fn replaced_root_watch_only_receives_events_while_generic_old_generation_remains_leased()
    {
        use crate::workspace_target::ResolvedProjectTarget;
        use std::time::Duration;

        let tmp = tempfile::tempdir().unwrap();
        let root = tmp.path().join("repo");
        let old_root = tmp.path().join("repo-old");
        std::fs::create_dir(&root).unwrap();
        let root = root.canonicalize().unwrap();
        let target = ResolvedProjectTarget::from_parts(
            "project".into(),
            root.clone(),
            root.clone(),
            "root".into(),
            true,
            true,
            None,
        );
        let fs = FsSubsystem::new(vec![("project".into(), root.clone())]);
        let (old_generic, _old_rx) = fs.subscribe_target_tree(&target, root.clone()).unwrap();
        let (old_watch_only, _old_watch_rx) = fs
            .subscribe_target_directory(&target, root.clone())
            .unwrap();
        assert_eq!(fs.watcher_refcount(&root), 2);

        std::fs::rename(&root, &old_root).unwrap();
        std::fs::create_dir(&root).unwrap();
        fs.unsubscribe_tree(old_watch_only);
        assert_eq!(fs.watcher_refcount(&root), 1);
        let (new_watch_only, mut new_rx) = fs
            .subscribe_target_directory(&target, root.clone())
            .unwrap();
        let (new_generic, mut new_generic_rx) =
            fs.subscribe_target_tree(&target, root.clone()).unwrap();
        assert_eq!(fs.watcher_refcount(&root), 3);

        let file = root.join("first-new-generation.txt");
        std::fs::write(&file, "replacement root").unwrap();
        let event = tokio::time::timeout(Duration::from_secs(3), async {
            loop {
                let event = new_rx.recv().await.unwrap();
                if event.path == file {
                    break event;
                }
            }
        })
        .await
        .expect("new watch-only lease must receive an actual replacement-root event");
        assert!(matches!(
            event.kind,
            super::event::FsEventKind::Created | super::event::FsEventKind::Modified
        ));

        // Releasing a still-held Explorer lease must not decrement the new generation.
        fs.unsubscribe_tree(old_generic);
        fs.unsubscribe_tree(old_watch_only);
        assert_eq!(fs.watcher_refcount(&root), 2);
        let file = root.join("after-old-release.txt");
        std::fs::write(&file, "old generation released").unwrap();
        tokio::time::timeout(Duration::from_secs(3), async {
            loop {
                if new_rx.recv().await.unwrap().path == file {
                    break;
                }
            }
        })
        .await
        .expect("old generation release must preserve replacement watch-only delivery");

        fs.unsubscribe_tree(new_watch_only);
        assert_eq!(fs.watcher_refcount(&root), 1);
        let file = root.join("remaining-new-generic.txt");
        std::fs::write(&file, "new generic still owns its watcher").unwrap();
        tokio::time::timeout(Duration::from_secs(3), async {
            loop {
                if new_generic_rx.recv().await.unwrap().path == file {
                    break;
                }
            }
        })
        .await
        .expect("new generic lease must survive release of the new watch-only lease");
        fs.unsubscribe_tree(new_generic);
        assert_eq!(fs.watcher_refcount(&root), 0);
    }

    // Windows directory deletion stays pending until all notify/native handles close.
    #[cfg(unix)]
    #[tokio::test]
    async fn deleted_root_recreation_gets_live_watch_only_generation_with_old_generic_lease() {
        use crate::workspace_target::ResolvedProjectTarget;
        let tmp = tempfile::tempdir().unwrap();
        let root = tmp.path().join("repo");
        std::fs::create_dir(&root).unwrap();
        let root = root.canonicalize().unwrap();
        let target = ResolvedProjectTarget::from_parts(
            "project".into(),
            root.clone(),
            root.clone(),
            "root".into(),
            true,
            true,
            None,
        );
        let fs = FsSubsystem::new(vec![("project".into(), root.clone())]);
        let (old_generic, _old_rx) = fs.subscribe_target_tree(&target, root.clone()).unwrap();
        std::fs::remove_dir(&root).unwrap();
        std::fs::create_dir(&root).unwrap();
        let (new_watch_only, mut new_rx) = fs
            .subscribe_target_directory(&target, root.clone())
            .unwrap();
        assert_eq!(fs.watcher_refcount(&root), 2);
        for (name, release_old) in [
            ("after-recreate.txt", false),
            ("after-old-release.txt", true),
        ] {
            if release_old {
                fs.unsubscribe_tree(old_generic);
                assert_eq!(fs.watcher_refcount(&root), 1);
            }
            let file = root.join(name);
            std::fs::write(&file, "recreated root event").unwrap();
            tokio::time::timeout(std::time::Duration::from_secs(3), async {
                loop {
                    if new_rx.recv().await.unwrap().path == file {
                        break;
                    }
                }
            })
            .await
            .expect(
                "recreated root must deliver real events despite the deleted generic generation",
            );
        }
        fs.unsubscribe_tree(old_generic);
        assert_eq!(fs.watcher_refcount(&root), 1);
        fs.unsubscribe_tree(new_watch_only);
        assert_eq!(fs.watcher_refcount(&root), 0);
    }

    #[cfg(any(unix, windows))]
    #[tokio::test]
    async fn reinit_sandbox_releases_overlapping_directory_generations_without_touching_new_leases()
    {
        let tmp = tempfile::tempdir().unwrap();
        let root = tmp.path().join("repo");
        std::fs::create_dir(&root).unwrap();
        let root = root.canonicalize().unwrap();
        let fs = FsSubsystem::new(vec![("project".into(), root.clone())]);
        let (old_sub, mut old_rx) = fs.subscribe_tree("project", root.clone()).unwrap();
        std::fs::rename(&root, tmp.path().join("repo-old")).unwrap();
        std::fs::create_dir(&root).unwrap();
        let (replacement_sub, mut replacement_rx) =
            fs.subscribe_tree("project", root.clone()).unwrap();
        assert_eq!(fs.watcher_refcount(&root), 2);
        fs.reinit_sandbox(vec![("project".into(), root.clone())]);
        assert_eq!(fs.watcher_refcount(&root), 0);
        for rx in [&mut old_rx, &mut replacement_rx] {
            tokio::time::timeout(std::time::Duration::from_secs(3), async {
                loop {
                    if matches!(
                        rx.recv().await,
                        Err(tokio::sync::broadcast::error::RecvError::Closed)
                    ) {
                        break;
                    }
                }
            })
            .await
            .expect("sandbox clear must close every directory generation");
        }
        let (current_sub, _current_rx) = fs.subscribe_tree("project", root.clone()).unwrap();
        fs.unsubscribe_tree(old_sub);
        fs.unsubscribe_tree(replacement_sub);
        assert_eq!(fs.watcher_refcount(&root), 1);
        fs.unsubscribe_tree(current_sub);
        assert_eq!(fs.watcher_refcount(&root), 0);
    }

    #[test]
    fn missing_project_root_does_not_make_fs_unavailable() {
        let tmp = tempfile::tempdir().unwrap();
        let alpha = tmp.path().join("alpha");
        std::fs::create_dir_all(&alpha).unwrap();

        let fs = FsSubsystem::new(vec![
            ("alpha".into(), alpha.clone()),
            ("missing".into(), tmp.path().join("missing")),
        ]);

        let (sub_id, _rx) = fs.subscribe_tree("alpha", alpha.clone()).unwrap();
        assert_eq!(fs.watcher_refcount(&alpha), 1);

        let missing = fs.subscribe_tree("missing", alpha.clone());
        assert!(matches!(missing, Err(super::FsError::NotFound)));

        fs.unsubscribe_tree(sub_id);
    }
}

fn map_io_sync(e: std::io::Error) -> FsError {
    if e.kind() == std::io::ErrorKind::NotFound {
        FsError::NotFound
    } else if e.kind() == std::io::ErrorKind::PermissionDenied {
        FsError::PermissionDenied
    } else {
        FsError::Io(e)
    }
}
