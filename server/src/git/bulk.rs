/// BulkGitService — concurrent multi-project git operations.
///
/// Mirrors Node's BulkGitService (p-limit(4)) using tokio::sync::Semaphore.
/// Each operation opens its own Repository handle (git2::Repository is !Sync).
use std::collections::HashMap;
use std::path::Path;
use std::sync::Arc;

use tokio::sync::Semaphore;

use crate::git::progress::{create_progress_channel, emit_completed, emit_progress, ProgressSender};
use crate::git::repository::{self, update_branch};
use crate::git::types::{BranchUpdateResult, GitOperationResult, GitStatus};
use crate::ssh::SshCredStore;

/// Sentinel project_name for bulk-level progress events (no specific project).
const BULK: &str = "BULK";

pub struct ProjectRef<'a> {
    pub name: &'a str,
    pub path: &'a Path,
}

pub struct BulkGitService {
    pub concurrency: usize,
    pub progress: Option<ProgressSender>,
    pub ssh_cred: Option<Arc<SshCredStore>>,
}

impl Default for BulkGitService {
    fn default() -> Self {
        Self::new(4)
    }
}

impl BulkGitService {
    pub fn new(concurrency: usize) -> Self {
        let progress = Some(create_progress_channel());
        Self { concurrency, progress, ssh_cred: None }
    }

    pub fn with_creds(mut self, cred: Option<Arc<SshCredStore>>) -> Self {
        self.ssh_cred = cred;
        self
    }

    pub fn subscribe(&self) -> Option<crate::git::progress::ProgressReceiver> {
        self.progress.as_ref().map(|tx| tx.subscribe())
    }

    pub async fn fetch_all(&self, projects: &[ProjectRef<'_>]) -> Vec<GitOperationResult> {
        let sem = Arc::new(Semaphore::new(self.concurrency));
        let total = projects.len();
        let completed = Arc::new(std::sync::atomic::AtomicUsize::new(0));
        let progress = self.progress.clone();

        let mut handles = Vec::with_capacity(total);

        for p in projects {
            let name = p.name.to_string();
            let path = p.path.to_path_buf();
            let sem = Arc::clone(&sem);
            let completed = Arc::clone(&completed);
            let progress = progress.clone();
            let cred = self.ssh_cred.clone();

            handles.push(tokio::spawn(async move {
                let _permit = sem.acquire().await.expect("semaphore closed");
                let result = repository::fetch(&path, &name, &progress, cred).await;
                let done = completed.fetch_add(1, std::sync::atomic::Ordering::Relaxed) + 1;
                let pct = (done * 100 / total).min(100) as u8;
                emit_progress(
                    &progress,
                    &name,
                    "bulk-fetch",
                    &format!("{done}/{total} projects fetched"),
                    Some(pct),
                );
                result
            }));
        }

        let mut results = Vec::with_capacity(total);
        for h in handles {
            if let Ok(r) = h.await {
                results.push(r);
            }
        }

        emit_completed(&progress, BULK, "bulk-fetch", &format!("All {total} projects fetched"));
        results
    }

    pub async fn pull_all(&self, projects: &[ProjectRef<'_>]) -> Vec<GitOperationResult> {
        let sem = Arc::new(Semaphore::new(self.concurrency));
        let total = projects.len();
        let completed = Arc::new(std::sync::atomic::AtomicUsize::new(0));
        let progress = self.progress.clone();

        let mut handles = Vec::with_capacity(total);

        for p in projects {
            let name = p.name.to_string();
            let path = p.path.to_path_buf();
            let sem = Arc::clone(&sem);
            let completed = Arc::clone(&completed);
            let progress = progress.clone();
            let cred = self.ssh_cred.clone();

            handles.push(tokio::spawn(async move {
                let _permit = sem.acquire().await.expect("semaphore closed");
                let result = repository::pull(&path, &name, &progress, cred).await;
                let done = completed.fetch_add(1, std::sync::atomic::Ordering::Relaxed) + 1;
                let pct = (done * 100 / total).min(100) as u8;
                emit_progress(
                    &progress,
                    &name,
                    "bulk-pull",
                    &format!("{done}/{total} projects pulled"),
                    Some(pct),
                );
                result
            }));
        }

        let mut results = Vec::with_capacity(total);
        for h in handles {
            if let Ok(r) = h.await {
                results.push(r);
            }
        }

        emit_completed(&progress, BULK, "bulk-pull", &format!("All {total} projects pulled"));
        results
    }

    pub async fn status_all(&self, projects: &[ProjectRef<'_>]) -> Vec<GitStatus> {
        let sem = Arc::new(Semaphore::new(self.concurrency));
        let mut handles = Vec::with_capacity(projects.len());

        for p in projects {
            let name = p.name.to_string();
            let path = p.path.to_path_buf();
            let sem = Arc::clone(&sem);

            handles.push(tokio::spawn(async move {
                let _permit = sem.acquire().await.expect("semaphore closed");
                let name_err = name.clone();
                // spawn_blocking because git2 ops are synchronous
                tokio::task::spawn_blocking(move || {
                    repository::get_status(&path, &name).unwrap_or_else(|e| {
                        GitStatus::error(&name, e.to_string())
                    })
                })
                .await
                .unwrap_or_else(|_| GitStatus::error(&name_err, "task panic"))
            }));
        }

        let mut results = Vec::with_capacity(projects.len());
        for h in handles {
            if let Ok(r) = h.await {
                results.push(r);
            }
        }
        results
    }

    pub async fn update_all_branches(
        &self,
        projects: &[ProjectRef<'_>],
    ) -> HashMap<String, Vec<BranchUpdateResult>> {
        let sem = Arc::new(Semaphore::new(self.concurrency));
        let progress = self.progress.clone();
        let mut handles = Vec::with_capacity(projects.len());

        for p in projects {
            let name = p.name.to_string();
            let path = p.path.to_path_buf();
            let sem = Arc::clone(&sem);
            let progress = progress.clone();

            handles.push(tokio::spawn(async move {
                let _permit = sem.acquire().await.expect("semaphore closed");

                let name_clone = name.clone();
                let path_clone = path.clone();

                let results = tokio::task::spawn_blocking(move || {
                    update_all_branches_for_project(&path_clone, &name_clone)
                })
                .await
                .unwrap_or_default();

                emit_completed(
                    &progress,
                    &name,
                    "update-branches",
                    &format!("Updated {} branches", results.len()),
                );

                (name, results)
            }));
        }

        let mut map = HashMap::new();
        for h in handles {
            if let Ok((name, results)) = h.await {
                map.insert(name, results);
            }
        }
        map
    }
}

fn update_all_branches_for_project(path: &Path, _name: &str) -> Vec<BranchUpdateResult> {
    let branches = match repository::list_branches(path) {
        Ok(b) => b,
        Err(_) => return Vec::new(),
    };

    let local_with_tracking: Vec<_> = branches
        .iter()
        .filter(|b| !b.is_remote && b.tracking_branch.is_some())
        .collect();

    local_with_tracking
        .iter()
        .map(|b| {
            update_branch(path, &b.name, "origin").unwrap_or_else(|e| BranchUpdateResult {
                branch: b.name.clone(),
                success: false,
                reason: Some(e.to_string()),
            })
        })
        .collect()
}
