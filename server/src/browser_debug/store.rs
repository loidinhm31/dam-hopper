use std::{
    any::Any,
    collections::HashMap,
    future::Future,
    io::{Cursor, Write},
    path::PathBuf,
    pin::Pin,
    sync::{
        atomic::{AtomicU64, AtomicUsize, Ordering},
        Arc, Mutex as StdMutex, RwLock as StdRwLock,
    },
};

use axum::body::Bytes;
use chrono::Utc;
use sha2::{Digest, Sha256};
use tempfile::TempDir;
use tokio::sync::RwLock;
use uuid::Uuid;

use crate::{api::auth::AuthenticatedActor, error::AppError, pty::PtySessionManager};
use super::{
    terminal_reference, BrowserDebugArtifactResponse, BrowserDebugError,
    BrowserDebugHandoffResponse, BrowserSelectionV1, ARTIFACT_TTL_MS, MAX_PNG_BYTES,
    MAX_SELECTION_JSON_BYTES,
};
pub const MAX_GLOBAL_ARTIFACT_RECORDS: usize = 64;
pub const MAX_GLOBAL_ARTIFACT_BYTES: usize = 64 * 1024 * 1024;

#[derive(Clone, Debug, PartialEq, Eq)]
pub enum ArtifactSource {
    Cooperative,
    ManagedBrowser {
        principal: String,
        profile_epoch: u64,
        browser_incarnation: u64,
    },
}

