use std::os::unix::fs::PermissionsExt;
use std::path::{Path, PathBuf};
use std::process::ExitCode;
use std::sync::atomic::{AtomicUsize, Ordering};
use std::sync::Arc;
use std::time::Duration;

use clap::Parser;
use serde_json::json;
use tempfile::tempdir;

use crate::linux_release::cli::{Cli, Commands, DiagnoseArgs};
use crate::linux_release::constants::{API_SERVICE_UNIT, HELPER_SERVICE_UNIT};
use crate::linux_release::diagnostics::collector::{
    collect_diagnostic_bundle, run_diagnose, Clock, CollectorAdapters, EuidProvider,
};
use crate::linux_release::diagnostics::host_commands::{
    parse_inhibitors, parse_journal_entries, parse_unit_status, CommandOutput, HostCommand,
    HostCommandError, HostCommandRunner,
};
use crate::linux_release::diagnostics::host_probes::{
    read_rtc_wakealarm, read_suspend_capabilities, CurrentHostProbeReader,
};
use crate::linux_release::diagnostics::local_api::{
    query_local_idle_status, LocalApiError, LocalIdleStatusClient,
};
use crate::linux_release::diagnostics::model::{
    ActiveInhibitorProbeV1, Applicability, BoundsV1, CollectionStatus, CompletenessStatus,
    ProjectedCurrentHostProbes, RtcWakealarmProbeV1, SourceCoverage,
};
use crate::linux_release::diagnostics::output::{
    verify_or_create_secure_directory, write_diagnostic_bundle_to_dir, OutputError,
};
use crate::linux_release::layout::{resolve_user_diagnostics_dir_with, Layout};
use crate::linux_release::privilege::verify_privileges;

// ── Test Fakes ─────────────────────────────────────────────────────────────

struct FakeClock(u64);
impl Clock for FakeClock {
    fn now_ms(&self) -> u64 {
        self.0
    }
}

struct FakeEuid(u32);
impl EuidProvider for FakeEuid {
    fn get_euid(&self) -> u32 {
        self.0
    }
}

#[derive(Default, Clone)]
struct MockHostCommandRunner {
    pub show_api_stdout: Option<Vec<u8>>,
    pub show_helper_stdout: Option<Vec<u8>>,
    pub journal_api_stdout: Option<Vec<u8>>,
    pub journal_helper_stdout: Option<Vec<u8>>,
    pub inhibitors_stdout: Option<Vec<u8>>,
    pub fail_all: bool,
    pub call_count: Arc<AtomicUsize>,
}

impl HostCommandRunner for MockHostCommandRunner {
    async fn run(&self, command: &HostCommand) -> Result<CommandOutput, HostCommandError> {
        self.call_count.fetch_add(1, Ordering::SeqCst);
        if self.fail_all {
            return Err(HostCommandError::Execution("mock command failure".to_string()));
        }

        let stdout = match command {
            HostCommand::ShowApiUnit => self.show_api_stdout.clone().unwrap_or_else(|| {
                b"ActiveState=active\nSubState=running\nMainPID=1001\nExecMainStatus=0\nLoadState=loaded\nActiveEnterTimestampUSec=1726243200000000\n".to_vec()
            }),
            HostCommand::ShowHelperUnit => self.show_helper_stdout.clone().unwrap_or_else(|| {
                b"ActiveState=active\nSubState=running\nMainPID=1002\nExecMainStatus=0\nLoadState=loaded\nActiveEnterTimestampUSec=1726243200000000\n".to_vec()
            }),
            HostCommand::JournalApi { .. } => self.journal_api_stdout.clone().unwrap_or_else(|| {
                b"{\"__REALTIME_TIMESTAMP\":\"1726243210000000\",\"PRIORITY\":\"6\",\"_BOOT_ID\":\"00000000-0000-4000-8000-000000000001\",\"_SYSTEMD_INVOCATION_ID\":\"inv-1\",\"JOB_RESULT\":\"done\",\"MESSAGE\":\"secret message must be omitted\"}\n".to_vec()
            }),
            HostCommand::JournalHelper { .. } => self.journal_helper_stdout.clone().unwrap_or_else(|| {
                b"{\"__REALTIME_TIMESTAMP\":\"1726243215000000\",\"PRIORITY\":\"6\",\"_BOOT_ID\":\"00000000-0000-4000-8000-000000000001\",\"_SYSTEMD_INVOCATION_ID\":\"inv-2\",\"JOB_RESULT\":\"done\"}\n".to_vec()
            }),
            HostCommand::ListInhibitors => self.inhibitors_stdout.clone().unwrap_or_else(|| {
                b"WHO UID USER PID COMM WHAT WHY MODE\nfoo 1000 user 10 sleep test delay\nbar 1000 user 11 idle test block\n2 inhibitors listed.\n".to_vec()
            }),
        };

        Ok(CommandOutput {
            stdout,
            exit_code: Some(0),
            truncated: false,
        })
    }
}

