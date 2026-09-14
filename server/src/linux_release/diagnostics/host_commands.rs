use std::future::Future;
use std::process::Stdio;
use std::time::Duration;
use tokio::io::AsyncReadExt;
use crate::linux_release::constants::{API_SERVICE_UNIT, HELPER_SERVICE_UNIT};
use super::model::{
    ActiveInhibitorProbeV1, BoundsV1, ProjectedJournalEntry, UnitStatusV1,
    COMMAND_DEADLINE_SECONDS, MAX_ACCEPTED_RECORDS_PER_SOURCE, MAX_COMMAND_STDOUT_BYTES,
};

/// Closed host command variants executable during diagnostic bundle collection.
#[derive(Clone, Debug, PartialEq, Eq)]
pub enum HostCommand {
    /// Inspect properties of dam-hopper-api.service via `systemctl show`.
    ShowApiUnit,
    /// Inspect properties of dam-hopper-idle-suspend-helper.service via `systemctl show`.
    ShowHelperUnit,
    /// Query journald entries for dam-hopper-api.service within requested window.
    JournalApi { since_ms: u64 },
    /// Query journald entries for dam-hopper-idle-suspend-helper.service within requested window.
    JournalHelper { since_ms: u64 },
    /// Query active inhibitors via `systemd-inhibit --list`.
    ListInhibitors,
}

/// Compiled specification for an immutable host command invocation.
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct CompiledCommand {
    pub program: String,
    pub args: Vec<String>,
    pub max_stdout_bytes: usize,
    pub deadline: Duration,
}

impl HostCommand {
    /// Compile the closed command to fixed executable, argv, stdout cap, and deadline.
    pub fn compile(&self) -> CompiledCommand {
        let deadline = Duration::from_secs(COMMAND_DEADLINE_SECONDS);
        let max_stdout_bytes = MAX_COMMAND_STDOUT_BYTES;

        match self {
            HostCommand::ShowApiUnit => CompiledCommand {
                program: "systemctl".to_string(),
                args: vec![
                    "show".to_string(),
                    API_SERVICE_UNIT.to_string(),
                    "--no-pager".to_string(),
                ],
                max_stdout_bytes,
                deadline,
            },
            HostCommand::ShowHelperUnit => CompiledCommand {
                program: "systemctl".to_string(),
                args: vec![
                    "show".to_string(),
                    HELPER_SERVICE_UNIT.to_string(),
                    "--no-pager".to_string(),
                ],
                max_stdout_bytes,
                deadline,
            },
            HostCommand::JournalApi { since_ms } => {
                let since_arg = if *since_ms > 0 {
                    format!("--since=@{}", since_ms / 1000)
                } else {
                    "--since=@0".to_string()
                };
                CompiledCommand {
                    program: "journalctl".to_string(),
                    args: vec![
                        "-u".to_string(),
                        API_SERVICE_UNIT.to_string(),
                        since_arg,
                        "--no-pager".to_string(),
                        "--output=json".to_string(),
                    ],
                    max_stdout_bytes,
                    deadline,
                }
            }
            HostCommand::JournalHelper { since_ms } => {
                let since_arg = if *since_ms > 0 {
                    format!("--since=@{}", since_ms / 1000)
                } else {
                    "--since=@0".to_string()
                };
                CompiledCommand {
                    program: "journalctl".to_string(),
                    args: vec![
                        "-u".to_string(),
                        HELPER_SERVICE_UNIT.to_string(),
                        since_arg,
                        "--no-pager".to_string(),
                        "--output=json".to_string(),
                    ],
                    max_stdout_bytes,
                    deadline,
                }
            }
            HostCommand::ListInhibitors => CompiledCommand {
                program: "systemd-inhibit".to_string(),
                args: vec!["--list".to_string(), "--no-pager".to_string()],
                max_stdout_bytes,
                deadline,
            },
        }
    }
}

/// Raw bounded output captured from an executed host command.
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct CommandOutput {
    pub stdout: Vec<u8>,
    pub exit_code: Option<i32>,
    pub truncated: bool,
}

/// Errors occurring during host command execution.
#[derive(Debug, thiserror::Error)]
pub enum HostCommandError {
    #[error("command execution timed out after {0} seconds")]
    Timeout(u64),
    #[error("failed to spawn or execute command: {0}")]
    Execution(String),
    #[error("command failed with exit code {0}")]
    ExitFailure(i32),
}

/// Abstract host command runner trait allowing deterministic fakes in tests.
pub trait HostCommandRunner: Send + Sync {
    fn run(
        &self,
        command: &HostCommand,
    ) -> impl Future<Output = Result<CommandOutput, HostCommandError>> + Send;
}

