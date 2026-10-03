use std::path::Path;
use std::time::Instant;

use super::types::{
    validate_opaque_id, AgentKind, AgentStatusError, PrivateHookEnvelope, BURST_REPORTS,
    MAX_ANCESTRY_DEPTH, MAX_REPORTS_PER_SEC,
};
use crate::pty::activity::ProcessIdentity;

/// Token-bucket rate limiter enforcing 20 reports/sec replenishment with burst 40,
/// keyed by terminal ID and incarnation.
#[derive(Debug, Clone)]
pub struct TokenRateLimiter {
    tokens: f64,
    last_tick: Instant,
}

impl Default for TokenRateLimiter {
    fn default() -> Self {
        Self::new()
    }
}

impl TokenRateLimiter {
    /// Create a new limiter with full burst capacity.
    pub fn new() -> Self {
        Self {
            tokens: BURST_REPORTS as f64,
            last_tick: Instant::now(),
        }
    }

    /// Check if at least one token is available, replenishing according to elapsed time.
    /// Consumes one token if available and returns true; otherwise returns false without consuming.
    pub fn check_and_consume(&mut self) -> bool {
        let now = Instant::now();
        let elapsed = now.duration_since(self.last_tick).as_secs_f64();
        self.last_tick = now;
        self.tokens =
            (self.tokens + elapsed * (MAX_REPORTS_PER_SEC as f64)).min(BURST_REPORTS as f64);
        if self.tokens >= 1.0 {
            self.tokens -= 1.0;
            true
        } else {
            false
        }
    }
}

/// Validate that a hook envelope adheres to protocol version and identifier constraints.
pub fn validate_hook_envelope(envelope: &PrivateHookEnvelope) -> Result<(), AgentStatusError> {
    if envelope.version != super::types::AGENT_STATUS_PROTOCOL_VERSION {
        return Err(AgentStatusError::VersionMismatch {
            expected: super::types::AGENT_STATUS_PROTOCOL_VERSION,
            actual: envelope.version,
        });
    }

    // Only Codex and Claude native hook ingress is permitted
    match envelope.agent_kind {
        AgentKind::Codex => {
            if super::codex_hooks::normalize_codex_event(&envelope.event).is_none() {
                return Err(AgentStatusError::AuthorityLost(format!(
                    "unqualified Codex event: {}",
                    envelope.event
                )));
            }
            if envelope.reason.is_some() {
                return Err(AgentStatusError::AuthorityLost(
                    "Codex hook events cannot carry blocked reasons".to_string(),
                ));
            }
            if envelope.notification_type.is_some() {
                return Err(AgentStatusError::AuthorityLost(
                    "Codex hook events cannot carry notification types".to_string(),
                ));
            }
        }
        AgentKind::Claude => {
            if super::claude_hooks::normalize_claude_event(&envelope.event).is_none() {
                return Err(AgentStatusError::AuthorityLost(format!(
                    "unqualified Claude event: {}",
                    envelope.event
                )));
            }
            if envelope.event == "Notification" && envelope.notification_type.is_none() {
                return Err(AgentStatusError::AuthorityLost(
                    "Claude Notification event requires notification_type".to_string(),
                ));
            }
            if envelope.reason.is_some() && envelope.event != "Notification" && envelope.event != "StopFailure" {
                return Err(AgentStatusError::AuthorityLost(
                    "Claude hook events cannot carry blocked reasons outside Notification and StopFailure".to_string(),
                ));
            }
        }
        AgentKind::Omp => {
            return Err(AgentStatusError::AuthorityLost(
                "unsupported agent kind for hook ingress".to_string(),
            ));
        }
    }

    validate_opaque_id("agent_session_id", &envelope.agent_session_id)?;
    validate_opaque_id("event_id", &envelope.event_id)?;
    validate_opaque_id("adapter_version", &envelope.adapter_version)?;

    if let Some(turn_id) = &envelope.turn_id {
        validate_opaque_id("turn_id", turn_id)?;
    }
    if let Some(tool_call_id) = &envelope.tool_call_id {
        validate_opaque_id("tool_call_id", tool_call_id)?;
    }
    if let Some(notification_type) = &envelope.notification_type {
        validate_opaque_id("notification_type", notification_type)?;
    }

    Ok(())
}

/// Match the same CLI evidence used by the reporter. A generic Node process
/// is not evidence that Claude Code owns the terminal.
fn is_agent_process(proc_dir: &Path, pid: u32, comm: &str, agent_kind: AgentKind) -> bool {
    super::hook_reporter::is_agent_cli_process(proc_dir, pid, comm, agent_kind)
}