#[derive(Default, Clone)]
struct MockIdleStatusClient {
    pub response: Option<serde_json::Value>,
    pub error: Option<String>,
}

impl LocalIdleStatusClient for MockIdleStatusClient {
    async fn fetch_status(
        &self,
        _token_path: &Path,
    ) -> Result<(serde_json::Value, usize), LocalApiError> {
        if let Some(err) = &self.error {
            return Err(LocalApiError::Unavailable(err.clone()));
        }
        let val = self.response.clone().unwrap_or_else(|| {
            json!({
                "status": "watching",
                "automaticPolicy": "agentActivity",
                "enabled": true
            })
        });
        let bytes_len = serde_json::to_vec(&val).map(|v| v.len()).unwrap_or(32);
        Ok((val, bytes_len))
    }
}

#[derive(Default, Clone)]
struct MockProbeReader {
    pub custom_probes: Option<ProjectedCurrentHostProbes>,
}

impl CurrentHostProbeReader for MockProbeReader {
    async fn read_probes(
        &self,
        _layout: &Layout,
        inhibitor_probe: Option<ActiveInhibitorProbeV1>,
    ) -> ProjectedCurrentHostProbes {
        if let Some(p) = &self.custom_probes {
            return p.clone();
        }

        ProjectedCurrentHostProbes {
            rtc_wakealarm: Some(RtcWakealarmProbeV1 {
                supported: true,
                wakealarm_time: Some(1726244000),
                now_time: Some(1726243200),
            }),
            suspend_capabilities: Some(vec!["freeze".to_string(), "mem".to_string()]),
            active_inhibitors: inhibitor_probe,
            qualified_executables: Some(vec!["dam-hopper-api".to_string()]),
        }
    }
}

// ── 1. CLI Grammar & Privilege Tests ───────────────────────────────────────

#[test]
fn test_cli_diagnose_exact_grammar_success() {
    let args = vec!["dam-hopper", "diagnose", "--json"];
    let cli = Cli::try_parse_from(args).expect("should parse exact diagnose --json");
    assert_eq!(cli.command, Commands::Diagnose(DiagnoseArgs { json: true }));
}

#[test]
fn test_cli_diagnose_missing_json_flag_fails() {
    let args = vec!["dam-hopper", "diagnose"];
    let err = Cli::try_parse_from(args).expect_err("missing --json must fail parse");
    assert!(
        err.to_string().contains("--json"),
        "error must mention missing required --json flag"
    );
}

#[test]
fn test_cli_diagnose_extra_flags_and_positionals_fail() {
    // Unknown option --since
    let args = vec!["dam-hopper", "diagnose", "--json", "--since", "1h"];
    assert!(Cli::try_parse_from(args).is_err());

    // Unknown option --output
    let args = vec!["dam-hopper", "diagnose", "--json", "--output", "/tmp/out.json"];
    assert!(Cli::try_parse_from(args).is_err());

    // Positional argument
    let args = vec!["dam-hopper", "diagnose", "--json", "/tmp/out.json"];
    assert!(Cli::try_parse_from(args).is_err());
}

