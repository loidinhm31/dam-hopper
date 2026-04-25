use std::sync::Arc;

use once_cell::sync::Lazy;
use regex::Regex;
#[cfg(not(target_os = "linux"))]
use tracing::warn;

use super::manager::PortForwardManager;

// ---------------------------------------------------------------------------
// Port safety guard
// ---------------------------------------------------------------------------

/// Ports that must never be proxied regardless of what processes bind them.
const DANGER_PORTS: &[u16] = &[22, 25, 110, 143, 3306, 5432, 6379, 27017];

/// Returns `true` when a detected port is safe to expose via the proxy.
pub fn port_is_safe(port: u16) -> bool {
    if port < 1024 {
        return false;
    }
    !DANGER_PORTS.contains(&port)
}

// ---------------------------------------------------------------------------
// Regex bank (ANSI-stripped stdout patterns)
// ---------------------------------------------------------------------------

static PORT_REGEXES: Lazy<Vec<Regex>> = Lazy::new(|| {
    vec![
        Regex::new(r"(?i)listening on.*:(\d{4,5})").unwrap(),
        Regex::new(r"localhost:(\d{4,5})").unwrap(),
        Regex::new(r"http://(?:localhost|127\.0\.0\.1):(\d{4,5})").unwrap(),
        Regex::new(r"Local:\s+http://localhost:(\d{4,5})").unwrap(),
        Regex::new(r"(?i)server listening on.*:(\d{4,5})").unwrap(),
        Regex::new(r"(?i)bound to.*:(\d{4,5})").unwrap(),
        Regex::new(r"0\.0\.0\.0:(\d{4,5})").unwrap(),
    ]
});

// ---------------------------------------------------------------------------
// ANSI escape stripping
// ---------------------------------------------------------------------------

/// Strip ANSI CSI escape sequences (`\x1b[...m`) and OSC sequences (`\x1b]...\x07`).
pub fn strip_ansi(input: &str) -> String {
    let mut out = String::with_capacity(input.len());
    let mut chars = input.chars().peekable();
    while let Some(ch) = chars.next() {
        if ch == '\x1b' {
            match chars.peek() {
                Some(&'[') => {
                    chars.next(); // consume '['
                    // Consume until a letter (final byte)
                    for c in chars.by_ref() {
                        if c.is_ascii_alphabetic() {
                            break;
                        }
                    }
                }
                Some(&']') => {
                    chars.next(); // consume ']'
                    // Consume until BEL (\x07) or ST (\x1b\\)
                    for c in chars.by_ref() {
                        if c == '\x07' {
                            break;
                        }
                    }
                }
                _ => {} // lone ESC — discard
            }
        } else {
            out.push(ch);
        }
    }
    out
}

// ---------------------------------------------------------------------------
// stdout chunk scanner
// ---------------------------------------------------------------------------

/// Scan a raw PTY output chunk for port numbers; report first safe hit to manager.
///
/// Non-blocking: regex on 4KB is ~µs. Called from reader_thread (OS thread, not Tokio).
/// `rt_handle` must be captured from the async context before the OS thread is spawned —
/// std::thread::spawn does not inherit Tokio's thread-local runtime context.
pub fn scan_chunk(
    data: &[u8],
    session_id: &str,
    project: Option<&str>,
    mgr: &Arc<PortForwardManager>,
    rt_handle: &tokio::runtime::Handle,
) {
    let text = String::from_utf8_lossy(data);
    let clean = strip_ansi(&text);

    for re in PORT_REGEXES.iter() {
        if let Some(caps) = re.captures(&clean) {
            if let Some(m) = caps.get(1) {
                if let Ok(port) = m.as_str().parse::<u16>() {
                    if !port_is_safe(port) {
                        continue;
                    }
                    let mgr = Arc::clone(mgr);
                    let session_id = session_id.to_owned();
                    let project = project.map(ToOwned::to_owned);
                    rt_handle.spawn(async move {
                        mgr.report_stdout_hit(port, session_id, project).await;
                    });
                    // Only report the first match per chunk to avoid event spam.
                    return;
                }
            }
        }
    }
}

// ---------------------------------------------------------------------------
// /proc/net/tcp poller — Linux only
// ---------------------------------------------------------------------------

