use std::{
    collections::HashMap,
    future::Future,
    io::{Cursor, Write},
    path::PathBuf,
    pin::Pin,
    sync::{
        atomic::{AtomicBool, AtomicU64, AtomicUsize, Ordering},
        Arc, Mutex as StdMutex, RwLock as StdRwLock,
    },
};

use axum::body::Bytes;
use chrono::Utc;
use sha2::{Digest, Sha256};
use tempfile::TempDir;
use tokio::sync::RwLock;
use uuid::Uuid;

use super::{
    terminal_reference, BrowserDebugArtifactResponse, BrowserDebugError,
    BrowserDebugHandoffResponse, BrowserSelectionV1, ARTIFACT_TTL_MS, MAX_PNG_BYTES,
    MAX_SELECTION_JSON_BYTES,
};
use crate::{api::auth::AuthenticatedActor, error::AppError, pty::PtySessionManager};
pub const MAX_GLOBAL_ARTIFACT_RECORDS: usize = 64;
pub const MAX_GLOBAL_ARTIFACT_BYTES: usize = 64 * 1024 * 1024;

#[derive(Clone, Debug, PartialEq, Eq)]
pub enum ArtifactSource {
    Cooperative,
    ManagedBrowser {
        principal: String,
        profile_epoch: u64,
        browser_incarnation: String,
    },
}

pub type BoxFuture<'a, T> = Pin<Box<dyn Future<Output = T> + Send + 'a>>;

/// Test-only async barrier invoked at a named point of the handoff fence.
pub type HandoffHook =
    Arc<StdRwLock<Option<Arc<dyn Fn() -> BoxFuture<'static, ()> + Send + Sync>>>>;

/// Test-only synchronous hook run on a blocking worker at a named point.
pub type SyncHookSlot = Arc<StdRwLock<Option<Arc<dyn Fn() + Send + Sync>>>>;

/// Handle held while a handoff owns the live-selection fence. `is_current` is evaluated with no
/// await, under the PTY mutation lock, immediately before the terminal write, so any state
/// published since the fence was acquired (e.g. an observed native navigation) denies the write.
pub trait HandoffFence: Send + Sync {
    fn is_current(&self) -> bool;
}

impl HandoffFence for () {
    fn is_current(&self) -> bool {
        true
    }
}

pub trait BrowserAdmissionAuthority: Send + Sync {
    fn check_managed_admission<'a>(
        &'a self,
        actor: &'a AuthenticatedActor,
        principal: &'a str,
        profile_epoch: u64,
    ) -> BoxFuture<'a, bool>;

    fn check_managed_selection_live<'a>(
        &'a self,
        _principal: &'a str,
        _session_id: &'a str,
        _navigation_revision: u64,
        _selection_revision: u64,
    ) -> BoxFuture<'a, bool> {
        Box::pin(async { true })
    }

    fn acquire_managed_selection_fence<'a>(
        &'a self,
        principal: &'a str,
        _profile_epoch: u64,
        session_id: &'a str,
        navigation_revision: u64,
        selection_revision: u64,
        _artifact_id: Uuid,
    ) -> BoxFuture<'a, Option<Box<dyn HandoffFence>>> {
        Box::pin(async move {
            if self
                .check_managed_selection_live(
                    principal,
                    session_id,
                    navigation_revision,
                    selection_revision,
                )
                .await
            {
                Some(Box::new(()) as Box<dyn HandoffFence>)
            } else {
                None
            }
        })
    }

    /// Final asynchronous handoff revalidation, run after the entry lock and the selection fence
    /// are both held and immediately before the synchronous recheck + PTY write. Must not take
    /// the selection lock (the fence already holds it).
    fn revalidate_managed_handoff<'a>(
        &'a self,
        actor: &'a AuthenticatedActor,
        principal: &'a str,
        profile_epoch: u64,
        _session_id: &'a str,
        _navigation_revision: u64,
    ) -> BoxFuture<'a, bool> {
        Box::pin(async move {
            self.check_managed_admission(actor, principal, profile_epoch)
                .await
        })
    }

    /// Synchronous final recheck (deadline / epoch / exact browser incarnation) executed under
    /// the PTY mutation lock, with no await, immediately before the terminal write.
    fn final_handoff_sync_check(
        &self,
        _actor: &AuthenticatedActor,
        _principal: &str,
        _profile_epoch: u64,
        _browser_incarnation: &str,
    ) -> bool {
        true
    }

    /// An artifact reached a terminal state (deleted, expired, invalidated, revoked): drop any
    /// live-selection registration that still references it.
    fn artifact_retired<'a>(
        &'a self,
        _session_id: &'a str,
        _artifact_id: Uuid,
    ) -> BoxFuture<'a, ()> {
        Box::pin(async {})
    }
}

#[derive(Default)]
struct QuotaState {
    records: usize,
    bytes: usize,
}

#[derive(Clone)]
pub struct BrowserDebugArtifactManager {
    pub(super) root: Arc<TempDir>,
    pub(super) entries: Arc<RwLock<HashMap<Uuid, ArtifactMetadata>>>,
    quota: Arc<StdMutex<QuotaState>>,
    pub(super) reserved_bytes: Arc<AtomicUsize>,
    pending_cleanups: Arc<StdMutex<HashMap<Uuid, PendingCleanup>>>,
    inflight: Arc<InflightOps>,
    managed_generation: Arc<AtomicU64>,
    /// Per-principal revocation epoch, published synchronously (no await, no entry lock) when a
    /// login is revoked or a principal is fenced. A handoff captures it when it starts and
    /// re-reads it under the PTY mutation lock.
    revocation_epochs: Arc<StdMutex<HashMap<String, u64>>>,
    authority: Arc<StdRwLock<Option<Arc<dyn BrowserAdmissionAuthority>>>>,
    #[doc(hidden)]
    pub _before_write_hook: SyncHookSlot,
    #[doc(hidden)]
    pub _after_persist_before_publish_hook: SyncHookSlot,
    #[doc(hidden)]
    pub _before_handoff_fence_hook: HandoffHook,
    /// Runs after the entry lock and selection fence are held, before final validation.
    #[doc(hidden)]
    pub _before_handoff_final_validation_hook: HandoffHook,
    /// Runs on the blocking worker right before it enters the PTY mutation boundary.
    #[doc(hidden)]
    pub _before_pty_mutation_hook: SyncHookSlot,
    /// Runs on the blocking writer after the temp file is written, before it can be cancelled.
    #[doc(hidden)]
    pub _after_temp_write_hook: SyncHookSlot,
    /// Runs on the blocking worker before every retained-file unlink attempt.
    #[doc(hidden)]
    pub _before_unlink_hook: SyncHookSlot,
}

/// Private files of a retired artifact whose unlink failed: the quota stays charged until the
/// files are really gone, so cleanup remains owned, bounded and retryable.
struct PendingCleanup {
    owner: String,
    paths: Vec<PathBuf>,
    records: usize,
    bytes: usize,
    /// Browser session whose live-selection registration still references the retired
    /// artifact. The obligation travels with the retained files, so any retry (not only the
    /// call that retired the artifact) drops the registration exactly once.
    selection_notice: Option<String>,
}
#[derive(Clone)]
pub(super) struct ArtifactMetadata {
    pub(super) owner: String,
    pub(super) source: ArtifactSource,
    managed_selection: Option<(String, u64, u64)>,
    terminal_id: String,
    terminal_incarnation: u64,
    pub(super) expires_at: i64,
    json: ArtifactFile,
    png: Option<ArtifactFile>,
    png_uploading: bool,
    handoff_claimed: bool,
}