#[test]
fn test_privilege_diagnose_allowed_under_any_euid() {
    let cmd = Commands::Diagnose(DiagnoseArgs { json: true });

    // Root (EUID 0) allowed
    assert!(verify_privileges(&cmd, 0).is_ok());

    // Non-root (EUID 1000) allowed
    assert!(verify_privileges(&cmd, 1000).is_ok());

    // Unprivileged (EUID 65534) allowed
    assert!(verify_privileges(&cmd, 65534).is_ok());
}

#[test]
fn test_privilege_mutating_commands_still_require_root() {
    let install_cmd = Commands::Install(crate::linux_release::cli::InstallArgs {
        bundle: PathBuf::from("/tmp/b"),
        role: None,
        allow_web_origins: vec![],
        verify_attestation: false,
        service_user: None,
        plugin_owner_user: None,
        reinstall: false,
    });
    assert!(verify_privileges(&install_cmd, 0).is_ok());
    assert!(verify_privileges(&install_cmd, 1000).is_err());

    let fetch_cmd = Commands::Fetch(crate::linux_release::cli::FetchArgs {
        version: None,
        latest: true,
        output: PathBuf::from("/tmp/o"),
        verify_attestation: false,
    });
    // Fetch must NOT run as root
    assert!(verify_privileges(&fetch_cmd, 0).is_err());
    assert!(verify_privileges(&fetch_cmd, 1000).is_ok());
}

// ── 2. HostCommand Compilation & Parser Tests ──────────────────────────────

#[test]
fn test_host_command_compilation_invariants() {
    let show_api = HostCommand::ShowApiUnit.compile();
    assert_eq!(show_api.program, "systemctl");
    assert_eq!(show_api.args, vec!["show", API_SERVICE_UNIT, "--no-pager"]);
    assert_eq!(show_api.deadline, Duration::from_secs(5));
    assert_eq!(show_api.max_stdout_bytes, 2 * 1024 * 1024);

    let show_helper = HostCommand::ShowHelperUnit.compile();
    assert_eq!(show_helper.program, "systemctl");
    assert_eq!(show_helper.args, vec!["show", HELPER_SERVICE_UNIT, "--no-pager"]);

    let journal_api = HostCommand::JournalApi { since_ms: 1726243200000 }.compile();
    assert_eq!(journal_api.program, "journalctl");
    assert_eq!(
        journal_api.args,
        vec![
            "-u",
            API_SERVICE_UNIT,
            "--since=@1726243200",
            "--no-pager",
            "--output=json"
        ]
    );

    let journal_helper = HostCommand::JournalHelper { since_ms: 0 }.compile();
    assert_eq!(journal_helper.program, "journalctl");
    assert_eq!(
        journal_helper.args,
        vec![
            "-u",
            HELPER_SERVICE_UNIT,
            "--since=@0",
            "--no-pager",
            "--output=json"
        ]
    );

    let inhibitors = HostCommand::ListInhibitors.compile();
    assert_eq!(inhibitors.program, "systemd-inhibit");
    assert_eq!(inhibitors.args, vec!["--list", "--no-pager"]);
}

#[test]
fn test_parse_unit_status_properties() {
    let sample = b"LoadState=loaded\nActiveState=active\nSubState=running\nMainPID=4210\nExecMainStatus=0\nInvocationID=abc123def456\nActiveEnterTimestampUSec=1726243200000000\nInactiveExitTimestampUSec=0\n";
    let status = parse_unit_status("dam-hopper-api.service", sample).expect("should parse properties");

    assert_eq!(status.unit_name, "dam-hopper-api.service");
    assert_eq!(status.load_state, "loaded");
    assert_eq!(status.active_state, "active");
    assert_eq!(status.sub_state, "running");
    assert_eq!(status.main_pid, Some(4210));
    assert_eq!(status.exec_main_status, Some(0));
    assert_eq!(status.invocation_id, Some("abc123def456".to_string()));
    assert_eq!(status.active_enter_timestamp_ms, Some(1726243200000));
    assert_eq!(status.inactive_exit_timestamp_ms, None);
}

