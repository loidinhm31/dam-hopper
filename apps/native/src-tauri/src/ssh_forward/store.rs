//! Windows-only typed, handle-contained persistence for SSH-forward state.
//!
//! All mutations share one gate. A failed parse, validation, or replacement
//! leaves the last committed document intact; raw bytes never cross this API.

use std::{
    collections::{HashMap, HashSet},
    io,
    os::windows::io::OwnedHandle,
    path::Path,
    sync::{
        atomic::{AtomicBool, Ordering},
        Arc, Mutex, OnceLock,
    },
};

use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use uuid::Uuid;

use super::{
    model::{UtcTimestamp, WireCounter},
    profile::{
        validate_canonical_ssh_host, validate_uuid_v4, LoopbackHost, ReconnectPolicy,
        SshForwardAuth, SshForwardProfile,
    },
    scope_retention::{
        is_purge_eligible, reconcile, validate_known_scopes, KnownScopesInput, Reconciliation,
        ScopeMeta,
    },
    windows_storage_probe::{
        acquire_file_lock, acquire_file_lock_at, create_new_relative_file, delete_handle,
        enumerate_directory, enumerate_directory_except, file_identity, flush_handle,
        ntstatus_error, open_activity_lock_file, open_exclusive_relative_file,
        open_or_create_relative_directory_no_delete, open_or_create_scope_directory, open_relative,
        open_relative_directory_for_deletion_no_delete, open_relative_directory_no_delete,
        open_relative_directory_shared, open_relative_for_mutation, open_root,
        open_scope_directory_existing, open_scope_operation_file, release_file_lock_at,
        validate_retained_handle, DirectoryEntry, FileIdentity,
    },
};

const STORE_ROOT: &str = "ssh-forward";
const SCOPES_DIRECTORY: &str = "scopes";
const IDENTITY_FILE: &str = "desktop-instance.toml";
const PROFILES_FILE: &str = "profiles.toml";
const TRUST_FILE: &str = "known-hosts.toml";
const META_FILE: &str = "scope-meta.toml";
const ACTIVITY_LOCK_FILE: &str = "scope-activity.lock";
const SCOPE_FENCE_FILE: &str = "scope-operation.lock";
const LOCK_FILE: &str = "ssh-forward.lock";
const SCHEMA_VERSION: u8 = 1;
const MAX_PROFILES: usize = 64;
const MAX_TRUSTED_ALGORITHMS_PER_ENDPOINT: usize = 8;
const SHA256_FINGERPRINT_LENGTH: usize = "SHA256:".len() + 43;

static PROCESS_DESKTOP_IDENTITIES: OnceLock<Mutex<HashMap<FileIdentity, String>>> = OnceLock::new();

pub(crate) struct SshForwardStore {
    app_config: Arc<OwnedHandle>,
    root: Arc<OwnedHandle>,
    root_identity: FileIdentity,
    scopes: Arc<OwnedHandle>,
    scopes_identity: FileIdentity,
    lock_file: Arc<OwnedHandle>,
    write_gate: Arc<Mutex<()>>,
    desktop_instance_id: Mutex<Option<String>>,
}
pub(crate) struct ScopeStore {
    app_config: Arc<OwnedHandle>,
    root: Arc<OwnedHandle>,
    directory: Mutex<Option<OwnedHandle>>,
    scopes: Arc<OwnedHandle>,
    root_identity: FileIdentity,
    scopes_identity: FileIdentity,
    lock_file: Arc<OwnedHandle>,
    scope_id: String,
    storage_key: String,
    directory_identity: FileIdentity,
    purged: AtomicBool,
    tombstone: Mutex<Option<String>>,
    write_gate: Arc<Mutex<()>>,
}

/// Runtime ownership fence held by the manager while a scope is active or
/// staged. Purge cannot acquire the same cross-process lock while this lease
/// is alive.
pub(crate) struct ScopeActivityLease {
    handle: OwnedHandle,
    offset: i64,
}

impl Drop for ScopeActivityLease {
    fn drop(&mut self) {
        release_file_lock_at(&self.handle, self.offset);
    }
}

struct ScopeOperationFence {
    handle: OwnedHandle,
}

impl Drop for ScopeOperationFence {
    fn drop(&mut self) {
        release_file_lock_at(&self.handle, 0);
        let _ = delete_handle(&self.handle);
    }
}

#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize)]
#[serde(rename_all = "snake_case", deny_unknown_fields)]
pub(crate) struct StoredProfiles {
    schema_version: u8,
    scope_id: String,
    profiles_revision: WireCounter,
    profiles: Vec<StoredProfile>,
}

#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize)]
#[serde(rename_all = "snake_case", deny_unknown_fields)]
pub(crate) struct StoredTrust {
    schema_version: u8,
    scope_id: String,
    trust_revision: WireCounter,
    entries: Vec<TrustedHost>,
}

#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize)]
#[serde(rename_all = "snake_case", deny_unknown_fields)]
pub(crate) struct StoredScopeMeta {
    schema_version: u8,
    scope_id: String,
    last_seen_at: UtcTimestamp,
    orphaned_at: Option<UtcTimestamp>,
}

#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize)]
#[serde(rename_all = "snake_case", deny_unknown_fields)]
pub(crate) struct TrustedHost {
    ssh_host: String,
    ssh_port: u16,
    algorithm: String,
    fingerprint: String,
}

#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize)]
#[serde(rename_all = "snake_case", deny_unknown_fields)]
struct StoredProfile {
    id: String,
    scope_id: String,
    name: String,
    ssh_host: String,
    ssh_port: u16,
    ssh_user: String,
    auth: StoredAuth,
    local_port: u16,
    target_host: LoopbackHost,
    target_port: u16,
    auto_start: bool,
    reconnect: ReconnectPolicy,
    created_at: UtcTimestamp,
    updated_at: UtcTimestamp,
}

#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize)]
#[serde(tag = "mode", rename_all = "snake_case", deny_unknown_fields)]
enum StoredAuth {
    Agent,
    Key { key_id: String },
}

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
struct ReplacementMarker {
    staged: FileIdentity,
    destination: Option<FileIdentity>,
}

impl ReplacementMarker {
    fn encode(self) -> String {
        format!(
            "version=1\n{}{}",
            self.staged.marker(),
            self.destination
                .map(FileIdentity::marker)
                .unwrap_or_else(|| "none\n".into())
        )
    }

    fn parse(value: &[u8]) -> io::Result<Self> {
        let text = std::str::from_utf8(value).map_err(|_| invalid_data("invalid_commit_marker"))?;
        let mut lines = text.lines();
        if lines.next() != Some("version=1") {
            return Err(invalid_data("invalid_commit_marker"));
        }
        let staged = FileIdentity::parse_marker(
            lines
                .next()
                .ok_or_else(|| invalid_data("invalid_commit_marker"))?,
        )?;
        let destination = lines
            .next()
            .ok_or_else(|| invalid_data("invalid_commit_marker"))?;
        if lines.next().is_some() {
            return Err(invalid_data("invalid_commit_marker"));
        }
        let destination = if destination == "none" {
            None
        } else {
            Some(FileIdentity::parse_marker(destination)?)
        };
        Ok(Self {
            staged,
            destination,
        })
    }
}

impl SshForwardStore {
    pub(crate) fn open(app_config_dir: &Path) -> io::Result<Self> {
        let app_config = Arc::new(open_root(app_config_dir)?);
        let root = Arc::new(open_or_create_relative_directory_no_delete(
            &app_config,
            STORE_ROOT,
        )?);
        let root_identity = file_identity(&root)?;
        let scopes = Arc::new(open_or_create_relative_directory_no_delete(
            &root,
            SCOPES_DIRECTORY,
        )?);
        let scopes_identity = file_identity(&scopes)?;
        let lock_file = Arc::new(open_exclusive_relative_file(&root, LOCK_FILE)?);
        let store = Self {
            app_config,
            root,
            root_identity,
            scopes,
            scopes_identity,
            lock_file,
            write_gate: Arc::new(Mutex::new(())),
            desktop_instance_id: Mutex::new(None),
        };
        {
            let _gate = lock(&store.write_gate)?;
            let _file_lock = acquire_file_lock(&store.lock_file)?;
            store.ensure_current()?;
            recover_identity_artifacts(&store.root)?;
            recover_storage_artifacts(&store.scopes)?;
        }
        Ok(store)
    }

    pub(crate) fn scope(&self, scope_id: &str) -> io::Result<ScopeStore> {
        validate_uuid_v4(scope_id).map_err(invalid_scope)?;
        let _gate = lock(&self.write_gate)?;
        let _file_lock = acquire_file_lock(&self.lock_file)?;
        self.ensure_current()?;
        let storage_key = scope_storage_key(scope_id)?;
        let directory = open_or_create_scope_directory(&self.scopes, &storage_key)?;
        flush_handle(&self.scopes)?;
        let directory_identity = file_identity(&directory)?;
        Ok(self.make_scope(scope_id.into(), storage_key, directory, directory_identity))
    }

    /// Opens a scope for deletion/recovery without creating missing storage.
    pub(crate) fn existing_scope(&self, scope_id: &str) -> io::Result<ScopeStore> {
        validate_uuid_v4(scope_id).map_err(invalid_scope)?;
        let _gate = lock(&self.write_gate)?;
        let _file_lock = acquire_file_lock(&self.lock_file)?;
        self.ensure_current()?;
        let storage_key = scope_storage_key(scope_id)?;
        let directory = open_scope_directory_existing(&self.scopes, &storage_key)?;
        let directory_identity = file_identity(&directory)?;
        Ok(self.make_scope(scope_id.into(), storage_key, directory, directory_identity))
    }

    /// Returns all scope directories whose retained metadata proves their UUID/hash pair.
    pub(crate) fn enumerate_scopes(&self) -> io::Result<Vec<ScopeStore>> {
        let _gate = lock(&self.write_gate)?;
        let _file_lock = acquire_file_lock(&self.lock_file)?;
        self.ensure_current()?;
        recover_storage_artifacts(&self.scopes)?;
        let mut scopes = Vec::new();
        for entry in enumerate_directory(&self.scopes)? {
            if !entry.is_directory || !is_scope_storage_key(&entry.name) {
                return Err(invalid_data("unexpected_scope_entry"));
            }
            let meta = match read_named_typed_handle::<StoredScopeMeta>(&entry.handle, META_FILE) {
                Ok(meta) => meta,
                Err(error) if error.kind() == io::ErrorKind::NotFound => {
                    if enumerate_directory(&entry.handle)?.is_empty() {
                        continue;
                    }
                    return Err(invalid_data("scope_meta_missing"));
                }
                Err(error) => return Err(error),
            };
            meta.validate(&meta.scope_id)?;
            if scope_storage_key(&meta.scope_id)? != entry.name {
                return Err(invalid_data("scope_storage_key_mismatch"));
            }
            let directory_identity = file_identity(&entry.handle)?;
            scopes.push(self.make_scope(
                meta.scope_id,
                entry.name,
                entry.handle,
                directory_identity,
            ));
        }
        scopes.sort_by(|left, right| left.storage_key.cmp(&right.storage_key));
        Ok(scopes)
    }

    /// Purges an observed missing scope and returns false when it is already gone.
    pub(crate) fn purge_scope_if_deleted(
        &self,
        scope_id: &str,
        known: &KnownScopesInput,
    ) -> io::Result<bool> {
        validate_uuid_v4(scope_id).map_err(invalid_scope)?;
        let _gate = lock(&self.write_gate)?;
        let _file_lock = acquire_file_lock(&self.lock_file)?;
        self.ensure_current()?;
        let storage_key = scope_storage_key(scope_id)?;
        let directory = match open_scope_directory_existing(&self.scopes, &storage_key) {
            Ok(directory) => directory,
            Err(error) if error.kind() == io::ErrorKind::NotFound => {
                return self.purge_pending_tombstone(&storage_key, known)
            }
            Err(error) => return Err(error),
        };
        let directory_identity = file_identity(&directory)?;
        let scope = self.make_scope(scope_id.into(), storage_key, directory, directory_identity);
        scope.purge_if_deleted_locked(known)
    }

    fn purge_pending_tombstone(
        &self,
        storage_key: &str,
        known: &KnownScopesInput,
    ) -> io::Result<bool> {
        let mut tombstones = enumerate_directory(&self.scopes)?
            .into_iter()
            .filter(|entry| {
                entry.is_directory
                    && is_tombstone_name(&entry.name)
                    && entry.name.starts_with(&format!("{storage_key}.tombstone-"))
            })
            .collect::<Vec<_>>();
        if tombstones.is_empty() {
            return Ok(false);
        }
        if tombstones.len() > 1 {
            return Err(invalid_data("ambiguous_scope_tombstone"));
        }
        validate_known_scopes(known).map_err(|_| invalid_data("invalid_known_scopes"))?;
        let KnownScopesInput::Available { ids } = known else {
            return Err(invalid_data("known_scopes_unavailable"));
        };
        if ids
            .iter()
            .any(|id| scope_storage_key(id).ok().as_deref() == Some(storage_key))
        {
            return Err(invalid_data("scope_not_deleted"));
        }
        let tombstone = tombstones.pop().expect("one tombstone remains");
        let identity = file_identity(&tombstone.handle)?;
        let name = tombstone.name;
        drop(tombstone.handle);
        let _activity = acquire_scope_activity_lock(&self.root, storage_key)?;
        recover_tombstone(&self.scopes, &name, identity)?;
        Ok(true)
    }

    pub(crate) fn load_or_create_desktop_instance(&self) -> io::Result<String> {
        let process_cache = PROCESS_DESKTOP_IDENTITIES.get_or_init(|| Mutex::new(HashMap::new()));
        if let Some(identity) = process_cache
            .lock()
            .map_err(|_| io::Error::other("desktop_instance_process_cache_poisoned"))?
            .get(&self.root_identity)
            .cloned()
        {
            return Ok(identity);
        }
        let mut cached = self
            .desktop_instance_id
            .lock()
            .map_err(|_| io::Error::other("desktop_instance_cache_poisoned"))?;
        if let Some(identity) = cached.as_ref() {
            return Ok(identity.clone());
        }
        let _gate = lock(&self.write_gate)?;
        let _file_lock = acquire_file_lock(&self.lock_file)?;
        self.ensure_current()?;
        recover_identity_artifacts(&self.root)?;
        let identity = match read_file(&self.root, IDENTITY_FILE) {
            Ok(contents) => parse_identity(&contents),
            Err(error) if error.kind() == io::ErrorKind::NotFound => {
                let identity = Uuid::new_v4().to_string();
                write_file(&self.root, IDENTITY_FILE, &identity_toml(&identity))?;
                Ok(identity)
            }
            Err(error) => Err(error),
        }?;
        *cached = Some(identity.clone());
        process_cache
            .lock()
            .map_err(|_| io::Error::other("desktop_instance_process_cache_poisoned"))?
            .insert(self.root_identity, identity.clone());
        Ok(identity)
    }

