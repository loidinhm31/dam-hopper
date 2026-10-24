use std::time::Duration;
use thiserror::Error;
use tokio::time::sleep;

#[derive(Debug, Error)]
pub enum ReaperError {
    #[error("Child process kill failed: {0}")]
    KillFailed(String),

    #[error("Descendant process leak detected: PGID {0} still contains living processes")]
    DescendantLeak(u32),

    #[error("I/O error during process management: {0}")]
    Io(#[from] std::io::Error),
}

/// Snapshot of live process count and resident set size (RSS) across a child process tree.
#[derive(Clone, Debug, Default, PartialEq, Eq)]
pub struct TreeResourceSample {
    pub process_count: usize,
    pub rss_bytes: u64,
    pub pids: Vec<u32>,
}

#[cfg(target_os = "linux")]
fn page_size_bytes() -> u64 {
    let sz = unsafe { libc::sysconf(libc::_SC_PAGESIZE) };
    if sz > 0 {
        sz as u64
    } else {
        4096
    }
}

/// Reads the current Resident Set Size (RSS) in bytes for a single process from `/proc/<pid>/statm`,
/// returning `None` if the process no longer exists or is a zombie (`Z` / `X`).
#[cfg(target_os = "linux")]
pub fn read_proc_rss_bytes(pid: u32) -> Option<u64> {
    let stat_path = format!("/proc/{pid}/stat");
    let stat_content = std::fs::read_to_string(stat_path).ok()?;
    let rparen = stat_content.rfind(')')?;
    let state_char = stat_content.get(rparen + 2..)?.chars().next()?;
    if matches!(state_char, 'Z' | 'X' | 'x') {
        return None;
    }

    let statm_path = format!("/proc/{pid}/statm");
    let statm_content = std::fs::read_to_string(statm_path).ok()?;
    let resident_pages: u64 = statm_content.split_whitespace().nth(1)?.parse().ok()?;
    Some(resident_pages.saturating_mul(page_size_bytes()))
}

#[cfg(not(target_os = "linux"))]
pub fn read_proc_rss_bytes(_pid: u32) -> Option<u64> {
    None
}

/// Samples the live process count and aggregate RSS bytes for `root_pid` and all its `/proc` descendants.
pub fn sample_tree_resources(root_pid: u32) -> TreeResourceSample {
    let mut candidate_pids = vec![root_pid];
    candidate_pids.extend(get_all_descendants(root_pid));

    let mut live_pids = Vec::with_capacity(candidate_pids.len());
    let mut rss_bytes = 0u64;
    for pid in candidate_pids {
        if let Some(rss) = read_proc_rss_bytes(pid) {
            live_pids.push(pid);
            rss_bytes = rss_bytes.saturating_add(rss);
        }
    }

    TreeResourceSample {
        process_count: live_pids.len(),
        rss_bytes,
        pids: live_pids,
    }
}

/// Dispatches a POSIX signal to an entire process group.
#[cfg(unix)]
pub fn signal_pgid(
    pgid: u32,
    signal: Option<nix::sys::signal::Signal>,
) -> Result<(), nix::errno::Errno> {
    use nix::sys::signal::kill;
    use nix::unistd::Pid;

    let target_pgid = Pid::from_raw(-(pgid as i32));
    kill(target_pgid, signal)
}

/// Checks whether any process remains in the given process group.
/// Returns `true` if the process group is completely empty (ESRCH), `false` if processes remain.
#[cfg(unix)]
pub fn is_pgid_empty(pgid: u32) -> bool {
    use nix::errno::Errno;

    match signal_pgid(pgid, None) {
        Err(Errno::ESRCH) => true,
        Ok(_) => false,
        Err(_) => false,
    }
}

#[cfg(not(unix))]
pub fn is_pgid_empty(_pgid: u32) -> bool {
    true
}

/// Finds direct child PIDs across all Linux `/proc/<pid>/task/<tid>/children` files.
/// This is a best-effort snapshot: tasks can exit or become unreadable during enumeration.
#[cfg(target_os = "linux")]
pub fn get_proc_children(pid: u32) -> Vec<u32> {
    let Ok(tasks) = std::fs::read_dir(format!("/proc/{pid}/task")) else {
        return Vec::new();
    };
    let mut children = Vec::new();
    for task in tasks.flatten() {
        // Children belong to the spawning task, which need not be the process leader.
        let Ok(content) = std::fs::read_to_string(task.path().join("children")) else {
            continue;
        };
        children.extend(
            content
                .split_whitespace()
                .filter_map(|s| s.parse::<u32>().ok()),
        );
    }
    children.sort_unstable();
    children.dedup();
    children
}

#[cfg(not(target_os = "linux"))]
pub fn get_proc_children(_pid: u32) -> Vec<u32> {
    Vec::new()
}

/// Recursively discovers all descendants of a root PID under Linux `/proc`.
pub fn get_all_descendants(root_pid: u32) -> Vec<u32> {
    let mut all = Vec::new();
    let mut queue = vec![root_pid];

    while let Some(current) = queue.pop() {
        let children = get_proc_children(current);
        for child in children {
            if !all.contains(&child) && child != root_pid {
                all.push(child);
                queue.push(child);
            }
        }
    }
    all
}
/// Merges newly discovered `/proc` descendants of `root_pid` and any already-recorded descendants
/// into `recorded`, ensuring grandchildren spawned during shutdown are tracked even if `root_pid` exits.
pub fn merge_descendants(root_pid: u32, recorded: &mut Vec<u32>) {
    for child in get_all_descendants(root_pid) {
        if child != root_pid && !recorded.contains(&child) {
            recorded.push(child);
        }
    }
    let snapshot = recorded.clone();
    for desc in snapshot {
        for sub in get_all_descendants(desc) {
            if sub != root_pid && !recorded.contains(&sub) {
                recorded.push(sub);
            }
        }
    }
}

/// Two-stage signal escalation and verification reaper for a child process and its process group:
/// 1. Sends SIGTERM to `-pgid` and recorded descendants.
/// 2. Awaits exit of the direct child for up to `term_grace`.
/// 3. If direct child or descendants remain, sends SIGKILL to `-pgid` and all descendants.
/// 4. Reaps the direct child via Tokio `Child::wait`.
/// 5. Polls `verify_tree_reaped` for up to `kill_grace` to verify zero surviving descendants.
pub async fn terminate_and_reap_tree(
    child: &mut tokio::process::Child,
    pgid: u32,
    term_grace: Duration,
    kill_grace: Duration,
) -> Result<std::process::ExitStatus, ReaperError> {
    let mut recorded_descendants = Vec::new();
    terminate_and_reap_tree_with_descendants(
        child,
        pgid,
        &mut recorded_descendants,
        term_grace,
        kill_grace,
    )
    .await
}

/// Same as [`terminate_and_reap_tree`], preserving and updating an existing `recorded_descendants` list
/// captured before graceful LSP shutdown messages were sent.
pub async fn terminate_and_reap_tree_with_descendants(
    child: &mut tokio::process::Child,
    pgid: u32,
    recorded_descendants: &mut Vec<u32>,
    term_grace: Duration,
    kill_grace: Duration,
) -> Result<std::process::ExitStatus, ReaperError> {
    merge_descendants(pgid, recorded_descendants);

    #[cfg(unix)]
    {
        use nix::sys::signal::{kill, Signal};
        use nix::unistd::Pid;

        // Stage 1: SIGTERM to process group and individual descendants
        let _ = signal_pgid(pgid, Some(Signal::SIGTERM));
        for &desc_pid in recorded_descendants.iter() {
            let _ = kill(Pid::from_raw(desc_pid as i32), Some(Signal::SIGTERM));
        }

        // Await direct child exit within term_grace
        if let Ok(Ok(status)) = tokio::time::timeout(term_grace, child.wait()).await {
            merge_descendants(pgid, recorded_descendants);
            if verify_tree_reaped(pgid, recorded_descendants, Duration::from_millis(100)).await {
                return Ok(status);
            }
        }

        // Refresh descendants before Stage 2 SIGKILL
        merge_descendants(pgid, recorded_descendants);

        // Stage 2: SIGKILL to process group and individual descendants
        let _ = signal_pgid(pgid, Some(Signal::SIGKILL));
        for &desc_pid in recorded_descendants.iter() {
            let _ = kill(Pid::from_raw(desc_pid as i32), Some(Signal::SIGKILL));
        }
    }

    // Fallback direct kill on the child with timeout
    let _ = tokio::time::timeout(Duration::from_millis(1000), child.kill()).await;
    let status_res = tokio::time::timeout(kill_grace, child.wait()).await;

    let status = match status_res {
        Ok(Ok(st)) => st,
        Ok(Err(e)) => return Err(ReaperError::KillFailed(e.to_string())),
        Err(_) => {
            return Err(ReaperError::KillFailed(
                "Child wait timed out during forced kill".into(),
            ))
        }
    };

    #[cfg(unix)]
    {
        if !verify_tree_reaped(pgid, recorded_descendants, kill_grace).await {
            return Err(ReaperError::DescendantLeak(pgid));
        }
    }

    Ok(status)
}

#[cfg(unix)]
pub fn verify_pids_dead(pids: &[u32]) -> bool {
    use nix::errno::Errno;
    use nix::sys::signal::kill;
    use nix::unistd::Pid;

    for &pid in pids {
        match kill(Pid::from_raw(pid as i32), None) {
            Err(Errno::ESRCH) => {}
            _ => return false,
        }
    }
    true
}

#[cfg(not(unix))]
pub fn verify_pids_dead(_pids: &[u32]) -> bool {
    true
}

/// Polls `is_pgid_empty(pgid)` until true or until timeout expires.
pub async fn verify_pgid_reaped(pgid: u32, timeout: Duration) -> bool {
    verify_tree_reaped(pgid, &[], timeout).await
}

/// Polls until both `is_pgid_empty(pgid)` and `verify_pids_dead(pids)` hold, or until `timeout` expires.
pub async fn verify_tree_reaped(pgid: u32, pids: &[u32], timeout: Duration) -> bool {
    let start = std::time::Instant::now();
    let poll_interval = Duration::from_millis(20);

    while start.elapsed() < timeout {
        if is_pgid_empty(pgid) && verify_pids_dead(pids) {
            return true;
        }
        sleep(poll_interval).await;
    }

    is_pgid_empty(pgid) && verify_pids_dead(pids)
}