#[test]
fn test_parse_journal_entries_privacy_never_retains_message() {
    let sample = b"{\"__REALTIME_TIMESTAMP\":\"1726243200000000\",\"PRIORITY\":\"6\",\"_BOOT_ID\":\"boot-1\",\"_SYSTEMD_INVOCATION_ID\":\"inv-1\",\"JOB_RESULT\":\"done\",\"MESSAGE\":\"CRITICAL_PASSWORD_OR_TOKEN_123\"}\n{\"invalid-json\"\n";
    let bounds = BoundsV1::default();
    let (entries, malformed, truncated) = parse_journal_entries("dam-hopper-api.service", sample, &bounds);

    assert_eq!(entries.len(), 1);
    assert_eq!(malformed, 1);
    assert!(!truncated);

    let entry = &entries[0];
    assert_eq!(entry.timestamp_ms, 1726243200000);
    assert_eq!(entry.priority, Some(6));
    assert_eq!(entry.boot_id, Some("boot-1".to_string()));
    assert_eq!(entry.invocation_id, Some("inv-1".to_string()));
    assert_eq!(entry.code_or_result, Some("done".to_string()));

    // Verify through serialization that MESSAGE is NEVER present
    let serialized = serde_json::to_string(entry).unwrap();
    assert!(!serialized.contains("CRITICAL_PASSWORD"));
    assert!(!serialized.contains("message"));
    assert!(!serialized.contains("MESSAGE"));
}

#[test]
fn test_parse_inhibitors_delay_and_block() {
    let sample = b"WHO            UID  USER    PID     COMM           WHAT  WHY                                       MODE
ModemManager   0    root    1205    ModemManager   sleep ModemManager needs to reset devices       delay
NetworkManager 0    root    1144    NetworkManager sleep NetworkManager needs to turn off networks delay
Oh My Pi       1000 loidinh 3620338 omp            idle  Oh My Pi agent session                    block

3 inhibitors listed.
";
    let probe = parse_inhibitors(sample);
    assert_eq!(probe.count, 3);
    assert!(probe.delay_inhibited);
    assert!(probe.block_inhibited);
}

// ── 3. Local API Client & Token Handling Tests ─────────────────────────────

#[tokio::test]
async fn test_query_local_idle_status_not_applicable_for_web_role() {
    let client = MockIdleStatusClient::default();
    let coverage = SourceCoverage::new(1000, 2000);
    let env = query_local_idle_status(
        &client,
        Path::new("/nonexistent/token"),
        Applicability::NotApplicable,
        coverage,
    )
    .await;

    assert_eq!(env.collection_status, CollectionStatus::NotApplicable);
    assert_eq!(env.applicability, Applicability::NotApplicable);
    assert!(env.records.is_none());
}

#[tokio::test]
async fn test_query_local_idle_status_available() {
    let client = MockIdleStatusClient {
        response: Some(json!({"state": "watching"})),
        error: None,
    };
    let coverage = SourceCoverage::new(1000, 2000);
    let env = query_local_idle_status(
        &client,
        Path::new("/dummy/token"),
        Applicability::Applicable,
        coverage,
    )
    .await;

    assert_eq!(env.collection_status, CollectionStatus::Available);
    assert_eq!(env.record_count, 1);
    assert!(env.records.is_some());
    assert_eq!(env.records.unwrap()["state"], "watching");
}

// ── 4. Host Probes Tests ───────────────────────────────────────────────────

#[test]
fn test_read_suspend_capabilities_from_file() {
    let tmp = tempdir().unwrap();
    let layout = Layout::with_root(tmp.path());

    // Create /sys/power/state in fake root
    let power_path = layout.power_state_path();
    std::fs::create_dir_all(power_path.parent().unwrap()).unwrap();
    std::fs::write(&power_path, "freeze mem disk\n").unwrap();

    let caps = read_suspend_capabilities(&layout).expect("should read capabilities");
    assert_eq!(caps, vec!["disk", "freeze", "mem"]);
}