    fn make_scope(
        &self,
        scope_id: String,
        storage_key: String,
        directory: OwnedHandle,
        directory_identity: FileIdentity,
    ) -> ScopeStore {
        ScopeStore {
            app_config: Arc::clone(&self.app_config),
            root: Arc::clone(&self.root),
            directory: Mutex::new(Some(directory)),
            scopes: Arc::clone(&self.scopes),
            root_identity: self.root_identity,
            scopes_identity: self.scopes_identity,
            lock_file: Arc::clone(&self.lock_file),
            scope_id,
            storage_key,
            directory_identity,
            purged: AtomicBool::new(false),
            tombstone: Mutex::new(None),
            write_gate: Arc::clone(&self.write_gate),
        }
    }

    fn ensure_current(&self) -> io::Result<()> {
        ensure_store_handles(
            &self.app_config,
            &self.root,
            self.root_identity,
            self.scopes_identity,
        )
    }
}

impl StoredProfiles {
    pub(crate) fn empty(scope_id: &str) -> Self {
        Self {
            schema_version: SCHEMA_VERSION,
            scope_id: scope_id.into(),
            profiles_revision: WireCounter::ZERO,
            profiles: vec![],
        }
    }
    fn validate(&self, scope_id: &str) -> io::Result<()> {
        validate_document_header(self.schema_version, &self.scope_id, scope_id)?;
        if self.profiles.len() > MAX_PROFILES {
            return Err(invalid_data("profile_limit"));
        }
        let mut ids = HashSet::new();
        self.profiles.iter().try_for_each(|profile| {
            profile.validate(scope_id)?;
            if ids.insert(profile.id.as_str()) {
                Ok(())
            } else {
                Err(invalid_data("duplicate_profile_id"))
            }
        })
    }
}

impl StoredTrust {
    pub(crate) fn empty(scope_id: &str) -> Self {
        Self {
            schema_version: SCHEMA_VERSION,
            scope_id: scope_id.into(),
            trust_revision: WireCounter::ZERO,
            entries: vec![],
        }
    }
    fn validate(&self, scope_id: &str) -> io::Result<()> {
        validate_document_header(self.schema_version, &self.scope_id, scope_id)?;
        let mut algorithms = HashSet::new();
        let mut endpoint_counts = HashMap::new();
        self.entries.iter().try_for_each(|entry| {
            entry.validate()?;
            let endpoint = (entry.ssh_host.as_str(), entry.ssh_port);
            let count = endpoint_counts.entry(endpoint).or_insert(0usize);
            *count += 1;
            if *count > MAX_TRUSTED_ALGORITHMS_PER_ENDPOINT {
                return Err(invalid_data("trust_algorithm_limit"));
            }
            if algorithms.insert((
                entry.ssh_host.as_str(),
                entry.ssh_port,
                entry.algorithm.as_str(),
            )) {
                Ok(())
            } else {
                Err(invalid_data("duplicate_trust_algorithm"))
            }
        })
    }
}

impl StoredScopeMeta {
    pub(crate) fn new(scope_id: &str, now: UtcTimestamp) -> Self {
        Self {
            schema_version: SCHEMA_VERSION,
            scope_id: scope_id.into(),
            last_seen_at: now,
            orphaned_at: None,
        }
    }
    fn validate(&self, scope_id: &str) -> io::Result<()> {
        validate_document_header(self.schema_version, &self.scope_id, scope_id).and_then(|()| {
            match self.orphaned_at {
                Some(orphaned_at) if orphaned_at < self.last_seen_at => {
                    Err(invalid_data("invalid_scope_retention_order"))
                }
                _ => Ok(()),
            }
        })
    }
    fn retention(&self) -> ScopeMeta {
        ScopeMeta {
            scope_id: self.scope_id.clone(),
            last_seen_at: self.last_seen_at,
            orphaned_at: self.orphaned_at,
        }
    }
    fn set_retention(&mut self, meta: ScopeMeta) {
        self.last_seen_at = meta.last_seen_at;
        self.orphaned_at = meta.orphaned_at;
    }
}

impl TrustedHost {
    fn validate(&self) -> io::Result<()> {
        if validate_canonical_ssh_host(&self.ssh_host).is_err()
            || self.ssh_port == 0
            || self.algorithm.is_empty()
            || self.algorithm.len() > 128
            || !self.algorithm.bytes().all(|byte| {
                byte.is_ascii_alphanumeric() || matches!(byte, b'-' | b'_' | b'.' | b'@' | b'+')
            })
            || !self.fingerprint.starts_with("SHA256:")
            || self.fingerprint.len() != SHA256_FINGERPRINT_LENGTH
            || !self.fingerprint["SHA256:".len()..]
                .bytes()
                .all(|byte| byte.is_ascii_alphanumeric() || matches!(byte, b'+' | b'/'))
        {
            Err(invalid_data("invalid_trust"))
        } else {
            Ok(())
        }
    }
}

impl StoredProfile {
    fn validate(&self, scope_id: &str) -> io::Result<()> {
        self.to_profile()?
            .validate()
            .map_err(|_| invalid_data("invalid_profile"))?;
        if self.scope_id == scope_id {
            Ok(())
        } else {
            Err(invalid_data("embedded_scope_mismatch"))
        }
    }
    fn to_profile(&self) -> io::Result<SshForwardProfile> {
        Ok(SshForwardProfile {
            id: self.id.clone(),
            scope_id: self.scope_id.clone(),
            name: self.name.clone(),
            ssh_host: self.ssh_host.clone(),
            ssh_port: self.ssh_port,
            ssh_user: self.ssh_user.clone(),
            auth: self.auth.to_auth(),
            local_port: self.local_port,
            target_host: self.target_host,
            target_port: self.target_port,
            auto_start: self.auto_start,
            reconnect: self.reconnect,
            created_at: self.created_at,
            updated_at: self.updated_at,
        })
    }
}

impl StoredAuth {
    fn to_auth(&self) -> SshForwardAuth {
        match self {
            Self::Agent => SshForwardAuth::Agent,
            Self::Key { key_id } => SshForwardAuth::Key {
                key_id: key_id.clone(),
            },
        }
    }
}

impl ScopeStore {
    /// Acquires a cross-process runtime lease. The manager should hold this
    /// lease for every active or staged scope; purge takes the same lock.
    pub(crate) fn acquire_activity_lease(&self) -> io::Result<ScopeActivityLease> {
        self.ensure_live()?;
        let _gate = lock(&self.write_gate)?;
        let _file_lock = acquire_file_lock(&self.lock_file)?;
        self.ensure_current()?;
        self.acquire_activity_lock_locked()
    }

    fn acquire_activity_lock_locked(&self) -> io::Result<ScopeActivityLease> {
        acquire_scope_activity_lock(&self.root, &self.storage_key)
    }

    pub(crate) fn load_profiles(&self) -> io::Result<StoredProfiles> {
        self.ensure_live()?;
        let _gate = lock(&self.write_gate)?;
        let _file_lock = acquire_file_lock(&self.lock_file)?;
        let _fence = self.acquire_scope_operation_fence()?;
        self.ensure_current()?;
        self.load_profiles_unlocked()
    }
    fn load_profiles_unlocked(&self) -> io::Result<StoredProfiles> {
        self.read_or_empty(
            PROFILES_FILE,
            StoredProfiles::empty,
            StoredProfiles::validate,
        )
    }
    pub(crate) fn load_trust(&self) -> io::Result<StoredTrust> {
        self.ensure_live()?;
        let _gate = lock(&self.write_gate)?;
        let _file_lock = acquire_file_lock(&self.lock_file)?;
        let _fence = self.acquire_scope_operation_fence()?;
        self.ensure_current()?;
        self.load_trust_unlocked()
    }
    fn load_trust_unlocked(&self) -> io::Result<StoredTrust> {
        self.read_or_empty(TRUST_FILE, StoredTrust::empty, StoredTrust::validate)
    }
    pub(crate) fn load_meta(&self) -> io::Result<StoredScopeMeta> {
        self.ensure_live()?;
        let _gate = lock(&self.write_gate)?;
        let _file_lock = acquire_file_lock(&self.lock_file)?;
        let _fence = self.acquire_scope_operation_fence()?;
        self.ensure_current()?;
        self.load_meta_unlocked()
    }
    fn load_meta_unlocked(&self) -> io::Result<StoredScopeMeta> {
        self.read_typed(META_FILE, StoredScopeMeta::validate)
    }

    fn validate_documents_for_purge(&self) -> io::Result<()> {
        self.load_profiles_unlocked()?;
        self.load_trust_unlocked()?;
        match self.load_meta_unlocked() {
            Ok(_) => Ok(()),
            Err(error) if error.kind() == io::ErrorKind::NotFound => Ok(()),
            Err(error) => Err(error),
        }
    }

    pub(crate) fn replace_profiles(
        &self,
        expected: WireCounter,
        mut next: StoredProfiles,
    ) -> io::Result<StoredProfiles> {
        self.ensure_live()?;
        let _gate = lock(&self.write_gate)?;
        let _file_lock = acquire_file_lock(&self.lock_file)?;
        let _fence = self.acquire_scope_operation_fence()?;
        self.ensure_current()?;
        let current = self.load_profiles_unlocked()?;
        if current.profiles_revision != expected {
            return Err(invalid_data("profiles_revision_conflict"));
        }
        next.profiles_revision = current
            .profiles_revision
            .increment()
            .map_err(|_| invalid_data("counter_exhausted"))?;
        next.validate(&self.scope_id)?;
        self.write_typed(PROFILES_FILE, &next)?;
        Ok(next)
    }

    pub(crate) fn replace_trust(
        &self,
        expected: WireCounter,
        mut next: StoredTrust,
    ) -> io::Result<StoredTrust> {
        self.ensure_live()?;
        let _gate = lock(&self.write_gate)?;
        let _file_lock = acquire_file_lock(&self.lock_file)?;
        let _fence = self.acquire_scope_operation_fence()?;
        self.ensure_current()?;
        let current = self.load_trust_unlocked()?;
        if current.trust_revision != expected {
            return Err(invalid_data("trust_revision_conflict"));
        }
        next.trust_revision = current
            .trust_revision
            .increment()
            .map_err(|_| invalid_data("counter_exhausted"))?;
        next.validate(&self.scope_id)?;
        self.write_typed(TRUST_FILE, &next)?;
        Ok(next)
    }

    pub(crate) fn reconcile_known_scope(
        &self,
        known: &KnownScopesInput,
        now: UtcTimestamp,
    ) -> io::Result<Reconciliation> {
        self.ensure_live()?;
        let _gate = lock(&self.write_gate)?;
        let _file_lock = acquire_file_lock(&self.lock_file)?;
        self.ensure_current()?;
        validate_known_scopes(known).map_err(|_| invalid_data("invalid_known_scopes"))?;
        if matches!(known, KnownScopesInput::Unavailable) {
            return Ok(Reconciliation::Unchanged);
        }
        let fence = self.acquire_scope_operation_fence()?;
        self.load_profiles_unlocked()?;
        self.load_trust_unlocked()?;
        let mut stored = match self.load_meta_unlocked() {
            Ok(meta) => meta,
            Err(error) if error.kind() == io::ErrorKind::NotFound => {
                StoredScopeMeta::new(&self.scope_id, now)
            }
            Err(error) => return Err(error),
        };
        let mut meta = stored.retention();
        let result =
            reconcile(&mut meta, known, now).map_err(|_| invalid_data("invalid_known_scopes"))?;
        stored.set_retention(meta);
        self.write_typed(META_FILE, &stored)?;
        drop(fence);
        if matches!(known, KnownScopesInput::Available { .. })
            && is_purge_eligible(&stored.retention(), now)
                .map_err(|_| invalid_data("invalid_meta"))?
        {
            self.purge_locked()?;
        }
        Ok(result)
    }

    pub(crate) fn purge_if_deleted(&self, known: &KnownScopesInput) -> io::Result<bool> {
        if self.purged.load(Ordering::Acquire) {
            return Ok(false);
        }
        let _gate = lock(&self.write_gate)?;
        let _file_lock = acquire_file_lock(&self.lock_file)?;
        self.purge_if_deleted_locked(known)
    }

    fn purge_if_deleted_locked(&self, known: &KnownScopesInput) -> io::Result<bool> {
        if self.purged.load(Ordering::Acquire) {
            return Ok(false);
        }
        validate_known_scopes(known).map_err(|_| invalid_data("invalid_known_scopes"))?;
        let KnownScopesInput::Available { ids } = known else {
            return Err(invalid_data("known_scopes_unavailable"));
        };
        if ids.iter().any(|id| id == &self.scope_id) {
            return Err(invalid_data("scope_not_deleted"));
        }
        if self.tombstone_name()?.is_some() {
            self.purge_locked()?;
            return Ok(true);
        }
        if self.directory_is_missing()? {
            match self.restore_current_directory() {
                Ok(()) => {}
                Err(error) if error.kind() == io::ErrorKind::NotFound => return Ok(false),
                Err(error) => return Err(error),
            }
        }
        match self.ensure_current() {
            Ok(()) => {}
            Err(error) if error.kind() == io::ErrorKind::NotFound => return Ok(false),
            Err(error) => return Err(error),
        }
        let fence = self.acquire_scope_operation_fence()?;
        self.ensure_current()?;
        self.validate_documents_for_purge()?;
        drop(fence);
        self.purge_locked()?;
        Ok(true)
    }

    fn purge_locked(&self) -> io::Result<()> {
        let _activity = self.acquire_activity_lock_locked()?;
        self.purge_locked_with_fault_inner(None)
    }