#[derive(Clone)]
struct ArtifactFile {
    path: PathBuf,
    size: u64,
    sha256: String,
}
impl BrowserDebugArtifactManager {
    pub fn new() -> Result<Self, BrowserDebugError> {
        Ok(Self {
            root: Arc::new(
                tempfile::Builder::new()
                    .prefix("dam-hopper-browser-debug-")
                    .tempdir()?,
            ),
            entries: Arc::new(RwLock::new(HashMap::new())),
            quota: Arc::new(StdMutex::new(QuotaState::default())),
            reserved_bytes: Arc::new(AtomicUsize::new(0)),
            pending_cleanups: Arc::new(StdMutex::new(HashMap::new())),
            inflight: Arc::new(InflightOps::default()),
            managed_generation: Arc::new(AtomicU64::new(0)),
            revocation_epochs: Arc::new(StdMutex::new(HashMap::new())),
            authority: Arc::new(StdRwLock::new(None)),
            _before_write_hook: Arc::new(StdRwLock::new(None)),
            _after_persist_before_publish_hook: Arc::new(StdRwLock::new(None)),
            _before_handoff_fence_hook: Arc::new(StdRwLock::new(None)),
            _before_handoff_final_validation_hook: Arc::new(StdRwLock::new(None)),
            _before_pty_mutation_hook: Arc::new(StdRwLock::new(None)),
            _after_temp_write_hook: Arc::new(StdRwLock::new(None)),
            _before_unlink_hook: Arc::new(StdRwLock::new(None)),
        })
    }
    pub fn set_authority(&self, authority: Arc<dyn BrowserAdmissionAuthority>) {
        let mut guard = self.authority.write().unwrap();
        *guard = Some(authority);
    }

    pub async fn set_authority_async(&self, authority: Arc<dyn BrowserAdmissionAuthority>) {
        let mut guard = self.authority.write().unwrap();
        *guard = Some(authority);
    }

    pub fn reserved_bytes(&self) -> usize {
        self.reserved_bytes.load(Ordering::Relaxed)
    }

    pub async fn len(&self) -> usize {
        self.entries.read().await.len()
    }

    async fn check_managed_admission(
        &self,
        actor: &AuthenticatedActor,
        principal: &str,
        profile_epoch: u64,
    ) -> bool {
        let auth = self.authority.read().unwrap().clone();
        if let Some(authority) = auth {
            authority
                .check_managed_admission(actor, principal, profile_epoch)
                .await
        } else {
            false
        }
    }

    async fn check_managed_selection_live(
        &self,
        principal: &str,
        managed_selection: Option<&(String, u64, u64)>,
    ) -> bool {
        let Some((session_id, nav_rev, sel_rev)) = managed_selection else {
            return true;
        };
        let auth = self.authority.read().unwrap().clone();
        if let Some(authority) = auth {
            authority
                .check_managed_selection_live(principal, session_id, *nav_rev, *sel_rev)
                .await
        } else {
            false
        }
    }

    async fn reserve_create_slot(
        &self,
        json_len: usize,
    ) -> Result<QuotaReservationGuard, BrowserDebugError> {
        if let Some(guard) = try_reserve_quota_sync(&self.quota, &self.reserved_bytes, 1, json_len)
        {
            return Ok(guard);
        }
        self.sweep_expired().await;
        try_reserve_quota_sync(&self.quota, &self.reserved_bytes, 1, json_len)
            .ok_or(BrowserDebugError::TooLarge)
    }

    async fn reserve_extra_bytes(
        &self,
        extra_len: usize,
    ) -> Result<QuotaReservationGuard, BrowserDebugError> {
        if let Some(guard) = try_reserve_quota_sync(&self.quota, &self.reserved_bytes, 0, extra_len)
        {
            return Ok(guard);
        }
        self.sweep_expired().await;
        try_reserve_quota_sync(&self.quota, &self.reserved_bytes, 0, extra_len)
            .ok_or(BrowserDebugError::TooLarge)
    }

    fn release_quota_sync(&self, record_delta: usize, byte_delta: usize) {
        release_quota_sync(&self.quota, &self.reserved_bytes, record_delta, byte_delta);
    }

    /// Number of retired artifacts whose private files could not be unlinked yet.
    pub fn pending_cleanup_count(&self) -> usize {
        self.pending_cleanups.lock().unwrap().len()
    }

    fn begin_op(&self, owner: &str) -> InflightGuard {
        self.inflight.begin(owner, &self.managed_generation)
    }

    fn write_hooks(&self) -> WriteHooks {
        WriteHooks {
            before: self._before_write_hook.read().unwrap().clone(),
            after_temp: self._after_temp_write_hook.read().unwrap().clone(),
            after_persist: self
                ._after_persist_before_publish_hook
                .read()
                .unwrap()
                .clone(),
        }
    }

    /// Sink for files an in-flight operation owns outside of `entries`; it keeps the operation
    /// registered as in flight until every clone of the sink is gone.
    fn op_sink(&self, owner: &str, inflight: &InflightGuard) -> PendingSink {
        PendingSink {
            pending: self.pending_cleanups.clone(),
            owner: owner.to_string(),
            before_unlink: self._before_unlink_hook.clone(),
            _inflight: inflight.clone(),
        }
    }

    /// Publishes, synchronously and without waiting for any lock, that the authority of every
    /// login of `principal` may be gone (logout, device-session revoke, demotion, reset fence).
    /// A managed handoff that captured an earlier epoch is denied under the PTY mutation lock
    /// however long it waited for it. Revoking one login also denies the principal's other
    /// in-flight handoffs (fail closed; the artifact stays valid and can be handed off again).
    pub fn publish_revocation(&self, principal: &str) {
        *self
            .revocation_epochs
            .lock()
            .unwrap()
            .entry(principal.to_string())
            .or_default() += 1;
    }

    fn revocation_fence(&self, principal: &str) -> RevocationFence {
        let captured = self
            .revocation_epochs
            .lock()
            .unwrap()
            .get(principal)
            .copied()
            .unwrap_or(0);
        RevocationFence {
            epochs: self.revocation_epochs.clone(),
            principal: principal.to_string(),
            captured,
        }
    }

    /// Re-attempts every retained unlink (optionally only those owned by `owner`). Quota is
    /// released per entry only after its files are really gone. Fails while any file remains
    /// and, for an owner, while an operation that began before the latest managed fence is
    /// still running (its private files are not yet owned by an entry or the pending set).
    pub async fn retry_pending_cleanups(
        &self,
        owner: Option<&str>,
    ) -> Result<(), BrowserDebugError> {
        // Sampled BEFORE the snapshot: an operation that already finished registered its
        // leftovers before releasing its guard, so the snapshot sees them; one still running is
        // reported instead of being silently missed.
        let in_flight = owner.is_some_and(|owner| {
            self.inflight
                .any_started_before(owner, self.managed_generation.load(Ordering::SeqCst))
        });
        let ids: Vec<Uuid> = self
            .pending_cleanups
            .lock()
            .unwrap()
            .iter()
            .filter(|(_, p)| owner.is_none_or(|o| p.owner == o))
            .map(|(id, _)| *id)
            .collect();
        let mut first_error = None;
        for id in ids {
            if let Err(error) = self.complete_cleanup(id, "retained cleanup").await {
                first_error.get_or_insert(error);
            }
        }
        match first_error {
            Some(error) => Err(error),
            None if in_flight => Err(BrowserDebugError::OperationsInFlight),
            None => Ok(()),
        }
    }

