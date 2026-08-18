//! Server-authoritative project worktree target resolution.
//!
//! A project name remains the authorization identity. `ProjectTargetRef` only
//! selects the registered filesystem root used by a root-sensitive operation.

use std::collections::HashMap;
use std::hash::{Hash, Hasher};
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::Arc;
use std::time::{Duration, Instant};

use serde::{Deserialize, Serialize};
use thiserror::Error;
use tokio::sync::RwLock;

use crate::error::AppError;
use crate::git::cli_fallback::repository_root;
use crate::git::{list_worktrees, Worktree};

const DEFAULT_CACHE_TTL: Duration = Duration::from_secs(2);
const MAX_CACHED_PROJECTS: usize = 32;

/// Identifies a project and, optionally, one of its registered worktrees.
///
/// An omitted `worktreePath` is the backward-compatible configured-root
/// target. The server never trusts a supplied path without resolving it
/// against Git's registered worktree list.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ProjectTargetRef {
    pub project: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub worktree_path: Option<String>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ResolvedProjectTarget {
    project: String,
    configured_root: PathBuf,
    target_path: PathBuf,
    /// Stable, opaque input for downstream target-key derivation.
    target_key: String,
    is_root: bool,
    available: bool,
    #[serde(skip_serializing_if = "Option::is_none")]
    worktree: Option<ProjectWorktree>,
}

impl ResolvedProjectTarget {
    #[cfg(test)]
    pub(crate) fn from_parts(
        project: String,
        configured_root: PathBuf,
        target_path: PathBuf,
        target_key: String,
        is_root: bool,
        available: bool,
        worktree: Option<ProjectWorktree>,
    ) -> Self {
        Self {
            project,
            configured_root,
            target_path,
            target_key,
            is_root,
            available,
            worktree,
        }
    }

    pub fn project(&self) -> &str {
        &self.project
    }

    pub fn configured_root(&self) -> &Path {
        &self.configured_root
    }

    pub fn target_path(&self) -> &Path {
        &self.target_path
    }

    pub fn target_key(&self) -> &str {
        &self.target_key
    }

    pub fn is_root(&self) -> bool {
        self.is_root
    }

    pub fn available(&self) -> bool {
        self.available
    }

    pub fn worktree(&self) -> Option<&ProjectWorktree> {
        self.worktree.as_ref()
    }
}

/// Worktree metadata projected into the configured project's directory.
/// `path` is the selectable target; `repositoryPath` remains available for
/// mutations that operate on the Git worktree root.
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ProjectWorktree {
    pub path: String,
    pub repository_path: String,
    pub branch: String,
    pub commit_hash: String,
    pub is_main: bool,
    pub is_locked: bool,
    pub is_detached: bool,
    pub is_bare: bool,
    pub is_prunable: bool,
    pub is_available: bool,
}

#[derive(Debug, Clone, Error, PartialEq, Eq)]
pub enum WorkspaceTargetError {
    #[error("Project not found")]
    UnknownProject,
    #[error("Target is not a registered worktree")]
    UnregisteredTarget,
    #[error("Worktree target is unavailable")]
    UnavailableTarget,
    #[error("Invalid worktree target path")]
    InvalidPath,
}

#[derive(Clone)]
pub struct WorkspaceTargetResolver {
    cache: Arc<RwLock<HashMap<PathBuf, CachedWorktrees>>>,
    generation: Arc<AtomicU64>,
    project_generations: Arc<RwLock<HashMap<PathBuf, u64>>>,
    ttl: Duration,
    max_entries: usize,
}