    #[allow(dead_code)]
    fn purge_locked_with_fault(&self, fault: Option<PurgeFault>) -> io::Result<()> {
        let _activity = self.acquire_activity_lock_locked()?;
        self.purge_locked_with_fault_inner(fault)
    }

    fn purge_locked_with_fault_inner(&self, fault: Option<PurgeFault>) -> io::Result<()> {
        let pending_tombstone = self.tombstone_name()?;
        let tombstone = if let Some(tombstone) = pending_tombstone.as_ref() {
            tombstone.clone()
        } else {
            if self.directory_is_missing()? {
                self.restore_current_directory()?;
            }
            self.ensure_current()?;
            let directory = self.take_directory()?;
            let identity = match file_identity(&directory) {
                Ok(identity) => identity,
                Err(error) => {
                    self.restore_taken_directory(directory)?;
                    return Err(error);
                }
            };
            if identity != self.directory_identity {
                self.restore_taken_directory(directory)?;
                return Err(invalid_data("scope_handle_stale"));
            }
            drop(directory);
            let tombstone = format!("{}.tombstone-{}", self.storage_key, Uuid::new_v4());
            let rename_source =
                match open_relative_directory_shared(&self.scopes, &self.storage_key) {
                    Ok(handle) => handle,
                    Err(error) => {
                        self.restore_current_directory()?;
                        return Err(error);
                    }
                };
            let source_identity = match file_identity(&rename_source) {
                Ok(identity) => identity,
                Err(error) => {
                    drop(rename_source);
                    self.restore_current_directory()?;
                    return Err(error);
                }
            };
            if source_identity != self.directory_identity {
                drop(rename_source);
                self.restore_current_directory()?;
                return Err(invalid_data("scope_handle_stale"));
            }
            self.set_tombstone_name(&tombstone)?;
            if let Err(error) = rename_to(&rename_source, &self.scopes, &tombstone, false) {
                drop(rename_source);
                self.clear_tombstone_name()?;
                self.restore_current_directory()?;
                return Err(error);
            }
            drop(rename_source);
            tombstone
        };

        flush_purge_handle(&self.scopes, fault, PurgeFlushPoint::AfterRename)?;
        let tombstone_handle =
            match open_relative_directory_for_deletion_no_delete(&self.scopes, &tombstone) {
                Ok(handle) => handle,
                Err(error)
                    if pending_tombstone.is_some() && error.kind() == io::ErrorKind::NotFound =>
                {
                    self.clear_tombstone_name()?;
                    self.purged.store(true, Ordering::Release);
                    return Ok(());
                }
                Err(error) => return Err(error),
            };
        if file_identity(&tombstone_handle)? != self.directory_identity {
            return Err(invalid_data("tombstone_identity_changed"));
        }
        if matches!(fault, Some(PurgeFault::AfterRename)) {
            return Err(io::Error::other("fault_after_tombstone_rename"));
        }
        let entries = enumerate_directory(&tombstone_handle)?;
        for entry in &entries {
            if entry.is_directory || !is_managed_scope_entry(&entry.name) {
                return Err(invalid_data("unexpected_tombstone_entry"));
            }
            validate_scope_payload(&self.storage_key, entry)?;
        }
        for entry in entries {
            delete_handle(&entry.handle)?;
        }
        flush_purge_handle(&tombstone_handle, fault, PurgeFlushPoint::Tombstone)?;
        delete_directory(&tombstone_handle)?;
        flush_purge_handle(&self.scopes, fault, PurgeFlushPoint::AfterDelete)?;
        self.clear_tombstone_name()?;
        self.purged.store(true, Ordering::Release);
        Ok(())
    }

    fn ensure_live(&self) -> io::Result<()> {
        if self.purged.load(Ordering::Acquire) || self.tombstone_name()?.is_some() {
            Err(invalid_data("scope_gone"))
        } else {
            Ok(())
        }
    }

    fn tombstone_name(&self) -> io::Result<Option<String>> {
        self.tombstone
            .lock()
            .map_err(|_| io::Error::other("scope_tombstone_poisoned"))
            .map(|name| name.clone())
    }

    fn directory_is_missing(&self) -> io::Result<bool> {
        self.directory
            .lock()
            .map_err(|_| io::Error::other("scope_directory_poisoned"))
            .map(|directory| directory.is_none())
    }

    fn set_tombstone_name(&self, name: &str) -> io::Result<()> {
        let mut tombstone = self
            .tombstone
            .lock()
            .map_err(|_| io::Error::other("scope_tombstone_poisoned"))?;
        *tombstone = Some(name.to_owned());
        Ok(())
    }

    fn clear_tombstone_name(&self) -> io::Result<()> {
        let mut tombstone = self
            .tombstone
            .lock()
            .map_err(|_| io::Error::other("scope_tombstone_poisoned"))?;
        *tombstone = None;
        Ok(())
    }

    /// Proves that this retained handle still refers to the current hashed
    /// scope entry. A process restart or another instance may have purged or
    /// replaced that entry while this handle remained open.
    fn ensure_current(&self) -> io::Result<()> {
        ensure_store_handles(
            &self.app_config,
            &self.root,
            self.root_identity,
            self.scopes_identity,
        )?;
        self.with_directory(|directory| {
            if file_identity(directory)? == self.directory_identity {
                Ok(())
            } else {
                Err(invalid_data("scope_handle_stale"))
            }
        })
    }

    fn take_directory(&self) -> io::Result<OwnedHandle> {
        self.directory
            .lock()
            .map_err(|_| io::Error::other("scope_directory_poisoned"))?
            .take()
            .ok_or_else(|| invalid_data("scope_gone"))
    }

    fn restore_current_directory(&self) -> io::Result<()> {
        let directory = open_scope_directory_existing(&self.scopes, &self.storage_key)?;
        if file_identity(&directory)? != self.directory_identity {
            return Err(invalid_data("scope_handle_stale"));
        }
        let mut guard = self
            .directory
            .lock()
            .map_err(|_| io::Error::other("scope_directory_poisoned"))?;
        *guard = Some(directory);
        Ok(())
    }

    fn restore_taken_directory(&self, directory: OwnedHandle) -> io::Result<()> {
        let mut guard = self
            .directory
            .lock()
            .map_err(|_| io::Error::other("scope_directory_poisoned"))?;
        *guard = Some(directory);
        Ok(())
    }

    fn acquire_scope_operation_fence(&self) -> io::Result<ScopeOperationFence> {
        self.with_directory(|directory| {
            let handle = open_scope_operation_file(directory, SCOPE_FENCE_FILE)?;
            let guard = acquire_file_lock(&handle)?;
            std::mem::forget(guard);
            Ok(ScopeOperationFence { handle })
        })
    }

    fn with_directory<T>(
        &self,
        operation: impl FnOnce(&OwnedHandle) -> io::Result<T>,
    ) -> io::Result<T> {
        let guard = self
            .directory
            .lock()
            .map_err(|_| io::Error::other("scope_directory_poisoned"))?;
        let directory = guard.as_ref().ok_or_else(|| invalid_data("scope_gone"))?;
        validate_retained_handle(directory, true)?;
        operation(directory)
    }

    fn read_or_empty<T: for<'de> Deserialize<'de>>(
        &self,
        name: &str,
        empty: fn(&str) -> T,
        validate: fn(&T, &str) -> io::Result<()>,
    ) -> io::Result<T> {
        match self.read_typed(name, validate) {
            Ok(value) => Ok(value),
            Err(error) if error.kind() == io::ErrorKind::NotFound => Ok(empty(&self.scope_id)),
            Err(error) => Err(error),
        }
    }
    fn read_typed<T: for<'de> Deserialize<'de>>(
        &self,
        name: &str,
        validate: fn(&T, &str) -> io::Result<()>,
    ) -> io::Result<T> {
        let text = self.with_directory(|directory| read_file(directory, name))?;
        let text = String::from_utf8(text).map_err(|_| invalid_data("store_not_utf8"))?;
        let value = toml::from_str(&text).map_err(|_| invalid_data("invalid_store_toml"))?;
        validate(&value, &self.scope_id)?;
        Ok(value)
    }
    fn write_typed<T: Serialize>(&self, name: &str, value: &T) -> io::Result<()> {
        let text = toml::to_string(value).map_err(|_| invalid_data("store_serialize"))?;
        self.with_directory(|directory| write_file(directory, name, &text))
    }
}

fn ensure_store_handles(
    app_config: &OwnedHandle,
    root: &OwnedHandle,
    root_identity: FileIdentity,
    scopes_identity: FileIdentity,
) -> io::Result<()> {
    validate_retained_handle(app_config, true)?;
    validate_retained_handle(root, true)?;
    let current_root = open_relative_directory_no_delete(app_config, STORE_ROOT)?;
    if file_identity(&current_root)? != root_identity {
        return Err(invalid_data("store_root_handle_stale"));
    }
    let current_scopes = open_relative_directory_no_delete(root, SCOPES_DIRECTORY)?;
    if file_identity(&current_scopes)? != scopes_identity {
        return Err(invalid_data("scopes_handle_stale"));
    }
    Ok(())
}

pub(crate) fn scope_storage_key(scope_id: &str) -> io::Result<String> {
    validate_uuid_v4(scope_id).map_err(invalid_scope)?;
    let mut digest = Sha256::new();
    digest.update(scope_id.to_ascii_lowercase().as_bytes());
    Ok(format!("{:x}", digest.finalize()))
}

fn validate_document_header(version: u8, embedded: &str, expected: &str) -> io::Result<()> {
    if version == SCHEMA_VERSION && embedded == expected {
        validate_uuid_v4(embedded).map_err(invalid_scope)
    } else {
        Err(invalid_data("invalid_store_header"))
    }
}
fn invalid_scope(_: impl std::fmt::Display) -> io::Error {
    invalid_data("invalid_scope_id")
}
fn invalid_data(message: &'static str) -> io::Error {
    io::Error::new(io::ErrorKind::InvalidData, message)
}
fn lock(gate: &Mutex<()>) -> io::Result<std::sync::MutexGuard<'_, ()>> {
    gate.lock()
        .map_err(|_| io::Error::other("store_write_gate_poisoned"))
}

fn read_file(parent: &OwnedHandle, name: &str) -> io::Result<Vec<u8>> {
    let handle = open_relative(parent, name, false)?;
    read_handle(&handle)
}

fn read_handle(handle: &OwnedHandle) -> io::Result<Vec<u8>> {
    use std::io::Read;
    validate_retained_handle(handle, false)?;
    let mut contents = Vec::new();
    std::fs::File::from(handle.try_clone()?)
        .take(1024 * 1024 + 1)
        .read_to_end(&mut contents)?;
    validate_retained_handle(handle, false)?;
    if contents.len() > 1024 * 1024 {
        Err(invalid_data("store_file_too_large"))
    } else {
        Ok(contents)
    }
}

fn read_typed_handle<T: for<'de> Deserialize<'de>>(handle: &OwnedHandle) -> io::Result<T> {
    let text =
        String::from_utf8(read_handle(handle)?).map_err(|_| invalid_data("store_not_utf8"))?;
    toml::from_str(&text).map_err(|_| invalid_data("invalid_store_toml"))
}

fn write_file(parent: &OwnedHandle, name: &str, contents: &str) -> io::Result<()> {
    write_file_with_fault(parent, name, contents, None)
}

#[cfg(test)]
#[derive(Clone, Copy)]
enum ReplacementFault {
    AfterBackup,
    AfterCommit,
    FlushStage,
    FlushMarker,
    FlushBackup,
    FlushCommit,
    FlushFinal,
}

#[derive(Clone, Copy)]
enum ReplacementFlushPoint {
    Stage,
    Marker,
    Backup,
    Commit,
    Final,
}

#[derive(Clone, Copy)]
#[allow(dead_code)]
enum PurgeFault {
    AfterRename,
    FlushAfterRename,
    FlushTombstone,
    FlushAfterDelete,
}

#[derive(Clone, Copy)]
enum PurgeFlushPoint {
    AfterRename,
    Tombstone,
    AfterDelete,
}

fn write_file_with_fault(
    parent: &OwnedHandle,
    name: &str,
    contents: &str,
    #[cfg(test)] fault: Option<ReplacementFault>,
    #[cfg(not(test))] fault: Option<()>,
) -> io::Result<()> {
    use std::io::Write;
    let replacement_id = Uuid::new_v4();
    let staged_name = format!("{name}.tmp-{replacement_id}");
    let mut file = std::fs::File::from(create_new_relative_file(parent, &staged_name)?);
    file.write_all(contents.as_bytes())?;
    file.sync_all()?;
    drop(file);
    flush_replacement_parent(parent, fault, ReplacementFlushPoint::Stage)?;

    let staged = open_relative_for_mutation(parent, &staged_name)?;
    let staged_identity = file_identity(&staged)?;
    let commit_name = format!("{name}.commit-{replacement_id}");
    let destination = match open_relative_for_mutation(parent, name) {
        Ok(handle) => Some(handle),
        Err(error) if error.kind() == io::ErrorKind::NotFound => None,
        Err(error) => {
            let _ = delete_artifact_if_present(parent, &staged_name);
            return Err(error);
        }
    };
    let destination_identity = destination.as_ref().map(file_identity).transpose()?;
    let replacement_marker = ReplacementMarker {
        staged: staged_identity,
        destination: destination_identity,
    };
    let marker_result = (|| -> io::Result<()> {
        let mut marker = std::fs::File::from(create_new_relative_file(parent, &commit_name)?);
        marker.write_all(replacement_marker.encode().as_bytes())?;
        marker.sync_all()?;
        drop(marker);
        flush_replacement_parent(parent, fault, ReplacementFlushPoint::Marker)
    })();
    if let Err(error) = marker_result {
        let cleanup = delete_artifact_if_present(parent, &commit_name);
        return Err(match cleanup {
            Ok(()) => error,
            Err(cleanup_error) => {
                io::Error::other(format!("{error};marker_cleanup_failed:{cleanup_error}"))
            }
        });
    }

    let backup_name = format!("{name}.backup-{replacement_id}");
    if let Some(destination) = destination.as_ref() {
        rename_to(destination, parent, &backup_name, false)?;
        if let Err(error) = flush_replacement_parent(parent, fault, ReplacementFlushPoint::Backup) {
            return Err(restore_after_replacement_failure(
                parent,
                name,
                Some(destination),
                error,
            ));
        }
        #[cfg(test)]
        if matches!(fault, Some(ReplacementFault::AfterBackup)) {
            return Err(io::Error::other("fault_after_backup"));
        }
    }
    if let Err(error) = rename_to(&staged, parent, name, false) {
        return Err(restore_after_replacement_failure(
            parent,
            name,
            destination.as_ref(),
            error,
        ));
    }
    drop(staged);
    if let Err(error) = flush_replacement_parent(parent, fault, ReplacementFlushPoint::Commit) {
        return Err(rollback_replacement(
            parent,
            name,
            destination.as_ref(),
            staged_identity,
            error,
        ));
    }
    let committed = match open_relative_for_mutation(parent, name) {
        Ok(committed) => committed,
        Err(error) => {
            return Err(rollback_replacement(
                parent,
                name,
                destination.as_ref(),
                staged_identity,
                error,
            ))
        }
    };
    let committed_identity = match file_identity(&committed) {
        Ok(identity) => identity,
        Err(error) => {
            return Err(rollback_replacement(
                parent,
                name,
                destination.as_ref(),
                staged_identity,
                error,
            ))
        }
    };
    if committed_identity != staged_identity {
        return Err(rollback_replacement(
            parent,
            name,
            destination.as_ref(),
            staged_identity,
            invalid_data("replacement_identity_changed"),
        ));
    }
    #[cfg(test)]
    if matches!(fault, Some(ReplacementFault::AfterCommit)) {
        return Err(io::Error::other("fault_after_commit"));
    }
    if let Some(destination) = destination.as_ref() {
        delete_handle(destination)?;
    }
    flush_replacement_parent(parent, fault, ReplacementFlushPoint::Final)
        .map_err(|error| io::Error::other(format!("replacement_commit_ambiguous:{error}")))?;
    let marker = open_relative_for_mutation(parent, &commit_name)?;
    delete_handle(&marker)?;
    flush_handle(parent)
        .map_err(|error| io::Error::other(format!("replacement_commit_ambiguous:{error}")))?;
    Ok(())
}