#[test]
fn test_read_rtc_wakealarm_unsupported_when_device_missing() {
    let tmp = tempdir().unwrap();
    let layout = Layout::with_root(tmp.path());

    let rtc = read_rtc_wakealarm(&layout).expect("should return probe");
    assert!(!rtc.supported);
    assert_eq!(rtc.wakealarm_time, None);
}

// ── 5. Safe Atomic Output Writer Tests ─────────────────────────────────────

#[test]
fn test_resolve_user_diagnostics_dir_priority() {
    // 1. XDG_STATE_HOME has priority
    let res = resolve_user_diagnostics_dir_with(|k| match k {
        "XDG_STATE_HOME" => Some(PathBuf::from("/custom/state")),
        "HOME" => Some(PathBuf::from("/home/user")),
        _ => None,
    });
    assert_eq!(res, Some(PathBuf::from("/custom/state/dam-hopper/diagnostics")));

    // 2. Fallback to HOME/.local/state
    let res = resolve_user_diagnostics_dir_with(|k| match k {
        "XDG_STATE_HOME" => None,
        "HOME" => Some(PathBuf::from("/home/user")),
        _ => None,
    });
    assert_eq!(
        res,
        Some(PathBuf::from("/home/user/.local/state/dam-hopper/diagnostics"))
    );

    // 3. None when both empty/missing (no /tmp fallback!)
    let res = resolve_user_diagnostics_dir_with(|_| None);
    assert_eq!(res, None);
}

#[test]
fn test_verify_or_create_secure_directory_rejects_symlink() {
    let tmp = tempdir().unwrap();
    let euid = unsafe { libc::geteuid() };

    let real_dir = tmp.path().join("real");
    std::fs::create_dir_all(&real_dir).unwrap();
    std::fs::set_permissions(&real_dir, std::fs::Permissions::from_mode(0o700)).unwrap();

    let symlink_dir = tmp.path().join("symlink_dir");
    std::os::unix::fs::symlink(&real_dir, &symlink_dir).unwrap();

    let err = verify_or_create_secure_directory(&symlink_dir, euid).unwrap_err();
    match err {
        OutputError::InvalidDirectorySecurity(msg) => {
            assert!(msg.contains("must not be a symlink"));
        }
        other => panic!("expected InvalidDirectorySecurity, got {:?}", other),
    }
}

#[test]
fn test_write_diagnostic_bundle_atomic_mode_0600() {
    let tmp = tempdir().unwrap();
    let dest_dir = tmp.path().join("diagnostics");
    let euid = unsafe { libc::geteuid() };

    let bundle_bytes = b"{\"bundleSchemaVersion\":1,\"test\":\"payload\"}";
    let path = write_diagnostic_bundle_to_dir(
        &dest_dir,
        "test-bundle-id",
        1726243200000,
        bundle_bytes,
        euid,
    )
    .expect("should write bundle atomically");

    assert!(path.exists());
    let filename = path.file_name().unwrap().to_str().unwrap();
    assert_eq!(filename, "dam-hopper-diagnose-1726243200000-test-bundle-id.json");

    // File mode must be 0600
    let meta = std::fs::metadata(&path).unwrap();
    assert_eq!(meta.permissions().mode() & 0o777, 0o600);

    // Content must match
    let content = std::fs::read(&path).unwrap();
    assert_eq!(content, bundle_bytes);

    // Directory mode must be 0700
    let dir_meta = std::fs::metadata(&dest_dir).unwrap();
    assert_eq!(dir_meta.permissions().mode() & 0o777, 0o700);
}

// ── 6. Full Orchestration Scenarios ────────────────────────────────────────

