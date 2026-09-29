//! Early-dispatch CLI handler for native agent hook reporting.
//!
//! Handles `dam-hopper-server integration <codex|claude> report-hook` before
//! server startup, dotenv loading, tracing configuration, database connection, or global config.
//!
//! In accordance with the security and privacy design contract:
//! - Always exits silently with status code 0.
//! - Discards all text/prompt/tool values immediately without materializing or logging them.
//! - Emits no messages on stdout or stderr.
//! - Validates the private loopback WebSocket collector URL and derives the local `POST /v1/agent-hooks` route.
//! - Reads actual `/proc` launcher ancestry to qualify root process identity, failing closed on ambiguity.
//! - Strictly bounds execution with a 250ms deadline and no retries.

use std::collections::HashSet;
use std::io::Read;
use std::net::{Ipv4Addr, Ipv6Addr, SocketAddr, SocketAddrV4, SocketAddrV6};
use std::path::Path;
use std::time::Duration;

#[cfg(test)]
use serde::Deserialize;
use tokio::io::{AsyncReadExt, AsyncWriteExt};

use crate::agent_status::integration::MANAGED_ADAPTER_VERSION;
use crate::agent_status::types::{
    AgentKind, PrivateHookEnvelope, AGENT_HOOKS_PATH, AGENT_STATUS_WS_PATH,
    ENV_AGENT_HOOKS_SOCKET, ENV_AGENT_STATUS_TOKEN, ENV_AGENT_STATUS_URL, MAX_ANCESTRY_DEPTH,
};
use crate::pty::activity::{read_process_stat, ProcessIdentity};

/// Maximum stdin payload size permitted for native hook reporting (1 MiB).
pub const MAX_HOOK_STDIN_BYTES: usize = 1_048_576;

/// Maximum normalized serialized envelope size allowed over the wire (4 KiB).
pub const MAX_ENVELOPE_WIRE_BYTES: usize = 4_096;

/// Timeout deadline for sending the hook report to the local collector (250 ms).
pub const REPORT_HOOK_DEADLINE: Duration = Duration::from_millis(250);

/// Allowlisted subset of incoming native hook fields.
///
/// All sensitive fields (e.g. `prompt`, `tool_input`, `tool_name`, `last_assistant_message`,
/// `error_details`, `transcript_path`, `cwd`, `reason`) are deliberately omitted and ignored by Serde.
#[cfg(test)]
fn present_marker<'de, D: serde::Deserializer<'de>>(deserializer: D) -> Result<bool, D::Error> {
    let _ = serde::de::IgnoredAny::deserialize(deserializer)?;
    Ok(true)
}

#[cfg(test)]
#[derive(Debug, Deserialize)]
struct NativeHookInput {
    session_id: Option<String>,

    /// Event name from hook execution (`hook_event_name` or `event`).
    #[serde(alias = "event")]
    hook_event_name: Option<String>,

    /// Optional turn or prompt identifier.
    #[serde(alias = "prompt_id")]
    turn_id: Option<String>,

    /// Optional tool invocation identifier.
    #[allow(dead_code)]
    #[serde(alias = "tool_use_id")]
    tool_call_id: Option<String>,
    /// Presence alone identifies a child; ignore marker content, including null.
    #[serde(default, deserialize_with = "present_marker")]
    agent_id: bool,
    #[serde(default, deserialize_with = "present_marker")]
    agent_type: bool,

    /// Notification type (e.g. "permission_prompt", "idle_prompt", "agent_needs_input").
    #[allow(dead_code)]
    notification_type: Option<String>,
}

struct PrivateHookTarget {
    socket_path: String,
    token: String,
}

fn trim_string_in_place(value: &mut String) {
    value.truncate(value.trim_end().len());
    let leading_bytes = value.len() - value.trim_start().len();
    if leading_bytes != 0 {
        value.replace_range(..leading_bytes, "");
    }
}

fn load_private_hook_target() -> Result<PrivateHookTarget, ()> {
    let mut socket_path = std::env::var(ENV_AGENT_HOOKS_SOCKET).map_err(|_| ())?;
    let mut raw_url = std::env::var(ENV_AGENT_STATUS_URL).map_err(|_| ())?;
    let mut token = std::env::var(ENV_AGENT_STATUS_TOKEN).map_err(|_| ())?;
    trim_string_in_place(&mut socket_path);
    trim_string_in_place(&mut raw_url);
    trim_string_in_place(&mut token);
    if socket_path.is_empty() || raw_url.is_empty() || token.is_empty() {
        return Err(());
    }

    parse_loopback_status_endpoint(&raw_url).ok_or(())?;

    if !Path::new(&socket_path).exists() {
        return Err(());
    }

    Ok(PrivateHookTarget { socket_path, token })
}

