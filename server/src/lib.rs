pub mod agent_store;
pub mod api;
pub mod commands;
pub mod config;
pub mod error;
pub mod fs;
pub mod git;
pub mod pty;
pub mod ssh;
pub mod state;
pub mod utils;

/// Check inotify watch limit at startup (Linux only).
///
/// Warns if `/proc/sys/fs/inotify/max_user_watches` < 65536 — insufficient for
/// large repositories and will cause `ENOSPC` from the watcher.
pub fn probe_inotify_limit() {
    #[cfg(target_os = "linux")]
    {
        const MIN_WATCHES: u64 = 65536;
        match std::fs::read_to_string("/proc/sys/fs/inotify/max_user_watches") {
            Ok(s) => {
                if let Ok(n) = s.trim().parse::<u64>() {
                    if n < MIN_WATCHES {
                        tracing::warn!(
                            current = n,
                            recommended = MIN_WATCHES,
                            "inotify max_user_watches is low — large repos may fail to watch. \
                             Run: echo {} | sudo tee /proc/sys/fs/inotify/max_user_watches",
                            MIN_WATCHES
                        );
                    } else {
                        tracing::debug!(max_user_watches = n, "inotify limit ok");
                    }
                }
            }
            Err(e) => {
                tracing::debug!(error = %e, "could not read inotify limit");
            }
        }
    }
}