fn is_any_agent_process(proc_dir: &Path, pid: u32, comm: &str) -> bool {
    super::hook_reporter::is_any_agent_cli_process(proc_dir, pid, comm)
}

fn is_codex_managed_daemon(proc_dir: &Path, pid: u32) -> bool {
    let Ok(cmdline) = std::fs::read(proc_dir.join(pid.to_string()).join("cmdline")) else {
        return false;
    };
    let args: Vec<&[u8]> = cmdline
        .split(|&byte| byte == 0)
        .filter(|arg| !arg.is_empty())
        .collect();
    let Some(arg0) = args.first().and_then(|arg| std::str::from_utf8(arg).ok()) else {
        return false;
    };
    let arg0_name = Path::new(arg0).file_name().and_then(|name| name.to_str());
    let is_codex = matches!(arg0_name, Some("codex" | "codex-cli"));
    let has_app_server = args
        .iter()
        .skip(1)
        .any(|arg| *arg == b"app-server");
    let is_managed = args
        .iter()
        .skip(1)
        .any(|arg| *arg == b"--managed-daemon");
    is_codex && has_app_server && is_managed
}

/// Verify that the reporter's reported agent CLI root and the registered PTY shell root
/// form a valid, verifiable ancestry chain in /proc on Linux.
///
/// Rejects nested native agent CLIs regardless of whether they match the claimed kind.
/// This function executes entirely outside runtime and registry mutexes to prevent locking bottlenecks.
#[cfg(target_os = "linux")]
pub fn verify_reporter_ancestry(
    proc_dir: &Path,
    peer_pid: u32,
    registered_root: ProcessIdentity,
    envelope: &PrivateHookEnvelope,
) -> Result<(), AgentStatusError> {
    use crate::pty::activity::read_process_stat;

    // 1. Peer PID must equal envelope.process_ancestry[0].pid (leaf reporter)
    if envelope.process_ancestry.is_empty() {
        return Err(AgentStatusError::UnverifiableProcessAncestry(
            "empty process ancestry in hook envelope".to_string(),
        ));
    }

    let claimed_leaf = &envelope.process_ancestry[0];
    if claimed_leaf.pid != peer_pid {
        return Err(AgentStatusError::UnverifiableProcessAncestry(format!(
            "UDS peer PID {peer_pid} does not match claimed leaf PID {}",
            claimed_leaf.pid
        )));
    }

    // 2. Verify leaf process in /proc
    let leaf_stat = read_process_stat(proc_dir, peer_pid).map_err(|e| {
        AgentStatusError::UnverifiableProcessAncestry(format!(
            "failed to read reporter process {peer_pid} from {}: {e}",
            proc_dir.display()
        ))
    })?;

    if leaf_stat.start_ticks != claimed_leaf.start_ticks {
        return Err(AgentStatusError::UnverifiableProcessAncestry(format!(
            "reporter process {peer_pid} start ticks mismatch (PID reused): expected {}, got {}",
            claimed_leaf.start_ticks, leaf_stat.start_ticks
        )));
    }

    // Codex 0.160+ can run hooks from a shared app-server daemon detached from the
    // launching terminal (PPID 1). The daemon may inherit the terminal capability,
    // but process ancestry can no longer prove which DamHopper PTY owns the hook.
    // Fail closed with actionable guidance instead of weakening terminal isolation.
    if envelope.agent_kind == AgentKind::Codex
        && !envelope.process_ancestry.contains(&registered_root)
        && is_codex_managed_daemon(proc_dir, envelope.root_process.pid)
    {
        return Err(AgentStatusError::UnverifiableProcessAncestry(
            "Codex shared managed daemon is detached from the DamHopper PTY; launch Codex with `codex --no-daemon` for terminal-scoped status tracking".to_string(),
        ));
    }

    // 3. Chain length check: reporter, agent CLI root, and PTY shell root required
    if envelope.process_ancestry.len() < 3 || envelope.process_ancestry.len() > MAX_ANCESTRY_DEPTH {
        return Err(AgentStatusError::UnverifiableProcessAncestry(
            "reporter, agent and PTY root ancestry required".to_string(),
        ));
    }

    // 4. Find agent CLI root and PTY shell root in the reported ancestry
    let Some(agent_idx) = envelope
        .process_ancestry
        .iter()
        .position(|p| *p == envelope.root_process)
    else {
        return Err(AgentStatusError::UnverifiableProcessAncestry(
            "claimed agent CLI root not found in reported ancestry chain".to_string(),
        ));
    };

    let Some(pty_root_idx) = envelope
        .process_ancestry
        .iter()
        .position(|p| *p == registered_root)
    else {
        return Err(AgentStatusError::UnverifiableProcessAncestry(
            "registered PTY shell root not found in reported ancestry chain".to_string(),
        ));
    };

    // 5. Agent CLI must be a descendant of the PTY shell root (leaf-to-root ordering)
    if agent_idx >= pty_root_idx {
        return Err(AgentStatusError::UnverifiableProcessAncestry(
            "agent CLI root must be a descendant of the PTY shell root".to_string(),
        ));
    }

    // 6. Verify registered PTY shell root in /proc
    let shell_stat = read_process_stat(proc_dir, registered_root.pid).map_err(|e| {
        AgentStatusError::UnverifiableProcessAncestry(format!(
            "failed to read PTY shell process {} from {}: {e}",
            registered_root.pid,
            proc_dir.display()
        ))
    })?;

    if shell_stat.start_ticks != registered_root.start_ticks {
        return Err(AgentStatusError::UnverifiableProcessAncestry(format!(
            "PTY shell process {} start ticks mismatch (PID reused): expected {}, got {}",
            registered_root.pid, registered_root.start_ticks, shell_stat.start_ticks
        )));
    }

    // 7. Verify agent CLI root in /proc
    let agent_stat = read_process_stat(proc_dir, envelope.root_process.pid).map_err(|e| {
        AgentStatusError::UnverifiableProcessAncestry(format!(
            "failed to read agent CLI process {} from {}: {e}",
            envelope.root_process.pid,
            proc_dir.display()
        ))
    })?;

    if agent_stat.start_ticks != envelope.root_process.start_ticks {
        return Err(AgentStatusError::UnverifiableProcessAncestry(format!(
            "agent CLI process {} start ticks mismatch (PID reused): expected {}, got {}",
            envelope.root_process.pid, envelope.root_process.start_ticks, agent_stat.start_ticks
        )));
    }

    // Verify that the agent CLI process actually matches the reported agent kind (executable or comm)
    if !is_agent_process(
        proc_dir,
        envelope.root_process.pid,
        &agent_stat.comm,
        envelope.agent_kind,
    ) {
        return Err(AgentStatusError::UnverifiableProcessAncestry(format!(
            "process {} (comm '{}') does not match expected agent executable for {:?}",
            envelope.root_process.pid, agent_stat.comm, envelope.agent_kind
        )));
    }

    // 8. Reject every additional native agent CLI between the reporter and registered PTY root.
    // Checking both kinds prevents a nested Codex-under-Claude (or inverse) from selecting the
    // inner process as an apparently valid root.
    for (i, process) in envelope.process_ancestry[..=pty_root_idx]
        .iter()
        .enumerate()
    {
        if i == agent_idx {
            continue;
        }
        if let Ok(stat) = read_process_stat(proc_dir, process.pid) {
            if stat.start_ticks == process.start_ticks
                && is_any_agent_process(proc_dir, process.pid, &stat.comm)
            {
                return Err(AgentStatusError::UnverifiableProcessAncestry(format!(
                    "additional native agent process {} in reporter-to-PTY ancestry rejected",
                    process.pid
                )));
            }
        }
    }

    // 9. Verify the complete chain, including the short-lived reporter.
    for i in 0..pty_root_idx {
        let child = &envelope.process_ancestry[i];
        let parent = &envelope.process_ancestry[i + 1];

        match read_process_stat(proc_dir, child.pid) {
            Ok(stat) => {
                if stat.start_ticks != child.start_ticks {
                    return Err(AgentStatusError::UnverifiableProcessAncestry(format!(
                        "ancestry process {} start ticks mismatch",
                        child.pid
                    )));
                }
                if stat.ppid != parent.pid {
                    return Err(AgentStatusError::UnverifiableProcessAncestry(format!(
                        "broken ancestry link: pid {} has ppid {}, expected {}",
                        child.pid, stat.ppid, parent.pid
                    )));
                }
            }
            Err(e) => {
                return Err(AgentStatusError::UnverifiableProcessAncestry(format!(
                    "ancestry process {} not found in /proc: {e}",
                    child.pid
                )));
            }
        }
    }

    Ok(())
}