fn flush_replacement_parent(
    parent: &OwnedHandle,
    #[cfg(test)] fault: Option<ReplacementFault>,
    #[cfg(not(test))] _fault: Option<()>,
    #[cfg(test)] point: ReplacementFlushPoint,
    #[cfg(not(test))] _point: ReplacementFlushPoint,
) -> io::Result<()> {
    #[cfg(test)]
    if fault.is_some_and(|fault| {
        matches!(
            (fault, point),
            (ReplacementFault::FlushStage, ReplacementFlushPoint::Stage)
                | (ReplacementFault::FlushMarker, ReplacementFlushPoint::Marker)
                | (ReplacementFault::FlushBackup, ReplacementFlushPoint::Backup)
                | (ReplacementFault::FlushCommit, ReplacementFlushPoint::Commit)
                | (ReplacementFault::FlushFinal, ReplacementFlushPoint::Final)
        )
    }) {
        return Err(io::Error::other("fault_flush_replacement_parent"));
    }
    flush_handle(parent)
}

fn flush_purge_handle(
    handle: &OwnedHandle,
    fault: Option<PurgeFault>,
    point: PurgeFlushPoint,
) -> io::Result<()> {
    if fault.is_some_and(|fault| {
        matches!(
            (fault, point),
            (PurgeFault::FlushAfterRename, PurgeFlushPoint::AfterRename)
                | (PurgeFault::FlushTombstone, PurgeFlushPoint::Tombstone)
                | (PurgeFault::FlushAfterDelete, PurgeFlushPoint::AfterDelete)
        )
    }) {
        return Err(io::Error::other("fault_flush_purge_handle"));
    }
    flush_handle(handle)
}

fn delete_artifact_if_present(parent: &OwnedHandle, name: &str) -> io::Result<()> {
    match open_relative_for_mutation(parent, name) {
        Ok(handle) => {
            delete_handle(&handle)?;
            flush_handle(parent)
        }
        Err(error) if error.kind() == io::ErrorKind::NotFound => Ok(()),
        Err(error) => Err(error),
    }
}

fn restore_after_replacement_failure(
    parent: &OwnedHandle,
    name: &str,
    destination: Option<&OwnedHandle>,
    error: io::Error,
) -> io::Error {
    let Some(destination) = destination else {
        return error;
    };
    match restore_destination(parent, name, destination) {
        Ok(()) => error,
        Err(rollback) => io::Error::other(format!("{error};restore_failed:{rollback}")),
    }
}

fn rollback_replacement(
    parent: &OwnedHandle,
    name: &str,
    destination: Option<&OwnedHandle>,
    replacement_identity: FileIdentity,
    error: io::Error,
) -> io::Error {
    let Some(destination) = destination else {
        return error;
    };
    let current = match open_relative_for_mutation(parent, name) {
        Ok(current) => current,
        Err(open_error) if open_error.kind() == io::ErrorKind::NotFound => {
            return restore_after_replacement_failure(parent, name, Some(destination), error)
        }
        Err(open_error) => {
            return io::Error::other(format!("{error};rollback_open_failed:{open_error}"))
        }
    };
    match file_identity(&current) {
        Ok(identity) if identity == replacement_identity => {}
        Ok(_) => return io::Error::other(format!("{error};rollback_destination_race")),
        Err(identity_error) => {
            return io::Error::other(format!("{error};rollback_identity_failed:{identity_error}"))
        }
    }
    if let Err(delete_error) = delete_handle(&current) {
        return io::Error::other(format!("{error};rollback_delete_failed:{delete_error}"));
    }
    if let Err(flush_error) = flush_handle(parent) {
        return io::Error::other(format!("{error};rollback_flush_failed:{flush_error}"));
    }
    restore_after_replacement_failure(parent, name, Some(destination), error)
}

fn restore_destination(
    parent: &OwnedHandle,
    name: &str,
    destination: &OwnedHandle,
) -> io::Result<()> {
    match open_relative_for_mutation(parent, name) {
        Err(error) if error.kind() == io::ErrorKind::NotFound => {
            let expected = file_identity(destination)?;
            rename_to(destination, parent, name, false)?;
            flush_handle(parent)?;
            let restored = open_relative_for_mutation(parent, name)?;
            if file_identity(&restored)? != expected {
                return Err(invalid_data("restore_identity_changed"));
            }
            Ok(())
        }
        Ok(_) => Err(invalid_data("replacement_destination_race")),
        Err(error) => Err(error),
    }
}

fn read_named_typed_handle<T: for<'de> Deserialize<'de>>(
    parent: &OwnedHandle,
    name: &str,
) -> io::Result<T> {
    let handle = open_relative(parent, name, false)?;
    read_typed_handle(&handle)
}

fn recover_identity_artifacts(root: &OwnedHandle) -> io::Result<()> {
    let entries =
        enumerate_directory_except(root, &[SCOPES_DIRECTORY, LOCK_FILE, ACTIVITY_LOCK_FILE])?;
    let changed = recover_document_artifacts(root, &entries, IDENTITY_FILE, None, true)?;
    if changed {
        flush_handle(root)?;
    }
    Ok(())
}

fn recover_storage_artifacts(scopes: &OwnedHandle) -> io::Result<()> {
    let mut changed = false;
    for entry in enumerate_directory(scopes)? {
        if !entry.is_directory {
            return Err(invalid_data("unexpected_scope_entry"));
        }
        if is_tombstone_name(&entry.name) {
            let identity = file_identity(&entry.handle)?;
            let name = entry.name.clone();
            drop(entry.handle);
            recover_tombstone(scopes, &name, identity)?;
            changed = true;
        } else if is_scope_storage_key(&entry.name) {
            recover_scope_artifacts(&entry.handle, &entry.name)?;
        } else {
            return Err(invalid_data("unexpected_scope_entry"));
        }
    }
    if changed {
        flush_handle(scopes)?;
    }
    Ok(())
}

fn recover_tombstone(
    scopes: &OwnedHandle,
    name: &str,
    expected_identity: FileIdentity,
) -> io::Result<()> {
    let tombstone = open_relative_directory_for_deletion_no_delete(scopes, name)?;
    if file_identity(&tombstone)? != expected_identity {
        return Err(invalid_data("tombstone_identity_changed"));
    }
    let storage_key = name
        .split_once(".tombstone-")
        .map(|(key, _)| key)
        .ok_or_else(|| invalid_data("invalid_tombstone_name"))?;
    let entries = enumerate_directory(&tombstone)?;
    for entry in &entries {
        if entry.is_directory || !is_managed_scope_entry(&entry.name) {
            return Err(invalid_data("unexpected_tombstone_entry"));
        }
        validate_scope_payload(storage_key, entry)?;
    }
    for entry in entries {
        delete_handle(&entry.handle)?;
    }
    flush_handle(&tombstone)?;
    delete_directory(&tombstone)?;
    flush_handle(scopes)
}

fn validate_scope_payload(storage_key: &str, entry: &DirectoryEntry) -> io::Result<()> {
    let document_base = [PROFILES_FILE, TRUST_FILE, META_FILE]
        .into_iter()
        .find(|base| {
            entry.name == *base
                || [ArtifactKind::Temp, ArtifactKind::Backup]
                    .iter()
                    .any(|kind| artifact_name_is_valid_for(&entry.name, base, *kind))
        });
    let embedded_scope_id = match document_base {
        Some(PROFILES_FILE) => {
            let value = read_typed_handle::<StoredProfiles>(&entry.handle)?;
            value.validate(&value.scope_id)?;
            Some(value.scope_id)
        }
        Some(TRUST_FILE) => {
            let value = read_typed_handle::<StoredTrust>(&entry.handle)?;
            value.validate(&value.scope_id)?;
            Some(value.scope_id)
        }
        Some(META_FILE) => {
            let value = read_typed_handle::<StoredScopeMeta>(&entry.handle)?;
            value.validate(&value.scope_id)?;
            Some(value.scope_id)
        }
        Some(_) => unreachable!("unknown tombstone document base"),
        None => {
            if [PROFILES_FILE, TRUST_FILE, META_FILE]
                .iter()
                .any(|base| artifact_name_is_valid_for(&entry.name, base, ArtifactKind::Commit))
            {
                ReplacementMarker::parse(&read_handle(&entry.handle)?)?;
            }
            None
        }
    };
    if let Some(scope_id) = embedded_scope_id {
        if scope_storage_key(&scope_id)? != storage_key {
            return Err(invalid_data("tombstone_scope_mismatch"));
        }
    }
    Ok(())
}

fn recover_scope_artifacts(scope: &OwnedHandle, storage_key: &str) -> io::Result<()> {
    let entries = enumerate_directory(scope)?;
    for entry in &entries {
        if entry.is_directory || !is_managed_scope_entry(&entry.name) {
            return Err(invalid_data("unexpected_scope_entry"));
        }
    }

    let mut changed = false;
    for entry in &entries {
        if entry.name == SCOPE_FENCE_FILE {
            delete_handle(&entry.handle)?;
            changed = true;
        }
    }
    for base in [PROFILES_FILE, TRUST_FILE, META_FILE] {
        changed |= recover_document_artifacts(scope, &entries, base, Some(storage_key), false)?;
    }
    if changed {
        flush_handle(scope)?;
    }
    Ok(())
}

fn recover_document_artifacts(
    parent: &OwnedHandle,
    entries: &[DirectoryEntry],
    base: &str,
    storage_key: Option<&str>,
    identity_payload: bool,
) -> io::Result<bool> {
    let artifact_prefixes = [".tmp-", ".backup-", ".commit-"];
    for entry in entries {
        let has_artifact_prefix = artifact_prefixes
            .iter()
            .any(|marker| entry.name.starts_with(&format!("{base}{marker}")));
        let is_artifact = [
            ArtifactKind::Temp,
            ArtifactKind::Backup,
            ArtifactKind::Commit,
        ]
        .iter()
        .any(|kind| artifact_name_is_valid_for(&entry.name, base, *kind));
        if has_artifact_prefix && !is_artifact {
            return Err(invalid_data("invalid_artifact_name"));
        }
        if (entry.name == base || is_artifact) && entry.is_directory {
            return Err(invalid_data("artifact_is_directory"));
        }
    }

    let destination = entries.iter().position(|entry| entry.name == base);
    let backups = artifact_indices(entries, base, ArtifactKind::Backup);
    let temps = artifact_indices(entries, base, ArtifactKind::Temp);
    let commits = artifact_indices(entries, base, ArtifactKind::Commit);
    if backups.len() > 1 {
        return Err(invalid_data("ambiguous_backup"));
    }
    if commits.len() > 1 {
        return Err(invalid_data("ambiguous_commit_marker"));
    }
    if let Some(commit) = commits.first().copied() {
        let commit_suffix = artifact_suffix(&entries[commit].name, base, ArtifactKind::Commit)
            .ok_or_else(|| invalid_data("invalid_commit_marker_name"))?;
        if let Some(backup) = backups.first().copied() {
            if artifact_suffix(&entries[backup].name, base, ArtifactKind::Backup)
                != Some(commit_suffix)
            {
                return Err(invalid_data("artifact_transaction_mismatch"));
            }
        }
        let marker = ReplacementMarker::parse(&read_handle(&entries[commit].handle)?)?;
        if let Some(destination) = destination {
            let destination_identity = file_identity(&entries[destination].handle)?;
            if destination_identity == marker.staged {
                if marker.destination.is_none() && !backups.is_empty() {
                    return Err(invalid_data("unexpected_backup"));
                }
                if let (Some(backup), Some(expected)) = (backups.first(), marker.destination) {
                    if file_identity(&entries[*backup].handle)? != expected {
                        return Err(invalid_data("backup_identity_changed"));
                    }
                }
                validate_recovery_payload(storage_key, identity_payload, &entries[destination])?;
                if let Some(backup) = backups.first() {
                    validate_recovery_payload(storage_key, identity_payload, &entries[*backup])?;
                }
                for index in backups.into_iter().chain(temps).chain([commit]) {
                    delete_handle(&entries[index].handle)?;
                }
                return Ok(true);
            }
            if let Some(expected) = marker.destination {
                if destination_identity == expected && backups.is_empty() {
                    validate_recovery_payload(
                        storage_key,
                        identity_payload,
                        &entries[destination],
                    )?;
                    for index in temps.into_iter().chain([commit]) {
                        delete_handle(&entries[index].handle)?;
                    }
                    return Ok(true);
                }
            }
            return Err(invalid_data("commit_identity_changed"));
        }

        if let Some(backup) = backups.first().copied() {
            let expected = marker
                .destination
                .ok_or_else(|| invalid_data("unproven_backup"))?;
            if file_identity(&entries[backup].handle)? != expected {
                return Err(invalid_data("backup_identity_changed"));
            }
            validate_recovery_payload(storage_key, identity_payload, &entries[backup])?;
            rename_to(&entries[backup].handle, parent, base, false)?;
            flush_handle(parent)?;
            for index in temps.into_iter().chain([commit]) {
                delete_handle(&entries[index].handle)?;
            }
            return Ok(true);
        }

        let staged = temps.iter().copied().find(|index| {
            artifact_suffix(&entries[*index].name, base, ArtifactKind::Temp)
                .is_some_and(|suffix| suffix == commit_suffix)
        });
        let staged = staged.ok_or_else(|| invalid_data("commit_stage_missing"))?;
        if marker.destination.is_some() {
            return Err(invalid_data("commit_backup_missing"));
        }
        if file_identity(&entries[staged].handle)? != marker.staged {
            return Err(invalid_data("commit_stage_identity_changed"));
        }
        validate_recovery_payload(storage_key, identity_payload, &entries[staged])?;
        rename_to(&entries[staged].handle, parent, base, false)?;
        flush_handle(parent)?;
        for index in temps.into_iter().filter(|index| *index != staged) {
            delete_handle(&entries[index].handle)?;
        }
        delete_handle(&entries[commit].handle)?;
        Ok(true)
    } else if destination.is_some() {
        if !backups.is_empty() {
            return Err(invalid_data("unproven_replacement"));
        }
        let had_temps = !temps.is_empty();
        for index in temps {
            delete_handle(&entries[index].handle)?;
        }
        Ok(had_temps)
    } else if !backups.is_empty() {
        Err(invalid_data("unproven_backup"))
    } else {
        let had_temps = !temps.is_empty();
        for index in temps {
            delete_handle(&entries[index].handle)?;
        }
        Ok(had_temps)
    }
}