#[derive(Clone)]
struct CachedWorktrees {
    loaded_at: Instant,
    worktrees: Vec<RegisteredWorktree>,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
struct CacheGeneration {
    global: u64,
    project: u64,
}

#[derive(Clone)]
struct RegisteredWorktree {
    worktree: Worktree,
    /// The configured project's corresponding directory in this Git worktree.
    target_path: PathBuf,
    /// Canonical target captured at discovery time for fast cache-hit matching.
    canonical_target_path: Option<PathBuf>,
    /// Stable lexical identity used for API projection even when the target
    /// has disappeared and can no longer be canonicalized.
    stable_target_path: PathBuf,
    available: bool,
}

impl Default for WorkspaceTargetResolver {
    fn default() -> Self {
        Self::new()
    }
}

impl WorkspaceTargetResolver {
    pub fn new() -> Self {
        Self {
            cache: Arc::new(RwLock::new(HashMap::new())),
            generation: Arc::new(AtomicU64::new(0)),
            project_generations: Arc::new(RwLock::new(HashMap::new())),
            ttl: DEFAULT_CACHE_TTL,
            max_entries: MAX_CACHED_PROJECTS,
        }
    }

    #[cfg(test)]
    fn with_cache(ttl: Duration, max_entries: usize) -> Self {
        Self {
            cache: Arc::new(RwLock::new(HashMap::new())),
            generation: Arc::new(AtomicU64::new(0)),
            project_generations: Arc::new(RwLock::new(HashMap::new())),
            ttl,
            max_entries,
        }
    }

    /// Resolve a target after the caller has selected the configured project.
    ///
    /// An omitted target preserves the configured-root behavior for existing
    /// non-Git projects. Explicit targets, including the configured root, are
    /// accepted only after canonical membership validation.
    pub async fn resolve(
        &self,
        target_ref: &ProjectTargetRef,
        configured_root: &Path,
    ) -> Result<ResolvedProjectTarget, AppError> {
        let configured_root = canonical_configured_root(configured_root).await?;

        let Some(requested_path) = target_ref.worktree_path.as_deref() else {
            return Ok(self.root_target(&target_ref.project, configured_root));
        };

        if requested_path.is_empty() || requested_path.contains('\0') {
            return Err(WorkspaceTargetError::InvalidPath.into());
        }

        let requested = PathBuf::from(requested_path);
        if !requested.is_absolute() {
            return Err(WorkspaceTargetError::InvalidPath.into());
        }

        let requested_canonical = canonicalize_path(requested.clone()).await;

        // Cache entries are useful for discovery UI, but never authorize a
        // target. A fresh Git snapshot closes the remove/recreate race.
        let worktrees = list_worktrees(&configured_root)
            .await
            .map_err(map_target_discovery_error)?;
        let worktrees = discover_targets(&configured_root, worktrees)
            .await
            .map_err(map_target_discovery_error)?;
        let matching = worktrees
            .iter()
            .find(|candidate| paths_match(requested_canonical.as_deref(), &requested, candidate));

        let Some(candidate) = matching else {
            return Err(WorkspaceTargetError::UnregisteredTarget.into());
        };
        let target_path = self
            .live_target_path(candidate)
            .await
            .ok_or(WorkspaceTargetError::UnavailableTarget)?;

        Ok(ResolvedProjectTarget {
            project: target_ref.project.clone(),
            configured_root,
            target_key: target_key(&target_path),
            target_path,
            is_root: false,
            available: true,
            worktree: Some(project_worktree(candidate)),
        })
    }

    /// Explicitly refresh and cache the registered worktree list.
    pub async fn refresh(&self, configured_root: &Path) -> Result<Vec<Worktree>, AppError> {
        let (worktrees, candidates, configured_root, observed_generation) =
            self.refresh_discovery(configured_root).await?;
        let key = configured_root;
        self.store_if_current(key, candidates, observed_generation)
            .await;
        Ok(worktrees)
    }

    /// Refresh worktrees projected into the configured project directory.
    pub async fn refresh_project_worktrees(
        &self,
        configured_root: &Path,
    ) -> Result<Vec<ProjectWorktree>, AppError> {
        let (worktrees, candidates, configured_root, observed_generation) =
            self.refresh_discovery(configured_root).await?;
        self.store_if_current(configured_root, candidates.clone(), observed_generation)
            .await;
        Ok(project_worktrees(&worktrees, &candidates))
    }