/// Check CLI arguments early and execute the report hook if invoked as:
/// `dam-hopper-server integration <codex|claude> report-hook`
///
/// Returns `true` if early hook reporting was dispatched, meaning `main` should exit 0 immediately.
pub async fn maybe_dispatch_early_report_hook() -> bool {
    let args: Vec<String> = std::env::args().collect();
    if let Some(agent_kind) = parse_report_hook_args(&args) {
        execute_report_hook(agent_kind).await;
        true
    } else {
        false
    }
}

/// Parse CLI arguments to detect exact `integration <codex|claude> report-hook`.
pub fn parse_report_hook_args(args: &[String]) -> Option<AgentKind> {
    if args.len() != 4 {
        return None;
    }
    if args.get(1).map(|s| s.as_str()) != Some("integration") {
        return None;
    }
    if args.get(3).map(|s| s.as_str()) != Some("report-hook") {
        return None;
    }
    match args.get(2).map(|s| s.as_str()) {
        Some("codex") => Some(AgentKind::Codex),
        Some("claude") => Some(AgentKind::Claude),
        _ => None,
    }
}

#[cfg(target_os = "linux")]
fn read_hook_stdin_bounded() -> Option<Vec<u8>> {
    let deadline = std::time::Instant::now() + REPORT_HOOK_DEADLINE;
    let mut buffer = Vec::new();
    let mut chunk = [0u8; 8192];
    loop {
        let remaining = deadline.saturating_duration_since(std::time::Instant::now());
        if remaining.is_zero() {
            return None;
        }
        let mut fd = libc::pollfd {
            fd: libc::STDIN_FILENO,
            events: libc::POLLIN,
            revents: 0,
        };
        let ready = unsafe { libc::poll(&mut fd, 1, remaining.as_millis().max(1) as i32) };
        if ready <= 0 || fd.revents & (libc::POLLERR | libc::POLLNVAL) != 0 {
            return None;
        }
        let n = unsafe { libc::read(libc::STDIN_FILENO, chunk.as_mut_ptr().cast(), chunk.len()) };
        if n < 0 {
            if std::io::Error::last_os_error().kind() == std::io::ErrorKind::Interrupted {
                continue;
            }
            return None;
        }
        if n == 0 {
            return (!buffer.is_empty()).then_some(buffer);
        }
        if buffer.len() + n as usize > MAX_HOOK_STDIN_BYTES {
            return None;
        }
        buffer.extend_from_slice(&chunk[..n as usize]);
    }
}

#[cfg(not(target_os = "linux"))]
fn read_hook_stdin_bounded() -> Option<Vec<u8>> {
    None
}

/// Execute native agent report hook silently, never throwing errors or writing to stdio.
///
/// Strictly bounds the entire operation (including stdin reading) to at most 250ms.
pub async fn execute_report_hook(agent_kind: AgentKind) {
    let operation = async {
        // Fail unmanaged or malformed private environments before touching stdin. Native hook
        // providers may leave stdin open, so reading first would needlessly consume the deadline.
        let target = load_private_hook_target()?;
        let stdin_bytes = tokio::task::spawn_blocking(read_hook_stdin_bounded)
            .await
            .ok()
            .flatten()
            .ok_or(())?;

        execute_report_hook_with_target(agent_kind, &stdin_bytes, target).await
    };

    let _ = tokio::time::timeout(REPORT_HOOK_DEADLINE, operation).await;
}

/// Internal implementation of report hook execution accepting a generic stdin reader (for tests).
pub async fn execute_report_hook_internal<R: Read>(
    agent_kind: AgentKind,
    reader: R,
) -> Result<(), ()> {
    let target = load_private_hook_target()?;
    let mut buffer = Vec::new();
    let mut reader = reader.take((MAX_HOOK_STDIN_BYTES + 1) as u64);
    reader.read_to_end(&mut buffer).map_err(|_| ())?;
    execute_report_hook_with_target(agent_kind, &buffer, target).await
}

/// Core report hook logic given already-buffered stdin bytes.
pub async fn execute_report_hook_with_bytes(
    agent_kind: AgentKind,
    buffer: &[u8],
) -> Result<(), ()> {
    let target = load_private_hook_target()?;
    execute_report_hook_with_target(agent_kind, buffer, target).await
}