    /// Unlinks the retained files of `id`. Ownership stays in the pending set (charged) until
    /// the files are confirmed gone; only then is the quota released, exactly once.
    async fn complete_cleanup(
        &self,
        id: Uuid,
        stage: &'static str,
    ) -> Result<(), BrowserDebugError> {
        self.discharge_selection_notice(id).await;
        let Some(paths) = self
            .pending_cleanups
            .lock()
            .unwrap()
            .get(&id)
            .map(|p| p.paths.clone())
        else {
            return Ok(());
        };
        let before_unlink = self._before_unlink_hook.read().unwrap().clone();
        match remove_files(paths, before_unlink).await {
            Ok(()) => {
                let removed = self.pending_cleanups.lock().unwrap().remove(&id);
                if let Some(p) = removed {
                    self.release_quota_sync(p.records, p.bytes);
                    tracing::info!(artifact_id = %id, stage, "browser debug artifact files removed");
                }
                Ok(())
            }
            Err(error) => {
                tracing::warn!(artifact_id = %id, error = %error, stage, "browser debug artifact cleanup failed; retained for retry");
                Err(error)
            }
        }
    }

    /// Drops the live-selection registration a retired artifact still owes. The obligation is
    /// taken from the retained cleanup and handed to a detached task in one synchronous step:
    /// a caller cancelled after the take cannot lose it, and a caller cancelled before it leaves
    /// the obligation with the retained files for the next retry.
    async fn discharge_selection_notice(&self, id: Uuid) {
        let session_id = self
            .pending_cleanups
            .lock()
            .unwrap()
            .get_mut(&id)
            .and_then(|pending| pending.selection_notice.take());
        let Some(session_id) = session_id else {
            return;
        };
        let authority = self.authority.read().unwrap().clone();
        let Some(authority) = authority else {
            return;
        };
        let removal =
            tokio::spawn(async move { authority.artifact_retired(&session_id, id).await });
        let _ = removal.await;
    }
    pub async fn create(
        &self,
        owner: String,
        source: ArtifactSource,
        terminal_id: String,
        terminal_incarnation: u64,
        selection: BrowserSelectionV1,
    ) -> Result<BrowserDebugArtifactResponse, BrowserDebugError> {
        self.create_internal(
            None,
            owner,
            source,
            None,
            terminal_id,
            terminal_incarnation,
            selection,
            None,
        )
        .await
    }

    pub async fn create_managed_checked(
        &self,
        actor: &AuthenticatedActor,
        source: ArtifactSource,
        managed_selection: (String, u64, u64),
        terminal_id: String,
        terminal_incarnation: u64,
        selection: BrowserSelectionV1,
        pty_manager: &PtySessionManager,
    ) -> Result<BrowserDebugArtifactResponse, BrowserDebugError> {
        self.create_internal(
            Some(actor),
            actor.subject.clone(),
            source,
            Some(managed_selection),
            terminal_id,
            terminal_incarnation,
            selection,
            Some(pty_manager),
        )
        .await
    }

    #[allow(clippy::too_many_arguments)]
    async fn create_internal(
        &self,
        actor: Option<&AuthenticatedActor>,
        owner: String,
        source: ArtifactSource,
        managed_selection: Option<(String, u64, u64)>,
        terminal_id: String,
        terminal_incarnation: u64,
        selection: BrowserSelectionV1,
        pty_manager: Option<&PtySessionManager>,
    ) -> Result<BrowserDebugArtifactResponse, BrowserDebugError> {
        if !selection.is_valid() {
            return Err(BrowserDebugError::InvalidSelection);
        }
        let json =
            serde_json::to_vec(&selection).map_err(|_| BrowserDebugError::InvalidSelection)?;
        let json_len = json.len();
        if json_len > MAX_SELECTION_JSON_BYTES {
            return Err(BrowserDebugError::TooLarge);
        }

        let inflight = self.begin_op(&owner);
        let start_gen = inflight.generation;
        if let ArtifactSource::ManagedBrowser {
            principal,
            profile_epoch,
            ..
        } = &source
        {
            if let Some(act) = actor {
                if !self
                    .check_managed_admission(act, principal, *profile_epoch)
                    .await
                    || !self
                        .check_managed_selection_live(principal, managed_selection.as_ref())
                        .await
                {
                    return Err(BrowserDebugError::NotFound);
                }
            }
        }

        let quota_guard = self.reserve_create_slot(json_len).await?;

        let id = Uuid::new_v4();
        let json_path = self.root.path().join(format!("{id}.json"));
        let hooks = self.write_hooks();
        let (json_file, quota_guard) = write_file_cancellable(
            json_path.clone(),
            Bytes::from(json),
            quota_guard,
            self.op_sink(&owner, &inflight),
            hooks,
        )
        .await?;
        let mut post_write_cleanup = PublishedPathCleanupGuard::new(
            json_path.clone(),
            quota_guard,
            self.op_sink(&owner, &inflight),
        );

        // Post-write admission & selection completion check before publishing into entries
        if let ArtifactSource::ManagedBrowser {
            principal,
            profile_epoch,
            ..
        } = &source
        {
            if let Some(act) = actor {
                if !self
                    .check_managed_admission(act, principal, *profile_epoch)
                    .await
                    || !self
                        .check_managed_selection_live(principal, managed_selection.as_ref())
                        .await
                {
                    post_write_cleanup
                        .cleanup_now("discard managed artifact after completion recheck")
                        .await;
                    return Err(BrowserDebugError::NotFound);
                }
            }
        }

        let metadata = ArtifactMetadata {
            owner,
            source,
            managed_selection,
            terminal_id: terminal_id.clone(),
            terminal_incarnation,
            expires_at: Utc::now().timestamp_millis() + ARTIFACT_TTL_MS,
            json: json_file,
            png: None,
            png_uploading: false,
            handoff_claimed: false,
        };
        let response = response_for(id, &metadata);
        let insert_err: Option<BrowserDebugError> = {
            let mut entries = self.entries.write().await;
            if matches!(metadata.source, ArtifactSource::ManagedBrowser { .. })
                && self.managed_generation.load(Ordering::SeqCst) != start_gen
            {
                Some(BrowserDebugError::NotFound)
            } else if pty_manager
                .is_some_and(|pm| pm.live_incarnation(&terminal_id) != Some(terminal_incarnation))
            {
                Some(BrowserDebugError::IncarnationMismatch)
            } else {
                post_write_cleanup.disarm();
                entries.insert(id, metadata);
                None
            }
        };
        if let Some(err) = insert_err {
            post_write_cleanup
                .cleanup_now("discard managed artifact after commit recheck")
                .await;
            return Err(err);
        }
        tracing::info!(artifact_id = %id, size = response.json_size, sha256 = %response.json_sha256, "browser debug artifact created");
        Ok(response)
    }
    pub async fn upload_png(
        &self,
        id: Uuid,
        actor: &AuthenticatedActor,
        png: Bytes,
    ) -> Result<BrowserDebugArtifactResponse, BrowserDebugError> {
        let png_len = png.len();
        if png_len > MAX_PNG_BYTES {
            return Err(BrowserDebugError::TooLarge);
        }
        if !is_png(&png) {
            return Err(BrowserDebugError::InvalidPng);
        }

        let inflight = self.begin_op(&actor.subject);
        let start_gen = inflight.generation;
        let (png_path, source, managed_selection) = match {
            let mut entries = self.entries.write().await;
            if entries.get(&id).is_none() {
                Err(false)
            } else if entries.get(&id).is_some_and(expired) {
                Err(retire_locked(&self.pending_cleanups, &mut entries, id))
            } else {
                let metadata = entries.get_mut(&id).expect("entry was checked above");
                if metadata.owner != actor.subject {
                    return Err(BrowserDebugError::NotFound);
                }
                if metadata.handoff_claimed {
                    return Err(BrowserDebugError::AlreadyHandedOff);
                }
                if metadata.png.is_some() || metadata.png_uploading {
                    return Err(BrowserDebugError::PngAlreadyUploaded);
                }
                metadata.png_uploading = true;
                Ok((
                    self.root.path().join(format!("{id}.png")),
                    metadata.source.clone(),
                    metadata.managed_selection.clone(),
                ))
            }
        } {
            Ok(triple) => triple,
            Err(retired) => {
                if retired {
                    self.finish_expired(id, "before PNG upload").await;
                }
                return Err(BrowserDebugError::NotFound);
            }
        };

        let mut upload_guard = UploadReservationGuard::new(id, self.entries.clone());

        if let ArtifactSource::ManagedBrowser {
            principal,
            profile_epoch,
            ..
        } = &source
        {
            if !self
                .check_managed_admission(actor, principal, *profile_epoch)
                .await
                || !self
                    .check_managed_selection_live(principal, managed_selection.as_ref())
                    .await
            {
                return Err(BrowserDebugError::NotFound);
            }
        }

        let extra_quota = self.reserve_extra_bytes(png_len).await?;
        let hooks = self.write_hooks();
        let (png_file, extra_quota) = write_file_cancellable(
            png_path.clone(),
            png,
            extra_quota,
            self.op_sink(&actor.subject, &inflight),
            hooks,
        )
        .await?;
        let mut post_write_cleanup = PublishedPathCleanupGuard::new(
            png_path.clone(),
            extra_quota,
            self.op_sink(&actor.subject, &inflight),
        );

        // Recheck admission & selection after disk write for ManagedBrowser
        if let ArtifactSource::ManagedBrowser {
            principal,
            profile_epoch,
            ..
        } = &source
        {
            if !self
                .check_managed_admission(actor, principal, *profile_epoch)
                .await
                || !self
                    .check_managed_selection_live(principal, managed_selection.as_ref())
                    .await
            {
                post_write_cleanup
                    .cleanup_now("discard PNG after admission revocation during upload")
                    .await;
                return Err(BrowserDebugError::NotFound);
            }
        }

        let result = {
            let mut entries = self.entries.write().await;
            if (matches!(source, ArtifactSource::ManagedBrowser { .. })
                && self.managed_generation.load(Ordering::SeqCst) != start_gen)
                || entries.get(&id).is_none()
            {
                Err(false)
            } else if entries.get(&id).is_some_and(expired) {
                Err(retire_locked(&self.pending_cleanups, &mut entries, id))
            } else {
                let metadata = entries.get_mut(&id).expect("entry was checked above");
                if metadata.owner != actor.subject
                    || !metadata.png_uploading
                    || metadata.handoff_claimed
                {
                    Err(false)
                } else {
                    metadata.png_uploading = false;
                    metadata.png = Some(png_file.clone());
                    post_write_cleanup.disarm();
                    upload_guard.disarm();
                    Ok(response_for(id, metadata))
                }
            }
        };
        match result {
            Ok(response) => {
                tracing::info!(artifact_id = %id, size = png_file.size, sha256 = %png_file.sha256, "browser debug PNG uploaded");
                Ok(response)
            }
            Err(retired) => {
                post_write_cleanup
                    .cleanup_now("discard PNG after upload race")
                    .await;
                if retired {
                    self.finish_expired(id, "during PNG upload").await;
                }
                Err(BrowserDebugError::NotFound)
            }
        }
    }