    async fn refresh_discovery(
        &self,
        configured_root: &Path,
    ) -> Result<
        (
            Vec<Worktree>,
            Vec<RegisteredWorktree>,
            PathBuf,
            CacheGeneration,
        ),
        AppError,
    > {
        let configured_root = canonical_configured_root(configured_root).await?;
        let observed_generation = self.generation_for(&configured_root).await;
        let worktrees = list_worktrees(&configured_root).await?;
        let candidates = discover_targets(&configured_root, worktrees.clone()).await?;
        Ok((worktrees, candidates, configured_root, observed_generation))
    }

    /// Invalidate one project's discovery entry after a worktree mutation.
    pub async fn invalidate(&self, configured_root: &Path) {
        let key = canonicalize_path(configured_root.to_path_buf())
            .await
            .unwrap_or_else(|| configured_root.to_path_buf());
        let mut project_generations = self.project_generations.write().await;
        project_generations
            .entry(key.clone())
            .and_modify(|generation| *generation += 1)
            .or_insert(1);
        self.cache.write().await.remove(&key);
    }

    /// Invalidate all entries when project configuration is reloaded.
    pub async fn invalidate_all(&self) {
        let mut project_generations = self.project_generations.write().await;
        self.generation.fetch_add(1, Ordering::AcqRel);
        project_generations.clear();
        self.cache.write().await.clear();
    }

    /// Return a bounded-cache discovery result for non-authorizing callers.
    /// Explicit target resolution always uses a fresh Git snapshot.
    pub async fn cached_worktrees(
        &self,
        configured_root: &Path,
    ) -> Result<Vec<Worktree>, AppError> {
        let configured_root = canonical_configured_root(configured_root).await?;
        let key = configured_root.clone();
        for _ in 0..3 {
            let observed_generation = self.generation_for(&key).await;
            let cached = { self.cache.read().await.get(&key).cloned() };
            if let Some(cached) = cached {
                if cached.loaded_at.elapsed() < self.ttl
                    && self.generation_for(&key).await == observed_generation
                {
                    return Ok(cached
                        .worktrees
                        .into_iter()
                        .map(|candidate| candidate.worktree)
                        .collect());
                }
            }

            let fresh = self.refresh(&configured_root).await?;
            if self.generation_for(&key).await == observed_generation {
                return Ok(fresh);
            }
        }

        Err(AppError::Unavailable(
            "Worktree discovery changed while refreshing".to_string(),
        ))
    }

    async fn store_if_current(
        &self,
        key: PathBuf,
        worktrees: Vec<RegisteredWorktree>,
        observed_generation: CacheGeneration,
    ) {
        let project_generations = self.project_generations.read().await;
        let current_generation = CacheGeneration {
            global: self.generation.load(Ordering::Acquire),
            project: project_generations.get(&key).copied().unwrap_or_default(),
        };
        if current_generation != observed_generation {
            return;
        }

        let mut cache = self.cache.write().await;
        let current_generation = CacheGeneration {
            global: self.generation.load(Ordering::Acquire),
            project: project_generations.get(&key).copied().unwrap_or_default(),
        };
        if current_generation != observed_generation {
            return;
        }
        cache.insert(
            key,
            CachedWorktrees {
                loaded_at: Instant::now(),
                worktrees,
            },
        );
        while cache.len() > self.max_entries {
            let oldest = cache
                .iter()
                .min_by_key(|(_, entry)| entry.loaded_at)
                .map(|(key, _)| key.clone());
            if let Some(oldest) = oldest {
                cache.remove(&oldest);
            } else {
                break;
            }
        }
    }

    async fn generation_for(&self, key: &Path) -> CacheGeneration {
        CacheGeneration {
            global: self.generation.load(Ordering::Acquire),
            project: self
                .project_generations
                .read()
                .await
                .get(key)
                .copied()
                .unwrap_or_default(),
        }
    }