async fn execute_report_hook_with_target(
    agent_kind: AgentKind,
    buffer: &[u8],
    target: PrivateHookTarget,
) -> Result<(), ()> {
    if buffer.is_empty() || buffer.len() > MAX_HOOK_STDIN_BYTES {
        return Err(());
    }

    let PrivateHookTarget { socket_path, token } = target;

    // Parse and normalize according to agent-specific qualified hook schemas.
    let (canonical_event, agent_session_id, turn_id, tool_call_id, reason, notification_type) =
        match agent_kind {
            AgentKind::Codex => {
                let norm = super::codex_hooks::parse_and_normalize_codex_hook(buffer)
                    .map_err(|_| ())?;
                (
                    norm.canonical_event,
                    norm.session_id,
                    norm.turn_id,
                    norm.tool_call_id,
                    None,
                    None,
                )
            }
            AgentKind::Claude => {
                let norm = super::claude_hooks::parse_and_normalize_claude_hook(buffer)
                    .map_err(|_| ())?;
                let notification_type = if norm.is_question_candidate {
                    Some("question_candidate".to_string())
                } else {
                    norm.notification_type
                };
                (
                    norm.canonical_event,
                    norm.session_id,
                    norm.turn_id,
                    norm.tool_call_id,
                    norm.reason,
                    notification_type,
                )
            }
            AgentKind::Omp => return Err(()),
        };

    // 8. Derive process identity and ancestry from actual /proc hierarchy.
    // Selects actual native agent CLI root, failing closed if ambiguous.
    let (root_process, process_ancestry) = resolve_process_ancestry(agent_kind).ok_or(())?;

    // 9. Construct normalized private envelope.
    let envelope = PrivateHookEnvelope {
        version: 1,
        agent_kind,
        adapter_version: MANAGED_ADAPTER_VERSION.to_string(),
        event_id: uuid::Uuid::new_v4().to_string(),
        event: canonical_event.to_string(),
        agent_session_id,
        turn_id,
        tool_call_id,
        reason,
        notification_type,
        root_process,
        process_ancestry,
    };

    // 10. Enforce envelope identifier bounds before serialization.
    use crate::agent_status::types::validate_opaque_id;
    validate_opaque_id("agent_session_id", &envelope.agent_session_id).map_err(|_| ())?;
    validate_opaque_id("event_id", &envelope.event_id).map_err(|_| ())?;
    validate_opaque_id("adapter_version", &envelope.adapter_version).map_err(|_| ())?;
    if let Some(turn_id) = &envelope.turn_id {
        validate_opaque_id("turn_id", turn_id).map_err(|_| ())?;
    }
    if let Some(tool_call_id) = &envelope.tool_call_id {
        validate_opaque_id("tool_call_id", tool_call_id).map_err(|_| ())?;
    }
    if let Some(notification_type) = &envelope.notification_type {
        validate_opaque_id("notification_type", notification_type).map_err(|_| ())?;
    }

    let serialized = serde_json::to_vec(&envelope).map_err(|_| ())?;
    if serialized.len() > MAX_ENVELOPE_WIRE_BYTES {
        return Err(());
    }

    // 11. Send authenticated HTTP POST via Unix domain socket with 250ms timeout; discard response.
    let post_future = async {
        #[cfg(target_os = "linux")]
        {
            let mut stream = tokio::net::UnixStream::connect(socket_path).await?;
            let request_head = format!(
                "POST {} HTTP/1.1\r\n\
                 Host: localhost\r\n\
                 Authorization: Bearer {}\r\n\
                 Content-Type: application/json\r\n\
                 Content-Length: {}\r\n\
                 Connection: close\r\n\
                 \r\n",
                AGENT_HOOKS_PATH,
                token,
                serialized.len(),
            );
            stream.write_all(request_head.as_bytes()).await?;
            stream.write_all(&serialized).await?;
            stream.flush().await?;

            let mut response_buf = [0u8; 128];
            let _ = stream.read(&mut response_buf).await;
            Ok::<(), std::io::Error>(())
        }
        #[cfg(not(target_os = "linux"))]
        {
            Err::<(), std::io::Error>(std::io::Error::new(
                std::io::ErrorKind::Unsupported,
                "Unix domain socket hook ingress is only supported on Linux",
            ))
        }
    };
    let _ = tokio::time::timeout(REPORT_HOOK_DEADLINE, post_future).await;
    Ok(())
}