/// Production implementation of `HostCommandRunner` using `tokio::process::Command`.
#[derive(Debug, Default, Clone)]
pub struct ProductionHostCommandRunner;

impl HostCommandRunner for ProductionHostCommandRunner {
    async fn run(&self, command: &HostCommand) -> Result<CommandOutput, HostCommandError> {
        let spec = command.compile();

        let mut cmd = tokio::process::Command::new(&spec.program);
        cmd.args(&spec.args)
            .stdin(Stdio::null())
            .stdout(Stdio::piped())
            .stderr(Stdio::null())
            .env("LC_ALL", "C")
            .env("LANG", "C");

        let mut child = cmd.spawn().map_err(|e| {
            HostCommandError::Execution(format!("failed to spawn '{}': {e}", spec.program))
        })?;

        let mut stdout_handle = child.stdout.take().ok_or_else(|| {
            HostCommandError::Execution("failed to capture child stdout".to_string())
        })?;

        let execution = async {
            let mut buffer = Vec::new();
            let mut chunk = [0u8; 8192];
            let mut truncated = false;

            loop {
                let n = stdout_handle.read(&mut chunk).await?;
                if n == 0 {
                    break;
                }
                if buffer.len() + n > spec.max_stdout_bytes {
                    let allowed = spec.max_stdout_bytes.saturating_sub(buffer.len());
                    buffer.extend_from_slice(&chunk[..allowed]);
                    truncated = true;
                    // Drain remaining or stop
                    break;
                } else {
                    buffer.extend_from_slice(&chunk[..n]);
                }
            }
            // Explicitly drop read handle to deliver EOF/SIGPIPE to child on next write
            drop(stdout_handle);
            let status = child.wait().await?;
            Ok::<_, std::io::Error>((buffer, status.code(), truncated))
        };

        match tokio::time::timeout(spec.deadline, execution).await {
            Ok(Ok((stdout, exit_code, truncated))) => {
                if let Some(code) = exit_code {
                    if code != 0 {
                        return Err(HostCommandError::ExitFailure(code));
                    }
                }
                Ok(CommandOutput {
                    stdout,
                    exit_code,
                    truncated,
                })
            }
            Ok(Err(e)) => Err(HostCommandError::Execution(e.to_string())),
            Err(_) => {
                // Timeout: kill child to prevent leaks
                let _ = child.start_kill();
                let _ = child.wait().await;
                Err(HostCommandError::Timeout(spec.deadline.as_secs()))
            }
        }
    }
}

/// Parse systemd unit properties from `systemctl show` output.
pub fn parse_unit_status(unit_name: &str, stdout: &[u8]) -> Result<UnitStatusV1, String> {
    let text = String::from_utf8_lossy(stdout);
    let mut load_state = String::new();
    let mut active_state = String::new();
    let mut sub_state = String::new();
    let mut main_pid = None;
    let mut exec_main_status = None;
    let mut invocation_id = None;
    let mut active_enter_timestamp_ms = None;
    let mut inactive_exit_timestamp_ms = None;

    for line in text.lines() {
        let line = line.trim();
        if line.is_empty() || line.starts_with('#') {
            continue;
        }

        if let Some((key, val)) = line.split_once('=') {
            match key {
                "LoadState" => load_state = val.to_string(),
                "ActiveState" => active_state = val.to_string(),
                "SubState" => sub_state = val.to_string(),
                "MainPID" => {
                    if let Ok(pid) = val.parse::<u32>() {
                        if pid > 0 {
                            main_pid = Some(pid);
                        }
                    }
                }
                "ExecMainStatus" => {
                    if let Ok(status) = val.parse::<i32>() {
                        exec_main_status = Some(status);
                    }
                }
                "InvocationID" => {
                    if !val.is_empty() && val != "00000000000000000000000000000000" {
                        invocation_id = Some(val.to_string());
                    }
                }
                "ActiveEnterTimestampUSec" => {
                    if let Ok(usec) = val.parse::<u64>() {
                        if usec > 0 {
                            active_enter_timestamp_ms = Some(usec / 1000);
                        }
                    }
                }
                "InactiveExitTimestampUSec" => {
                    if let Ok(usec) = val.parse::<u64>() {
                        if usec > 0 {
                            inactive_exit_timestamp_ms = Some(usec / 1000);
                        }
                    }
                }
                _ => {}
            }
        }
    }

    if load_state.is_empty() && active_state.is_empty() {
        return Err("no systemd unit properties recognized in output".to_string());
    }

    Ok(UnitStatusV1 {
        unit_name: unit_name.to_string(),
        load_state: if load_state.is_empty() { "unknown".to_string() } else { load_state },
        active_state: if active_state.is_empty() { "unknown".to_string() } else { active_state },
        sub_state: if sub_state.is_empty() { "unknown".to_string() } else { sub_state },
        main_pid,
        exec_main_status,
        invocation_id,
        active_enter_timestamp_ms,
        inactive_exit_timestamp_ms,
    })
}