/// Spawn the background poller task. On non-Linux, logs a warning and exits.
pub async fn proc_poll_loop(_pfm: Arc<PortForwardManager>) {
    #[cfg(not(target_os = "linux"))]
    {
        warn!("Port forwarding proc poller is Linux-only — port confirmation/loss detection disabled on this OS");
        return;
    }

    #[cfg(target_os = "linux")]
    {
        linux_poll_loop(_pfm).await;
    }
}

#[cfg(target_os = "linux")]
async fn linux_poll_loop(pfm: Arc<PortForwardManager>) {
    use std::collections::HashSet;
    use std::time::Duration;
    use procfs::net::TcpState;
    use tokio::time;

    let mut interval = time::interval(Duration::from_secs(2));
    interval.set_missed_tick_behavior(time::MissedTickBehavior::Skip);

    loop {
        interval.tick().await;

        // Collect all currently LISTEN ports from /proc/net/tcp and tcp6.
        let mut listening: HashSet<u16> = HashSet::new();
        if let Ok(entries) = procfs::net::tcp() {
            for e in &entries {
                if e.state == TcpState::Listen {
                    listening.insert(e.local_address.port());
                }
            }
        }
        if let Ok(entries) = procfs::net::tcp6() {
            for e in &entries {
                if e.state == TcpState::Listen {
                    listening.insert(e.local_address.port());
                }
            }
        }

        // Snapshot current known ports without holding the lock across awaits.
        let known: Vec<u16> = pfm.list().await.into_iter().map(|p| p.port).collect();

        for port in &known {
            if listening.contains(port) {
                pfm.confirm_listen(*port).await;
            } else {
                pfm.report_lost(*port).await;
            }
        }
    }
}

// ---------------------------------------------------------------------------
// Unit tests
// ---------------------------------------------------------------------------

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn strip_ansi_removes_csi() {
        let s = "\x1b[32mhello\x1b[0m";
        assert_eq!(strip_ansi(s), "hello");
    }

    #[test]
    fn strip_ansi_removes_osc() {
        let s = "\x1b]0;title\x07text";
        assert_eq!(strip_ansi(s), "text");
    }

    #[test]
    fn strip_ansi_plain_passthrough() {
        assert_eq!(strip_ansi("hello world"), "hello world");
    }

    #[test]
    fn port_is_safe_rejects_privileged() {
        assert!(!port_is_safe(80));
        assert!(!port_is_safe(443));
        assert!(!port_is_safe(0));
    }

    #[test]
    fn port_is_safe_rejects_danger_list() {
        assert!(!port_is_safe(22));
        assert!(!port_is_safe(3306));
        assert!(!port_is_safe(5432));
        assert!(!port_is_safe(6379));
        assert!(!port_is_safe(27017));
    }

    #[test]
    fn port_is_safe_accepts_common_dev_ports() {
        assert!(port_is_safe(3000));
        assert!(port_is_safe(4000));
        assert!(port_is_safe(5173));
        assert!(port_is_safe(8080));
        assert!(port_is_safe(8000));
    }

    #[test]
    fn scan_chunk_extracts_vite_port() {
        // We can't test the async dispatch, but verify regex matches
        let text = b"  Local:   http://localhost:5173/\n";
        let clean = strip_ansi(&String::from_utf8_lossy(text));
        let found: Option<u16> = PORT_REGEXES.iter().find_map(|re| {
            re.captures(&clean)
                .and_then(|c| c.get(1))
                .and_then(|m| m.as_str().parse().ok())
        });
        assert_eq!(found, Some(5173));
    }

    #[test]
    fn scan_chunk_extracts_listening_on_port() {
        let text = b"Server listening on localhost:8080\n";
        let clean = strip_ansi(&String::from_utf8_lossy(text));
        let found: Option<u16> = PORT_REGEXES.iter().find_map(|re| {
            re.captures(&clean)
                .and_then(|c| c.get(1))
                .and_then(|m| m.as_str().parse().ok())
        });
        assert_eq!(found, Some(8080));
    }

    #[test]
    fn scan_chunk_ignores_danger_port_22() {
        // Port 22 would match a pattern but port_is_safe should reject it
        let text = b"Listening on 0.0.0.0:22\n";
        let clean = strip_ansi(&String::from_utf8_lossy(text));
        let found: Option<u16> = PORT_REGEXES.iter().find_map(|re| {
            re.captures(&clean)
                .and_then(|c| c.get(1))
                .and_then(|m| m.as_str().parse::<u16>().ok())
                .filter(|&p| port_is_safe(p))
        });
        assert_eq!(found, None);
    }
}