pub type BoxFuture<'a, T> = Pin<Box<dyn Future<Output = T> + Send + 'a>>;

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
    ) -> BoxFuture<'a, Option<Box<dyn Any + Send + Sync>>> {
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
                Some(Box::new(()) as Box<dyn Any + Send + Sync>)
            } else {
                None
            }
        })
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
    managed_generation: Arc<AtomicU64>,
    authority: Arc<StdRwLock<Option<Arc<dyn BrowserAdmissionAuthority>>>>,
    #[doc(hidden)]
    pub _before_write_hook: Arc<StdRwLock<Option<Arc<dyn Fn() + Send + Sync>>>>,
    #[doc(hidden)]
    pub _after_persist_before_publish_hook: Arc<StdRwLock<Option<Arc<dyn Fn() + Send + Sync>>>>,
    #[doc(hidden)]
    pub _before_handoff_fence_hook:
        Arc<StdRwLock<Option<Arc<dyn Fn() -> BoxFuture<'static, ()> + Send + Sync>>>>,
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
            managed_generation: Arc::new(AtomicU64::new(0)),
            authority: Arc::new(StdRwLock::new(None)),
            _before_write_hook: Arc::new(StdRwLock::new(None)),
            _after_persist_before_publish_hook: Arc::new(StdRwLock::new(None)),
            _before_handoff_fence_hook: Arc::new(StdRwLock::new(None)),
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
        if let Some(guard) =
            try_reserve_quota_sync(&self.quota, &self.reserved_bytes, 0, extra_len)
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

    fn restore_quota_sync(&self, record_delta: usize, byte_delta: usize) {
        restore_quota_sync(&self.quota, &self.reserved_bytes, record_delta, byte_delta);
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

        let start_gen = self.managed_generation.load(Ordering::SeqCst);
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
        let before_hook = self._before_write_hook.read().unwrap().clone();
        let after_hook = self._after_persist_before_publish_hook.read().unwrap().clone();
        let (json_file, quota_guard) = write_file_cancellable(
            json_path.clone(),
            Bytes::from(json),
            quota_guard,
            before_hook,
            after_hook,
        )
        .await?;
        let mut post_write_cleanup = PublishedPathCleanupGuard::new(json_path.clone(), quota_guard);

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

        let start_gen = self.managed_generation.load(Ordering::SeqCst);
        let (png_path, source, managed_selection) = match {
            let mut entries = self.entries.write().await;
            if entries.get(&id).is_none() {
                Err(None)
            } else if entries.get(&id).is_some_and(expired) {
                Err(entries.remove(&id))
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
            Err(metadata) => {
                if let Some(metadata) = metadata {
                    self.retry_expired_cleanup(id, metadata, "before PNG upload")
                        .await;
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
        let before_hook = self._before_write_hook.read().unwrap().clone();
        let after_hook = self._after_persist_before_publish_hook.read().unwrap().clone();
        let (png_file, extra_quota) = write_file_cancellable(
            png_path.clone(),
            png,
            extra_quota,
            before_hook,
            after_hook,
        )
        .await?;
        let mut post_write_cleanup = PublishedPathCleanupGuard::new(png_path.clone(), extra_quota);

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
            if matches!(source, ArtifactSource::ManagedBrowser { .. })
                && self.managed_generation.load(Ordering::SeqCst) != start_gen
            {
                Err(None)
            } else if entries.get(&id).is_none() {
                Err(None)
            } else if entries.get(&id).is_some_and(expired) {
                Err(entries.remove(&id))
            } else {
                let metadata = entries.get_mut(&id).expect("entry was checked above");
                if metadata.owner != actor.subject || !metadata.png_uploading || metadata.handoff_claimed {
                    Err(None)
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
            Err(metadata) => {
                post_write_cleanup
                    .cleanup_now("discard PNG after upload race")
                    .await;
                if let Some(metadata) = metadata {
                    self.retry_expired_cleanup(id, metadata, "during PNG upload")
                        .await;
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

        let metadata = {
            let mut entries = self.entries.write().await;
            let metadata = entries.get(&id).ok_or(BrowserDebugError::NotFound)?;
            if metadata.owner != actor.subject {
                return Err(BrowserDebugError::NotFound);
            }
            if metadata.handoff_claimed {
                return Err(BrowserDebugError::AlreadyHandedOff);
            }
            entries.remove(&id).expect("entry was checked above")
        };
        let size = (metadata.json.size + metadata.png.as_ref().map_or(0, |f| f.size)) as usize;
        self.release_quota_sync(1, size);
        if let Err(error) = remove_files(paths_for(&metadata)).await {
            self.restore_quota_sync(1, size);
            self.entries.write().await.insert(id, metadata);
            return Err(error);
        }
        tracing::info!(artifact_id = %id, "browser debug artifact deleted");
        Ok(())
    }

    /// Force-invalidates an unclaimed artifact during navigation, inspect cancel, or session teardown.
    pub async fn force_invalidate(&self, id: Uuid) {
        let removed = {
            let mut entries = self.entries.write().await;
            if entries.get(&id).is_some_and(|m| !m.handoff_claimed) {
                entries.remove(&id)
            } else {
                None
            }
        };
        if let Some(metadata) = removed {
            let size = (metadata.json.size + metadata.png.as_ref().map_or(0, |f| f.size)) as usize;
            self.release_quota_sync(1, size);
            remove_or_log(paths_for(&metadata), "force invalidate pending artifact").await;
        }
    }

    /// Atomically validates current authorization/selection fence and executes the single permitted
    /// PTY write under the ordered fence before marking the artifact handed off.
    pub async fn execute_handoff(
        &self,
        id: Uuid,
        actor: &AuthenticatedActor,
        pty_manager: &PtySessionManager,
    ) -> Result<BrowserDebugHandoffResponse, AppError> {
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

        let _selection_fence = if let ArtifactSource::ManagedBrowser {
            principal,
            profile_epoch,
            ..
        } = &source
        {
            let Some((sess_id, nav_rev, sel_rev)) = &managed_selection else {
                return Err(AppError::BrowserDebug(BrowserDebugError::NotFound));
            };
            let auth = self.authority.read().unwrap().clone();
            let Some(authority) = auth else {
                return Err(AppError::BrowserDebug(BrowserDebugError::NotFound));
            };
            let Some(guard) = authority
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
            Some(guard)
        } else {
            None
        };

        enum HandoffAttempt {
            Done(BrowserDebugHandoffResponse),
            Expired(ArtifactMetadata),
            Err(AppError),
        }

        let attempt = {
            let mut entries = self.entries.write().await;
            if matches!(source, ArtifactSource::ManagedBrowser { .. })
                && self.managed_generation.load(Ordering::SeqCst) != start_gen
            {
                HandoffAttempt::Err(AppError::BrowserDebug(BrowserDebugError::NotFound))
            } else {
                match entries.get(&id) {
                    None => HandoffAttempt::Err(AppError::BrowserDebug(BrowserDebugError::NotFound)),
                    Some(metadata) if expired(metadata) => {
                        HandoffAttempt::Expired(entries.remove(&id).expect("entry checked above"))
                    }
                    Some(metadata) if metadata.owner != actor.subject => {
                        HandoffAttempt::Err(AppError::BrowserDebug(BrowserDebugError::NotFound))
                    }
                    Some(metadata) if metadata.handoff_claimed => {
                        HandoffAttempt::Err(AppError::BrowserDebug(BrowserDebugError::AlreadyHandedOff))
                    }
                    Some(metadata) if metadata.png_uploading => {
                        HandoffAttempt::Err(AppError::BrowserDebug(BrowserDebugError::ArtifactBusy))
                    }
                    Some(_) => {
                        let metadata = entries.get_mut(&id).expect("entry checked above");
                        let response = response_for(id, metadata);
                        match terminal_reference(&response) {
                            Err(err) => HandoffAttempt::Err(AppError::BrowserDebug(err)),
                            Ok(reference) => {
                                match pty_manager.write_if_incarnation(
                                    &response.terminal_id,
                                    response.terminal_incarnation,
                                    reference.as_bytes(),
                                ) {
                                    Ok(()) => {
                                        metadata.handoff_claimed = true;
                                        HandoffAttempt::Done(BrowserDebugHandoffResponse {
                                            inserted: true,
                                        })
                                    }
                                    Err(err) => HandoffAttempt::Err(err),
                                }
                            }
                        }
                    }
                }
            }
        };
        drop(_selection_fence);

        match attempt {
            HandoffAttempt::Done(resp) => Ok(resp),
            HandoffAttempt::Expired(metadata) => {
                self.retry_expired_cleanup(id, metadata, "before atomic handoff")
                    .await;
                Err(AppError::BrowserDebug(BrowserDebugError::NotFound))
            }
            HandoffAttempt::Err(err) => Err(err),
        }
    }

    /// Pure in-memory fence removing managed and pending artifacts for `principal` and bumping
    /// `managed_generation` without awaiting disk cleanup. Call `delete_fenced_artifacts` to purge files.
    pub async fn fence_managed_by_principal_and_ids(
        &self,
        principal: &str,
        profile_epoch: Option<u64>,
        extra_ids: &[Uuid],
    ) -> Vec<(Uuid, Vec<PathBuf>)> {
        let to_remove = {
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
                                && profile_epoch.map_or(true, |target_epoch| *epoch <= target_epoch)
                        }
                        ArtifactSource::Cooperative => false,
                    };
                    let is_extra_match = !entry.handoff_claimed && extra_ids.contains(&id);
                    is_managed_match || is_extra_match
                });
                if remove_entry {
                    if let Some(mut meta) = entries.remove(&id) {
                        meta.png_uploading = false;
                        meta.handoff_claimed = true;
                        matched.push((id, meta));
                    }
                }
            }
            matched
        };

        if !to_remove.is_empty() {
            let total_size: usize = to_remove
                .iter()
                .map(|(_, m)| (m.json.size + m.png.as_ref().map_or(0, |f| f.size)) as usize)
                .sum();
            self.release_quota_sync(to_remove.len(), total_size);
        }

        to_remove
            .into_iter()
            .map(|(id, meta)| (id, paths_for(&meta)))
            .collect()
    }

    pub async fn delete_fenced_artifacts(removed: Vec<(Uuid, Vec<PathBuf>)>, principal: &str) {
        for (id, paths) in removed {
            remove_or_log(paths, "revoke managed artifact").await;
            tracing::info!(artifact_id = %id, principal, "revoked managed browser artifact");
        }
    }

    pub async fn revoke_managed_by_principal(
        &self,
        principal: &str,
        profile_epoch: Option<u64>,
    ) {
        let removed = self
            .fence_managed_by_principal_and_ids(principal, profile_epoch, &[])
            .await;
        Self::delete_fenced_artifacts(removed, principal).await;
    }

    pub async fn sweep_expired(&self) {
        let expired = {
            let mut entries = self.entries.write().await;
            let ids = entries
                .iter()
                .filter_map(|(id, metadata)| expired(metadata).then_some(*id))
                .collect::<Vec<_>>();
            ids.into_iter()
                .filter_map(|id| entries.remove(&id).map(|metadata| (id, metadata)))
                .collect::<Vec<_>>()
        };
        for (id, metadata) in expired {
            let size = (metadata.json.size + metadata.png.as_ref().map_or(0, |f| f.size)) as usize;
            self.release_quota_sync(1, size);
            if let Err(error) = remove_files(paths_for(&metadata)).await {
                tracing::warn!(artifact_id = %id, error = %error, "browser debug artifact expiry cleanup failed");
                self.restore_quota_sync(1, size);
                self.entries.write().await.insert(id, metadata);
                continue;
            }
            tracing::info!(artifact_id = %id, "browser debug artifact expired");
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
        let root = self.root.path().to_path_buf();
        match tokio::task::spawn_blocking(move || std::fs::remove_dir_all(root)).await {
            Ok(Ok(())) => {}
            Ok(Err(error)) => tracing::warn!(error = %error, "browser debug root cleanup failed"),
            Err(error) => tracing::warn!(error = %error, "browser debug root cleanup task failed"),
        }
    }

    async fn retry_expired_cleanup(
        &self,
        id: Uuid,
        metadata: ArtifactMetadata,
        stage: &'static str,
    ) {
        let size = (metadata.json.size + metadata.png.as_ref().map_or(0, |f| f.size)) as usize;
        self.release_quota_sync(1, size);
        if let Err(error) = remove_files(paths_for(&metadata)).await {
            tracing::warn!(artifact_id = %id, error = %error, stage, "browser debug expired artifact cleanup failed");
            self.restore_quota_sync(1, size);
            self.entries.write().await.insert(id, metadata);
        }
    }
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

fn restore_quota_sync(
    quota: &Arc<StdMutex<QuotaState>>,
    reserved_bytes: &Arc<AtomicUsize>,
    record_delta: usize,
    byte_delta: usize,
) {
    let mut q = quota.lock().unwrap();
    q.records = q.records.saturating_add(record_delta);
    q.bytes = q.bytes.saturating_add(byte_delta);
    reserved_bytes.store(q.bytes, Ordering::Relaxed);
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

struct PublishedPathCleanupGuard {
    path: Option<PathBuf>,
    quota: Option<QuotaReservationGuard>,
}

impl PublishedPathCleanupGuard {
    fn new(path: PathBuf, quota: QuotaReservationGuard) -> Self {
        Self {
            path: Some(path),
            quota: Some(quota),
        }
    }

    fn disarm(&mut self) {
        self.path = None;
        if let Some(mut q) = self.quota.take() {
            q.disarm();
        }
    }

    async fn cleanup_now(&mut self, operation: &'static str) {
        if let Some(path) = self.path.take() {
            remove_or_log(vec![path], operation).await;
        }
        drop(self.quota.take());
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
        if let Ok(handle) = tokio::runtime::Handle::try_current() {
            handle.spawn_blocking(move || {
                let _ = std::fs::remove_file(path);
                drop(quota);
            });
        } else {
            let _ = std::fs::remove_file(path);
            drop(quota);
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
            if let Ok(handle) = tokio::runtime::Handle::try_current() {
                handle.spawn_blocking(move || {
                    let _ = std::fs::remove_file(published);
                    drop(guard);
                });
            } else {
                let _ = std::fs::remove_file(published);
                drop(guard);
            }
        } else {
            st.cancelled = true;
            st.deferred_quota = Some(guard);
        }
    }
}

async fn write_file_cancellable(
    path: PathBuf,
    bytes: Bytes,
    quota_guard: QuotaReservationGuard,
    before_hook: Option<Arc<dyn Fn() + Send + Sync>>,
    after_hook: Option<Arc<dyn Fn() + Send + Sync>>,
) -> Result<(ArtifactFile, QuotaReservationGuard), BrowserDebugError> {
    let shared = Arc::new(StdMutex::new(SharedWriteCleanup::default()));
    let mut cancel_guard = WriteCancellationGuard {
        shared: shared.clone(),
        quota: Some(quota_guard),
    };
    let shared_worker = shared.clone();
    let file = tokio::task::spawn_blocking(move || {
        write_file_sync_cancellable(path, bytes, shared_worker, before_hook, after_hook)
    })
    .await
    .map_err(|error| BrowserDebugError::Task(error.to_string()))??;
    let quota_guard = cancel_guard.disarm();
    Ok((file, quota_guard))
}

fn write_file_sync_cancellable(
    path: PathBuf,
    bytes: Bytes,
    shared: Arc<StdMutex<SharedWriteCleanup>>,
    before_hook: Option<Arc<dyn Fn() + Send + Sync>>,
    after_hook: Option<Arc<dyn Fn() + Send + Sync>>,
) -> Result<ArtifactFile, BrowserDebugError> {
    if let Some(hook) = before_hook {
        hook();
    }
    {
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
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        temp.as_file()
            .set_permissions(std::fs::Permissions::from_mode(0o600))?;
    }
    temp.write_all(bytes.as_ref())?;
    temp.as_file().sync_all()?;
    {
        let mut st = shared.lock().unwrap();
        if st.cancelled {
            drop(st.deferred_quota.take());
            return Err(BrowserDebugError::NotFound);
        }
    }
    temp.persist_noclobber(&path)
        .map_err(|error| BrowserDebugError::Io(error.error))?;
    if let Some(hook) = after_hook {
        hook();
    }
    {
        let mut st = shared.lock().unwrap();
        if st.cancelled {
            let quota = st.deferred_quota.take();
            drop(st);
            let _ = std::fs::remove_file(&path);
            drop(quota);
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
async fn remove_files(paths: Vec<PathBuf>) -> Result<(), BrowserDebugError> {
    tokio::task::spawn_blocking(move || {
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
    if let Err(error) = remove_files(paths).await {
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