fn validate_recovery_payload(
    storage_key: Option<&str>,
    identity_payload: bool,
    entry: &DirectoryEntry,
) -> io::Result<()> {
    if identity_payload
        && (entry.name == IDENTITY_FILE
            || [ArtifactKind::Temp, ArtifactKind::Backup]
                .iter()
                .any(|kind| artifact_name_is_valid_for(&entry.name, IDENTITY_FILE, *kind)))
    {
        parse_identity(&read_handle(&entry.handle)?)?;
        return Ok(());
    }
    if let Some(storage_key) = storage_key {
        validate_scope_payload(storage_key, entry)?;
    }
    Ok(())
}

#[derive(Clone, Copy)]
enum ArtifactKind {
    Temp,
    Backup,
    Commit,
}

fn artifact_indices(entries: &[DirectoryEntry], base: &str, kind: ArtifactKind) -> Vec<usize> {
    entries
        .iter()
        .enumerate()
        .filter_map(|(index, entry)| artifact_suffix(&entry.name, base, kind).map(|_| index))
        .collect()
}

fn artifact_suffix<'a>(name: &'a str, base: &str, kind: ArtifactKind) -> Option<&'a str> {
    let marker = match kind {
        ArtifactKind::Temp => ".tmp-",
        ArtifactKind::Backup => ".backup-",
        ArtifactKind::Commit => ".commit-",
    };
    name.strip_prefix(&format!("{base}{marker}"))
        .filter(|suffix| is_uuid_suffix(suffix))
}

fn is_managed_scope_entry(name: &str) -> bool {
    [PROFILES_FILE, TRUST_FILE, META_FILE, SCOPE_FENCE_FILE].contains(&name)
        || [
            ArtifactKind::Temp,
            ArtifactKind::Backup,
            ArtifactKind::Commit,
        ]
        .iter()
        .any(|kind| artifact_name_is_valid(name, *kind))
}

fn acquire_scope_activity_lock(
    root: &OwnedHandle,
    storage_key: &str,
) -> io::Result<ScopeActivityLease> {
    let handle = open_activity_lock_file(root, ACTIVITY_LOCK_FILE)?;
    let offset = activity_lock_offset(storage_key);
    let guard = acquire_file_lock_at(&handle, offset).map_err(|_| invalid_data("scope_active"))?;
    std::mem::forget(guard);
    Ok(ScopeActivityLease { handle, offset })
}

fn activity_lock_offset(storage_key: &str) -> i64 {
    let mut bytes = [0u8; 8];
    for (slot, byte) in bytes.iter_mut().zip(storage_key.as_bytes().iter().copied()) {
        *slot = byte;
    }
    let offset = i64::from_le_bytes(bytes) & i64::MAX;
    if offset == 0 {
        1
    } else {
        offset
    }
}

fn artifact_name_is_valid(name: &str, kind: ArtifactKind) -> bool {
    [PROFILES_FILE, TRUST_FILE, META_FILE]
        .iter()
        .any(|base| artifact_name_is_valid_for(name, base, kind))
}

fn artifact_name_is_valid_for(name: &str, base: &str, kind: ArtifactKind) -> bool {
    artifact_suffix(name, base, kind).is_some()
}

fn is_scope_storage_key(name: &str) -> bool {
    name.len() == 64
        && name
            .bytes()
            .all(|byte| byte.is_ascii_digit() || (b'a'..=b'f').contains(&byte))
}

fn is_tombstone_name(name: &str) -> bool {
    name.split_once(".tombstone-")
        .is_some_and(|(key, suffix)| is_scope_storage_key(key) && is_uuid_suffix(suffix))
}

fn is_uuid_suffix(value: &str) -> bool {
    Uuid::parse_str(value).is_ok_and(|uuid| uuid.get_version() == Some(uuid::Version::Random))
}

fn delete_directory(directory: &OwnedHandle) -> io::Result<()> {
    use std::os::windows::io::AsRawHandle;
    use windows_sys::{
        Wdk::Storage::FileSystem::{
            FileDispositionInformation, NtSetInformationFile, FILE_DISPOSITION_INFORMATION,
        },
        Win32::{Foundation::HANDLE, System::IO::IO_STATUS_BLOCK},
    };
    validate_retained_handle(directory, true)?;
    let mut status = IO_STATUS_BLOCK::default();
    let mut disposition = FILE_DISPOSITION_INFORMATION { DeleteFile: true };
    let result = unsafe {
        NtSetInformationFile(
            directory.as_raw_handle() as HANDLE,
            &mut status,
            &mut disposition as *mut _ as *const _,
            std::mem::size_of::<FILE_DISPOSITION_INFORMATION>() as u32,
            FileDispositionInformation,
        )
    };
    if result < 0 {
        Err(ntstatus_error(result))
    } else {
        Ok(())
    }
}
fn identity_toml(identity: &str) -> String {
    format!("schema_version = 1\ndesktop_instance_id = \"{identity}\"\n")
}
fn parse_identity(contents: &[u8]) -> io::Result<String> {
    #[derive(Deserialize)]
    #[serde(deny_unknown_fields)]
    struct Identity {
        schema_version: u8,
        desktop_instance_id: String,
    }
    let text = std::str::from_utf8(contents).map_err(|_| invalid_data("identity_not_utf8"))?;
    let value: Identity = toml::from_str(text).map_err(|_| invalid_data("identity_corrupt"))?;
    if value.schema_version == SCHEMA_VERSION {
        validate_uuid_v4(&value.desktop_instance_id)
            .map_err(|_| invalid_data("identity_corrupt"))?;
        Ok(value.desktop_instance_id)
    } else {
        Err(invalid_data("identity_corrupt"))
    }
}
fn rename_to(
    source: &OwnedHandle,
    parent: &OwnedHandle,
    name: &str,
    replace: bool,
) -> io::Result<()> {
    // Revalidate the retained source immediately before rename so a post-open
    // reparse or hard-link change fails closed without a path reopen.
    let _ = file_identity(source)?;
    use std::{
        mem::{size_of, MaybeUninit},
        os::windows::io::AsRawHandle,
    };
    use windows_sys::{
        Wdk::Storage::FileSystem::{
            FileRenameInformation, NtSetInformationFile, FILE_RENAME_INFORMATION,
        },
        Win32::{Foundation::HANDLE, System::IO::IO_STATUS_BLOCK},
    };
    let wide: Vec<u16> = name.encode_utf16().collect();
    let bytes =
        size_of::<FILE_RENAME_INFORMATION>() - size_of::<u16>() + wide.len() * size_of::<u16>();
    let mut buffer = vec![MaybeUninit::<usize>::zeroed(); bytes.div_ceil(size_of::<usize>())];
    let info = buffer.as_mut_ptr() as *mut FILE_RENAME_INFORMATION;
    unsafe {
        (*info).Anonymous.ReplaceIfExists = replace;
        (*info).RootDirectory = parent.as_raw_handle() as HANDLE;
        (*info).FileNameLength = (wide.len() * size_of::<u16>()) as u32;
        std::ptr::copy_nonoverlapping(wide.as_ptr(), (*info).FileName.as_mut_ptr(), wide.len());
    }
    let mut status = IO_STATUS_BLOCK::default();
    let result = unsafe {
        NtSetInformationFile(
            source.as_raw_handle() as HANDLE,
            &mut status,
            info.cast(),
            bytes as u32,
            FileRenameInformation,
        )
    };
    if result < 0 {
        Err(ntstatus_error(result))
    } else {
        Ok(())
    }
}

#[cfg(test)]
mod tests {
    use std::{
        fs,
        io::Write,
        process::Command,
        sync::{Arc, Barrier},
        thread,
        time::Duration,
    };
    use uuid::Uuid;

    use super::{
        acquire_file_lock, create_new_relative_file, delete_handle, file_identity, flush_handle,
        identity_toml, open_relative_for_mutation, open_scope_operation_file, read_handle,
        rename_to, restore_destination, scope_storage_key, write_file_with_fault, PurgeFault,
        ReplacementFault, ReplacementMarker, SshForwardStore, StoredAuth, StoredProfile,
        StoredProfiles, StoredTrust, TrustedHost, IDENTITY_FILE,
        MAX_TRUSTED_ALGORITHMS_PER_ENDPOINT, META_FILE, PROFILES_FILE, SCOPE_FENCE_FILE,
        TRUST_FILE,
    };
    use crate::ssh_forward::{
        model::{UtcTimestamp, WireCounter},
        profile::{LoopbackHost, ReconnectPolicy},
        scope_retention::{KnownScopesInput, Reconciliation},
    };

    const SCOPE: &str = "c1f5890a-55d7-46ca-949b-0d63972f0a68";

    struct Fixture {
        root: std::path::PathBuf,
    }
    impl Fixture {
        fn new() -> Self {
            let root = std::env::temp_dir()
                .join(format!("dam-hopper-typed-store-{}", uuid::Uuid::new_v4()));
            fs::create_dir_all(&root).unwrap();
            Self { root }
        }
        fn scope_dir(&self) -> std::path::PathBuf {
            self.root
                .join("ssh-forward")
                .join("scopes")
                .join(scope_storage_key(SCOPE).unwrap())
        }
    }
    impl Drop for Fixture {
        fn drop(&mut self) {
            let _ = fs::remove_dir_all(&self.root);
        }
    }
    fn timestamp(value: &str) -> UtcTimestamp {
        UtcTimestamp::parse(value).unwrap()
    }
    fn available_absent() -> KnownScopesInput {
        KnownScopesInput::Available { ids: vec![] }
    }

    fn assert_tombstone_recovery_rejects(artifact: impl FnOnce(&std::path::Path)) {
        let fixture = Fixture::new();
        let store = SshForwardStore::open(&fixture.root).unwrap();
        let scope = store.scope(SCOPE).unwrap();
        scope
            .replace_profiles(WireCounter::ZERO, StoredProfiles::empty(SCOPE))
            .unwrap();
        assert!(scope
            .purge_locked_with_fault(Some(PurgeFault::AfterRename))
            .is_err());
        drop(scope);
        drop(store);

        let tombstone = fs::read_dir(fixture.root.join("ssh-forward").join("scopes"))
            .unwrap()
            .map(|entry| entry.unwrap().path())
            .find(|path| {
                path.file_name()
                    .is_some_and(|name| name.to_string_lossy().contains(".tombstone-"))
            })
            .unwrap();
        artifact(&tombstone);

        assert!(SshForwardStore::open(&fixture.root).is_err());
        assert!(tombstone.exists());
    }

    #[test]
    fn typed_toml_rejects_unknown_secret_and_scope_mismatch() {
        let fixture = Fixture::new();
        let store = SshForwardStore::open(&fixture.root).unwrap();
        let scope = store.scope(SCOPE).unwrap();
        let trust = fixture.scope_dir().join("known-hosts.toml");
        fs::write(&trust, format!("schema_version = 1\nscope_id = \"{SCOPE}\"\ntrust_revision = \"0\"\npassword = \"never\"\nentries = []\n")).unwrap();
        assert!(scope.load_trust().is_err());
        fs::write(&trust, "schema_version = 1\nscope_id = \"00000000-0000-4000-8000-000000000000\"\ntrust_revision = \"0\"\nentries = []\n").unwrap();
        assert!(scope.load_trust().is_err());
    }

    #[test]
    fn stored_key_auth_uses_snake_case_toml_fields() {
        let auth = StoredAuth::Key {
            key_id: "workstation".into(),
        };
        let encoded = toml::to_string(&auth).unwrap();
        assert!(encoded.contains("key_id = \"workstation\""));
        assert!(!encoded.contains("keyId"));
        assert_eq!(toml::from_str::<StoredAuth>(&encoded).unwrap(), auth);
    }

    #[test]
    fn revisions_are_independent_checked_and_serialized() {
        let fixture = Fixture::new();
        let store = SshForwardStore::open(&fixture.root).unwrap();
        let scope = store.scope(SCOPE).unwrap();
        let profiles = scope
            .replace_profiles(WireCounter::ZERO, StoredProfiles::empty(SCOPE))
            .unwrap();
        let trust = scope
            .replace_trust(WireCounter::ZERO, StoredTrust::empty(SCOPE))
            .unwrap();
        assert_eq!(profiles.profiles_revision.to_string(), "1");
        assert_eq!(trust.trust_revision.to_string(), "1");
        assert!(scope
            .replace_profiles(WireCounter::ZERO, StoredProfiles::empty(SCOPE))
            .is_err());
        let path = fixture.scope_dir().join("profiles.toml");
        let overflow = format!("schema_version = 1\nscope_id = \"{SCOPE}\"\nprofiles_revision = \"{}\"\nprofiles = []\n", u64::MAX);
        fs::write(path, overflow).unwrap();
        assert!(scope
            .replace_profiles(
                WireCounter::parse(&u64::MAX.to_string()).unwrap(),
                StoredProfiles::empty(SCOPE)
            )
            .is_err());
    }