#[tokio::test]
async fn test_root_complete_scenario() {
    let tmp = tempdir().unwrap();
    let layout = Layout::with_root(tmp.path());

    // Setup host.toml with Server role
    std::fs::create_dir_all(&layout.etc_dir).unwrap();
    let host_toml = layout.host_config_path();
    std::fs::write(&host_toml, "role = \"server\"\nallowed_web_origins = []\n").unwrap();
    // Create server events and server audit files
    std::fs::create_dir_all(layout.server_events_path().parent().unwrap()).unwrap();
    std::fs::write(&layout.server_events_path(), "").unwrap();
    std::fs::create_dir_all(layout.api_audit_path().parent().unwrap()).unwrap();
    std::fs::write(&layout.api_audit_path(), "").unwrap();

    // Create helper audit file (root)
    std::fs::create_dir_all(layout.helper_audit_path().parent().unwrap()).unwrap();
    std::fs::write(&layout.helper_audit_path(), "").unwrap();

    // Create backend diagnostics file
    std::fs::write(&layout.backend_diagnostics_path(), "").unwrap();

    let adapters = CollectorAdapters {
        clock: FakeClock(1726243200000),
        euid: FakeEuid(0), // Root
        command_runner: MockHostCommandRunner::default(),
        api_client: MockIdleStatusClient::default(),
        probe_reader: MockProbeReader::default(),
    };

    let bundle = collect_diagnostic_bundle(&layout, &adapters).await;

    assert_eq!(bundle.host.euid, 0);
    assert!(bundle.host.is_root);
    assert_eq!(bundle.host.target_role, Some("server".to_string()));
    assert_eq!(bundle.events.applicability, Applicability::Applicable);
    assert_eq!(bundle.server_audit.applicability, Applicability::Applicable);
    assert_eq!(bundle.helper_audit.applicability, Applicability::Applicable);
    assert_eq!(bundle.helper_audit.collection_status, CollectionStatus::Available);
    assert_eq!(bundle.completeness.status, CompletenessStatus::Complete);
}

#[tokio::test]
async fn test_non_root_partial_scenario_without_sudo() {
    let tmp = tempdir().unwrap();
    let layout = Layout::with_root(tmp.path());

    // Setup host.toml with Server role
    std::fs::create_dir_all(&layout.etc_dir).unwrap();
    let host_toml = layout.host_config_path();
    std::fs::write(&host_toml, "role = \"server\"\nallowed_web_origins = []\n").unwrap();
    // Create readable server sources
    std::fs::create_dir_all(layout.server_events_path().parent().unwrap()).unwrap();
    std::fs::write(&layout.server_events_path(), "").unwrap();
    std::fs::create_dir_all(layout.api_audit_path().parent().unwrap()).unwrap();
    std::fs::write(&layout.api_audit_path(), "").unwrap();
    std::fs::write(&layout.backend_diagnostics_path(), "").unwrap();

    let adapters = CollectorAdapters {
        clock: FakeClock(1726243200000),
        euid: FakeEuid(1000), // Non-root EUID
        command_runner: MockHostCommandRunner::default(),
        api_client: MockIdleStatusClient::default(),
        probe_reader: MockProbeReader::default(),
    };

    let bundle = collect_diagnostic_bundle(&layout, &adapters).await;

    assert_eq!(bundle.host.euid, 1000);
    assert!(!bundle.host.is_root);
    // Non-root MUST have helperAudit marked permissionDenied
    assert_eq!(bundle.helper_audit.collection_status, CollectionStatus::PermissionDenied);
    assert_eq!(bundle.completeness.status, CompletenessStatus::Partial);
    assert!(bundle.completeness.reasons.iter().any(|r| r.contains("helperAudit")));
}