#[derive(Clone, Copy)]
enum LoopbackHost {
    Ipv4,
    Localhost,
    Ipv6,
}

fn parse_loopback_status_endpoint(raw_url: &str) -> Option<(SocketAddr, LoopbackHost)> {
    let rest = raw_url.strip_prefix("ws://")?;
    if rest.contains('?') || rest.contains('#') {
        return None;
    }

    let slash_idx = rest.find('/')?;
    let host_port = &rest[..slash_idx];
    if &rest[slash_idx..] != AGENT_STATUS_WS_PATH {
        return None;
    }

    if host_port.starts_with('[') {
        let close_bracket = host_port.find(']')?;
        let host = &host_port[1..close_bracket];
        if host != "::1" && host != "0:0:0:0:0:0:0:1" {
            return None;
        }
        let port: u16 = host_port[close_bracket + 1..]
            .strip_prefix(':')?
            .parse()
            .ok()?;
        if port == 0 {
            return None;
        }
        Some((
            SocketAddr::V6(SocketAddrV6::new(Ipv6Addr::LOCALHOST, port, 0, 0)),
            LoopbackHost::Ipv6,
        ))
    } else {
        let (host, port_str) = host_port.rsplit_once(':')?;
        let port: u16 = port_str.parse().ok()?;
        if port == 0 {
            return None;
        }
        let addr = SocketAddr::V4(SocketAddrV4::new(Ipv4Addr::LOCALHOST, port));
        match host {
            "127.0.0.1" => Some((addr, LoopbackHost::Ipv4)),
            "localhost" => Some((addr, LoopbackHost::Localhost)),
            _ => None,
        }
    }
}

/// Validate that the URL is strictly a loopback WebSocket URL targeting `/v1/agent-status`,
/// and derive the loopback socket address and Host header for HTTP POST.
pub fn validate_and_derive_post_endpoint(raw_url: &str) -> Option<(SocketAddr, String)> {
    let (addr, host) = parse_loopback_status_endpoint(raw_url)?;
    let port = addr.port();
    let host_header = match host {
        LoopbackHost::Ipv4 => format!("127.0.0.1:{port}"),
        LoopbackHost::Localhost => format!("localhost:{port}"),
        LoopbackHost::Ipv6 => format!("[::1]:{port}"),
    };
    Some((addr, host_header))
}

/// Canonicalize and check if the given event name is allowlisted for the specified agent kind.
pub fn normalize_and_allowlist_event(agent_kind: AgentKind, raw: &str) -> Option<&'static str> {
    match agent_kind {
        AgentKind::Codex => super::codex_hooks::normalize_codex_event(raw),
        AgentKind::Claude => super::claude_hooks::normalize_claude_event(raw),
        AgentKind::Omp => None,
    }
}

#[derive(Clone, Copy, PartialEq, Eq)]
enum AgentCliMatch {
    None,
    Codex,
    Claude,
    Ambiguous,
}

fn classify_agent_cli_process(proc_dir: &Path, pid: u32, comm: &str) -> AgentCliMatch {
    let exe_target = std::fs::read_link(proc_dir.join(pid.to_string()).join("exe")).ok();
    let exe_name = exe_target
        .as_deref()
        .and_then(Path::file_name)
        .and_then(|name| name.to_str());

    let cmdline = std::fs::read(proc_dir.join(pid.to_string()).join("cmdline")).ok();
    let mut args = cmdline
        .as_deref()
        .unwrap_or_default()
        .split(|&byte| byte == 0);
    let arg0 = args.next().and_then(|arg| std::str::from_utf8(arg).ok());
    let arg0_name = arg0
        .and_then(|arg| Path::new(arg).file_name())
        .and_then(|name| name.to_str());
    let arg1 = args.next().and_then(|arg| std::str::from_utf8(arg).ok());

    let comm = comm.trim();
    let codex = matches!(comm, "codex" | "codex-cli")
        || matches!(exe_name, Some("codex" | "codex-cli"))
        || matches!(arg0_name, Some("codex" | "codex-cli"));
    let claude = matches!(comm, "claude" | "claude-code")
        || matches!(exe_name, Some("claude" | "claude-code"))
        || matches!(arg0_name, Some("claude" | "claude-code"))
        || (arg0_name == Some("node")
            && arg1.is_some_and(|script| script.contains("@anthropic-ai/claude-code")));

    match (codex, claude) {
        (false, false) => AgentCliMatch::None,
        (true, false) => AgentCliMatch::Codex,
        (false, true) => AgentCliMatch::Claude,
        (true, true) => AgentCliMatch::Ambiguous,
    }
}