    #[test]
    fn concurrent_profile_writes_admit_exactly_one_revision() {
        let fixture = Fixture::new();
        let store = Arc::new(SshForwardStore::open(&fixture.root).unwrap());
        let scope = Arc::new(store.scope(SCOPE).unwrap());
        let barrier = Arc::new(Barrier::new(3));
        let workers: Vec<_> = (0..2)
            .map(|_| {
                let scope = Arc::clone(&scope);
                let barrier = Arc::clone(&barrier);
                thread::spawn(move || {
                    barrier.wait();
                    scope
                        .replace_profiles(WireCounter::ZERO, StoredProfiles::empty(SCOPE))
                        .is_ok()
                })
            })
            .collect();
        barrier.wait();
        assert_eq!(
            workers
                .into_iter()
                .map(|worker| usize::from(worker.join().unwrap()))
                .sum::<usize>(),
            1
        );
    }

    #[test]
    fn inactive_quarantine_purges_at_30_days_but_active_scope_never_purges() {
        let fixture = Fixture::new();
        let store = SshForwardStore::open(&fixture.root).unwrap();
        let scope = store.scope(SCOPE).unwrap();
        scope
            .reconcile_known_scope(&available_absent(), timestamp("2026-01-01T00:00:00.000Z"))
            .unwrap();
        let activity = scope.acquire_activity_lease().unwrap();
        assert!(scope.purge_if_deleted(&available_absent()).is_err());
        drop(activity);
        scope
            .reconcile_known_scope(&available_absent(), timestamp("2026-01-31T00:00:00.000Z"))
            .unwrap();
        drop(scope);
        assert!(!fixture.scope_dir().exists());
    }

    #[test]
    fn explicit_purge_is_idempotent_and_requires_observed_deletion() {
        let fixture = Fixture::new();
        let store = SshForwardStore::open(&fixture.root).unwrap();
        let scope = store.scope(SCOPE).unwrap();
        assert!(scope
            .purge_if_deleted(&KnownScopesInput::Available {
                ids: vec![SCOPE.into()]
            })
            .is_err());
        let activity = scope.acquire_activity_lease().unwrap();
        assert!(scope.purge_if_deleted(&available_absent()).is_err());
        drop(activity);
        assert!(scope.purge_if_deleted(&available_absent()).unwrap());
        assert!(!scope.purge_if_deleted(&available_absent()).unwrap());
        assert!(scope.load_profiles().is_err());
        assert!(store.existing_scope(SCOPE).is_err());
    }

    #[test]
    fn purge_rejects_embedded_scope_mismatch_before_quarantine() {
        let fixture = Fixture::new();
        let store = SshForwardStore::open(&fixture.root).unwrap();
        let scope = store.scope(SCOPE).unwrap();
        let other_scope = "00000000-0000-4000-8000-000000000000";

        fs::write(
            fixture.scope_dir().join(PROFILES_FILE),
            format!(
                "schema_version = 1\nscope_id = \"{other_scope}\"\nprofiles_revision = \"0\"\nprofiles = []\n"
            ),
        )
        .unwrap();
        assert!(scope.purge_if_deleted(&available_absent()).is_err());
        assert!(fixture.scope_dir().exists());

        fs::remove_file(fixture.scope_dir().join(PROFILES_FILE)).unwrap();
        fs::write(
            fixture.scope_dir().join(META_FILE),
            format!(
                "schema_version = 1\nscope_id = \"{other_scope}\"\nlast_seen_at = \"2026-08-10T00:00:00.000Z\"\norphaned_at = \"2026-08-10T00:00:00.000Z\"\n"
            ),
        )
        .unwrap();
        assert!(scope.purge_if_deleted(&available_absent()).is_err());
        assert!(fixture.scope_dir().exists());
    }

    #[test]
    fn feature_lock_serializes_second_store_instance() {
        let fixture = Fixture::new();
        let first = SshForwardStore::open(&fixture.root).unwrap();
        let ready = Arc::new(Barrier::new(2));
        let ready_for_worker = Arc::clone(&ready);
        let root = fixture.root.clone();
        let worker = thread::spawn(move || {
            ready_for_worker.wait();
            SshForwardStore::open(&root).is_ok()
        });
        ready.wait();
        drop(first);
        assert!(worker.join().unwrap());
    }

    #[test]
    fn retained_scope_handles_allow_multiple_store_instances() {
        let fixture = Fixture::new();
        let first_store = SshForwardStore::open(&fixture.root).unwrap();
        let first_scope = first_store.scope(SCOPE).unwrap();
        let second_store = SshForwardStore::open(&fixture.root).unwrap();
        let second_scope = second_store.existing_scope(SCOPE).unwrap();

        assert_eq!(
            first_scope.load_profiles().unwrap(),
            second_scope.load_profiles().unwrap()
        );
    }

    #[test]
    fn purge_retries_after_another_instance_releases_scope_handle() {
        let fixture = Fixture::new();
        let first_store = SshForwardStore::open(&fixture.root).unwrap();
        let first_scope = first_store.scope(SCOPE).unwrap();
        let second_store = SshForwardStore::open(&fixture.root).unwrap();
        let second_scope = second_store.existing_scope(SCOPE).unwrap();

        assert!(first_scope.purge_if_deleted(&available_absent()).is_err());
        drop(second_scope);
        drop(second_store);
        assert!(first_scope.purge_if_deleted(&available_absent()).unwrap());
    }

    #[test]
    fn purge_retries_after_cross_process_scope_handle_release() {
        let fixture = Fixture::new();
        let store = SshForwardStore::open(&fixture.root).unwrap();
        drop(store.scope(SCOPE).unwrap());
        let started = fixture.root.join("scope-handle-started");
        let release = fixture.root.join("scope-handle-release");
        let finished = fixture.root.join("scope-handle-finished");
        let mut child = Command::new(std::env::current_exe().unwrap())
            .args([
                "--exact",
                "ssh_forward::store::tests::cross_process_scope_handle_probe",
                "--nocapture",
            ])
            .env("DAM_HOPPER_SCOPE_HANDLE_ROOT", &fixture.root)
            .env("DAM_HOPPER_SCOPE_HANDLE_STARTED", &started)
            .env("DAM_HOPPER_SCOPE_HANDLE_RELEASE", &release)
            .env("DAM_HOPPER_SCOPE_HANDLE_FINISHED", &finished)
            .spawn()
            .unwrap();
        wait_for_file(&started, &mut child);

        assert!(store
            .purge_scope_if_deleted(SCOPE, &available_absent())
            .is_err());
        fs::write(&release, b"release").unwrap();
        wait_for_file(&finished, &mut child);
        assert!(child.wait().unwrap().success());
        assert!(store
            .purge_scope_if_deleted(SCOPE, &available_absent())
            .unwrap());
    }

    #[test]
    fn feature_lock_serializes_independent_process() {
        let fixture = Fixture::new();
        let store = SshForwardStore::open(&fixture.root).unwrap();
        let file_lock = acquire_file_lock(&store.lock_file).unwrap();
        let started = fixture.root.join("lock-probe-started");
        let result = fixture.root.join("lock-probe-result");
        let mut child = Command::new(std::env::current_exe().unwrap())
            .args([
                "--exact",
                "ssh_forward::store::tests::feature_lock_process_probe",
                "--nocapture",
            ])
            .env("DAM_HOPPER_LOCK_PROBE_ROOT", &fixture.root)
            .env("DAM_HOPPER_LOCK_PROBE_STARTED", &started)
            .env("DAM_HOPPER_LOCK_PROBE_RESULT", &result)
            .spawn()
            .unwrap();
        for _ in 0..100 {
            if started.exists() {
                break;
            }
            thread::sleep(Duration::from_millis(10));
        }
        assert!(started.exists());
        assert!(child.wait().unwrap().success());
        assert!(fs::read_to_string(&result).unwrap().starts_with("blocked"));
        drop(file_lock);
        let started_after_release = fixture.root.join("lock-probe-started-after-release");
        let result_after_release = fixture.root.join("lock-probe-result-after-release");
        let mut child = Command::new(std::env::current_exe().unwrap())
            .args([
                "--exact",
                "ssh_forward::store::tests::feature_lock_process_probe",
                "--nocapture",
            ])
            .env("DAM_HOPPER_LOCK_PROBE_ROOT", &fixture.root)
            .env("DAM_HOPPER_LOCK_PROBE_STARTED", &started_after_release)
            .env("DAM_HOPPER_LOCK_PROBE_RESULT", &result_after_release)
            .spawn()
            .unwrap();
        assert!(child.wait().unwrap().success());
        assert_eq!(fs::read_to_string(result_after_release).unwrap(), "opened");
    }

    #[test]
    fn feature_lock_process_probe() {
        let Ok(root) = std::env::var("DAM_HOPPER_LOCK_PROBE_ROOT") else {
            return;
        };
        fs::write(
            std::env::var("DAM_HOPPER_LOCK_PROBE_STARTED").unwrap(),
            b"started",
        )
        .unwrap();
        let result = SshForwardStore::open(std::path::Path::new(&root));
        let outcome = match &result {
            Ok(_) => "opened".to_string(),
            Err(error) => format!("blocked:{:?}", error.raw_os_error()),
        };
        fs::write(
            std::env::var("DAM_HOPPER_LOCK_PROBE_RESULT").unwrap(),
            outcome,
        )
        .unwrap();
    }

    #[test]
    fn cross_process_scope_handle_probe() {
        let Ok(root) = std::env::var("DAM_HOPPER_SCOPE_HANDLE_ROOT") else {
            return;
        };
        let store = SshForwardStore::open(std::path::Path::new(&root)).unwrap();
        let _scope = store.scope(SCOPE).unwrap();
        fs::write(
            std::env::var("DAM_HOPPER_SCOPE_HANDLE_STARTED").unwrap(),
            b"started",
        )
        .unwrap();
        while !std::path::Path::new(&std::env::var("DAM_HOPPER_SCOPE_HANDLE_RELEASE").unwrap())
            .exists()
        {
            thread::sleep(Duration::from_millis(5));
        }
        fs::write(
            std::env::var("DAM_HOPPER_SCOPE_HANDLE_FINISHED").unwrap(),
            b"finished",
        )
        .unwrap();
    }

    #[test]
    fn feature_lock_serializes_real_process_operations() {
        for operation in ["read", "write", "purge"] {
            run_process_operation(operation);
        }
    }

    #[test]
    fn retained_parent_swaps_fail_closed_before_scope_access() {
        let fixture = Fixture::new();
        let store = SshForwardStore::open(&fixture.root).unwrap();
        let scopes = fixture.root.join("ssh-forward").join("scopes");
        let moved_scopes = fixture.root.join("scopes.moved");
        assert!(fs::rename(&scopes, &moved_scopes).is_err());
        assert!(store.scope(SCOPE).is_ok());
    }

    #[test]
    fn scope_operation_fence_blocks_a_name_swap_during_validation_and_mutation() {
        let fixture = Fixture::new();
        let store = SshForwardStore::open(&fixture.root).unwrap();
        let scope = store.scope(SCOPE).unwrap();
        let moved = fixture.root.join("scope-operation.moved");
        let _fence = scope.acquire_scope_operation_fence().unwrap();
        assert!(fs::rename(fixture.scope_dir(), moved).is_err());
    }

    fn run_process_operation(operation: &str) {
        let fixture = Fixture::new();
        let store = SshForwardStore::open(&fixture.root).unwrap();
        let activity = (operation == "purge").then(|| {
            store
                .scope(SCOPE)
                .unwrap()
                .acquire_activity_lease()
                .unwrap()
        });
        let started = fixture.root.join("operation-started");
        let go = fixture.root.join("operation-go");
        let first = fixture.root.join("operation-first");
        let release = fixture.root.join("operation-release");
        let final_result = fixture.root.join("operation-final");
        let mut child = Command::new(std::env::current_exe().unwrap())
            .args([
                "--exact",
                "ssh_forward::store::tests::feature_lock_process_operation_probe",
                "--nocapture",
            ])
            .env("DAM_HOPPER_OPERATION_ROOT", &fixture.root)
            .env("DAM_HOPPER_OPERATION_KIND", operation)
            .env("DAM_HOPPER_OPERATION_STARTED", &started)
            .env("DAM_HOPPER_OPERATION_GO", &go)
            .env("DAM_HOPPER_OPERATION_FIRST", &first)
            .env("DAM_HOPPER_OPERATION_RELEASE", &release)
            .env("DAM_HOPPER_OPERATION_FINAL", &final_result)
            .spawn()
            .unwrap();
        wait_for_file(&started, &mut child);
        let file_lock = acquire_file_lock(&store.lock_file).unwrap();
        fs::write(&go, b"go").unwrap();
        if operation == "purge" {
            drop(file_lock);
            wait_for_file(&first, &mut child);
            assert_eq!(fs::read_to_string(&first).unwrap(), "blocked");
            drop(activity);
        } else {
            wait_for_file(&first, &mut child);
            assert_eq!(fs::read_to_string(&first).unwrap(), "blocked");
            drop(file_lock);
        }
        fs::write(&release, b"release").unwrap();
        wait_for_file(&final_result, &mut child);
        assert_eq!(fs::read_to_string(final_result).unwrap(), "success");
        assert!(child.wait().unwrap().success());
    }

    fn wait_for_file(path: &std::path::Path, child: &mut std::process::Child) {
        for _ in 0..200 {
            if path.exists() {
                return;
            }
            if child.try_wait().unwrap().is_some() {
                panic!("process probe exited before {:?}", path);
            }
            thread::sleep(Duration::from_millis(10));
        }
        let _ = child.kill();
        panic!("timed out waiting for {:?}", path);
    }