    pub async fn delete(
        &self,
        id: Uuid,
        actor: &AuthenticatedActor,
    ) -> Result<(), BrowserDebugError> {
        let source = {
            let entries = self.entries.read().await;
            let metadata = entries.get(&id).ok_or(BrowserDebugError::NotFound)?;
            if metadata.owner != actor.subject {
                return Err(BrowserDebugError::NotFound);
            }
            metadata.source.clone()
        };

        if let ArtifactSource::ManagedBrowser {
            principal,
            profile_epoch,
            ..
        } = &source
        {
            if !self
                .check_managed_admission(actor, principal, *profile_epoch)
                .await
            {
                return Err(BrowserDebugError::NotFound);
            }
        }

        // Ownership moves to the charged pending set BEFORE any I/O is awaited, so a purge that
        // runs concurrently with the unlink still sees the files.
        {
            let mut entries = self.entries.write().await;
            let metadata = entries.get(&id).ok_or(BrowserDebugError::NotFound)?;
            if metadata.owner != actor.subject {
                return Err(BrowserDebugError::NotFound);
            }
            if metadata.handoff_claimed {
                return Err(BrowserDebugError::AlreadyHandedOff);
            }
            retire_locked(&self.pending_cleanups, &mut entries, id);
        }
        self.complete_cleanup(id, "delete").await?;
        tracing::info!(artifact_id = %id, "browser debug artifact deleted");
        Ok(())
    }

    /// Force-invalidates an unclaimed artifact during navigation, inspect cancel, or session teardown.
    /// A denied unlink keeps the files charged in the retryable pending set and is reported.
    pub async fn force_invalidate(&self, id: Uuid) -> Result<(), BrowserDebugError> {
        let retired = {
            let mut entries = self.entries.write().await;
            entries.get(&id).is_some_and(|m| !m.handoff_claimed)
                && retire_locked(&self.pending_cleanups, &mut entries, id)
        };
        if !retired {
            return Ok(());
        }
        self.complete_cleanup(id, "force invalidate pending artifact")
            .await
    }

    /// Atomically validates current authorization/selection fence and executes the single permitted
    /// PTY write under the ordered fence before marking the artifact handed off.
    pub async fn execute_handoff(
        &self,
        id: Uuid,
        actor: &AuthenticatedActor,
        pty_manager: &PtySessionManager,
    ) -> Result<BrowserDebugHandoffResponse, AppError> {
        // Captured before any await: a revocation published after this point is seen by the
        // check under the PTY lock; one published before it is seen by the async validation.
        let revocation = self.revocation_fence(&actor.subject);
        let start_gen = self.managed_generation.load(Ordering::SeqCst);
        let (source, managed_selection) = {
            let entries = self.entries.read().await;
            let metadata = entries
                .get(&id)
                .ok_or_else(|| AppError::BrowserDebug(BrowserDebugError::NotFound))?;
            if metadata.owner != actor.subject {
                return Err(AppError::BrowserDebug(BrowserDebugError::NotFound));
            }
            (metadata.source.clone(), metadata.managed_selection.clone())
        };

        if let ArtifactSource::ManagedBrowser {
            principal,
            profile_epoch,
            ..
        } = &source
        {
            if !self
                .check_managed_admission(actor, principal, *profile_epoch)
                .await
            {
                return Err(AppError::BrowserDebug(BrowserDebugError::NotFound));
            }
        }

        let hook = self._before_handoff_fence_hook.read().unwrap().clone();
        if let Some(h) = hook {
            h().await;
        }

        // Ordered final fence. Every async lock wait happens first: the entry lock, then
        // (managed) the session/navigation/reset selection fence, then the final asynchronous
        // revalidation of the live actor, profile and session. The remaining work runs on a
        // blocking worker that owns both guards; the synchronous authority recheck executes
        // under the PTY mutation lock, after any wait for that lock, immediately before the
        // write (`HandoffAuthority::is_current`). State published without the selection lock
        // (an observed native navigation, a reset epoch, the actor deadline) is therefore seen
        // by the check no matter how long the PTY lock wait took.
        let entries = self.entries.clone().write_owned().await;

        let managed = match &source {
            ArtifactSource::ManagedBrowser {
                principal,
                profile_epoch,
                browser_incarnation,
            } => {
                let Some((sess_id, nav_rev, sel_rev)) = &managed_selection else {
                    return Err(AppError::BrowserDebug(BrowserDebugError::NotFound));
                };
                let authority = self.authority.read().unwrap().clone();
                let Some(authority) = authority else {
                    return Err(AppError::BrowserDebug(BrowserDebugError::NotFound));
                };
                let Some(fence) = authority
                    .acquire_managed_selection_fence(
                        principal,
                        *profile_epoch,
                        sess_id,
                        *nav_rev,
                        *sel_rev,
                        id,
                    )
                    .await
                else {
                    return Err(AppError::BrowserDebug(BrowserDebugError::NotFound));
                };
                let hook = self
                    ._before_handoff_final_validation_hook
                    .read()
                    .unwrap()
                    .clone();
                if let Some(h) = hook {
                    h().await;
                }
                if !authority
                    .revalidate_managed_handoff(actor, principal, *profile_epoch, sess_id, *nav_rev)
                    .await
                {
                    return Err(AppError::BrowserDebug(BrowserDebugError::NotFound));
                }
                Some(HandoffAuthority {
                    authority,
                    principal: principal.clone(),
                    profile_epoch: *profile_epoch,
                    browser_incarnation: browser_incarnation.clone(),
                    revocation,
                    fence,
                    generation: self.managed_generation.clone(),
                    start_gen,
                })
            }
            ArtifactSource::Cooperative => None,
        };

        let pending = self.pending_cleanups.clone();
        let pty_manager = pty_manager.clone();
        let actor = actor.clone();
        let before_pty = self._before_pty_mutation_hook.read().unwrap().clone();
        // The blocking worker cannot be aborted, so a dropped caller is signalled to it: it
        // re-reads the flag under the PTY lock and never writes for a caller that is gone.
        let cancelled = Arc::new(AtomicBool::new(false));
        let _cancel_on_drop = CancelOnDrop(cancelled.clone());
        let attempt = tokio::task::spawn_blocking(move || {
            let mut entries = entries;
            let attempt = handoff_under_authority(
                &mut entries,
                &pending,
                id,
                &actor,
                &pty_manager,
                managed.as_ref(),
                &cancelled,
                before_pty.as_deref(),
            );
            drop(managed);
            drop(entries);
            attempt
        })
        .await
        .map_err(|error| AppError::BrowserDebug(BrowserDebugError::Task(error.to_string())))?;

        match attempt {
            HandoffAttempt::Done(resp) => Ok(resp),
            HandoffAttempt::Expired => {
                self.finish_expired(id, "before atomic handoff").await;
                Err(AppError::BrowserDebug(BrowserDebugError::NotFound))
            }
            HandoffAttempt::Err(err) => Err(err),
        }
    }