/// Determine whether a process in `/proc` corresponds unambiguously to the requested native
/// agent CLI executable.
pub fn is_agent_cli_process(proc_dir: &Path, pid: u32, comm: &str, agent_kind: AgentKind) -> bool {
    matches!(
        (agent_kind, classify_agent_cli_process(proc_dir, pid, comm)),
        (AgentKind::Codex, AgentCliMatch::Codex) | (AgentKind::Claude, AgentCliMatch::Claude)
    )
}

pub(super) fn is_any_agent_cli_process(proc_dir: &Path, pid: u32, comm: &str) -> bool {
    !matches!(
        classify_agent_cli_process(proc_dir, pid, comm),
        AgentCliMatch::None
    )
}

/// Trace parent process ancestry from a given `/proc` directory starting at `start_pid`,
/// selecting the actual agent CLI root and collecting the full parent chain up to root.
///
/// Returns `(agent_cli_root, ancestry_chain)` where:
/// - `ancestry_chain` is ordered from `start_pid` (the reporter) upwards to root.
/// - `agent_cli_root` is the verified agent CLI process in the ancestry.
///
/// Fails closed (returns `None`) if no agent CLI process is found in the ancestry chain.
pub fn resolve_process_ancestry_from(
    proc_dir: &Path,
    start_pid: u32,
    agent_kind: AgentKind,
) -> Option<(ProcessIdentity, Vec<ProcessIdentity>)> {
    let mut current_pid = start_pid;
    let mut ancestry: Vec<ProcessIdentity> = Vec::new();
    let mut visited: HashSet<u32> = HashSet::new();
    let mut agent_cli_root: Option<ProcessIdentity> = None;

    for _ in 0..MAX_ANCESTRY_DEPTH {
        if !visited.insert(current_pid) {
            // Cycle detected
            break;
        }

        let stat = read_process_stat(proc_dir, current_pid).ok()?;
        let identity = ProcessIdentity {
            pid: stat.pid,
            start_ticks: stat.start_ticks,
        };
        ancestry.push(identity);

        // Exclude the reporter executable itself, even though its later CLI arguments name the
        // integration kind. Every other native agent CLI in the live chain must be the sole
        // process matching the requested kind; mixed-kind and same-kind nesting are ambiguous.
        if stat.pid != start_pid {
            match (
                agent_kind,
                classify_agent_cli_process(proc_dir, stat.pid, &stat.comm),
            ) {
                (AgentKind::Codex, AgentCliMatch::Codex)
                | (AgentKind::Claude, AgentCliMatch::Claude) => {
                    if agent_cli_root.replace(identity).is_some() {
                        return None;
                    }
                }
                (_, AgentCliMatch::None) => {}
                _ => return None,
            }
        }

        // Reached root of user hierarchy / container boundary
        if stat.ppid <= 1 {
            break;
        }

        current_pid = stat.ppid;
    }

    // Reporter process must have at least one parent
    if ancestry.len() < 2 {
        return None;
    }

    // Fails closed if the agent CLI root was not verified among ancestry
    let root_process = agent_cli_root?;
    Some((root_process, ancestry))
}

/// Probe process identity and ancestry on Linux from `/proc`.
#[cfg(target_os = "linux")]
pub fn resolve_process_ancestry(
    agent_kind: AgentKind,
) -> Option<(ProcessIdentity, Vec<ProcessIdentity>)> {
    resolve_process_ancestry_from(Path::new("/proc"), std::process::id(), agent_kind)
}

