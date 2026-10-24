use std::collections::HashSet;
use std::path::{Path, PathBuf};
use std::sync::Arc;
use std::sync::LazyLock;
use parking_lot::Mutex;

/// Tracks in-flight Git mutation operations across the server to prevent concurrent mutations
/// on the same worktree or index, while avoiding Git lock self-deadlock.
#[derive(Clone, Default)]
pub struct GitMutationCoordinator {
    active_paths: Arc<Mutex<HashSet<PathBuf>>>,
}

pub struct MutationGuard {
    coordinator: GitMutationCoordinator,
    path: PathBuf,
}

impl Drop for MutationGuard {
    fn drop(&mut self) {
        let mut paths = self.coordinator.active_paths.lock();
        paths.remove(&self.path);
    }
}

impl GitMutationCoordinator {
    pub fn new() -> Self {
        Self {
            active_paths: Arc::new(Mutex::new(HashSet::new())),
        }
    }

    /// Attempts to acquire an exclusive mutation lock on the given canonical path.
    /// Returns Ok(MutationGuard) if acquired, or Err(reason) if another mutation is already active.
    pub fn try_acquire(&self, canonical_path: &Path) -> Result<MutationGuard, &'static str> {
        let mut paths = self.active_paths.lock();
        let normalized = dunce::canonicalize(canonical_path).unwrap_or_else(|_| canonical_path.to_path_buf());
        if paths.contains(&normalized) {
            return Err("Another Git mutation is in progress for this repository");
        }
        paths.insert(normalized.clone());
        Ok(MutationGuard {
            coordinator: self.clone(),
            path: normalized,
        })
    }

    /// Attempts to acquire an exclusive mutation lock using the repository's common git directory,
    /// ensuring linked worktrees and operations on the same repository serialize on shared state.
    pub fn try_acquire_for_repo(
        &self,
        repo: &git2::Repository,
        fallback_path: &Path,
    ) -> Result<MutationGuard, &'static str> {
        let git_dir = repo.path();
        let key_path = if let Ok(common_content) = std::fs::read_to_string(git_dir.join("commondir")) {
            let trimmed = common_content.trim();
            let resolved = git_dir.join(trimmed);
            dunce::canonicalize(&resolved).unwrap_or(resolved)
        } else {
            dunce::canonicalize(git_dir)
                .or_else(|_| dunce::canonicalize(fallback_path))
                .unwrap_or_else(|_| fallback_path.to_path_buf())
        };
        self.try_acquire(&key_path)
    }
}

pub static GLOBAL_MUTATION_COORDINATOR: LazyLock<GitMutationCoordinator> =
    LazyLock::new(GitMutationCoordinator::new);

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_coordinator_concurrency_and_drop() {
        let coord = GitMutationCoordinator::new();
        let path = PathBuf::from("/test/repo");

        let guard1 = coord.try_acquire(&path);
        assert!(guard1.is_ok());

        let guard2 = coord.try_acquire(&path);
        assert!(guard2.is_err());

        drop(guard1);

        let guard3 = coord.try_acquire(&path);
        assert!(guard3.is_ok());
    }
}