    /// Pure in-memory fence removing managed and pending artifacts for `principal` and bumping
    /// `managed_generation` without awaiting disk cleanup. The removed artifacts' files stay
    /// charged in the retryable pending set; call `retry_pending_cleanups(Some(principal))` to
    /// purge them (it fails while any private file remains).
    pub async fn fence_managed_by_principal_and_ids(
        &self,
        principal: &str,
        profile_epoch: Option<u64>,
        extra_ids: &[Uuid],
    ) -> Vec<Uuid> {
        // Published before the entry lock is awaited: a handoff that holds that lock while it
        // waits for the PTY mutex is denied by its final in-lock check.
        self.publish_revocation(principal);
        let removed = {
            let mut entries = self.entries.write().await;
            self.managed_generation.fetch_add(1, Ordering::SeqCst);
            let mut matched = Vec::new();
            let ids: Vec<Uuid> = entries.keys().copied().collect();
            for id in ids {
                let remove_entry = entries.get(&id).is_some_and(|entry| {
                    let is_managed_match = match &entry.source {
                        ArtifactSource::ManagedBrowser {
                            principal: p,
                            profile_epoch: epoch,
                            ..
                        } => {
                            p == principal
                                && profile_epoch.is_none_or(|target_epoch| *epoch <= target_epoch)
                        }
                        ArtifactSource::Cooperative => false,
                    };
                    let is_extra_match = !entry.handoff_claimed && extra_ids.contains(&id);
                    is_managed_match || is_extra_match
                });
                if remove_entry && retire_locked(&self.pending_cleanups, &mut entries, id) {
                    matched.push(id);
                }
            }
            matched
        };

        for id in &removed {
            self.discharge_selection_notice(*id).await;
        }
        removed
    }

    pub async fn revoke_managed_by_principal(
        &self,
        principal: &str,
        profile_epoch: Option<u64>,
    ) -> Result<(), BrowserDebugError> {
        self.fence_managed_by_principal_and_ids(principal, profile_epoch, &[])
            .await;
        self.retry_pending_cleanups(Some(principal)).await
    }

    pub async fn sweep_expired(&self) {
        let expired = {
            let mut entries = self.entries.write().await;
            let ids = entries
                .iter()
                .filter_map(|(id, metadata)| expired(metadata).then_some(*id))
                .collect::<Vec<_>>();
            ids.into_iter()
                .filter(|id| retire_locked(&self.pending_cleanups, &mut entries, *id))
                .collect::<Vec<_>>()
        };
        for id in expired {
            self.finish_expired(id, "expiry").await;
        }
        if let Err(error) = self.retry_pending_cleanups(None).await {
            tracing::warn!(error = %error, "retained browser debug artifact cleanup still pending");
        }
    }

    pub async fn dispose_all(&self) {
        let entries = std::mem::take(&mut *self.entries.write().await);
        {
            let mut q = self.quota.lock().unwrap();
            q.records = 0;
            q.bytes = 0;
            self.reserved_bytes.store(0, Ordering::Relaxed);
        }
        for metadata in entries.into_values() {
            remove_or_log(paths_for(&metadata), "shutdown").await;
        }
        self.pending_cleanups.lock().unwrap().clear();
        let root = self.root.path().to_path_buf();
        match tokio::task::spawn_blocking(move || std::fs::remove_dir_all(root)).await {
            Ok(Ok(())) => {}
            Ok(Err(error)) => tracing::warn!(error = %error, "browser debug root cleanup failed"),
            Err(error) => tracing::warn!(error = %error, "browser debug root cleanup task failed"),
        }
    }

    /// Finishes the retirement of an expired entry (already moved to the pending set).
    async fn finish_expired(&self, id: Uuid, stage: &'static str) {
        if let Err(error) = self.complete_cleanup(id, stage).await {
            tracing::warn!(artifact_id = %id, error = %error, stage, "browser debug expired artifact cleanup failed");
        }
    }
}

/// Everything the handoff must re-prove under the PTY mutation lock.
struct HandoffAuthority {
    authority: Arc<dyn BrowserAdmissionAuthority>,
    principal: String,
    profile_epoch: u64,
    browser_incarnation: String,
    revocation: RevocationFence,
    fence: Box<dyn HandoffFence>,
    generation: Arc<AtomicU64>,
    start_gen: u64,
}

impl HandoffAuthority {
    /// Synchronous and non-blocking: reset generation, published revocation, actor deadline,
    /// live profile epoch and browser incarnation, and the selection fence's own published
    /// state.
    fn is_current(&self, actor: &AuthenticatedActor) -> bool {
        self.generation.load(Ordering::SeqCst) == self.start_gen
            && self.revocation.is_current()
            && self.authority.final_handoff_sync_check(
                actor,
                &self.principal,
                self.profile_epoch,
                &self.browser_incarnation,
            )
            && self.fence.is_current()
    }
}

/// The principal's revocation epoch captured when a handoff started.
struct RevocationFence {
    epochs: Arc<StdMutex<HashMap<String, u64>>>,
    principal: String,
    captured: u64,
}

impl RevocationFence {
    fn is_current(&self) -> bool {
        self.epochs
            .lock()
            .unwrap()
            .get(&self.principal)
            .copied()
            .unwrap_or(0)
            == self.captured
    }
}

/// Tells the blocking handoff worker that its caller is gone.
struct CancelOnDrop(Arc<AtomicBool>);

impl Drop for CancelOnDrop {
    fn drop(&mut self) {
        self.0.store(true, Ordering::SeqCst);
    }
}