/// Fail closed on non-Linux platforms where `/proc/<pid>/stat` is unavailable.
#[cfg(not(target_os = "linux"))]
pub fn resolve_process_ancestry(
    _agent_kind: AgentKind,
) -> Option<(ProcessIdentity, Vec<ProcessIdentity>)> {
    None
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::fs;
    use tempfile::tempdir;

    fn write_mock_process(
        proc_path: &Path,
        pid: u32,
        ppid: u32,
        comm: &str,
        ticks: u64,
        cmdline: &[&str],
    ) {
        let process_path = proc_path.join(pid.to_string());
        fs::create_dir_all(&process_path).unwrap();
        fs::write(
            process_path.join("stat"),
            format!("{pid} ({comm}) S {ppid} 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 {ticks} 0 0\n"),
        )
        .unwrap();

        if !cmdline.is_empty() {
            let mut bytes = Vec::new();
            for arg in cmdline {
                bytes.extend_from_slice(arg.as_bytes());
                bytes.push(0);
            }
            fs::write(process_path.join("cmdline"), bytes).unwrap();
        }
    }

    fn assert_mixed_reporter_tree_rejected(
        inner_kind: AgentKind,
        inner_comm: &str,
        outer_kind: AgentKind,
        outer_comm: &str,
        hook_arg: &str,
    ) {
        let dir = tempdir().unwrap();
        let proc_path = dir.path();
        write_mock_process(proc_path, 100, 1, "bash", 1000, &[]);
        write_mock_process(proc_path, 200, 100, outer_comm, 2000, &[]);
        write_mock_process(proc_path, 300, 200, inner_comm, 3000, &[]);
        write_mock_process(
            proc_path,
            400,
            300,
            "dam-hopper-serv",
            4000,
            &[
                "/usr/bin/dam-hopper-server",
                "integration",
                hook_arg,
                "report-hook",
            ],
        );

        // Agent names in later reporter arguments are not executable evidence.
        assert!(!is_any_agent_cli_process(proc_path, 400, "dam-hopper-serv"));

        // The opposite CLI is respectively an ancestor and a descendant of the claimed root.
        assert!(resolve_process_ancestry_from(proc_path, 400, inner_kind).is_none());
        assert!(resolve_process_ancestry_from(proc_path, 400, outer_kind).is_none());
    }

    #[test]
    fn test_parse_report_hook_args_valid() {
        let args1 = vec![
            "dam-hopper-server".to_string(),
            "integration".to_string(),
            "codex".to_string(),
            "report-hook".to_string(),
        ];
        assert_eq!(parse_report_hook_args(&args1), Some(AgentKind::Codex));

        let args2 = vec![
            "/usr/local/bin/dam-hopper-server".to_string(),
            "integration".to_string(),
            "claude".to_string(),
            "report-hook".to_string(),
        ];
        assert_eq!(parse_report_hook_args(&args2), Some(AgentKind::Claude));
    }

    #[test]
    fn test_parse_report_hook_args_invalid() {
        let args = vec![
            "dam-hopper-server".to_string(),
            "integration".to_string(),
            "omp".to_string(),
            "status".to_string(),
        ];
        assert_eq!(parse_report_hook_args(&args), None);

        let args2 = vec![
            "dam-hopper-server".to_string(),
            "integration".to_string(),
            "codex".to_string(),
            "install".to_string(),
        ];
        assert_eq!(parse_report_hook_args(&args2), None);

        let empty: Vec<String> = vec![];
        assert_eq!(parse_report_hook_args(&empty), None);
    }

    #[test]
    fn test_validate_and_derive_post_endpoint_valid_ipv4() {
        let url = "ws://127.0.0.1:4800/v1/agent-status";
        let (addr, host) = validate_and_derive_post_endpoint(url).expect("valid ipv4");
        assert_eq!(addr, "127.0.0.1:4800".parse().unwrap());
        assert_eq!(host, "127.0.0.1:4800");
    }

    #[test]
    fn test_validate_and_derive_post_endpoint_valid_localhost() {
        let url = "ws://localhost:9000/v1/agent-status";
        let (addr, host) = validate_and_derive_post_endpoint(url).expect("valid localhost");
        assert_eq!(addr, "127.0.0.1:9000".parse().unwrap());
        assert_eq!(host, "localhost:9000");
    }

    #[test]
    fn test_validate_and_derive_post_endpoint_valid_ipv6() {
        let url = "ws://[::1]:5500/v1/agent-status";
        let (addr, host) = validate_and_derive_post_endpoint(url).expect("valid ipv6");
        assert_eq!(addr, "[::1]:5500".parse().unwrap());
        assert_eq!(host, "[::1]:5500");
    }

    #[test]
    fn test_validate_and_derive_post_endpoint_rejects_non_loopback() {
        assert!(
            validate_and_derive_post_endpoint("ws://192.168.1.50:4800/v1/agent-status").is_none()
        );
        assert!(
            validate_and_derive_post_endpoint("ws://example.com:4800/v1/agent-status").is_none()
        );
    }

    #[test]
    fn test_validate_and_derive_post_endpoint_rejects_query_and_fragment() {
        assert!(validate_and_derive_post_endpoint(
            "ws://127.0.0.1:4800/v1/agent-status?token=secret"
        )
        .is_none());
        assert!(
            validate_and_derive_post_endpoint("ws://127.0.0.1:4800/v1/agent-status#fragment")
                .is_none()
        );
    }

    #[test]
    fn test_validate_and_derive_post_endpoint_rejects_wrong_scheme_and_path() {
        assert!(
            validate_and_derive_post_endpoint("http://127.0.0.1:4800/v1/agent-status").is_none()
        );
        assert!(validate_and_derive_post_endpoint("ws://127.0.0.1:4800/v1/agent-hooks").is_none());
        assert!(
            validate_and_derive_post_endpoint("ws://127.0.0.1:4800/v1/agent-status/extra")
                .is_none()
        );
    }

    #[test]
    fn test_normalize_and_allowlist_event_codex() {
        assert_eq!(
            normalize_and_allowlist_event(AgentKind::Codex, "SessionStart"),
            Some("SessionStart")
        );
        assert_eq!(
            normalize_and_allowlist_event(AgentKind::Codex, "session_start"),
            Some("SessionStart")
        );
        assert_eq!(
            normalize_and_allowlist_event(AgentKind::Codex, "Interrupt"),
            Some("Interrupt")
        );
        // Codex does not have Notification or StopFailure
        assert_eq!(
            normalize_and_allowlist_event(AgentKind::Codex, "Notification"),
            None
        );
        assert_eq!(
            normalize_and_allowlist_event(AgentKind::Codex, "StopFailure"),
            None
        );
        assert_eq!(
            normalize_and_allowlist_event(AgentKind::Codex, "UnknownCustom"),
            None
        );
    }

    #[test]
    fn test_normalize_and_allowlist_event_claude() {
        assert_eq!(
            normalize_and_allowlist_event(AgentKind::Claude, "SessionStart"),
            Some("SessionStart")
        );
        assert_eq!(
            normalize_and_allowlist_event(AgentKind::Claude, "Notification"),
            Some("Notification")
        );
        assert_eq!(
            normalize_and_allowlist_event(AgentKind::Claude, "StopFailure"),
            Some("StopFailure")
        );
        // Claude does not have Interrupt hook
        assert_eq!(
            normalize_and_allowlist_event(AgentKind::Claude, "Interrupt"),
            None
        );
        assert_eq!(
            normalize_and_allowlist_event(AgentKind::Claude, "UnknownCustom"),
            None
        );
    }

    #[test]
    fn test_resolve_process_ancestry_mock() {
        let dir = tempdir().unwrap();
        let proc_path = dir.path();

        // Create mock /proc hierarchy:
        // PID 100: ppid=1, comm="bash" (PTY shell)
        // PID 200: ppid=100, comm="codex" (agent CLI)
        // PID 300: ppid=200, comm="dam-hopper-serv" (reporter CLI)
        let make_stat = |pid: u32, ppid: u32, comm: &str, ticks: u64| {
            format!("{pid} ({comm}) S {ppid} 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 {ticks} 0 0\n")
        };

        fs::create_dir_all(proc_path.join("100")).unwrap();
        fs::write(proc_path.join("100/stat"), make_stat(100, 1, "bash", 1000)).unwrap();

        fs::create_dir_all(proc_path.join("200")).unwrap();
        fs::write(
            proc_path.join("200/stat"),
            make_stat(200, 100, "codex", 2000),
        )
        .unwrap();

        fs::create_dir_all(proc_path.join("300")).unwrap();
        fs::write(
            proc_path.join("300/stat"),
            make_stat(300, 200, "dam-hopper-serv", 3000),
        )
        .unwrap();

        // Codex resolve: selects actual agent CLI root (PID 200), not PTY shell (PID 100) or PID 1
        let (agent_root, ancestry) =
            resolve_process_ancestry_from(proc_path, 300, AgentKind::Codex)
                .expect("should resolve codex CLI root");
        assert_eq!(
            agent_root,
            ProcessIdentity {
                pid: 200,
                start_ticks: 2000
            }
        );
        assert_eq!(ancestry.len(), 3);
        assert_eq!(
            ancestry[0],
            ProcessIdentity {
                pid: 300,
                start_ticks: 3000
            }
        );
        assert_eq!(
            ancestry[1],
            ProcessIdentity {
                pid: 200,
                start_ticks: 2000
            }
        );
        assert_eq!(
            ancestry[2],
            ProcessIdentity {
                pid: 100,
                start_ticks: 1000
            }
        );

        // Claude resolve on same tree fails closed because no claude CLI process exists in ancestry
        assert!(resolve_process_ancestry_from(proc_path, 300, AgentKind::Claude).is_none());
    }

    #[test]
    fn test_resolve_process_ancestry_rejects_codex_nested_under_claude() {
        assert_mixed_reporter_tree_rejected(
            AgentKind::Codex,
            "codex",
            AgentKind::Claude,
            "claude",
            "codex",
        );
    }

    #[test]
    fn test_resolve_process_ancestry_rejects_claude_nested_under_codex() {
        assert_mixed_reporter_tree_rejected(
            AgentKind::Claude,
            "claude",
            AgentKind::Codex,
            "codex",
            "claude",
        );
    }

    #[test]
    fn test_resolve_process_ancestry_cycle_prevention() {
        let dir = tempdir().unwrap();
        let proc_path = dir.path();

        // PID 500: ppid=600, comm="codex"
        // PID 600: ppid=500 (cycle)
        let make_stat = |pid: u32, ppid: u32, comm: &str, ticks: u64| {
            format!("{pid} ({comm}) S {ppid} 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 {ticks} 0 0\n")
        };

        fs::create_dir_all(proc_path.join("500")).unwrap();
        fs::write(
            proc_path.join("500/stat"),
            make_stat(500, 600, "codex", 5000),
        )
        .unwrap();

        fs::create_dir_all(proc_path.join("600")).unwrap();
        fs::write(proc_path.join("600/stat"), make_stat(600, 500, "sh", 6000)).unwrap();

        // Cycle terminates safely, selecting the detected agent CLI root
        let (root, ancestry) = resolve_process_ancestry_from(proc_path, 600, AgentKind::Codex)
            .expect("terminates on cycle and finds codex");
        assert_eq!(ancestry.len(), 2);
        assert_eq!(
            root,
            ProcessIdentity {
                pid: 500,
                start_ticks: 5000
            }
        );
    }

    #[test]
    fn test_native_hook_input_discards_sensitive_fields() {
        let raw_json = serde_json::json!({
            "session_id": "test-session-123",
            "hook_event_name": "UserPromptSubmit",
            "turn_id": "turn-456",
            "prompt": "SENSITIVE_SECRET_PROMPT_DO_NOT_RETAIN",
            "cwd": "/home/user/super_secret_dir",
            "transcript_path": "/var/log/secret.jsonl",
            "last_assistant_message": "SENSITIVE_ASSISTANT_TEXT",
            "reason": "SENSITIVE_RAW_REASON_DO_NOT_RETAIN",
        });
        let bytes = serde_json::to_vec(&raw_json).unwrap();
        let input: NativeHookInput = serde_json::from_slice(&bytes).expect("should parse");
        assert_eq!(input.session_id.as_deref(), Some("test-session-123"));
        assert_eq!(input.hook_event_name.as_deref(), Some("UserPromptSubmit"));
        assert_eq!(input.turn_id.as_deref(), Some("turn-456"));
    }

    #[test]
    fn test_subagent_child_marker_detection() {
        let root_payload = serde_json::json!({
            "session_id": "sess-1",
            "hook_event_name": "UserPromptSubmit"
        });
        let input: NativeHookInput = serde_json::from_value(root_payload).unwrap();
        assert!(!input.agent_id);
        assert!(!input.agent_type);

        // Even an empty string or null in agent_id/agent_type is detected and rejected
        let empty_child_payload = serde_json::json!({
            "session_id": "sess-1",
            "hook_event_name": "UserPromptSubmit",
            "agent_id": ""
        });
        let input_empty: NativeHookInput = serde_json::from_value(empty_child_payload).unwrap();
        assert!(input_empty.agent_id || input_empty.agent_type);

        let null_child_payload = serde_json::json!({
            "session_id": "sess-1",
            "hook_event_name": "UserPromptSubmit",
            "agent_type": null
        });
        let input_null: NativeHookInput = serde_json::from_value(null_child_payload).unwrap();
        assert!(input_null.agent_id || input_null.agent_type);
    }

    struct PanicOnRead;

    impl Read for PanicOnRead {
        fn read(&mut self, _buffer: &mut [u8]) -> std::io::Result<usize> {
            panic!("unmanaged report hook must not read stdin")
        }
    }

    #[tokio::test]
    async fn test_unmanaged_report_hook_does_not_read_open_stdin() {
        // A missing private environment returns before touching a reader that could stay open.
        let result = execute_report_hook_internal(AgentKind::Codex, PanicOnRead).await;
        assert!(result.is_err());
    }
}