/// On non-Linux platforms, process ancestry verification is unavailable and fails closed.
#[cfg(not(target_os = "linux"))]
pub fn verify_reporter_ancestry(
    _proc_dir: &Path,
    _peer_pid: u32,
    _registered_root: ProcessIdentity,
    _envelope: &PrivateHookEnvelope,
) -> Result<(), AgentStatusError> {
    Err(AgentStatusError::NonLinuxPlatformUnqualified)
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

    fn mixed_envelope(agent_kind: AgentKind, root_process: ProcessIdentity) -> PrivateHookEnvelope {
        PrivateHookEnvelope {
            version: 1,
            agent_kind,
            adapter_version: "1.0.0".to_string(),
            event_id: "evt-mixed".to_string(),
            event: "SessionStart".to_string(),
            agent_session_id: "sess-mixed".to_string(),
            turn_id: None,
            tool_call_id: None,
            reason: None,
            notification_type: None,
            root_process,
            process_ancestry: vec![
                ProcessIdentity {
                    pid: 400,
                    start_ticks: 4000,
                },
                ProcessIdentity {
                    pid: 300,
                    start_ticks: 3000,
                },
                ProcessIdentity {
                    pid: 200,
                    start_ticks: 2000,
                },
                ProcessIdentity {
                    pid: 100,
                    start_ticks: 1000,
                },
            ],
        }
    }

    fn assert_mixed_ingress_tree_rejected(
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

        // The reporter's later provider argument must not be mistaken for executable evidence.
        assert!(!is_any_agent_process(proc_path, 400, "dam-hopper-serv"));

        let pty_root = ProcessIdentity {
            pid: 100,
            start_ticks: 1000,
        };
        let inner_envelope = mixed_envelope(
            inner_kind,
            ProcessIdentity {
                pid: 300,
                start_ticks: 3000,
            },
        );
        let outer_envelope = mixed_envelope(
            outer_kind,
            ProcessIdentity {
                pid: 200,
                start_ticks: 2000,
            },
        );

        // Reject the opposite CLI both above and below the claimed root.
        assert!(verify_reporter_ancestry(proc_path, 400, pty_root, &inner_envelope).is_err());
        assert!(verify_reporter_ancestry(proc_path, 400, pty_root, &outer_envelope).is_err());
    }

    #[test]
    fn test_token_rate_limiter() {
        let mut limiter = TokenRateLimiter::new();
        // Full capacity should allow consumes
        for _ in 0..BURST_REPORTS {
            assert!(limiter.check_and_consume());
        }
        // Exhausted
        assert!(!limiter.check_and_consume());
    }

    #[test]
    fn test_validate_hook_envelope_valid() {
        let envelope = PrivateHookEnvelope {
            version: 1,
            agent_kind: AgentKind::Codex,
            adapter_version: "1.0.0".to_string(),
            event_id: "evt-1".to_string(),
            event: "SessionStart".to_string(),
            agent_session_id: "sess-1".to_string(),
            turn_id: Some("turn-1".to_string()),
            tool_call_id: None,
            reason: None,
            notification_type: None,
            root_process: ProcessIdentity {
                pid: 200,
                start_ticks: 2000,
            },
            process_ancestry: vec![
                ProcessIdentity {
                    pid: 300,
                    start_ticks: 3000,
                },
                ProcessIdentity {
                    pid: 200,
                    start_ticks: 2000,
                },
                ProcessIdentity {
                    pid: 100,
                    start_ticks: 1000,
                },
            ],
        };
        assert!(validate_hook_envelope(&envelope).is_ok());
    }

    #[test]
    fn test_validate_hook_envelope_rejects_omp() {
        let envelope = PrivateHookEnvelope {
            version: 1,
            agent_kind: AgentKind::Omp,
            adapter_version: "1.0.0".to_string(),
            event_id: "evt-1".to_string(),
            event: "SessionStart".to_string(),
            agent_session_id: "sess-1".to_string(),
            turn_id: None,
            tool_call_id: None,
            reason: None,
            notification_type: None,
            root_process: ProcessIdentity {
                pid: 200,
                start_ticks: 2000,
            },
            process_ancestry: vec![],
        };
        assert!(validate_hook_envelope(&envelope).is_err());
    }

    #[test]
    fn test_verify_reporter_ancestry_reports_codex_managed_daemon_incompatibility() {
        let dir = tempdir().unwrap();
        let proc_path = dir.path();

        write_mock_process(proc_path, 100, 1, "bash", 1000, &["/bin/bash"]);
        write_mock_process(
            proc_path,
            200,
            1,
            "codex",
            2000,
            &[
                "/home/test/.codex/packages/app-server-daemon/releases/0.160.0/bin/codex",
                "app-server",
                "--listen",
                "unix://",
                "--managed-daemon",
            ],
        );
        write_mock_process(
            proc_path,
            300,
            200,
            "dam-hopper-serv",
            3000,
            &[
                "/opt/dam-hopper/bin/dam-hopper-server",
                "integration",
                "codex",
                "report-hook",
            ],
        );

        let envelope = PrivateHookEnvelope {
            version: 1,
            agent_kind: AgentKind::Codex,
            adapter_version: "1.0.0".to_string(),
            event_id: "evt-daemon".to_string(),
            event: "UserPromptSubmit".to_string(),
            agent_session_id: "sess-daemon".to_string(),
            turn_id: Some("turn-1".to_string()),
            tool_call_id: None,
            reason: None,
            notification_type: None,
            root_process: ProcessIdentity {
                pid: 200,
                start_ticks: 2000,
            },
            process_ancestry: vec![
                ProcessIdentity {
                    pid: 300,
                    start_ticks: 3000,
                },
                ProcessIdentity {
                    pid: 200,
                    start_ticks: 2000,
                },
            ],
        };

        let err = verify_reporter_ancestry(
            proc_path,
            300,
            ProcessIdentity {
                pid: 100,
                start_ticks: 1000,
            },
            &envelope,
        )
        .expect_err("detached managed daemon must fail closed");

        assert!(
            err.to_string().contains("codex --no-daemon"),
            "error should provide the supported compatibility mode: {err}"
        );
    }

    #[test]
    fn test_verify_reporter_ancestry_mock() {
        let dir = tempdir().unwrap();
        let proc_path = dir.path();

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
            make_stat(300, 200, "dh-reporter", 3000),
        )
        .unwrap();

        let envelope = PrivateHookEnvelope {
            version: 1,
            agent_kind: AgentKind::Codex,
            adapter_version: "1.0.0".to_string(),
            event_id: "evt-1".to_string(),
            event: "SessionStart".to_string(),
            agent_session_id: "sess-1".to_string(),
            turn_id: Some("turn-1".to_string()),
            tool_call_id: None,
            reason: None,
            notification_type: None,
            root_process: ProcessIdentity {
                pid: 200,
                start_ticks: 2000,
            },
            process_ancestry: vec![
                ProcessIdentity {
                    pid: 300,
                    start_ticks: 3000,
                },
                ProcessIdentity {
                    pid: 200,
                    start_ticks: 2000,
                },
                ProcessIdentity {
                    pid: 100,
                    start_ticks: 1000,
                },
            ],
        };

        let pty_root = ProcessIdentity {
            pid: 100,
            start_ticks: 1000,
        };

        // Valid peer_pid = 300 matches leaf
        assert!(verify_reporter_ancestry(proc_path, 300, pty_root, &envelope).is_ok());

        // Mismatched peer_pid = 999 rejected
        assert!(verify_reporter_ancestry(proc_path, 999, pty_root, &envelope).is_err());

        // Start ticks mismatch on leaf rejected
        let bad_leaf_envelope = PrivateHookEnvelope {
            process_ancestry: vec![
                ProcessIdentity {
                    pid: 300,
                    start_ticks: 9999,
                },
                ProcessIdentity {
                    pid: 200,
                    start_ticks: 2000,
                },
                ProcessIdentity {
                    pid: 100,
                    start_ticks: 1000,
                },
            ],
            ..envelope.clone()
        };
        assert!(verify_reporter_ancestry(proc_path, 300, pty_root, &bad_leaf_envelope).is_err());

        // A generic Node process is not sufficient evidence of Claude Code.
        fs::write(
            proc_path.join("200/stat"),
            make_stat(200, 100, "node", 2000),
        )
        .unwrap();
        let claude = PrivateHookEnvelope {
            agent_kind: AgentKind::Claude,
            ..envelope
        };
        assert!(verify_reporter_ancestry(proc_path, 300, pty_root, &claude).is_err());
    }

    #[test]
    fn test_verify_reporter_ancestry_rejects_codex_nested_under_claude() {
        assert_mixed_ingress_tree_rejected(
            AgentKind::Codex,
            "codex",
            AgentKind::Claude,
            "claude",
            "codex",
        );
    }

    #[test]
    fn test_verify_reporter_ancestry_rejects_claude_nested_under_codex() {
        assert_mixed_ingress_tree_rejected(
            AgentKind::Claude,
            "claude",
            AgentKind::Codex,
            "codex",
            "claude",
        );
    }
}