enum HandoffAttempt {
    Done(BrowserDebugHandoffResponse),
    Expired,
    Err(AppError),
}

/// Runs on the blocking worker with the entry write guard (and the selection fence) held.
/// The authority is checked first (so a revoked actor learns nothing about the entry) and
/// again by `write_if_incarnation` under the PTY mutex, right before the bytes are written.
/// A dropped caller (`cancelled`) is part of that authority: it is re-read under the PTY
/// mutex, so an abandoned handoff never writes.
#[allow(clippy::too_many_arguments)]
fn handoff_under_authority(
    entries: &mut HashMap<Uuid, ArtifactMetadata>,
    pending: &StdMutex<HashMap<Uuid, PendingCleanup>>,
    id: Uuid,
    actor: &AuthenticatedActor,
    pty_manager: &PtySessionManager,
    managed: Option<&HandoffAuthority>,
    cancelled: &AtomicBool,
    before_pty: Option<&(dyn Fn() + Send + Sync)>,
) -> HandoffAttempt {
    let not_found = || HandoffAttempt::Err(AppError::BrowserDebug(BrowserDebugError::NotFound));
    let authorized =
        || !cancelled.load(Ordering::SeqCst) && managed.is_none_or(|m| m.is_current(actor));
    if !authorized() {
        return not_found();
    }
    match entries.get(&id) {
        None => not_found(),
        Some(metadata) if expired(metadata) => {
            if retire_locked(pending, entries, id) {
                HandoffAttempt::Expired
            } else {
                not_found()
            }
        }
        Some(metadata) if metadata.owner != actor.subject => not_found(),
        Some(metadata) if metadata.handoff_claimed => {
            HandoffAttempt::Err(AppError::BrowserDebug(BrowserDebugError::AlreadyHandedOff))
        }
        Some(metadata) if metadata.png_uploading => {
            HandoffAttempt::Err(AppError::BrowserDebug(BrowserDebugError::ArtifactBusy))
        }
        Some(_) => {
            let metadata = entries.get_mut(&id).expect("entry checked above");
            let response = response_for(id, metadata);
            let expires_at = metadata.expires_at;
            let reference = match terminal_reference(&response) {
                Ok(reference) => reference,
                Err(err) => return HandoffAttempt::Err(AppError::BrowserDebug(err)),
            };
            if let Some(hook) = before_pty {
                hook();
            }
            match pty_manager.write_if_incarnation(
                &response.terminal_id,
                response.terminal_incarnation,
                reference.as_bytes(),
                || Utc::now().timestamp_millis() < expires_at && authorized(),
            ) {
                Ok(()) => {
                    metadata.handoff_claimed = true;
                    HandoffAttempt::Done(BrowserDebugHandoffResponse { inserted: true })
                }
                Err(err) => HandoffAttempt::Err(err),
            }
        }
    }
}

/// Moves `id` out of `entries` into the charged, owner-qualified pending set in one step under
/// the entry lock, with no I/O. From here on the files stay owned (and their quota charged)
/// until an unlink is confirmed, so a concurrent purge always finds them; the registration
/// obligation of a managed artifact moves with them. Returns whether `id` was present.
fn retire_locked(
    pending: &StdMutex<HashMap<Uuid, PendingCleanup>>,
    entries: &mut HashMap<Uuid, ArtifactMetadata>,
    id: Uuid,
) -> bool {
    let Some(metadata) = entries.remove(&id) else {
        return false;
    };
    pending.lock().unwrap().insert(
        id,
        PendingCleanup {
            owner: metadata.owner.clone(),
            paths: paths_for(&metadata),
            records: 1,
            bytes: charged_bytes(&metadata),
            selection_notice: metadata
                .managed_selection
                .as_ref()
                .map(|(session_id, _, _)| session_id.clone()),
        },
    );
    true
}
fn expired(metadata: &ArtifactMetadata) -> bool {
    metadata.expires_at <= Utc::now().timestamp_millis()
}

fn response_for(id: Uuid, metadata: &ArtifactMetadata) -> BrowserDebugArtifactResponse {
    BrowserDebugArtifactResponse {
        artifact_id: id.to_string(),
        terminal_id: metadata.terminal_id.clone(),
        terminal_incarnation: metadata.terminal_incarnation,
        expires_at: metadata.expires_at,
        json_path: metadata.json.path.display().to_string(),
        json_size: metadata.json.size,
        json_sha256: metadata.json.sha256.clone(),
        png_path: metadata
            .png
            .as_ref()
            .map(|file| file.path.display().to_string()),
        png_size: metadata.png.as_ref().map(|file| file.size),
        png_sha256: metadata.png.as_ref().map(|file| file.sha256.clone()),
    }
}

fn paths_for(metadata: &ArtifactMetadata) -> Vec<PathBuf> {
    std::iter::once(metadata.json.path.clone())
        .chain(metadata.png.iter().map(|file| file.path.clone()))
        .collect()
}

fn try_reserve_quota_sync(
    quota: &Arc<StdMutex<QuotaState>>,
    reserved_bytes: &Arc<AtomicUsize>,
    record_delta: usize,
    byte_delta: usize,
) -> Option<QuotaReservationGuard> {
    let mut q = quota.lock().unwrap();
    if q.records.saturating_add(record_delta) > MAX_GLOBAL_ARTIFACT_RECORDS
        || q.bytes.saturating_add(byte_delta) > MAX_GLOBAL_ARTIFACT_BYTES
    {
        return None;
    }
    q.records += record_delta;
    q.bytes += byte_delta;
    reserved_bytes.store(q.bytes, Ordering::Relaxed);
    Some(QuotaReservationGuard {
        quota: quota.clone(),
        reserved_bytes: reserved_bytes.clone(),
        records: record_delta,
        bytes: byte_delta,
        armed: true,
    })
}

fn release_quota_sync(
    quota: &Arc<StdMutex<QuotaState>>,
    reserved_bytes: &Arc<AtomicUsize>,
    record_delta: usize,
    byte_delta: usize,
) {
    let mut q = quota.lock().unwrap();
    q.records = q.records.saturating_sub(record_delta);
    q.bytes = q.bytes.saturating_sub(byte_delta);
    reserved_bytes.store(q.bytes, Ordering::Relaxed);
}

fn charged_bytes(metadata: &ArtifactMetadata) -> usize {
    (metadata.json.size + metadata.png.as_ref().map_or(0, |f| f.size)) as usize
}

struct QuotaReservationGuard {
    quota: Arc<StdMutex<QuotaState>>,
    reserved_bytes: Arc<AtomicUsize>,
    records: usize,
    bytes: usize,
    armed: bool,
}

impl QuotaReservationGuard {
    fn disarm(&mut self) {
        self.armed = false;
    }
}

impl Drop for QuotaReservationGuard {
    fn drop(&mut self) {
        if self.armed {
            release_quota_sync(&self.quota, &self.reserved_bytes, self.records, self.bytes);
        }
    }
}

struct UploadReservationGuard {
    id: Uuid,
    entries: Arc<RwLock<HashMap<Uuid, ArtifactMetadata>>>,
    armed: bool,
}

impl UploadReservationGuard {
    fn new(id: Uuid, entries: Arc<RwLock<HashMap<Uuid, ArtifactMetadata>>>) -> Self {
        Self {
            id,
            entries,
            armed: true,
        }
    }

    fn disarm(&mut self) {
        self.armed = false;
    }
}

impl Drop for UploadReservationGuard {
    fn drop(&mut self) {
        if !self.armed {
            return;
        }
        if let Ok(mut guard) = self.entries.try_write() {
            if let Some(meta) = guard.get_mut(&self.id) {
                meta.png_uploading = false;
            }
            return;
        }
        let id = self.id;
        let entries = self.entries.clone();
        if let Ok(handle) = tokio::runtime::Handle::try_current() {
            handle.spawn(async move {
                if let Some(meta) = entries.write().await.get_mut(&id) {
                    meta.png_uploading = false;
                }
            });
        }
    }
}