    #[test]
    fn feature_lock_process_operation_probe() {
        let Ok(root) = std::env::var("DAM_HOPPER_OPERATION_ROOT") else {
            return;
        };
        let store = SshForwardStore::open(std::path::Path::new(&root)).unwrap();
        let scope = store.scope(SCOPE).unwrap();
        fs::write(
            std::env::var("DAM_HOPPER_OPERATION_STARTED").unwrap(),
            b"started",
        )
        .unwrap();
        while !std::path::Path::new(&std::env::var("DAM_HOPPER_OPERATION_GO").unwrap()).exists() {
            thread::sleep(Duration::from_millis(5));
        }
        let operation = std::env::var("DAM_HOPPER_OPERATION_KIND").unwrap();
        let run = || match operation.as_str() {
            "read" => scope.load_profiles().map(|_| ()),
            "write" => scope
                .replace_profiles(WireCounter::ZERO, StoredProfiles::empty(SCOPE))
                .map(|_| ()),
            "purge" => scope.purge_if_deleted(&available_absent()).map(|_| ()),
            _ => Err(std::io::Error::other("unknown_operation")),
        };
        let first = run();
        fs::write(
            std::env::var("DAM_HOPPER_OPERATION_FIRST").unwrap(),
            if first.is_err() {
                "blocked"
            } else {
                "unexpected"
            },
        )
        .unwrap();
        while !std::path::Path::new(&std::env::var("DAM_HOPPER_OPERATION_RELEASE").unwrap())
            .exists()
        {
            thread::sleep(Duration::from_millis(5));
        }
        let final_result = run();
        fs::write(
            std::env::var("DAM_HOPPER_OPERATION_FINAL").unwrap(),
            if final_result.is_ok() {
                "success"
            } else {
                "failed"
            },
        )
        .unwrap();
    }

    #[test]
    fn replacement_refuses_hard_link_destination_without_mutating_it() {
        let fixture = Fixture::new();
        let store = SshForwardStore::open(&fixture.root).unwrap();
        let scope = store.scope(SCOPE).unwrap();
        let source = fixture.root.join("outside.toml");
        fs::write(&source, format!("schema_version = 1\nscope_id = \"{SCOPE}\"\nprofiles_revision = \"0\"\nprofiles = []\n")).unwrap();
        let destination = fixture.scope_dir().join("profiles.toml");
        fs::hard_link(&source, &destination).unwrap();
        assert!(scope
            .replace_profiles(WireCounter::ZERO, StoredProfiles::empty(SCOPE))
            .is_err());
        assert_eq!(
            fs::read_to_string(source).unwrap(),
            fs::read_to_string(destination).unwrap()
        );
    }

    #[test]
    fn retained_file_operation_rechecks_hard_link_count_before_reading() {
        let fixture = Fixture::new();
        let store = SshForwardStore::open(&fixture.root).unwrap();
        let scope = store.scope(SCOPE).unwrap();
        scope
            .replace_profiles(WireCounter::ZERO, StoredProfiles::empty(SCOPE))
            .unwrap();
        scope
            .with_directory(|directory| {
                let handle = open_relative_for_mutation(directory, PROFILES_FILE)?;
                let link_result = fs::hard_link(
                    fixture.scope_dir().join(PROFILES_FILE),
                    fixture.root.join("late-hard-link.toml"),
                );
                match link_result {
                    Ok(()) => assert!(read_handle(&handle).is_err()),
                    // The strict mutation share fence rejected the late link.
                    Err(_) => {}
                }
                Ok(())
            })
            .unwrap();
    }

    #[test]
    fn failed_tombstone_delete_stays_quarantined_for_recovery() {
        let fixture = Fixture::new();
        let store = SshForwardStore::open(&fixture.root).unwrap();
        let scope = store.scope(SCOPE).unwrap();
        fs::write(fixture.scope_dir().join("unexpected"), "retain tombstone").unwrap();
        assert!(scope.purge_if_deleted(&available_absent()).is_err());
        drop(scope);
        assert!(
            fs::read_dir(fixture.root.join("ssh-forward").join("scopes"))
                .unwrap()
                .any(|entry| entry
                    .unwrap()
                    .file_name()
                    .to_string_lossy()
                    .contains(".tombstone-"))
        );
    }

    #[test]
    fn retained_enumeration_reconciles_every_scope_and_recovers_stale_artifacts() {
        let fixture = Fixture::new();
        let store = SshForwardStore::open(&fixture.root).unwrap();
        let first = store.scope(SCOPE).unwrap();
        first
            .reconcile_known_scope(
                &KnownScopesInput::Available {
                    ids: vec![SCOPE.into()],
                },
                timestamp("2026-08-10T00:00:00.000Z"),
            )
            .unwrap();
        first
            .replace_profiles(WireCounter::ZERO, StoredProfiles::empty(SCOPE))
            .unwrap();
        let replacement = toml::to_string(&StoredProfiles::empty(SCOPE)).unwrap();
        assert!(first
            .with_directory(|directory| write_file_with_fault(
                directory,
                PROFILES_FILE,
                &replacement,
                Some(ReplacementFault::AfterBackup),
            ))
            .is_err());

        let stale_name = format!("{TRUST_FILE}.tmp-{}", Uuid::new_v4());
        let mut stale = std::fs::File::from(
            first
                .with_directory(|directory| create_new_relative_file(directory, &stale_name))
                .unwrap(),
        );
        stale.write_all(b"stale").unwrap();
        stale.sync_all().unwrap();
        drop(stale);

        let second_id = "f2e3d6a0-0ac7-4b6b-b6b4-b4f9e7d2c1a0";
        let second = store.scope(second_id).unwrap();
        second
            .reconcile_known_scope(
                &KnownScopesInput::Available {
                    ids: vec![SCOPE.into(), second_id.into()],
                },
                timestamp("2026-08-10T00:00:00.000Z"),
            )
            .unwrap();
        drop(second);
        drop(first);
        drop(store);

        let reopened = SshForwardStore::open(&fixture.root).unwrap();
        let scopes = reopened.enumerate_scopes().unwrap();
        assert_eq!(scopes.len(), 2);
        drop(scopes);
        let recovered = reopened.existing_scope(SCOPE).unwrap();
        assert_eq!(
            recovered.load_profiles().unwrap().profiles_revision,
            WireCounter::parse("1").unwrap()
        );
        assert!(!fixture.scope_dir().read_dir().unwrap().any(|entry| {
            let name = entry.unwrap().file_name();
            let name = name.to_string_lossy();
            name.contains(".tmp-") || name.contains(".backup-")
        }));
    }

    #[test]
    fn restart_recovers_desktop_identity_backup_without_regenerating_identity() {
        let fixture = Fixture::new();
        let store = SshForwardStore::open(&fixture.root).unwrap();
        let identity = store.load_or_create_desktop_instance().unwrap();
        assert!(write_file_with_fault(
            &store.root,
            IDENTITY_FILE,
            &identity_toml(&identity),
            Some(ReplacementFault::AfterBackup),
        )
        .is_err());
        drop(store);

        let reopened = SshForwardStore::open(&fixture.root).unwrap();
        assert_eq!(
            reopened.load_or_create_desktop_instance().unwrap(),
            identity
        );
        assert!(!fixture
            .root
            .join("ssh-forward")
            .read_dir()
            .unwrap()
            .any(|entry| entry
                .unwrap()
                .file_name()
                .to_string_lossy()
                .contains("desktop-instance.toml.")));
    }

    #[test]
    fn replacement_flush_faults_recover_without_orphaned_artifacts() {
        for fault in [
            ReplacementFault::FlushStage,
            ReplacementFault::FlushMarker,
            ReplacementFault::FlushBackup,
            ReplacementFault::FlushCommit,
            ReplacementFault::FlushFinal,
        ] {
            let fixture = Fixture::new();
            let store = SshForwardStore::open(&fixture.root).unwrap();
            let scope = store.scope(SCOPE).unwrap();
            scope
                .replace_profiles(WireCounter::ZERO, StoredProfiles::empty(SCOPE))
                .unwrap();
            let replacement = toml::to_string(&StoredProfiles::empty(SCOPE)).unwrap();
            let error = scope
                .with_directory(|directory| {
                    write_file_with_fault(directory, PROFILES_FILE, &replacement, Some(fault))
                })
                .unwrap_err();
            if matches!(fault, ReplacementFault::FlushFinal) {
                assert!(error.to_string().contains("replacement_commit_ambiguous"));
                assert!(fixture.scope_dir().read_dir().unwrap().any(|entry| {
                    entry
                        .unwrap()
                        .file_name()
                        .to_string_lossy()
                        .contains(".commit-")
                }));
            }
            drop(scope);
            drop(store);

            let reopened = SshForwardStore::open(&fixture.root).unwrap();
            assert!(reopened
                .existing_scope(SCOPE)
                .unwrap()
                .load_profiles()
                .is_ok());
            assert!(!fixture.scope_dir().read_dir().unwrap().any(|entry| {
                let name = entry.unwrap().file_name();
                let name = name.to_string_lossy();
                name.contains(".tmp-") || name.contains(".backup-") || name.contains(".commit-")
            }));
        }
    }

    #[test]
    fn desktop_identity_is_cached_for_the_live_process_and_resets_after_restart() {
        let fixture = Fixture::new();
        let store = SshForwardStore::open(&fixture.root).unwrap();
        let original = store.load_or_create_desktop_instance().unwrap();
        fs::remove_file(fixture.root.join("ssh-forward").join(IDENTITY_FILE)).unwrap();

        assert_eq!(store.load_or_create_desktop_instance().unwrap(), original);
        drop(store);

        let second_store = SshForwardStore::open(&fixture.root).unwrap();
        assert_eq!(
            second_store.load_or_create_desktop_instance().unwrap(),
            original
        );
    }

    #[test]
    fn trust_records_require_canonical_unique_bounded_endpoint_algorithms() {
        let entry = TrustedHost {
            ssh_host: "bastion.example".into(),
            ssh_port: 22,
            algorithm: "ssh-ed25519".into(),
            fingerprint: "SHA256:AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA".into(),
        };
        let mut trust = StoredTrust::empty(SCOPE);
        trust.entries.push(entry.clone());
        assert!(trust.validate(SCOPE).is_ok());

        trust.entries[0].ssh_host = "Bastion.example".into();
        assert!(trust.validate(SCOPE).is_err());
        trust.entries[0] = entry.clone();
        trust.entries.push(entry.clone());
        assert!(trust.validate(SCOPE).is_err());

        trust.entries.clear();
        for index in 0..=MAX_TRUSTED_ALGORITHMS_PER_ENDPOINT {
            trust.entries.push(TrustedHost {
                algorithm: format!("ssh-test-{index}"),
                ..entry.clone()
            });
        }
        assert!(trust.validate(SCOPE).is_err());
    }

    #[test]
    fn stored_profiles_reject_duplicate_profile_ids() {
        let profile = StoredProfile {
            id: "e1634e77-b0b5-4b21-bd2f-462c9e3b7a96".into(),
            scope_id: SCOPE.into(),
            name: "metrics".into(),
            ssh_host: "bastion.example".into(),
            ssh_port: 22,
            ssh_user: "operator".into(),
            auth: StoredAuth::Agent,
            local_port: 15432,
            target_host: LoopbackHost,
            target_port: 5432,
            auto_start: false,
            reconnect: ReconnectPolicy {
                enabled: false,
                max_attempts: 0,
            },
            created_at: timestamp("2026-01-01T00:00:00.000Z"),
            updated_at: timestamp("2026-01-01T00:00:00.000Z"),
        };
        let mut profiles = StoredProfiles::empty(SCOPE);
        profiles.profiles = vec![profile.clone(), profile];
        assert!(profiles.validate(SCOPE).is_err());
    }

    #[test]
    fn unavailable_scope_reconciliation_does_not_create_metadata() {
        let fixture = Fixture::new();
        let store = SshForwardStore::open(&fixture.root).unwrap();
        let scope = store.scope(SCOPE).unwrap();
        assert_eq!(
            scope
                .reconcile_known_scope(
                    &KnownScopesInput::Unavailable,
                    timestamp("2026-01-01T00:00:00.000Z")
                )
                .unwrap(),
            Reconciliation::Unchanged
        );
        assert!(!fixture.scope_dir().join(META_FILE).exists());
    }

    #[test]
    fn recovery_rejects_backup_from_a_different_replacement_transaction() {
        let fixture = Fixture::new();
        let store = SshForwardStore::open(&fixture.root).unwrap();
        let scope = store.scope(SCOPE).unwrap();
        scope
            .replace_profiles(WireCounter::ZERO, StoredProfiles::empty(SCOPE))
            .unwrap();
        let backup_name = format!("{PROFILES_FILE}.backup-{}", Uuid::new_v4());
        let commit_name = format!("{PROFILES_FILE}.commit-{}", Uuid::new_v4());
        fs::copy(
            fixture.scope_dir().join(PROFILES_FILE),
            fixture.scope_dir().join(&backup_name),
        )
        .unwrap();
        let mut marker = std::fs::File::from(
            scope
                .with_directory(|directory| create_new_relative_file(directory, &commit_name))
                .unwrap(),
        );
        marker.write_all(b"0:0\n").unwrap();
        marker.sync_all().unwrap();
        drop(marker);
        drop(scope);
        drop(store);

        assert!(SshForwardStore::open(&fixture.root).is_err());
    }

    #[test]
    fn recovery_rejects_backup_identity_swap() {
        let fixture = Fixture::new();
        let store = SshForwardStore::open(&fixture.root).unwrap();
        let scope = store.scope(SCOPE).unwrap();
        scope
            .replace_profiles(WireCounter::ZERO, StoredProfiles::empty(SCOPE))
            .unwrap();
        let replacement = toml::to_string(&StoredProfiles::empty(SCOPE)).unwrap();
        assert!(scope
            .with_directory(|directory| write_file_with_fault(
                directory,
                PROFILES_FILE,
                &replacement,
                Some(ReplacementFault::AfterBackup),
            ))
            .is_err());
        let backup = fs::read_dir(fixture.scope_dir())
            .unwrap()
            .map(|entry| entry.unwrap().path())
            .find(|path| {
                path.file_name()
                    .is_some_and(|name| name.to_string_lossy().contains(".backup-"))
            })
            .unwrap();
        drop(scope);
        drop(store);
        fs::remove_file(&backup).unwrap();
        fs::write(&backup, b"wrong identity").unwrap();

        assert!(SshForwardStore::open(&fixture.root).is_err());
    }