/// Parse journal JSON stream from `journalctl --output=json`.
///
/// CRITICAL PRIVACY INVARIANT: Never extract, retain, or project `MESSAGE` or syslog message text.
pub fn parse_journal_entries(
    unit_name: &str,
    stdout: &[u8],
    bounds: &BoundsV1,
) -> (Vec<ProjectedJournalEntry>, usize, bool) {
    let mut entries = Vec::new();
    let mut malformed_count = 0;
    let mut truncated = false;
    let max_records = bounds.max_records_per_source.min(MAX_ACCEPTED_RECORDS_PER_SOURCE);

    let text = String::from_utf8_lossy(stdout);
    for line in text.lines() {
        let line = line.trim();
        if line.is_empty() {
            continue;
        }

        if entries.len() >= max_records {
            truncated = true;
            break;
        }

        let parsed: serde_json::Value = match serde_json::from_str(line) {
            Ok(v) => v,
            Err(_) => {
                malformed_count += 1;
                continue;
            }
        };

        let obj = match parsed.as_object() {
            Some(o) => o,
            None => {
                malformed_count += 1;
                continue;
            }
        };

        // Timestamp from __REALTIME_TIMESTAMP (microseconds)
        let timestamp_ms = obj
            .get("__REALTIME_TIMESTAMP")
            .and_then(|v| {
                if let Some(s) = v.as_str() {
                    s.parse::<u64>().ok()
                } else {
                    v.as_u64()
                }
            })
            .map(|usec| usec / 1000)
            .unwrap_or(0);

        let priority = obj
            .get("PRIORITY")
            .and_then(|v| {
                if let Some(s) = v.as_str() {
                    s.parse::<u32>().ok()
                } else {
                    v.as_u64().map(|n| n as u32)
                }
            });

        let boot_id = obj
            .get("_BOOT_ID")
            .and_then(|v| v.as_str())
            .map(|s| s.to_string());

        let invocation_id = obj
            .get("_SYSTEMD_INVOCATION_ID")
            .or_else(|| obj.get("INVOCATION_ID"))
            .or_else(|| obj.get("USER_INVOCATION_ID"))
            .and_then(|v| v.as_str())
            .map(|s| s.to_string());

        let code_or_result = obj
            .get("JOB_RESULT")
            .or_else(|| obj.get("EXIT_STATUS"))
            .or_else(|| obj.get("EXIT_CODE"))
            .or_else(|| obj.get("RESULT"))
            .and_then(|v| {
                if let Some(s) = v.as_str() {
                    Some(s.to_string())
                } else if let Some(n) = v.as_i64() {
                    Some(n.to_string())
                } else {
                    None
                }
            });

        entries.push(ProjectedJournalEntry {
            timestamp_ms,
            unit: unit_name.to_string(),
            priority,
            boot_id,
            invocation_id,
            code_or_result,
        });
    }

    (entries, malformed_count, truncated)
}

/// Parse systemd-inhibit list output into aggregated privacy-safe probe.
///
/// Omit who, why, comm, user, and all free-text fields.
pub fn parse_inhibitors(stdout: &[u8]) -> ActiveInhibitorProbeV1 {
    let text = String::from_utf8_lossy(stdout);
    let mut count = 0;
    let mut delay_inhibited = false;
    let mut block_inhibited = false;

    for line in text.lines() {
        let line = line.trim();
        if line.is_empty() {
            continue;
        }

        // Header line begins with WHO or contains WHAT/MODE
        if line.starts_with("WHO ") || line.starts_with("WHO\t") {
            continue;
        }

        // Summary trailer line, e.g. "4 inhibitors listed."
        if line.ends_with("inhibitors listed.") || line.ends_with("inhibitor listed.") {
            continue;
        }

        // If line has columns, check the last word for delay or block
        let lower = line.to_ascii_lowercase();
        let last_token = lower.split_whitespace().last().unwrap_or("");
        if last_token == "delay" {
            delay_inhibited = true;
            count += 1;
        } else if last_token == "block" {
            block_inhibited = true;
            count += 1;
        } else {
            // Count any other valid inhibitor row
            count += 1;
        }
    }

    ActiveInhibitorProbeV1 {
        count,
        delay_inhibited,
        block_inhibited,
    }
}
