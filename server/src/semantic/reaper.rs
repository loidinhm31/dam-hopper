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

/// Dispatches a POSIX signal to an entire process group.
#[cfg(unix)]
pub fn signal_pgid(pgid: u32, signal: Option<nix::sys::signal::Signal>) -> Result<(), nix::errno::Errno> {
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

/// Finds all direct child PIDs of `pid` by inspecting Linux `/proc/<pid>/task/<pid>/children`.
#[cfg(target_os = "linux")]
pub fn get_proc_children(pid: u32) -> Vec<u32> {
    let path = format!("/proc/{}/task/{}/children", pid, pid);
    if let Ok(content) = std::fs::read_to_string(path) {
        content
            .split_whitespace()
            .filter_map(|s| s.parse::<u32>().ok())
            .collect()
    } else {
        Vec::new()
    }
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

/// Two-stage signal escalation and verification reaper for a child process and its process group:
/// 1. Sends SIGTERM to `-pgid`.
/// 2. Awaits exit of the direct child for up to `term_grace`.
/// 3. If direct child or descendants remain, sends SIGKILL to `-pgid`.
/// 4. Reaps the direct child via Tokio `Child::wait`.
/// 5. Polls `is_pgid_empty` for up to `kill_grace` to verify zero surviving descendants.
pub async fn terminate_and_reap_tree(
    child: &mut tokio::process::Child,
    pgid: u32,
    term_grace: Duration,
    kill_grace: Duration,
) -> Result<std::process::ExitStatus, ReaperError> {
    // Snapshot known descendant PIDs before beginning teardown
    let recorded_descendants = get_all_descendants(pgid);

    #[cfg(unix)]
    {
        use nix::sys::signal::{kill, Signal};
        use nix::unistd::Pid;

        // Stage 1: SIGTERM to process group and individual descendants
        let _ = signal_pgid(pgid, Some(Signal::SIGTERM));
        for &desc_pid in &recorded_descendants {
            let _ = kill(Pid::from_raw(desc_pid as i32), Some(Signal::SIGTERM));
        }

        // Await direct child exit within term_grace
        if let Ok(Ok(status)) = tokio::time::timeout(term_grace, child.wait()).await {
            if is_pgid_empty(pgid) && verify_pids_dead(&recorded_descendants) {
                return Ok(status);
            }
        }

        // Stage 2: SIGKILL to process group and individual descendants
        let _ = signal_pgid(pgid, Some(Signal::SIGKILL));
        for &desc_pid in &recorded_descendants {
            let _ = kill(Pid::from_raw(desc_pid as i32), Some(Signal::SIGKILL));
        }
    }

    // Fallback direct kill on the child with timeout
    let _ = tokio::time::timeout(Duration::from_millis(1000), child.kill()).await;
    let status_res = tokio::time::timeout(kill_grace, child.wait()).await;

    let status = match status_res {
        Ok(Ok(st)) => st,
        Ok(Err(e)) => return Err(ReaperError::KillFailed(e.to_string())),
        Err(_) => return Err(ReaperError::KillFailed("Child wait timed out during forced kill".into())),
    };

    #[cfg(unix)]
    {
        if !verify_pgid_reaped(pgid, kill_grace).await || !verify_pids_dead(&recorded_descendants) {
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
    let start = std::time::Instant::now();
    let poll_interval = Duration::from_millis(20);

    while start.elapsed() < timeout {
        if is_pgid_empty(pgid) {
            return true;
        }
        sleep(poll_interval).await;
    }

    is_pgid_empty(pgid)
}