#[tokio::test]
async fn test_web_role_sources_not_applicable() {
    let tmp = tempdir().unwrap();
    let layout = Layout::with_root(tmp.path());

    // Setup host.toml with Web role
    std::fs::create_dir_all(&layout.etc_dir).unwrap();
    let host_toml = layout.host_config_path();
    std::fs::write(&host_toml, "role = \"web\"\nallowed_web_origins = []\n").unwrap();
    let cmd_runner = MockHostCommandRunner::default();
    let adapters = CollectorAdapters {
        clock: FakeClock(1726243200000),
        euid: FakeEuid(0),
        command_runner: cmd_runner.clone(),
        api_client: MockIdleStatusClient::default(),
        probe_reader: MockProbeReader::default(),
    };

    let bundle = collect_diagnostic_bundle(&layout, &adapters).await;

    assert_eq!(bundle.host.target_role, Some("web".to_string()));
    assert_eq!(bundle.events.applicability, Applicability::NotApplicable);
    assert_eq!(bundle.server_audit.applicability, Applicability::NotApplicable);
    assert_eq!(bundle.helper_audit.applicability, Applicability::NotApplicable);
    assert_eq!(bundle.journald.applicability, Applicability::NotApplicable);
    assert_eq!(bundle.systemd.applicability, Applicability::NotApplicable);
    assert_eq!(bundle.idle_status.applicability, Applicability::NotApplicable);

    // Web role should not run journald/show unit commands
    assert_eq!(cmd_runner.call_count.load(Ordering::SeqCst), 0);
    assert_eq!(bundle.completeness.status, CompletenessStatus::Complete);
}

#[tokio::test]
async fn test_run_diagnose_exit_codes() {
    let tmp = tempdir().unwrap();
    let layout = Layout::with_root(tmp.path());
    let real_euid = unsafe { libc::geteuid() };

    // Setup controlled XDG_STATE_HOME with mode 0700 owned by current user
    let user_state = tmp.path().join("user_state");
    std::fs::create_dir_all(&user_state).unwrap();
    std::fs::set_permissions(&user_state, std::fs::Permissions::from_mode(0o700)).unwrap();
    std::env::set_var("XDG_STATE_HOME", &user_state);

    // 1. Test Exit 0: Web role (sources NotApplicable, completeness Complete)
    std::fs::create_dir_all(&layout.etc_dir).unwrap();
    std::fs::write(&layout.host_config_path(), "role = \"web\"\nallowed_web_origins = []\n").unwrap();

    let web_adapters = CollectorAdapters {
        clock: FakeClock(1726243200000),
        euid: FakeEuid(real_euid),
        command_runner: MockHostCommandRunner::default(),
        api_client: MockIdleStatusClient::default(),
        probe_reader: MockProbeReader::default(),
    };
    let code = run_diagnose(&layout, &web_adapters).await;
    assert_eq!(code, ExitCode::from(0));

    // 2. Test Exit 2: Server role non-root (helperAudit PermissionDenied, completeness Partial)
    std::fs::write(&layout.host_config_path(), "role = \"server\"\nallowed_web_origins = []\n").unwrap();
    // Create server sources
    std::fs::create_dir_all(layout.server_events_path().parent().unwrap()).unwrap();
    std::fs::write(&layout.server_events_path(), "").unwrap();
    std::fs::create_dir_all(layout.api_audit_path().parent().unwrap()).unwrap();
    std::fs::write(&layout.api_audit_path(), "").unwrap();
    std::fs::write(&layout.backend_diagnostics_path(), "").unwrap();

    let partial_adapters = CollectorAdapters {
        clock: FakeClock(1726243200000),
        euid: FakeEuid(if real_euid == 0 { 1000 } else { real_euid }),
        command_runner: MockHostCommandRunner::default(),
        api_client: MockIdleStatusClient::default(),
        probe_reader: MockProbeReader::default(),
    };
    let code = run_diagnose(&layout, &partial_adapters).await;
    assert_eq!(code, ExitCode::from(2));

    // 3. Test Exit 1: Unsafe destination (symlink directory) causes write failure
    let symlink_dest = user_state.join("dam-hopper").join("diagnostics");
    let _ = std::fs::remove_dir_all(&symlink_dest);
    std::fs::create_dir_all(symlink_dest.parent().unwrap()).unwrap();
    let bad_target = tmp.path().join("bad_target");
    std::fs::create_dir_all(&bad_target).unwrap();
    std::os::unix::fs::symlink(&bad_target, &symlink_dest).unwrap();
    let code = run_diagnose(&layout, &partial_adapters).await;
    assert_eq!(code, ExitCode::from(1));
}