/// Operations (writes, uploads) whose private files are not yet owned by an entry or the
/// pending set. Keyed by `(owner, managed_generation at start)` so a purge can tell operations
/// that began before its fence from later ones.
#[derive(Default)]
struct InflightOps {
    counts: StdMutex<HashMap<(String, u64), usize>>,
}

impl InflightOps {
    fn begin(self: &Arc<Self>, owner: &str, generation: &AtomicU64) -> InflightGuard {
        // The generation is read under the counts lock: an operation is either counted before
        // a purge samples `any_started_before`, or it reads the post-fence generation.
        let mut counts = self.counts.lock().unwrap();
        let generation = generation.load(Ordering::SeqCst);
        *counts.entry((owner.to_string(), generation)).or_default() += 1;
        InflightGuard {
            ops: self.clone(),
            owner: owner.to_string(),
            generation,
        }
    }

    fn any_started_before(&self, owner: &str, generation: u64) -> bool {
        self.counts
            .lock()
            .unwrap()
            .iter()
            .any(|((o, g), n)| o == owner && *g < generation && *n > 0)
    }
}

struct InflightGuard {
    ops: Arc<InflightOps>,
    owner: String,
    generation: u64,
}

impl Clone for InflightGuard {
    fn clone(&self) -> Self {
        *self
            .ops
            .counts
            .lock()
            .unwrap()
            .entry((self.owner.clone(), self.generation))
            .or_default() += 1;
        Self {
            ops: self.ops.clone(),
            owner: self.owner.clone(),
            generation: self.generation,
        }
    }
}

impl Drop for InflightGuard {
    fn drop(&mut self) {
        let mut counts = self.ops.counts.lock().unwrap();
        let key = (self.owner.clone(), self.generation);
        if let Some(count) = counts.get_mut(&key) {
            *count -= 1;
            if *count == 0 {
                counts.remove(&key);
            }
        }
    }
}

/// Registers files whose unlink failed so they stay charged and retryable. Holding a sink keeps
/// the operation that created it registered as in flight.
#[derive(Clone)]
struct PendingSink {
    pending: Arc<StdMutex<HashMap<Uuid, PendingCleanup>>>,
    owner: String,
    before_unlink: SyncHookSlot,
    _inflight: InflightGuard,
}

impl PendingSink {
    /// Keeps a just-published file (and its still-charged quota) owned after a failed unlink.
    fn retain_failed(&self, path: PathBuf, quota: Option<QuotaReservationGuard>) {
        let (records, bytes) = quota.map_or((0, 0), |mut q| {
            q.disarm();
            (q.records, q.bytes)
        });
        self.pending.lock().unwrap().insert(
            Uuid::new_v4(),
            PendingCleanup {
                owner: self.owner.clone(),
                paths: vec![path],
                records,
                bytes,
                selection_notice: None,
            },
        );
    }

    /// Synchronous unlink. The quota is released only when the file is really gone; any other
    /// failure keeps both the file and its charge owned by the retryable pending set.
    fn unlink_or_retain(&self, path: PathBuf, quota: Option<QuotaReservationGuard>) {
        match std::fs::remove_file(&path) {
            Ok(()) => drop(quota),
            Err(error) if error.kind() == std::io::ErrorKind::NotFound => drop(quota),
            Err(error) => {
                tracing::warn!(error = %error, "browser debug artifact cleanup failed; retained for retry");
                self.retain_failed(path, quota);
            }
        }
    }
}

struct PublishedPathCleanupGuard {
    path: Option<PathBuf>,
    quota: Option<QuotaReservationGuard>,
    sink: PendingSink,
}

impl PublishedPathCleanupGuard {
    fn new(path: PathBuf, quota: QuotaReservationGuard, sink: PendingSink) -> Self {
        Self {
            path: Some(path),
            quota: Some(quota),
            sink,
        }
    }

    fn disarm(&mut self) {
        self.path = None;
        if let Some(mut q) = self.quota.take() {
            q.disarm();
        }
    }

    /// Unlinks the published file. Path and charge stay owned by this guard until the unlink is
    /// CONFIRMED, so a caller cancelled mid-await drops a still-armed guard whose `Drop` hands
    /// both to the retryable pending set (or releases them once the file is really gone).
    async fn cleanup_now(&mut self, operation: &'static str) {
        let Some(path) = self.path.clone() else {
            drop(self.quota.take());
            return;
        };
        let before_unlink = self.sink.before_unlink.read().unwrap().clone();
        match remove_files(vec![path.clone()], before_unlink).await {
            Ok(()) => {
                self.path = None;
                drop(self.quota.take());
            }
            Err(error) => {
                tracing::warn!(error = %error, operation, "browser debug artifact cleanup failed; retained for retry");
                self.path = None;
                self.sink.retain_failed(path, self.quota.take());
            }
        }
    }
}

impl Drop for PublishedPathCleanupGuard {
    fn drop(&mut self) {
        let path = self.path.take();
        let quota = self.quota.take();
        let Some(path) = path else {
            drop(quota);
            return;
        };
        let sink = self.sink.clone();
        let unlink = move || sink.unlink_or_retain(path, quota);
        if let Ok(handle) = tokio::runtime::Handle::try_current() {
            handle.spawn_blocking(unlink);
        } else {
            unlink();
        }
    }
}

#[derive(Default)]
struct SharedWriteCleanup {
    cancelled: bool,
    published_path: Option<PathBuf>,
    deferred_quota: Option<QuotaReservationGuard>,
}

struct WriteCancellationGuard {
    shared: Arc<StdMutex<SharedWriteCleanup>>,
    quota: Option<QuotaReservationGuard>,
    sink: PendingSink,
}

impl WriteCancellationGuard {
    fn disarm(&mut self) -> QuotaReservationGuard {
        self.quota.take().expect("quota already taken")
    }
}

impl Drop for WriteCancellationGuard {
    fn drop(&mut self) {
        let Some(guard) = self.quota.take() else {
            return;
        };
        let mut st = self.shared.lock().unwrap();
        if let Some(published) = st.published_path.take() {
            drop(st);
            let sink = self.sink.clone();
            let unlink = move || sink.unlink_or_retain(published, Some(guard));
            if let Ok(handle) = tokio::runtime::Handle::try_current() {
                handle.spawn_blocking(unlink);
            } else {
                unlink();
            }
        } else {
            st.cancelled = true;
            st.deferred_quota = Some(guard);
        }
    }
}

/// Test hooks run by the blocking writer at fixed points (all `None` in production).
#[derive(Clone, Default)]
struct WriteHooks {
    before: Option<Arc<dyn Fn() + Send + Sync>>,
    after_temp: Option<Arc<dyn Fn() + Send + Sync>>,
    after_persist: Option<Arc<dyn Fn() + Send + Sync>>,
}

async fn write_file_cancellable(
    path: PathBuf,
    bytes: Bytes,
    quota_guard: QuotaReservationGuard,
    sink: PendingSink,
    hooks: WriteHooks,
) -> Result<(ArtifactFile, QuotaReservationGuard), BrowserDebugError> {
    let shared = Arc::new(StdMutex::new(SharedWriteCleanup::default()));
    let mut cancel_guard = WriteCancellationGuard {
        shared: shared.clone(),
        quota: Some(quota_guard),
        sink: sink.clone(),
    };
    let shared_worker = shared.clone();
    let file = tokio::task::spawn_blocking(move || {
        write_file_sync_cancellable(path, bytes, shared_worker, sink, hooks)
    })
    .await
    .map_err(|error| BrowserDebugError::Task(error.to_string()))??;
    let quota_guard = cancel_guard.disarm();
    Ok((file, quota_guard))
}