    #[test]
    fn recovery_preserves_evidence_when_destination_identity_is_unproven() {
        let fixture = Fixture::new();
        let store = SshForwardStore::open(&fixture.root).unwrap();
        let scope = store.scope(SCOPE).unwrap();
        scope
            .replace_profiles(WireCounter::ZERO, StoredProfiles::empty(SCOPE))
            .unwrap();

        let replacement_id = Uuid::new_v4();
        let staged_name = format!("{PROFILES_FILE}.tmp-{replacement_id}");
        let commit_name = format!("{PROFILES_FILE}.commit-{replacement_id}");
        let raced_path = fixture.scope_dir().join(PROFILES_FILE);
        scope
            .with_directory(|directory| {
                let old = open_relative_for_mutation(directory, PROFILES_FILE)?;
                let destination = file_identity(&old)?;
                let mut staged =
                    std::fs::File::from(create_new_relative_file(directory, &staged_name)?);
                staged.write_all(b"staged")?;
                staged.sync_all()?;
                drop(staged);
                let staged = open_relative_for_mutation(directory, &staged_name)?;
                let marker = ReplacementMarker {
                    staged: file_identity(&staged)?,
                    destination: Some(destination),
                };
                let mut commit =
                    std::fs::File::from(create_new_relative_file(directory, &commit_name)?);
                commit.write_all(marker.encode().as_bytes())?;
                commit.sync_all()?;
                drop(commit);
                delete_handle(&old)?;
                flush_handle(directory)?;
                drop(old);
                drop(staged);
                Ok(())
            })
            .unwrap();
        fs::write(&raced_path, b"raced").unwrap();

        drop(scope);
        drop(store);

        assert!(SshForwardStore::open(&fixture.root).is_err());
        assert_eq!(fs::read(&raced_path).unwrap(), b"raced");
        assert!(fixture.scope_dir().join(&staged_name).exists());
        assert!(fixture.scope_dir().join(&commit_name).exists());
    }

    #[test]
    fn enumeration_fails_closed_for_nonempty_scope_without_metadata() {
        let fixture = Fixture::new();
        let store = SshForwardStore::open(&fixture.root).unwrap();
        let scope = store.scope(SCOPE).unwrap();
        scope
            .replace_profiles(WireCounter::ZERO, StoredProfiles::empty(SCOPE))
            .unwrap();
        drop(scope);
        assert!(store.enumerate_scopes().is_err());
    }

    #[test]
    fn restart_removes_stale_scope_operation_fence() {
        let fixture = Fixture::new();
        let store = SshForwardStore::open(&fixture.root).unwrap();
        let scope = store.scope(SCOPE).unwrap();
        drop(
            scope
                .with_directory(|directory| open_scope_operation_file(directory, SCOPE_FENCE_FILE))
                .unwrap(),
        );
        drop(scope);
        drop(store);

        let reopened = SshForwardStore::open(&fixture.root).unwrap();
        assert!(!fixture.scope_dir().join(SCOPE_FENCE_FILE).exists());
        assert!(reopened.enumerate_scopes().unwrap().is_empty());
    }

    #[test]
    fn restart_recovers_committed_backup_and_tombstone() {
        let fixture = Fixture::new();
        let store = SshForwardStore::open(&fixture.root).unwrap();
        let scope = store.scope(SCOPE).unwrap();
        scope
            .replace_profiles(WireCounter::ZERO, StoredProfiles::empty(SCOPE))
            .unwrap();
        let replacement = toml::to_string(&StoredProfiles::empty(SCOPE)).unwrap();
        assert!(scope
            .with_directory(|directory| write_file_with_fault(
                directory,
                PROFILES_FILE,
                &replacement,
                Some(ReplacementFault::AfterCommit),
            ))
            .is_err());
        drop(scope);
        drop(store);

        let reopened = SshForwardStore::open(&fixture.root).unwrap();
        let live = reopened.existing_scope(SCOPE).unwrap();
        assert!(live.load_profiles().is_ok());
        assert!(!fixture.scope_dir().read_dir().unwrap().any(|entry| entry
            .unwrap()
            .file_name()
            .to_string_lossy()
            .contains(".backup-")));
        assert!(live
            .purge_locked_with_fault(Some(PurgeFault::AfterRename))
            .is_err());
        drop(live);
        drop(reopened);

        let restarted = SshForwardStore::open(&fixture.root).unwrap();
        assert!(restarted.existing_scope(SCOPE).is_err());
        assert!(!restarted
            .purge_scope_if_deleted(SCOPE, &available_absent())
            .unwrap());
    }

    #[test]
    fn purge_retries_in_process_after_quarantine_failure() {
        let fixture = Fixture::new();
        let store = SshForwardStore::open(&fixture.root).unwrap();
        let scope = store.scope(SCOPE).unwrap();
        scope
            .replace_profiles(WireCounter::ZERO, StoredProfiles::empty(SCOPE))
            .unwrap();

        assert!(scope
            .purge_locked_with_fault(Some(PurgeFault::AfterRename))
            .is_err());
        assert!(scope.purge_if_deleted(&available_absent()).unwrap());
        assert!(!scope.purge_if_deleted(&available_absent()).unwrap());
        assert!(scope.load_profiles().is_err());
        assert!(store.existing_scope(SCOPE).is_err());
    }

    #[test]
    fn store_retries_pending_tombstone_after_scope_instance_failure() {
        let fixture = Fixture::new();
        let store = SshForwardStore::open(&fixture.root).unwrap();
        let scope = store.scope(SCOPE).unwrap();
        scope
            .replace_profiles(WireCounter::ZERO, StoredProfiles::empty(SCOPE))
            .unwrap();
        assert!(scope
            .purge_locked_with_fault(Some(PurgeFault::AfterRename))
            .is_err());
        drop(scope);

        assert!(store
            .purge_scope_if_deleted(SCOPE, &available_absent())
            .unwrap());
        assert!(store.existing_scope(SCOPE).is_err());
    }

    #[test]
    fn recovery_rejects_mismatched_non_tombstone_payloads() {
        for suffix in ["tmp", "backup"] {
            let fixture = Fixture::new();
            let store = SshForwardStore::open(&fixture.root).unwrap();
            let scope = store.scope(SCOPE).unwrap();
            scope
                .replace_profiles(WireCounter::ZERO, StoredProfiles::empty(SCOPE))
                .unwrap();
            let replacement_id = Uuid::new_v4();
            let artifact_name = format!("{PROFILES_FILE}.{suffix}-{replacement_id}");
            let commit_name = format!("{PROFILES_FILE}.commit-{replacement_id}");
            scope
                .with_directory(|directory| {
                    let current = open_relative_for_mutation(directory, PROFILES_FILE)?;
                    let mut artifact = std::fs::File::from(create_new_relative_file(
                        directory,
                        &artifact_name,
                    )?);
                    artifact.write_all(
                        b"schema_version = 1\nscope_id = \"00000000-0000-4000-8000-000000000000\"\nprofiles_revision = \"0\"\nprofiles = []\n",
                    )?;
                    artifact.sync_all()?;
                    drop(artifact);
                    let artifact = open_relative_for_mutation(directory, &artifact_name)?;
                    let artifact_identity = file_identity(&artifact)?;
                    let marker = ReplacementMarker {
                        staged: artifact_identity,
                        destination: (suffix == "backup").then_some(artifact_identity),
                    };
                    let mut commit = std::fs::File::from(create_new_relative_file(
                        directory,
                        &commit_name,
                    )?);
                    commit.write_all(marker.encode().as_bytes())?;
                    commit.sync_all()?;
                    drop(commit);
                    delete_handle(&current)?;
                    flush_handle(directory)?;
                    drop(current);
                    drop(artifact);
                    Ok(())
                })
                .unwrap();
            drop(scope);
            drop(store);

            assert!(SshForwardStore::open(&fixture.root).is_err());
            assert!(fixture.scope_dir().read_dir().unwrap().any(|entry| {
                entry
                    .unwrap()
                    .file_name()
                    .to_string_lossy()
                    .contains(&format!("{PROFILES_FILE}.{suffix}-"))
            }));
        }
    }

    #[test]
    fn recovery_rejects_malformed_identity_payload_before_cleanup() {
        let fixture = Fixture::new();
        let store = SshForwardStore::open(&fixture.root).unwrap();
        store.load_or_create_desktop_instance().unwrap();
        let replacement_id = Uuid::new_v4();
        let staged_name = format!("{IDENTITY_FILE}.tmp-{replacement_id}");
        let commit_name = format!("{IDENTITY_FILE}.commit-{replacement_id}");
        let root = &store.root;
        let current = open_relative_for_mutation(root, IDENTITY_FILE).unwrap();
        let mut staged = std::fs::File::from(create_new_relative_file(root, &staged_name).unwrap());
        staged
            .write_all(b"schema_version = 1\ndesktop_instance_id = \"invalid\"\n")
            .unwrap();
        staged.sync_all().unwrap();
        drop(staged);
        let staged = open_relative_for_mutation(root, &staged_name).unwrap();
        let marker = ReplacementMarker {
            staged: file_identity(&staged).unwrap(),
            destination: None,
        };
        let mut commit = std::fs::File::from(create_new_relative_file(root, &commit_name).unwrap());
        commit.write_all(marker.encode().as_bytes()).unwrap();
        commit.sync_all().unwrap();
        drop(commit);
        delete_handle(&current).unwrap();
        flush_handle(root).unwrap();
        drop(current);
        drop(staged);
        drop(store);

        assert!(SshForwardStore::open(&fixture.root).is_err());
        assert!(fixture.root.join("ssh-forward").join(&staged_name).exists());
        assert!(fixture.root.join("ssh-forward").join(&commit_name).exists());
    }

    #[test]
    fn restart_rejects_mismatched_tombstone_document() {
        let fixture = Fixture::new();
        let store = SshForwardStore::open(&fixture.root).unwrap();
        let scope = store.scope(SCOPE).unwrap();
        scope
            .replace_profiles(WireCounter::ZERO, StoredProfiles::empty(SCOPE))
            .unwrap();
        assert!(scope
            .purge_locked_with_fault(Some(PurgeFault::AfterRename))
            .is_err());
        drop(scope);
        drop(store);

        let tombstone = fs::read_dir(fixture.root.join("ssh-forward").join("scopes"))
            .unwrap()
            .map(|entry| entry.unwrap().path())
            .find(|path| {
                path.file_name()
                    .is_some_and(|name| name.to_string_lossy().contains(".tombstone-"))
            })
            .unwrap();
        fs::write(
            tombstone.join(PROFILES_FILE),
            "schema_version = 1\nscope_id = \"00000000-0000-4000-8000-000000000000\"\nprofiles_revision = \"0\"\nprofiles = []\n",
        )
        .unwrap();

        assert!(SshForwardStore::open(&fixture.root).is_err());
        assert!(tombstone.exists());
    }

    #[test]
    fn restart_rejects_mismatched_tombstone_temp_payload() {
        assert_tombstone_recovery_rejects(|tombstone| {
            fs::write(
                tombstone.join(format!("{PROFILES_FILE}.tmp-{}", Uuid::new_v4())),
                "schema_version = 1\nscope_id = \"00000000-0000-4000-8000-000000000000\"\nprofiles_revision = \"0\"\nprofiles = []\n",
            )
            .unwrap();
        });
    }

    #[test]
    fn restart_rejects_mismatched_tombstone_backup_payload() {
        assert_tombstone_recovery_rejects(|tombstone| {
            fs::write(
                tombstone.join(format!("{PROFILES_FILE}.backup-{}", Uuid::new_v4())),
                "schema_version = 1\nscope_id = \"00000000-0000-4000-8000-000000000000\"\nprofiles_revision = \"0\"\nprofiles = []\n",
            )
            .unwrap();
        });
    }

    #[test]
    fn restart_rejects_malformed_tombstone_commit_marker() {
        assert_tombstone_recovery_rejects(|tombstone| {
            fs::write(
                tombstone.join(format!("{PROFILES_FILE}.commit-{}", Uuid::new_v4())),
                b"not a replacement marker",
            )
            .unwrap();
        });
    }

    #[test]
    fn purge_flush_faults_recover_quarantined_storage() {
        for fault in [
            PurgeFault::FlushAfterRename,
            PurgeFault::FlushTombstone,
            PurgeFault::FlushAfterDelete,
        ] {
            let fixture = Fixture::new();
            let store = SshForwardStore::open(&fixture.root).unwrap();
            let scope = store.scope(SCOPE).unwrap();
            scope
                .replace_profiles(WireCounter::ZERO, StoredProfiles::empty(SCOPE))
                .unwrap();
            assert!(scope.purge_locked_with_fault(Some(fault)).is_err());
            drop(scope);
            drop(store);

            let reopened = SshForwardStore::open(&fixture.root).unwrap();
            assert!(reopened.existing_scope(SCOPE).is_err());
            assert!(!fixture
                .root
                .join("ssh-forward")
                .join("scopes")
                .read_dir()
                .unwrap()
                .any(|entry| {
                    entry
                        .unwrap()
                        .file_name()
                        .to_string_lossy()
                        .contains(".tombstone-")
                }));
        }
    }

    #[test]
    fn replacement_race_never_restores_over_a_new_destination() {
        let fixture = Fixture::new();
        let store = SshForwardStore::open(&fixture.root).unwrap();
        let scope = store.scope(SCOPE).unwrap();
        fs::write(fixture.scope_dir().join(PROFILES_FILE), b"old").unwrap();
        let backup = format!("{PROFILES_FILE}.backup-{}", Uuid::new_v4());
        let error = scope
            .with_directory(|directory| {
                let old = open_relative_for_mutation(directory, PROFILES_FILE)?;
                rename_to(&old, directory, &backup, false)?;
                fs::write(fixture.scope_dir().join(PROFILES_FILE), b"raced").unwrap();
                restore_destination(directory, PROFILES_FILE, &old)
            })
            .unwrap_err();
        assert_eq!(error.kind(), std::io::ErrorKind::InvalidData);
        assert_eq!(
            fs::read(fixture.scope_dir().join(PROFILES_FILE)).unwrap(),
            b"raced"
        );
        assert!(fixture.scope_dir().join(&backup).exists());
        drop(scope);
        drop(store);
    }
}