    async fn live_target_path(&self, candidate: &RegisteredWorktree) -> Option<PathBuf> {
        if candidate.worktree.is_prunable || !candidate.available {
            return None;
        }

        let root = PathBuf::from(&candidate.worktree.path);
        let target = candidate.target_path.clone();
        tokio::task::spawn_blocking(move || {
            let root_metadata = std::fs::symlink_metadata(&root).ok()?;
            let root_type = root_metadata.file_type();
            if !root_type.is_dir() || root_type.is_symlink() {
                return None;
            }
            let canonical_root = dunce::canonicalize(&root).ok()?;
            let canonical_target = dunce::canonicalize(&target).ok()?;
            if !canonical_target.is_dir()
                || !target_path_is_within(&canonical_target, &canonical_root)
            {
                return None;
            }
            Some(canonical_target)
        })
        .await
        .ok()
        .flatten()
    }

    fn root_target(&self, project: &str, configured_root: PathBuf) -> ResolvedProjectTarget {
        ResolvedProjectTarget {
            project: project.to_string(),
            target_key: "root".to_string(),
            target_path: configured_root.clone(),
            configured_root,
            is_root: true,
            available: true,
            worktree: None,
        }
    }
}

fn project_worktrees(
    worktrees: &[Worktree],
    candidates: &[RegisteredWorktree],
) -> Vec<ProjectWorktree> {
    worktrees
        .iter()
        .zip(candidates.iter())
        .map(|(worktree, candidate)| {
            project_worktree_with_path(
                worktree,
                candidate_project_path(candidate),
                candidate.available,
            )
        })
        .collect()
}

fn project_worktree(candidate: &RegisteredWorktree) -> ProjectWorktree {
    project_worktree_with_path(
        &candidate.worktree,
        candidate_project_path(candidate),
        candidate.available,
    )
}

fn candidate_project_path(candidate: &RegisteredWorktree) -> &Path {
    &candidate.stable_target_path
}

fn project_worktree_with_path(
    worktree: &Worktree,
    target_path: &Path,
    is_available: bool,
) -> ProjectWorktree {
    ProjectWorktree {
        path: target_path.to_string_lossy().into_owned(),
        repository_path: worktree.path.clone(),
        branch: worktree.branch.clone(),
        commit_hash: worktree.commit_hash.clone(),
        is_main: worktree.is_main,
        is_locked: worktree.is_locked,
        is_detached: worktree.is_detached,
        is_bare: worktree.is_bare,
        is_prunable: worktree.is_prunable,
        is_available,
    }
}

fn relative_project_root(
    configured_root: &Path,
    repository_root: &Path,
) -> Result<PathBuf, AppError> {
    target_path_relative(configured_root, repository_root)
        .ok_or_else(|| WorkspaceTargetError::InvalidPath.into())
}

async fn discover_targets(
    configured_root: &Path,
    worktrees: Vec<Worktree>,
) -> Result<Vec<RegisteredWorktree>, AppError> {
    let repository_root = repository_root(configured_root).await?;
    let repository_root = canonicalize_path(repository_root)
        .await
        .ok_or(WorkspaceTargetError::UnavailableTarget)?;
    let relative_project_root = relative_project_root(configured_root, &repository_root)?;

    tokio::task::spawn_blocking(move || {
        worktrees
            .into_iter()
            .map(|worktree| {
                let worktree_root = PathBuf::from(&worktree.path);
                let target_path = if relative_project_root.as_os_str().is_empty() {
                    worktree_root.clone()
                } else {
                    worktree_root.join(&relative_project_root)
                };
                let canonical_target_path = dunce::canonicalize(&target_path).ok();
                let stable_target_path = canonical_target_path
                    .clone()
                    .unwrap_or_else(|| normalize_target_path(target_path.clone()));
                let canonical_worktree_root = dunce::canonicalize(&worktree_root).ok();
                let available = !worktree.is_bare
                    && worktree.is_available
                    && canonical_worktree_root.as_ref().is_some_and(|root| {
                        canonical_target_path.as_ref().is_some_and(|target| {
                            target.is_dir() && target_path_is_within(target, root)
                        })
                    });
                RegisteredWorktree {
                    worktree,
                    target_path,
                    canonical_target_path,
                    stable_target_path,
                    available,
                }
            })
            .collect()
    })
    .await
    .map_err(|error| AppError::Internal(format!("target discovery task failed: {error}")))
}

fn map_target_discovery_error(error: AppError) -> AppError {
    match error {
        AppError::Git(message) if is_not_git_repository_error(&message) => {
            tracing::debug!(%message, "explicit worktree target requested for a non-Git project");
            WorkspaceTargetError::UnregisteredTarget.into()
        }
        error => error,
    }
}

pub(crate) fn is_not_git_repository_error(message: &str) -> bool {
    message
        .to_ascii_lowercase()
        .contains("not a git repository")
}

async fn canonical_configured_root(path: &Path) -> Result<PathBuf, AppError> {
    let canonical = canonicalize_path(path.to_path_buf())
        .await
        .ok_or(WorkspaceTargetError::UnavailableTarget)?;
    let is_dir = tokio::task::spawn_blocking({
        let canonical = canonical.clone();
        move || canonical.is_dir()
    })
    .await
    .unwrap_or(false);
    if !is_dir {
        return Err(WorkspaceTargetError::InvalidPath.into());
    }
    Ok(canonical)
}

async fn canonicalize_path(path: PathBuf) -> Option<PathBuf> {
    tokio::task::spawn_blocking(move || dunce::canonicalize(path).ok())
        .await
        .ok()
        .flatten()
}

fn paths_match(
    requested_canonical: Option<&Path>,
    requested: &Path,
    candidate: &RegisteredWorktree,
) -> bool {
    if let (Some(requested_canonical), Some(candidate_canonical)) = (
        requested_canonical,
        candidate.canonical_target_path.as_deref(),
    ) {
        if target_path_identity(requested_canonical) == target_path_identity(candidate_canonical)
            && (!candidate.worktree.is_main
                || target_path_identity(requested) == target_path_identity(&candidate.target_path))
        {
            return true;
        }
    }
    target_path_identity(requested) == target_path_identity(&candidate.stable_target_path)
}

/// Normalizes path syntax without requiring the path to exist. This keeps a
/// removed worktree's API identity aligned with its available projection for
/// `.`/`..` aliases while preserving platform prefixes through `Path`.
fn normalize_target_path(path: PathBuf) -> PathBuf {
    use std::path::Component;

    let mut normalized = PathBuf::new();
    for component in path.components() {
        match component {
            Component::CurDir => {}
            Component::ParentDir => {
                if !normalized.pop() {
                    normalized.push(component.as_os_str());
                }
            }
            Component::Prefix(_) | Component::RootDir | Component::Normal(_) => {
                normalized.push(component.as_os_str());
            }
        }
    }
    normalized
}

/// Returns the stable identity used when comparing target paths that may have
/// disappeared or arrived through a platform-specific alias. Windows paths
/// are case-insensitive and may use extended drive/UNC prefixes; POSIX paths
/// retain their case-sensitive identity.
pub(crate) fn target_path_identity(path: &Path) -> String {
    #[cfg(windows)]
    {
        let mut identity = normalize_target_path(path.to_path_buf())
            .to_string_lossy()
            .replace('\\', "/");
        const EXTENDED_UNC_PREFIX: &str = "//?/UNC/";
        const EXTENDED_PREFIX: &str = "//?/";
        if identity.len() >= EXTENDED_UNC_PREFIX.len()
            && identity[..EXTENDED_UNC_PREFIX.len()].eq_ignore_ascii_case(EXTENDED_UNC_PREFIX)
        {
            identity = format!("//{}", &identity[EXTENDED_UNC_PREFIX.len()..]);
        } else if identity.len() >= EXTENDED_PREFIX.len()
            && identity[..EXTENDED_PREFIX.len()].eq_ignore_ascii_case(EXTENDED_PREFIX)
        {
            identity = identity[EXTENDED_PREFIX.len()..].to_string();
        }
        identity = identity.to_ascii_lowercase();
        return identity;
    }

    #[cfg(not(windows))]
    {
        // Backslashes are ordinary filename bytes on POSIX. Do not turn a
        // literal `a\\b` component into the distinct `a/b` path.
        normalize_target_path(path.to_path_buf())
            .to_string_lossy()
            .into_owned()
    }
}

/// Compare lexical path ownership using the same platform-aware identity as
/// target matching. This is intentionally lexical: legacy terminal sessions
/// may point at a path that has already disappeared, so filesystem
/// canonicalization would lose the ownership information needed for removal
/// guards.
pub(crate) fn target_path_is_within(path: &Path, root: &Path) -> bool {
    let path_identity = target_path_identity(path);
    let root_identity = target_path_identity(root);
    if path_identity == root_identity {
        return true;
    }

    let root_prefix = root_identity.trim_end_matches('/');
    if root_prefix.is_empty() {
        return path_identity.starts_with('/');
    }

    path_identity.starts_with(&format!("{root_prefix}/"))
}

/// Derive a path relative to `root` using the same platform-aware identity as
/// containment checks. This preserves target switching when Windows changes
/// case or presents a drive/UNC path through an extended alias.
pub(crate) fn target_path_relative(path: &Path, root: &Path) -> Option<PathBuf> {
    if path
        .components()
        .any(|component| component == std::path::Component::ParentDir)
    {
        return None;
    }

    let path_identity = target_path_identity(path);
    let root_identity = target_path_identity(root);
    if path_identity == root_identity {
        return Some(PathBuf::new());
    }

    let root_prefix = root_identity.trim_end_matches('/');
    if root_prefix.is_empty() {
        return path_identity.strip_prefix('/').map(PathBuf::from);
    }

    path_identity
        .strip_prefix(&format!("{root_prefix}/"))
        .map(PathBuf::from)
}

fn target_key(path: &Path) -> String {
    let mut hasher = std::collections::hash_map::DefaultHasher::new();
    path.hash(&mut hasher);
    format!("worktree:{:016x}", hasher.finish())
}

impl From<WorkspaceTargetError> for AppError {
    fn from(error: WorkspaceTargetError) -> Self {
        AppError::WorkspaceTarget(error)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn target_ref_omits_absent_worktree_path() {
        let value = serde_json::to_value(ProjectTargetRef {
            project: "demo".to_string(),
            worktree_path: None,
        })
        .unwrap();
        assert_eq!(value, serde_json::json!({ "project": "demo" }));
    }

    #[test]
    fn root_target_uses_root_sentinel() {
        let root = tempfile::tempdir().unwrap();
        let resolver = WorkspaceTargetResolver::new();
        let target = resolver.root_target("demo", root.path().to_path_buf());
        assert_eq!(target.target_key, "root");
        assert!(target.is_root);
        assert!(target.available);
    }

    #[tokio::test]
    async fn cache_is_bounded_and_invalidation_is_deterministic() {
        let resolver = WorkspaceTargetResolver::with_cache(Duration::from_secs(60), 1);
        let first = tempfile::tempdir().unwrap();
        let second = tempfile::tempdir().unwrap();
        let first_key = dunce::canonicalize(first.path()).unwrap();
        let second_key = dunce::canonicalize(second.path()).unwrap();
        let empty = || RegisteredWorktree {
            worktree: Worktree {
                path: String::new(),
                branch: String::new(),
                commit_hash: String::new(),
                is_main: false,
                is_locked: false,
                is_detached: false,
                is_bare: false,
                is_prunable: false,
                is_available: false,
            },
            target_path: PathBuf::new(),
            canonical_target_path: None,
            stable_target_path: PathBuf::new(),
            available: false,
        };
        let generation = resolver.generation_for(&first_key).await;

        resolver
            .store_if_current(first_key.clone(), vec![empty()], generation)
            .await;
        resolver
            .store_if_current(second_key.clone(), vec![empty()], generation)
            .await;
        assert!(!resolver.cache.read().await.contains_key(&first_key));
        assert!(resolver.cache.read().await.contains_key(&second_key));

        resolver.invalidate(second.path()).await;
        assert!(resolver.cache.read().await.is_empty());
        assert_eq!(resolver.generation_for(&first_key).await, generation);
    }

    #[tokio::test]
    async fn concurrent_cache_store_and_invalidation_do_not_deadlock() {
        let resolver = Arc::new(WorkspaceTargetResolver::with_cache(
            Duration::from_secs(60),
            2,
        ));
        let project = tempfile::tempdir().unwrap();
        let key = dunce::canonicalize(project.path()).unwrap();

        let store_resolver = Arc::clone(&resolver);
        let store_key = key.clone();
        let store = async move {
            for _ in 0..64 {
                let generation = store_resolver.generation_for(&store_key).await;
                store_resolver
                    .store_if_current(
                        store_key.clone(),
                        vec![RegisteredWorktree {
                            worktree: Worktree {
                                path: String::new(),
                                branch: String::new(),
                                commit_hash: String::new(),
                                is_main: false,
                                is_locked: false,
                                is_detached: false,
                                is_bare: false,
                                is_prunable: false,
                                is_available: false,
                            },
                            target_path: PathBuf::new(),
                            canonical_target_path: None,
                            stable_target_path: PathBuf::new(),
                            available: false,
                        }],
                        generation,
                    )
                    .await;
            }
        };

        let invalidate_resolver = Arc::clone(&resolver);
        let invalidate_project = project.path().to_path_buf();
        let invalidate = async move {
            for _ in 0..64 {
                invalidate_resolver.invalidate(&invalidate_project).await;
            }
        };

        tokio::time::timeout(Duration::from_secs(2), async {
            tokio::join!(store, invalidate);
        })
        .await
        .expect("cache store and invalidation should not deadlock");
    }

    #[test]
    fn non_git_discovery_errors_map_to_unregistered_targets() {
        let error = map_target_discovery_error(AppError::Git(
            "fatal: not a git repository (or any of the parent directories): .git".to_string(),
        ));
        assert!(matches!(
            error,
            AppError::WorkspaceTarget(WorkspaceTargetError::UnregisteredTarget)
        ));
    }

    #[test]
    fn available_project_worktree_uses_canonical_target_path() {
        let candidate = RegisteredWorktree {
            worktree: Worktree {
                path: "/repo/worktree-alias".to_string(),
                branch: "feature".to_string(),
                commit_hash: "abc".to_string(),
                is_main: false,
                is_locked: false,
                is_detached: false,
                is_bare: false,
                is_prunable: false,
                is_available: true,
            },
            target_path: PathBuf::from("/repo/worktree-alias/project"),
            canonical_target_path: Some(PathBuf::from("/real/worktree/project")),
            stable_target_path: PathBuf::from("/real/worktree/project"),
            available: true,
        };

        let projected = project_worktree(&candidate);
        assert_eq!(projected.path, "/real/worktree/project");
    }

    #[test]
    fn unavailable_project_worktree_uses_normalized_target_identity() {
        let candidate = RegisteredWorktree {
            worktree: Worktree {
                path: "/repo/worktree".to_string(),
                branch: "feature".to_string(),
                commit_hash: "abc".to_string(),
                is_main: false,
                is_locked: false,
                is_detached: false,
                is_bare: false,
                is_prunable: true,
                is_available: false,
            },
            target_path: PathBuf::from("/repo/worktree/./project/../project"),
            canonical_target_path: None,
            stable_target_path: PathBuf::from("/repo/worktree/project"),
            available: false,
        };

        let projected = project_worktree(&candidate);
        assert_eq!(projected.path, "/repo/worktree/project");
    }

    #[test]
    fn target_path_identity_is_lexically_stable_for_missing_paths() {
        assert_eq!(
            target_path_identity(Path::new("/repo/worktree/./project/../project")),
            "/repo/worktree/project"
        );
    }

    #[test]
    fn target_path_is_within_normalizes_lexical_paths_and_boundaries() {
        assert!(target_path_is_within(
            Path::new("/tmp/demo/feature/src/../src"),
            Path::new("/tmp/demo/feature"),
        ));
        assert!(target_path_is_within(
            Path::new("/tmp/demo/feature"),
            Path::new("/tmp/demo/feature"),
        ));
        assert!(!target_path_is_within(
            Path::new("/tmp/demo/feature-other"),
            Path::new("/tmp/demo/feature"),
        ));
    }

    #[test]
    fn target_path_relative_preserves_boundaries_and_rejects_parent_aliases() {
        assert_eq!(
            target_path_relative(
                Path::new("/tmp/demo/project/src"),
                Path::new("/tmp/demo/project"),
            ),
            Some(PathBuf::from("src"))
        );
        assert_eq!(
            target_path_relative(
                Path::new("/tmp/demo/project-other/src"),
                Path::new("/tmp/demo/project"),
            ),
            None
        );
        assert_eq!(
            target_path_relative(
                Path::new("/tmp/demo/project/../secret"),
                Path::new("/tmp/demo/project"),
            ),
            None
        );
    }

    #[test]
    fn discovery_relative_project_root_uses_target_identity() {
        assert_eq!(
            relative_project_root(
                Path::new("/tmp/demo/project/src"),
                Path::new("/tmp/demo/project"),
            )
            .unwrap(),
            PathBuf::from("src")
        );
        assert!(relative_project_root(
            Path::new("/tmp/demo/project-other"),
            Path::new("/tmp/demo/project"),
        )
        .is_err());
    }

    #[cfg(not(windows))]
    #[test]
    fn target_path_identity_preserves_posix_literal_backslashes() {
        assert_ne!(
            target_path_identity(Path::new("/repo/a\\b")),
            target_path_identity(Path::new("/repo/a/b"))
        );
        assert_eq!(
            target_path_identity(Path::new("/repo/a\\b/../c")),
            "/repo/c"
        );
    }

    #[cfg(windows)]
    #[test]
    fn target_path_identity_accepts_windows_case_and_extended_aliases() {
        assert_eq!(
            target_path_identity(Path::new(r"C:\Users\Demo\Project")),
            target_path_identity(Path::new(r"c:\users\demo\project"))
        );
        assert_eq!(
            target_path_identity(Path::new(r"\\?\UNC\Server\Share\Project\..\src")),
            "//server/share/src"
        );
        assert_eq!(
            target_path_identity(Path::new(r"\\?\unc\Server\Share\Project")),
            target_path_identity(Path::new(r"\\?\UNC\server\share\project"))
        );
        assert_eq!(
            target_path_identity(Path::new(r"\\?\C:\Users\Demo\Project")),
            "c:/users/demo/project"
        );
        assert!(target_path_is_within(
            Path::new(r"\\?\unc\SERVER\SHARE\Project\src"),
            Path::new(r"\\server\share\project"),
        ));
        assert_eq!(
            target_path_relative(
                Path::new(r"\\?\UNC\SERVER\SHARE\Project\src"),
                Path::new(r"\\server\share\project"),
            ),
            Some(PathBuf::from("src"))
        );
        assert_eq!(
            relative_project_root(
                Path::new(r"\\?\UNC\SERVER\SHARE\Project\src"),
                Path::new(r"\\server\share\project"),
            )
            .unwrap(),
            PathBuf::from("src")
        );
    }
}