/// Removes a temporary file the cancelled writer created; a failed unlink stays owned (and
/// charged) in the pending set instead of being forgotten.
fn discard_temp(
    temp: tempfile::NamedTempFile,
    sink: &PendingSink,
    quota: Option<QuotaReservationGuard>,
) {
    let path = temp.path().to_path_buf();
    match temp.close() {
        Ok(()) => drop(quota),
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => drop(quota),
        Err(error) => {
            tracing::warn!(error = %error, "browser debug artifact temp cleanup failed; retained for retry");
            sink.retain_failed(path, quota);
        }
    }
}

/// Private-mode, write and fsync a fresh temp file.
fn fill_temp(temp: &mut tempfile::NamedTempFile, bytes: &[u8]) -> std::io::Result<()> {
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        temp.as_file()
            .set_permissions(std::fs::Permissions::from_mode(0o600))?;
    }
    temp.write_all(bytes)?;
    temp.as_file().sync_all()
}

/// Removes a temp file after a failed (non-cancelled) publication. A confirmed unlink leaves
/// nothing to own; a denied one hands path and charge to the retryable pending set: through the
/// caller's cancellation guard (which still holds the charge) or, if that guard already
/// dropped, through the quota it deferred.
fn retain_failed_temp(
    temp: tempfile::NamedTempFile,
    shared: &StdMutex<SharedWriteCleanup>,
    sink: &PendingSink,
) {
    let path = temp.path().to_path_buf();
    match temp.close() {
        Ok(()) => {}
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => {}
        Err(error) => {
            tracing::warn!(error = %error, "browser debug artifact temp cleanup failed; retained for retry");
            let mut st = shared.lock().unwrap();
            if st.cancelled {
                let quota = st.deferred_quota.take();
                drop(st);
                sink.retain_failed(path, quota);
            } else {
                // The guard's `Drop` unlinks again and retains with its charge on failure.
                st.published_path = Some(path);
            }
        }
    }
}

fn write_file_sync_cancellable(
    path: PathBuf,
    bytes: Bytes,
    shared: Arc<StdMutex<SharedWriteCleanup>>,
    sink: PendingSink,
    hooks: WriteHooks,
) -> Result<ArtifactFile, BrowserDebugError> {
    if let Some(hook) = hooks.before {
        hook();
    }
    {
        // Nothing exists on disk yet: dropping the deferred quota is a complete cleanup.
        let mut st = shared.lock().unwrap();
        if st.cancelled {
            drop(st.deferred_quota.take());
            return Err(BrowserDebugError::NotFound);
        }
    }
    let parent = path
        .parent()
        .ok_or_else(|| BrowserDebugError::Task("artifact path has no parent".into()))?;
    let mut temp = tempfile::NamedTempFile::new_in(parent)?;
    if let Err(error) = fill_temp(&mut temp, bytes.as_ref()) {
        retain_failed_temp(temp, &shared, &sink);
        return Err(error.into());
    }
    if let Some(hook) = hooks.after_temp {
        hook();
    }
    {
        let mut st = shared.lock().unwrap();
        if st.cancelled {
            let quota = st.deferred_quota.take();
            drop(st);
            discard_temp(temp, &sink, quota);
            return Err(BrowserDebugError::NotFound);
        }
    }
    if let Err(error) = temp.persist_noclobber(&path) {
        // `PersistError.file` is the still-existing temp: a denied unlink must keep it owned.
        retain_failed_temp(error.file, &shared, &sink);
        return Err(BrowserDebugError::Io(error.error));
    }
    if let Some(hook) = hooks.after_persist {
        hook();
    }
    {
        let mut st = shared.lock().unwrap();
        if st.cancelled {
            let quota = st.deferred_quota.take();
            drop(st);
            sink.unlink_or_retain(path, quota);
            return Err(BrowserDebugError::NotFound);
        }
        st.published_path = Some(path.clone());
    }
    Ok(ArtifactFile {
        path,
        size: bytes.len() as u64,
        sha256: format!("{:x}", Sha256::digest(bytes.as_ref())),
    })
}
async fn remove_files(
    paths: Vec<PathBuf>,
    before: Option<Arc<dyn Fn() + Send + Sync>>,
) -> Result<(), BrowserDebugError> {
    tokio::task::spawn_blocking(move || {
        if let Some(hook) = before {
            hook();
        }
        for path in paths {
            if let Err(error) = std::fs::remove_file(path) {
                if error.kind() != std::io::ErrorKind::NotFound {
                    return Err(error);
                }
            }
        }
        Ok(())
    })
    .await
    .map_err(|error| BrowserDebugError::Task(error.to_string()))??;
    Ok(())
}

async fn remove_or_log(paths: Vec<PathBuf>, operation: &'static str) {
    if let Err(error) = remove_files(paths, None).await {
        tracing::warn!(error = %error, operation, "browser debug artifact cleanup failed");
    }
}

fn is_png(bytes: &[u8]) -> bool {
    const SIGNATURE: &[u8] = b"\x89PNG\r\n\x1a\n";
    const MAX_DECODED_PNG_BYTES: usize = 64 * 1024 * 1024;
    if !bytes.starts_with(SIGNATURE) {
        return false;
    }
    let mut offset = SIGNATURE.len();
    let mut saw_ihdr = false;
    let mut saw_idat = false;
    let mut idat_finished = false;
    while offset < bytes.len() {
        let Some(header_end) = offset.checked_add(8) else {
            return false;
        };
        if header_end > bytes.len() {
            return false;
        }
        let length = u32::from_be_bytes(bytes[offset..offset + 4].try_into().unwrap()) as usize;
        let Some(chunk_end) = header_end
            .checked_add(length)
            .and_then(|end| end.checked_add(4))
        else {
            return false;
        };
        if chunk_end > bytes.len() {
            return false;
        }
        let kind = &bytes[offset + 4..header_end];
        let data = &bytes[header_end..header_end + length];
        let checksum =
            u32::from_be_bytes(bytes[header_end + length..chunk_end].try_into().unwrap());
        if !kind.iter().all(u8::is_ascii_alphabetic)
            || png_crc32(&bytes[offset + 4..header_end + length]) != checksum
        {
            return false;
        }
        if !saw_ihdr {
            if kind != b"IHDR"
                || length != 13
                || data[..4].iter().all(|byte| *byte == 0)
                || data[4..8].iter().all(|byte| *byte == 0)
            {
                return false;
            }
            saw_ihdr = true;
        } else if kind == b"IHDR" || (kind == b"IDAT" && idat_finished) {
            return false;
        } else if kind == b"IDAT" {
            saw_idat |= !data.is_empty();
        } else if kind == b"IEND" {
            if length != 0 || !saw_idat || chunk_end != bytes.len() {
                return false;
            }
            let decoder = png::Decoder::new(Cursor::new(bytes));
            let Ok(mut reader) = decoder.read_info() else {
                return false;
            };
            if reader.output_buffer_size() > MAX_DECODED_PNG_BYTES {
                return false;
            }
            let mut output = vec![0; reader.output_buffer_size()];
            return reader.next_frame(&mut output).is_ok();
        } else if saw_idat {
            idat_finished = true;
        }
        offset = chunk_end;
    }
    false
}

fn png_crc32(bytes: &[u8]) -> u32 {
    let mut crc = u32::MAX;
    for byte in bytes {
        crc ^= u32::from(*byte);
        for _ in 0..8 {
            crc = if crc & 1 == 0 {
                crc >> 1
            } else {
                (crc >> 1) ^ 0xedb8_8320
            };
        }
    }
    !crc
}
