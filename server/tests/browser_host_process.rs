use std::path::Path;
use std::time::Duration;
use tempfile::tempdir;

#[cfg(unix)]
use dam_hopper_server::browser_host::process::live_members;
use dam_hopper_server::browser_host::process::{
    discover_ws_endpoint, find_browser_executable, is_canonical_uuid, validate_browser_path,
    validate_loopback_endpoint, BrowserLaunchConfig, BrowserProcess, ProcessError,
    MAX_STDERR_CAPTURE_BYTES,
};

const VALID_UUID: &str = "e90e79e7-5782-4281-b83a-1dc27f852305";
const ALT_UUID: &str = "01234567-89ab-cdef-0123-456789abcdef";

#[test]
fn test_is_canonical_uuid() {
    assert!(is_canonical_uuid(VALID_UUID));
    assert!(is_canonical_uuid(ALT_UUID));

    // Reject non-canonical formats
    assert!(!is_canonical_uuid("123"));
    assert!(!is_canonical_uuid("abc-123"));
    assert!(!is_canonical_uuid(""));
    assert!(!is_canonical_uuid("e90e79e757824281b83a1dc27f852305")); // 32 chars unhyphenated
    assert!(!is_canonical_uuid("E90E79E7-5782-4281-B83A-1DC27F852305")); // uppercase hex
    assert!(!is_canonical_uuid(
        "e90e79e7-5782-4281-b83a-1dc27f852305/extra"
    ));
    assert!(!is_canonical_uuid("e90e79e7-5782-4281-b83a-1dc27f85230g")); // non-hex 'g'
}

#[test]
fn test_validate_browser_path() {
    assert!(validate_browser_path(&format!("/devtools/browser/{VALID_UUID}")).is_ok());

    // Non-canonical UUIDs or extra segments must be rejected
    assert!(validate_browser_path("/devtools/browser/123").is_err());
    assert!(validate_browser_path("/devtools/browser/abc-123").is_err());
    assert!(validate_browser_path("/devtools/browser/").is_err());
    assert!(validate_browser_path(&format!("/devtools/browser/{VALID_UUID}/extra")).is_err());
    assert!(validate_browser_path(&format!("/devtools/browser/{VALID_UUID}?query=1")).is_err());
    assert!(validate_browser_path(&format!("/other/prefix/{VALID_UUID}")).is_err());
}

#[test]
fn test_loopback_validation() {
    assert!(validate_loopback_endpoint(&format!(
        "ws://127.0.0.1:9222/devtools/browser/{VALID_UUID}"
    ))
    .is_ok());
    assert!(
        validate_loopback_endpoint(&format!("ws://[::1]:9222/devtools/browser/{VALID_UUID}"))
            .is_ok()
    );
    assert!(validate_loopback_endpoint(&format!(
        "ws://localhost:9222/devtools/browser/{VALID_UUID}"
    ))
    .is_ok());

    // Non-canonical UUID paths must be rejected
    assert!(validate_loopback_endpoint("ws://127.0.0.1:9222/devtools/browser/123").is_err());
    assert!(validate_loopback_endpoint("ws://127.0.0.1:9222/devtools/browser/abc-123").is_err());
    assert!(validate_loopback_endpoint("ws://127.0.0.1:9222/devtools/browser/").is_err());
    assert!(validate_loopback_endpoint(
        "ws://127.0.0.1:9222/devtools/browser/E90E79E7-5782-4281-B83A-1DC27F852305"
    )
    .is_err());
    assert!(validate_loopback_endpoint(&format!(
        "ws://127.0.0.1:9222/devtools/browser/{VALID_UUID}/extra"
    ))
    .is_err());
    assert!(validate_loopback_endpoint(&format!(
        "ws://127.0.0.1:9222/devtools/browser/{VALID_UUID}?q=1"
    ))
    .is_err());
    assert!(validate_loopback_endpoint(&format!(
        "ws://127.0.0.1:9222/devtools/browser/{VALID_UUID}#frag"
    ))
    .is_err());

    // Non-loopback endpoints MUST be rejected
    assert!(validate_loopback_endpoint(&format!(
        "ws://192.168.1.100:9222/devtools/browser/{VALID_UUID}"
    ))
    .is_err());
    assert!(validate_loopback_endpoint(&format!(
        "ws://0.0.0.0:9222/devtools/browser/{VALID_UUID}"
    ))
    .is_err());
    assert!(validate_loopback_endpoint(&format!(
        "ws://10.0.0.1:9222/devtools/browser/{VALID_UUID}"
    ))
    .is_err());
    assert!(
        validate_loopback_endpoint(&format!("ws://google.com/devtools/browser/{VALID_UUID}"))
            .is_err()
    );
}

#[test]
fn test_validate_loopback_endpoint_strict_rejections() {
    // Scheme must be ws
    assert!(validate_loopback_endpoint(&format!(
        "http://127.0.0.1:9222/devtools/browser/{VALID_UUID}"
    ))
    .is_err());
    // Port must be explicit and > 0
    assert!(
        validate_loopback_endpoint(&format!("ws://127.0.0.1/devtools/browser/{VALID_UUID}"))
            .is_err()
    );
    assert!(
        validate_loopback_endpoint(&format!("ws://127.0.0.1:0/devtools/browser/{VALID_UUID}"))
            .is_err()
    );
    // Credentials forbidden
    assert!(validate_loopback_endpoint(&format!(
        "ws://user:pass@127.0.0.1:9222/devtools/browser/{VALID_UUID}"
    ))
    .is_err());
}

#[tokio::test]
async fn test_allowlist_rejects_copied_overrides_and_insecure_flags() {
    let tmp = tempdir().unwrap();
    let forbidden_candidates = [
        "--no-sandbox",
        "--disable-web-security",
        "--ignore-certificate-errors",
        "--disable-site-isolation-trials",
        "--disable-ipc-flooding-protection",
        "--disable-hang-monitor",
        "--disable-renderer-backgrounding",
        "--disable-backgrounding-occluded-windows",
        "--disable-background-timer-throttling",
        "--use-mock-keychain",
        "--password-store=basic",
        "--remote-debugging-address=0.0.0.0",
        "--remote-allow-origins=*",
        "--user-data-dir=/tmp/bad",
        "--load-extension=/tmp/ext",
        "--foo-bar",
        "https://malicious.com",
    ];

    for flag in forbidden_candidates {
        let mut config = BrowserLaunchConfig::new(tmp.path().to_path_buf());
        config.additional_args.push(flag.to_string());
        let res = BrowserProcess::launch(config).await;
        assert!(
            matches!(res, Err(ProcessError::LaunchFailed(_))),
            "flag '{flag}' should have been rejected by allowlist"
        );
    }
}

/// Body of `test_find_browser_executable_requires_explicit_configuration`, run in its own
/// process with the variable removed so no sibling test ever observes the removal.
#[ignore]
#[test]
fn helper_find_browser_executable_without_env() {
    if std::env::var("DAM_HOPPER_TEST_HELPER_NO_BROWSER_ENV").as_deref() != Ok("1") {
        return;
    }
    assert!(std::env::var_os("DAM_HOPPER_BROWSER_EXECUTABLE").is_none());

    // When DAM_HOPPER_BROWSER_EXECUTABLE is not set, find_browser_executable(None) MUST fail closed.
    // Automatic PATH and standard-location discovery is disabled per architecture-contracts §2.
    let res = find_browser_executable(None);
    assert!(
        matches!(res, Err(ProcessError::ExecutableNotFound(_))),
        "automatic PATH discovery should be disabled"
    );

    // Non-existent configured path must fail closed
    let bad_path = Path::new("/nonexistent/dam_hopper_chrome_bin");
    assert!(matches!(
        find_browser_executable(Some(bad_path)),
        Err(ProcessError::ExecutableNotFound(_))
    ));
}

#[test]
fn test_find_browser_executable_requires_explicit_configuration() {
    let status = std::process::Command::new(std::env::current_exe().unwrap())
        .arg("--exact")
        .arg("helper_find_browser_executable_without_env")
        .arg("--ignored")
        .arg("--nocapture")
        .env_remove("DAM_HOPPER_BROWSER_EXECUTABLE")
        .env("DAM_HOPPER_TEST_HELPER_NO_BROWSER_ENV", "1")
        .status()
        .expect("failed to run the unset-environment helper");
    assert!(
        status.success(),
        "find_browser_executable must fail closed without explicit configuration"
    );
}

#[cfg(unix)]
#[tokio::test]
async fn test_guard_kills_descendants_on_early_failure() {
    use std::os::unix::fs::PermissionsExt;
    let tmp = tempdir().unwrap();
    let script_path = tmp.path().join("fake_browser.sh");
    let script_content = "#!/bin/sh\nsleep 60 &\nexit 1\n";
    std::fs::write(&script_path, script_content).unwrap();
    let mut perms = std::fs::metadata(&script_path).unwrap().permissions();
    perms.set_mode(0o755);
    std::fs::set_permissions(&script_path, perms).unwrap();

    let mut config = BrowserLaunchConfig::new(tmp.path().join("user_data"));
    config.executable_path = Some(script_path);

    let res = BrowserProcess::launch(config).await;
    assert!(res.is_err(), "fake browser exit should fail launch");

    tokio::time::sleep(Duration::from_millis(250)).await;

    #[cfg(target_os = "linux")]
    {
        let survivors = procfs::process::all_processes()
            .unwrap()
            .filter_map(Result::ok)
            .filter_map(|p| p.cmdline().ok())
            .filter(|cmd| cmd.iter().any(|arg| arg == "60"))
            .count();
        assert_eq!(
            survivors, 0,
            "no background sleeper descendant should survive failed launch"
        );
    }
}

#[tokio::test]
async fn test_browser_lifecycle_and_descendant_cleanup() {
    let exec = match find_browser_executable(None) {
        Ok(p) => p,
        Err(e) => {
            if std::env::var("DAM_HOPPER_REQUIRE_BROWSER").as_deref() == Ok("1") {
                panic!("DAM_HOPPER_REQUIRE_BROWSER=1 is set but no browser was found: {e}");
            }
            eprintln!("SKIP: No Chrome/Chromium executable available on this system.");
            return;
        }
    };

    println!("Found browser executable: {}", exec.display());

    let tmp = tempdir().unwrap();
    let mut config = BrowserLaunchConfig::new(tmp.path().join("browser-user-data"));
    config.executable_path = Some(exec);
    config.headless = true;

    let mut process = BrowserProcess::launch(config)
        .await
        .expect("failed to launch browser");

    let pid = process.pid();
    let endpoint = process.ws_endpoint().to_string();
    assert!(validate_loopback_endpoint(&endpoint).is_ok());

    #[cfg(unix)]
    let pgid = pid as i32;

    // Check process is running
    #[cfg(unix)]
    {
        use nix::sys::signal::kill;
        use nix::unistd::Pid;
        let running = kill(Pid::from_raw(pid as i32), None).is_ok();
        assert!(running, "browser root process should be alive");
    }

    // Terminate browser
    process.terminate().await.expect("termination failed");

    // Give kernel a moment to reap
    tokio::time::sleep(Duration::from_millis(300)).await;

    // Verify all descendants in process group are dead
    #[cfg(unix)]
    {
        use nix::sys::signal::killpg;
        use nix::unistd::Pid;
        let res = killpg(Pid::from_raw(pgid), None);
        assert_eq!(
            res.unwrap_err(),
            nix::errno::Errno::ESRCH,
            "process group {pgid} should return ESRCH proving all descendants are dead"
        );
    }
}

#[tokio::test]
async fn test_corroboration_matching_succeeds() {
    let tmp = tempdir().unwrap();
    let port_file = tmp.path().join("DevToolsActivePort");
    std::fs::write(
        &port_file,
        format!("9222\n/devtools/browser/{VALID_UUID}\n"),
    )
    .unwrap();

    let mock_stderr = std::io::Cursor::new(
        format!("Random log line\nDevTools listening on ws://127.0.0.1:9222/devtools/browser/{VALID_UUID}\nMore logs\n").into_bytes()
    );

    let res = discover_ws_endpoint(mock_stderr, tmp.path()).await;
    assert!(res.is_ok());
    let (endpoint, _) = res.unwrap();
    assert_eq!(
        endpoint,
        format!("ws://127.0.0.1:9222/devtools/browser/{VALID_UUID}")
    );
}

#[tokio::test]
async fn test_corroboration_mismatch_fails() {
    let tmp = tempdir().unwrap();
    let port_file = tmp.path().join("DevToolsActivePort");
    // Port file says port 9222
    std::fs::write(
        &port_file,
        format!("9222\n/devtools/browser/{VALID_UUID}\n"),
    )
    .unwrap();

    // Stderr says port 9999 (mismatched)
    let mock_stderr = std::io::Cursor::new(
        format!("DevTools listening on ws://127.0.0.1:9999/devtools/browser/{VALID_UUID}\n")
            .into_bytes(),
    );

    let res = discover_ws_endpoint(mock_stderr, tmp.path()).await;
    assert!(
        matches!(res, Err(ProcessError::InvalidEndpoint(msg)) if msg.contains("endpoint corroboration failed"))
    );
}

#[tokio::test]
async fn test_port_file_rejects_non_canonical_uuid() {
    let tmp = tempdir().unwrap();
    let port_file = tmp.path().join("DevToolsActivePort");

    // Rejected non-canonical UUID /123
    std::fs::write(&port_file, "9222\n/devtools/browser/123\n").unwrap();
    let mock_stderr = std::io::Cursor::new(Vec::new());
    let res = discover_ws_endpoint(mock_stderr, tmp.path()).await;
    assert!(matches!(res, Err(ProcessError::InvalidEndpoint(_))));

    // Rejected non-canonical UUID /abc-123
    std::fs::write(&port_file, "9222\n/devtools/browser/abc-123\n").unwrap();
    let mock_stderr2 = std::io::Cursor::new(Vec::new());
    let res2 = discover_ws_endpoint(mock_stderr2, tmp.path()).await;
    assert!(matches!(res2, Err(ProcessError::InvalidEndpoint(_))));
}

#[tokio::test]
async fn test_stderr_overflow_rejection() {
    let tmp = tempdir().unwrap();

    // Generate stderr stream larger than 64 KiB without ws:// token
    let large_garbage = vec![b'x'; MAX_STDERR_CAPTURE_BYTES + 1024];
    let mock_stderr = std::io::Cursor::new(large_garbage);

    let res = discover_ws_endpoint(mock_stderr, tmp.path()).await;
    assert!(matches!(res, Err(ProcessError::StderrOverflow)));
}

#[tokio::test]
async fn test_stderr_endpoint_without_trailing_newline_at_eof() {
    let tmp = tempdir().unwrap();
    let mock_stderr = std::io::Cursor::new(
        format!("DevTools listening on ws://127.0.0.1:9222/devtools/browser/{VALID_UUID}")
            .into_bytes(),
    );

    let res = discover_ws_endpoint(mock_stderr, tmp.path()).await;
    assert!(
        res.is_ok(),
        "expected successful endpoint discovery on EOF without newline: {:?}",
        res
    );
    let (endpoint, _) = res.unwrap();
    assert_eq!(
        endpoint,
        format!("ws://127.0.0.1:9222/devtools/browser/{VALID_UUID}")
    );
}

#[tokio::test]
async fn test_delayed_stderr_corroboration_matching_succeeds() {
    let tmp = tempdir().unwrap();
    let port_file = tmp.path().join("DevToolsActivePort");
    std::fs::write(
        &port_file,
        format!("9222\n/devtools/browser/{VALID_UUID}\n"),
    )
    .unwrap();

    let (mut client, server) = tokio::io::duplex(1024);
    tokio::spawn(async move {
        use tokio::io::AsyncWriteExt;
        tokio::time::sleep(Duration::from_millis(50)).await;
        let msg =
            format!("DevTools listening on ws://127.0.0.1:9222/devtools/browser/{VALID_UUID}\n");
        let _ = client.write_all(msg.as_bytes()).await;
    });

    let res = discover_ws_endpoint(server, tmp.path()).await;
    assert!(res.is_ok());
    let (endpoint, _) = res.unwrap();
    assert_eq!(
        endpoint,
        format!("ws://127.0.0.1:9222/devtools/browser/{VALID_UUID}")
    );
}

#[tokio::test]
async fn test_delayed_stderr_corroboration_mismatch_fails() {
    let tmp = tempdir().unwrap();
    let port_file = tmp.path().join("DevToolsActivePort");
    std::fs::write(
        &port_file,
        format!("9222\n/devtools/browser/{VALID_UUID}\n"),
    )
    .unwrap();

    let (mut client, server) = tokio::io::duplex(1024);
    tokio::spawn(async move {
        use tokio::io::AsyncWriteExt;
        tokio::time::sleep(Duration::from_millis(50)).await;
        let msg =
            format!("DevTools listening on ws://127.0.0.1:9999/devtools/browser/{VALID_UUID}\n");
        let _ = client.write_all(msg.as_bytes()).await;
    });

    let res = discover_ws_endpoint(server, tmp.path()).await;
    assert!(
        matches!(res, Err(ProcessError::InvalidEndpoint(msg)) if msg.contains("endpoint corroboration failed"))
    );
}

// Helper test process invoked only when DAM_HOPPER_TEST_HELPER_PARENT=1
#[cfg(unix)]
#[ignore]
#[tokio::test]
async fn helper_supervisor_sigkill_parent() {
    use std::io::Write;
    use std::os::unix::process::CommandExt;

    if std::env::var("DAM_HOPPER_TEST_HELPER_PARENT").as_deref() != Ok("1") {
        return;
    }

    let exec = match find_browser_executable(None) {
        Ok(p) => p,
        Err(_) => {
            println!("PARENT_HELPER_SKIP:no_browser");
            return;
        }
    };

    // 1. Spawn unrelated sibling process (simulating a PTY) in its own process group
    let sibling = std::process::Command::new("sleep")
        .arg("120")
        .process_group(0)
        .spawn()
        .expect("failed to spawn sibling PTY process");
    let sibling_pid = sibling.id();

    // 2. Launch BrowserProcess
    let tmp = tempdir().expect("failed to create tempdir");
    let mut config = BrowserLaunchConfig::new(tmp.path().join("helper-user-data"));
    config.headless = true;
    config.executable_path = if std::env::var("DAM_HOPPER_TEST_STUBBORN_DESCENDANT").as_deref()
        == Ok("1")
    {
        // The browser's group also holds a descendant that ignores SIGTERM.
        use std::os::unix::fs::PermissionsExt;
        let wrapper = tmp.path().join("stubborn_browser.sh");
        std::fs::write(
            &wrapper,
            format!(
                "#!/bin/sh\n( trap '' TERM; exec sleep 120 ) </dev/null >/dev/null 2>&1 &\nexec '{}' \"$@\"\n",
                exec.display()
            ),
        )
        .unwrap();
        std::fs::set_permissions(&wrapper, std::fs::Permissions::from_mode(0o755)).unwrap();
        Some(wrapper)
    } else {
        Some(exec)
    };

    let browser = match BrowserProcess::launch(config).await {
        Ok(b) => b,
        Err(e) => {
            eprintln!("PARENT_HELPER_LAUNCH_FAILED: {e}");
            return;
        }
    };

    let pgid = browser.pid() as i32;

    // 3. Emit readiness signal with pgid and sibling pid to stdout
    println!("PARENT_HELPER_READY:pgid={pgid}:sibling={sibling_pid}");
    let _ = std::io::stdout().flush();

    // 4. Block indefinitely awaiting SIGKILL from test runner
    tokio::time::sleep(Duration::from_secs(300)).await;
}

#[cfg(unix)]
#[tokio::test]
async fn test_supervisor_sigkill_containment() {
    run_supervisor_sigkill_containment(false).await;
}

/// A descendant ignoring SIGTERM only dies at the watcher's delayed KILL, delivered through
/// the pinned process-group object after the gap.
#[cfg(unix)]
#[tokio::test]
async fn test_supervisor_sigkill_kills_term_ignoring_descendant() {
    run_supervisor_sigkill_containment(true).await;
}

#[cfg(unix)]
async fn run_supervisor_sigkill_containment(stubborn_descendant: bool) {
    use nix::sys::signal::{kill, killpg, Signal};
    use nix::unistd::Pid;
    use std::io::{BufRead, BufReader};

    // Check if browser executable is available
    if find_browser_executable(None).is_err() {
        if std::env::var("DAM_HOPPER_REQUIRE_BROWSER").as_deref() == Ok("1") {
            panic!("DAM_HOPPER_REQUIRE_BROWSER=1 is set but no browser was found");
        }
        eprintln!("SKIP: No Chrome/Chromium executable available on this system.");
        return;
    }

    let current_exe = std::env::current_exe().expect("failed to get current_exe");
    let mut helper = std::process::Command::new(&current_exe)
        .arg("--exact")
        .arg("helper_supervisor_sigkill_parent")
        .arg("--ignored")
        .arg("--nocapture")
        .env("DAM_HOPPER_TEST_HELPER_PARENT", "1")
        .env(
            "DAM_HOPPER_TEST_STUBBORN_DESCENDANT",
            if stubborn_descendant { "1" } else { "0" },
        )
        .stdout(std::process::Stdio::piped())
        .stderr(std::process::Stdio::inherit())
        .spawn()
        .expect("failed to spawn helper supervisor process");

    let stdout = helper.stdout.take().expect("failed to take helper stdout");
    let mut reader = BufReader::new(stdout);
    let mut line = String::new();

    let mut pgid_opt: Option<i32> = None;
    let mut sibling_pid_opt: Option<u32> = None;

    let start_wait = std::time::Instant::now();
    while start_wait.elapsed() < Duration::from_secs(20) {
        line.clear();
        if reader.read_line(&mut line).unwrap_or(0) == 0 {
            break;
        }
        let trimmed = line.trim();
        if trimmed.starts_with("PARENT_HELPER_READY:") {
            let payload = &trimmed["PARENT_HELPER_READY:".len()..];
            for part in payload.split(':') {
                if let Some(val) = part.strip_prefix("pgid=") {
                    pgid_opt = val.parse::<i32>().ok();
                } else if let Some(val) = part.strip_prefix("sibling=") {
                    sibling_pid_opt = val.parse::<u32>().ok();
                }
            }
            break;
        } else if trimmed.starts_with("PARENT_HELPER_SKIP:") {
            eprintln!("Helper reported skip: {trimmed}");
            let _ = helper.kill();
            return;
        }
    }

    let pgid = pgid_opt.expect("helper failed to provide pgid within deadline");
    let sibling_pid =
        sibling_pid_opt.expect("helper failed to provide sibling_pid within deadline");

    // Assert that Chrome process group has active members
    let initial_count = live_members(pgid).expect("failed to check live members of Chrome pgid");
    assert!(
        initial_count > 0,
        "Chrome process group {pgid} should have active members initially"
    );

    // Assert that sibling process is alive
    assert!(
        kill(Pid::from_raw(sibling_pid as i32), None).is_ok(),
        "sibling process should be running"
    );

    // SIGKILL the helper supervisor parent process
    let helper_pid = helper.id() as i32;
    kill(Pid::from_raw(helper_pid), Signal::SIGKILL)
        .expect("failed to send SIGKILL to helper parent");
    let _ = helper.wait();

    // Verify bounded termination of Chrome process group descendants:
    // Both procfs non-zombie count must be 0 and kernel killpg must return ESRCH
    let poll_deadline = std::time::Instant::now() + Duration::from_secs(5);
    let mut clean = false;
    while std::time::Instant::now() < poll_deadline {
        let members = live_members(pgid).unwrap_or(1);
        let esrch = matches!(
            killpg(Pid::from_raw(pgid), None),
            Err(nix::errno::Errno::ESRCH)
        );
        if members == 0 && esrch {
            clean = true;
            break;
        }
        tokio::time::sleep(Duration::from_millis(50)).await;
    }

    assert!(clean, "all Chrome descendants in group {pgid} must terminate and be reaped after supervisor SIGKILL");

    // Kernel-authoritative proof: killpg returns ESRCH
    let res = killpg(Pid::from_raw(pgid), None);
    assert_eq!(
        res.unwrap_err(),
        nix::errno::Errno::ESRCH,
        "process group {pgid} must return ESRCH proving all descendants are reaped"
    );

    // Sibling process MUST still be ALIVE (unaffected by Chrome group termination)
    let sibling_alive = kill(Pid::from_raw(sibling_pid as i32), None).is_ok();
    assert!(
        sibling_alive,
        "unrelated sibling process {sibling_pid} (simulating PTY) must stay alive"
    );

    // Clean up sibling process
    let _ = kill(Pid::from_raw(sibling_pid as i32), Signal::SIGKILL);
}

// Regression test: supervisor SIGKILL immediately upon launch (testing the startup window)
#[cfg(unix)]
#[ignore]
#[tokio::test]
async fn helper_supervisor_sigkill_startup_window() {
    use std::io::Write;
    use std::os::unix::process::CommandExt;

    if std::env::var("DAM_HOPPER_TEST_HELPER_STARTUP").as_deref() != Ok("1") {
        return;
    }

    let exec = match find_browser_executable(None) {
        Ok(p) => p,
        Err(_) => {
            println!("STARTUP_HELPER_SKIP:no_browser");
            return;
        }
    };

    // Spawn unrelated sibling process (simulating PTY) in its own process group
    let sibling = std::process::Command::new("sleep")
        .arg("120")
        .process_group(0)
        .spawn()
        .expect("failed to spawn sibling PTY process");
    let sibling_pid = sibling.id();

    let tmp = tempdir().expect("failed to create tempdir");
    let mut config = BrowserLaunchConfig::new(tmp.path().join("startup-window-data"));
    config.executable_path = Some(exec);
    config.headless = true;

    let browser = match BrowserProcess::launch(config).await {
        Ok(b) => b,
        Err(e) => {
            eprintln!("STARTUP_HELPER_LAUNCH_FAILED: {e}");
            return;
        }
    };

    let pgid = browser.pid() as i32;
    // Immediately signal readiness upon spawn return
    println!("STARTUP_HELPER_READY:pgid={pgid}:sibling={sibling_pid}");
    let _ = std::io::stdout().flush();

    // Block indefinitely waiting for immediate SIGKILL
    tokio::time::sleep(Duration::from_secs(300)).await;
}

#[cfg(unix)]
#[tokio::test]
async fn test_supervisor_sigkill_startup_window() {
    use nix::sys::signal::{kill, killpg, Signal};
    use nix::unistd::Pid;
    use std::io::{BufRead, BufReader};

    if find_browser_executable(None).is_err() {
        if std::env::var("DAM_HOPPER_REQUIRE_BROWSER").as_deref() == Ok("1") {
            panic!("DAM_HOPPER_REQUIRE_BROWSER=1 is set but no browser was found");
        }
        eprintln!("SKIP: No Chrome/Chromium executable available on this system.");
        return;
    }

    let current_exe = std::env::current_exe().expect("failed to get current_exe");
    let mut helper = std::process::Command::new(&current_exe)
        .arg("--exact")
        .arg("helper_supervisor_sigkill_startup_window")
        .arg("--ignored")
        .arg("--nocapture")
        .env("DAM_HOPPER_TEST_HELPER_STARTUP", "1")
        .stdout(std::process::Stdio::piped())
        .stderr(std::process::Stdio::inherit())
        .spawn()
        .expect("failed to spawn helper supervisor startup process");

    let stdout = helper.stdout.take().expect("failed to take helper stdout");
    let mut reader = BufReader::new(stdout);
    let mut line = String::new();

    let mut pgid_opt: Option<i32> = None;
    let mut sibling_pid_opt: Option<u32> = None;

    let start_wait = std::time::Instant::now();
    while start_wait.elapsed() < Duration::from_secs(20) {
        line.clear();
        if reader.read_line(&mut line).unwrap_or(0) == 0 {
            break;
        }
        let trimmed = line.trim();
        if trimmed.starts_with("STARTUP_HELPER_READY:") {
            let payload = &trimmed["STARTUP_HELPER_READY:".len()..];
            for part in payload.split(':') {
                if let Some(val) = part.strip_prefix("pgid=") {
                    pgid_opt = val.parse::<i32>().ok();
                } else if let Some(val) = part.strip_prefix("sibling=") {
                    sibling_pid_opt = val.parse::<u32>().ok();
                }
            }
            break;
        } else if trimmed.starts_with("STARTUP_HELPER_SKIP:") {
            eprintln!("Helper reported skip: {trimmed}");
            let _ = helper.kill();
            return;
        }
    }

    let pgid = pgid_opt.expect("helper failed to provide pgid within deadline");
    let sibling_pid =
        sibling_pid_opt.expect("helper failed to provide sibling_pid within deadline");

    // IMMEDIATELY SIGKILL the helper supervisor parent process in the startup window
    let helper_pid = helper.id() as i32;
    kill(Pid::from_raw(helper_pid), Signal::SIGKILL)
        .expect("failed to send SIGKILL to helper parent");
    let _ = helper.wait();

    // Verify bounded termination of Chrome process group descendants:
    // Both procfs non-zombie count must be 0 and kernel killpg must return ESRCH
    let poll_deadline = std::time::Instant::now() + Duration::from_secs(5);
    let mut clean = false;
    while std::time::Instant::now() < poll_deadline {
        let members = live_members(pgid).unwrap_or(1);
        let esrch = matches!(
            killpg(Pid::from_raw(pgid), None),
            Err(nix::errno::Errno::ESRCH)
        );
        if members == 0 && esrch {
            clean = true;
            break;
        }
        tokio::time::sleep(Duration::from_millis(50)).await;
    }

    assert!(clean, "all Chrome descendants in group {pgid} must terminate after early supervisor SIGKILL in startup window");

    // Kernel-authoritative proof: killpg returns ESRCH
    let res = killpg(Pid::from_raw(pgid), None);
    assert_eq!(
        res.unwrap_err(),
        nix::errno::Errno::ESRCH,
        "process group {pgid} must return ESRCH proving all descendants are reaped"
    );

    // Sibling process MUST still be ALIVE (unaffected by Chrome group termination)
    let sibling_alive = kill(Pid::from_raw(sibling_pid as i32), None).is_ok();
    assert!(
        sibling_alive,
        "unrelated sibling process {sibling_pid} (simulating PTY) must stay alive"
    );

    // Clean up sibling process
    let _ = kill(Pid::from_raw(sibling_pid as i32), Signal::SIGKILL);
}

#[cfg(unix)]
#[tokio::test]
async fn test_watcher_arming_failure_fails_closed_and_cleans_up_chrome() {
    let exec = match find_browser_executable(None) {
        Ok(p) => p,
        Err(_) => {
            if std::env::var("DAM_HOPPER_REQUIRE_BROWSER").as_deref() == Ok("1") {
                panic!("DAM_HOPPER_REQUIRE_BROWSER=1 is set but no browser was found");
            }
            eprintln!("SKIP: No Chrome/Chromium executable available on this system.");
            return;
        }
    };

    let tmp = tempdir().unwrap();
    let mut config = BrowserLaunchConfig::new(tmp.path().join("watcher-fail-data"));
    config.executable_path = Some(exec);
    config.headless = true;
    // Arm failure test: the watcher's setup succeeds but its arming step reports an errno
    config._test_mock_watcher_arming_fail = true;

    let res = BrowserProcess::launch(config).await;

    // Launch MUST fail closed with LaunchFailed
    assert!(
        matches!(&res, Err(ProcessError::LaunchFailed(msg)) if msg.contains("supervisor watcher arming failed")),
        "launch must fail closed when watcher arming fails"
    );

    // Bounded sleep to ensure guard cleanup took effect
    tokio::time::sleep(Duration::from_millis(150)).await;

    // Verify zero Chrome sleeper or descendant processes survive
    #[cfg(target_os = "linux")]
    {
        let survivors = procfs::process::all_processes()
            .unwrap()
            .filter_map(Result::ok)
            .filter_map(|p| p.cmdline().ok())
            .filter(|cmd| cmd.iter().any(|arg| arg.contains("watcher-fail-data")))
            .count();
        assert_eq!(
            survivors, 0,
            "no Chrome processes should survive failed watcher initialization"
        );
    }
}

/// Kernels without `PIDFD_SIGNAL_PROCESS_GROUP` (< 6.9) are unsupported: the watcher cannot
/// identify the launch's group without trusting a recyclable number, so launch fails closed
/// (no per-member fallback) and leaves no browser process behind.
#[cfg(unix)]
#[tokio::test]
async fn test_watcher_unsupported_kernel_fails_closed_and_cleans_up_chrome() {
    let exec = match find_browser_executable(None) {
        Ok(p) => p,
        Err(_) => {
            if std::env::var("DAM_HOPPER_REQUIRE_BROWSER").as_deref() == Ok("1") {
                panic!("DAM_HOPPER_REQUIRE_BROWSER=1 is set but no browser was found");
            }
            eprintln!("SKIP: No Chrome/Chromium executable available on this system.");
            return;
        }
    };

    let tmp = tempdir().unwrap();
    let mut config = BrowserLaunchConfig::new(tmp.path().join("watcher-old-kernel-data"));
    config.executable_path = Some(exec);
    config.headless = true;
    config._test_force_watcher_group_signal_unsupported = true;

    let res = BrowserProcess::launch(config).await;
    assert!(
        matches!(&res, Err(ProcessError::LaunchFailed(msg))
            if msg.contains("supervisor watcher arming failed") && msg.contains("6.9")),
        "launch must fail closed on a kernel without process-group pidfd signalling: {:?}",
        res.as_ref().err()
    );

    tokio::time::sleep(Duration::from_millis(150)).await;
    #[cfg(target_os = "linux")]
    {
        let survivors = procfs::process::all_processes()
            .unwrap()
            .filter_map(Result::ok)
            .filter_map(|p| p.cmdline().ok())
            .filter(|cmd| {
                cmd.iter()
                    .any(|arg| arg.contains("watcher-old-kernel-data"))
            })
            .count();
        assert_eq!(
            survivors, 0,
            "no Chrome processes may survive the rejection"
        );
    }
}

#[cfg(unix)]
#[tokio::test]
async fn test_watcher_pre_exec_failure_fails_closed_and_cleans_up_chrome() {
    let exec = match find_browser_executable(None) {
        Ok(p) => p,
        Err(_) => {
            if std::env::var("DAM_HOPPER_REQUIRE_BROWSER").as_deref() == Ok("1") {
                panic!("DAM_HOPPER_REQUIRE_BROWSER=1 is set but no browser was found");
            }
            eprintln!("SKIP: No Chrome/Chromium executable available on this system.");
            return;
        }
    };

    let tmp = tempdir().unwrap();
    let mut config = BrowserLaunchConfig::new(tmp.path().join("watcher-pre-fail-data"));
    config.executable_path = Some(exec);
    config.headless = true;
    // Arm failure test: force grandchild watcher to simulate pre-exec exit before writing PID
    config._test_mock_watcher_pre_exec_fail = true;

    let res = BrowserProcess::launch(config).await;

    // Launch MUST fail closed with LaunchFailed
    assert!(
        matches!(&res, Err(ProcessError::LaunchFailed(msg)) if msg.contains("supervisor watcher pre-exec setup failed")),
        "launch must fail closed when watcher pre-exec setup fails"
    );

    // Bounded sleep to ensure guard cleanup took effect
    tokio::time::sleep(Duration::from_millis(150)).await;

    // Verify zero Chrome sleeper or descendant processes survive
    #[cfg(target_os = "linux")]
    {
        let survivors = procfs::process::all_processes()
            .unwrap()
            .filter_map(Result::ok)
            .filter_map(|p| p.cmdline().ok())
            .filter(|cmd| cmd.iter().any(|arg| arg.contains("watcher-pre-fail-data")))
            .count();
        assert_eq!(
            survivors, 0,
            "no Chrome processes should survive failed watcher pre-exec setup"
        );
    }
}

// ---------------------------------------------------------------------------------------------
// Prior-tree reconciliation (L6): identity-verified absence proof with real processes.
// ---------------------------------------------------------------------------------------------

#[cfg(target_os = "linux")]
mod prior_tree {
    use super::*;
    use dam_hopper_server::browser_host::process::{
        inspect_prior_tree, reap_prior_tree, ContainmentIdentity, ReapTimings, TreeState,
        LAUNCH_TOKEN_ENV,
    };
    use nix::sys::signal::{kill, killpg, Signal};
    use nix::unistd::Pid;
    use std::os::unix::process::CommandExt;
    use std::process::{Command, Stdio};

    fn timings(settle_ms: u64) -> ReapTimings {
        ReapTimings {
            settle: Duration::from_millis(settle_ms),
            term_grace: Duration::from_secs(2),
            proof: Duration::from_secs(2),
        }
    }

    /// Shell leader of its own group plus two sleeping descendants; the leader is reaped by a
    /// thread so a dead tree leaves no zombie.
    async fn spawn_tree(token: Option<&str>) -> (u32, std::thread::JoinHandle<()>) {
        let mut cmd = Command::new("sh");
        cmd.arg("-c")
            .arg("sleep 300 & sleep 300 & wait")
            .stdin(Stdio::null())
            .stdout(Stdio::null())
            .stderr(Stdio::null())
            .process_group(0);
        if let Some(token) = token {
            cmd.env(LAUNCH_TOKEN_ENV, token);
        }
        let mut child = cmd.spawn().unwrap();
        let pid = child.id();
        let waiter = std::thread::spawn(move || {
            let _ = child.wait();
        });
        for _ in 0..100 {
            if live_members(pid as i32).unwrap() >= 3 {
                return (pid, waiter);
            }
            tokio::time::sleep(Duration::from_millis(50)).await;
        }
        panic!("tree did not start");
    }

    fn group_gone(pgid: i32) -> bool {
        live_members(pgid).unwrap() == 0
    }

    fn destroy(pgid: i32, waiter: std::thread::JoinHandle<()>) {
        let _ = killpg(Pid::from_raw(pgid), Signal::SIGKILL);
        let _ = waiter.join();
    }

    #[tokio::test]
    async fn test_reap_terminates_verified_owner_and_proves_every_descendant_absent() {
        let dir = tempdir().unwrap();
        let token = "reap-owner-token";
        let (pid, waiter) = spawn_tree(Some(token)).await;
        let pgid = pid as i32;
        let identity = ContainmentIdentity::capture(pid, Some(pgid), Some(token.to_string()));
        assert!(identity.start_ticks.is_some() && identity.boot_id.is_some());

        reap_prior_tree(&identity, dir.path(), timings(100))
            .await
            .expect("verified owner must be terminated and proven absent");
        assert!(group_gone(pgid), "all descendants must be absent");
        assert!(matches!(
            inspect_prior_tree(&identity, dir.path()).unwrap(),
            TreeState::Absent
        ));
        destroy(pgid, waiter);
    }

    #[tokio::test]
    async fn test_reap_never_signals_unverifiable_group() {
        let dir = tempdir().unwrap();
        let (pid, waiter) = spawn_tree(None).await;
        let pgid = pid as i32;
        // Bare pid/pgid (legacy record): nothing proves the live group is the prior browser.
        let legacy = ContainmentIdentity {
            pid: Some(pid),
            pgid: Some(pgid),
            ..Default::default()
        };
        let res = reap_prior_tree(&legacy, dir.path(), timings(150)).await;
        assert!(
            matches!(res, Err(ProcessError::OwnershipAmbiguous(_))),
            "{res:?}"
        );
        assert!(
            !group_gone(pgid),
            "an unverified group must never be signalled"
        );

        // A different boot id proves the whole tree gone without touching live processes.
        let other_boot = ContainmentIdentity {
            boot_id: Some("00000000-0000-0000-0000-000000000000".to_string()),
            ..legacy
        };
        reap_prior_tree(&other_boot, dir.path(), timings(0))
            .await
            .unwrap();
        assert!(
            !group_gone(pgid),
            "a previous-boot identity must not signal anything"
        );
        destroy(pgid, waiter);
    }

    #[tokio::test]
    async fn test_reap_ignores_reused_pid_with_different_start_time() {
        let dir = tempdir().unwrap();
        let (pid, waiter) = spawn_tree(None).await;
        let pgid = pid as i32;
        let mut identity = ContainmentIdentity::capture(pid, Some(pgid), None);
        identity.start_ticks = identity.start_ticks.map(|t| t + 1_000_000);
        reap_prior_tree(&identity, dir.path(), timings(0))
            .await
            .unwrap();
        assert!(
            !group_gone(pgid),
            "a reused pid number must never be killed"
        );
        destroy(pgid, waiter);
    }

    #[tokio::test]
    async fn test_reap_kills_descendant_that_left_the_process_group_by_launch_token() {
        use std::io::{BufRead, BufReader};
        let dir = tempdir().unwrap();
        let token = "reap-stray-token";
        let mut child = Command::new("sh")
            .arg("-c")
            .arg("setsid sleep 300 & echo $!")
            .env(LAUNCH_TOKEN_ENV, token)
            .stdin(Stdio::null())
            .stdout(Stdio::piped())
            .stderr(Stdio::null())
            .process_group(0)
            .spawn()
            .unwrap();
        let mut line = String::new();
        BufReader::new(child.stdout.take().unwrap())
            .read_line(&mut line)
            .unwrap();
        let stray: i32 = line.trim().parse().expect("stray pid");
        let pid = child.id();
        let identity = ContainmentIdentity::capture(pid, Some(pid as i32), Some(token.to_string()));
        let _ = child.wait();

        assert!(
            kill(Pid::from_raw(stray), None).is_ok(),
            "stray must be running"
        );
        assert!(
            matches!(
                inspect_prior_tree(&identity, dir.path()).unwrap(),
                TreeState::Owned(_)
            ),
            "token-marked process outside the group is part of the tree"
        );
        reap_prior_tree(&identity, dir.path(), timings(0))
            .await
            .unwrap();
        let mut gone = false;
        for _ in 0..40 {
            if kill(Pid::from_raw(stray), None).is_err() {
                gone = true;
                break;
            }
            tokio::time::sleep(Duration::from_millis(50)).await;
        }
        assert!(
            gone,
            "descendant outside the group must be terminated via its verified identity"
        );
    }
}

// Helper process: a production manager owning a real browser whose group also holds a
// SIGTERM-ignoring descendant. Invoked only when DAM_HOPPER_TEST_HELPER_MANAGER=1.
#[cfg(target_os = "linux")]
#[ignore]
#[tokio::test]
async fn helper_manager_owner_for_replacement_race() {
    use dam_hopper_server::browser_host::config::BrowserHostConfig;
    use dam_hopper_server::browser_host::manager::BrowserHostManager;
    use std::io::Write;
    use tokio_util::sync::CancellationToken;

    if std::env::var("DAM_HOPPER_TEST_HELPER_MANAGER").as_deref() != Ok("1") {
        return;
    }
    let root = std::path::PathBuf::from(std::env::var("DAM_HOPPER_TEST_PROFILE_ROOT").unwrap());
    let exec = std::path::PathBuf::from(std::env::var("DAM_HOPPER_TEST_EXEC").unwrap());
    let config = BrowserHostConfig {
        enabled: true,
        executable_path: Some(exec),
        ..Default::default()
    };
    let manager = BrowserHostManager::new(config, Some(root), CancellationToken::new());
    match manager.ensure_running("race-user", false).await {
        Ok(handle) => {
            println!("MANAGER_HELPER_READY:pgid={}", handle.pid);
            let _ = std::io::stdout().flush();
            tokio::time::sleep(Duration::from_secs(300)).await;
        }
        Err(e) => {
            println!("MANAGER_HELPER_FAILED:{e}");
            let _ = std::io::stdout().flush();
        }
    }
}

#[cfg(target_os = "linux")]
#[tokio::test]
async fn test_replacement_manager_cannot_race_surviving_tree_after_supervisor_sigkill() {
    use dam_hopper_server::browser_host::config::BrowserHostConfig;
    use dam_hopper_server::browser_host::manager::BrowserHostManager;
    use nix::sys::signal::{kill, killpg, Signal};
    use nix::unistd::Pid;
    use std::io::{BufRead, BufReader};
    use std::os::unix::fs::PermissionsExt;
    use tokio_util::sync::CancellationToken;

    let real = match find_browser_executable(None).ok().or_else(|| {
        [
            "/usr/bin/google-chrome",
            "/usr/bin/chromium-browser",
            "/usr/bin/chromium",
        ]
        .iter()
        .map(std::path::PathBuf::from)
        .find(|p| p.is_file())
    }) {
        Some(p) => p,
        None => {
            if std::env::var("DAM_HOPPER_REQUIRE_BROWSER").as_deref() == Ok("1") {
                panic!("DAM_HOPPER_REQUIRE_BROWSER=1 is set but no browser was found");
            }
            eprintln!("SKIP: No Chrome/Chromium executable available on this system.");
            return;
        }
    };

    let work = tempdir().unwrap();
    let root = work.path().join("profiles");
    // First launch: add a descendant that ignores SIGTERM, so the browser group outlives the
    // death watcher's TERM and only dies at its KILL half a second later. Replacement launch
    // (watch_pgid present): record whether the old group was already gone.
    let wrapper = work.path().join("browser_wrapper.sh");
    fs_write_script(
        &wrapper,
        &format!(
            r#"#!/bin/sh
ROOT='{work}'
if [ -f "$ROOT/watch_pgid" ]; then
  OLD=$(cat "$ROOT/watch_pgid")
  if kill -s 0 -- "-$OLD" 2>/dev/null; then echo DIRTY > "$ROOT/verdict"; else echo CLEAN > "$ROOT/verdict"; fi
else
  ( trap '' TERM; exec sleep 30 ) </dev/null >/dev/null 2>&1 &
fi
exec '{real}' "$@"
"#,
            work = work.path().display(),
            real = real.display()
        ),
    );
    let _ = std::fs::set_permissions(&wrapper, std::fs::Permissions::from_mode(0o755));

    let current_exe = std::env::current_exe().unwrap();
    let mut helper = std::process::Command::new(&current_exe)
        .arg("--exact")
        .arg("helper_manager_owner_for_replacement_race")
        .arg("--ignored")
        .arg("--nocapture")
        .env("DAM_HOPPER_TEST_HELPER_MANAGER", "1")
        .env("DAM_HOPPER_TEST_PROFILE_ROOT", &root)
        .env("DAM_HOPPER_TEST_EXEC", &wrapper)
        .stdout(std::process::Stdio::piped())
        .stderr(std::process::Stdio::inherit())
        .spawn()
        .expect("failed to spawn helper manager process");

    let mut reader = BufReader::new(helper.stdout.take().unwrap());
    let mut line = String::new();
    let mut old_pgid: Option<i32> = None;
    let start = std::time::Instant::now();
    while start.elapsed() < Duration::from_secs(40) {
        line.clear();
        if reader.read_line(&mut line).unwrap_or(0) == 0 {
            break;
        }
        if let Some(val) = line.trim().strip_prefix("MANAGER_HELPER_READY:pgid=") {
            old_pgid = val.parse().ok();
            break;
        }
        if line.trim().starts_with("MANAGER_HELPER_FAILED:") {
            let _ = helper.kill();
            panic!(
                "helper manager could not launch the browser: {}",
                line.trim()
            );
        }
    }
    let old_pgid = old_pgid.expect("helper manager did not report its browser group");
    std::fs::write(work.path().join("watch_pgid"), old_pgid.to_string()).unwrap();
    assert!(
        live_members(old_pgid).unwrap() >= 2,
        "old browser group must hold the stubborn descendant"
    );

    // Parent death: the OS releases the profile flock at once while the death watcher is still
    // between SIGTERM and SIGKILL.
    kill(Pid::from_raw(helper.id() as i32), Signal::SIGKILL).unwrap();
    let _ = helper.wait();
    assert!(
        live_members(old_pgid).unwrap() > 0,
        "the TERM-to-KILL gap must be open when the replacement starts"
    );

    let config = BrowserHostConfig {
        enabled: true,
        executable_path: Some(wrapper.clone()),
        ..Default::default()
    };
    let replacement = BrowserHostManager::new(config, Some(root), CancellationToken::new());
    let handle = replacement
        .ensure_running("race-user", false)
        .await
        .expect("replacement manager must launch once the old tree is proven absent");

    assert_eq!(
        std::fs::read_to_string(work.path().join("verdict"))
            .unwrap()
            .trim(),
        "CLEAN",
        "the replacement browser must not start while the old tree survives"
    );
    assert!(
        matches!(
            killpg(Pid::from_raw(old_pgid), None),
            Err(nix::errno::Errno::ESRCH)
        ),
        "old group {old_pgid} must be fully gone"
    );
    assert_ne!(handle.pid as i32, old_pgid);
    replacement.shutdown_all().await;
}

#[cfg(target_os = "linux")]
fn fs_write_script(path: &Path, body: &str) {
    std::fs::write(path, body).unwrap();
}

#[tokio::test]
async fn test_automation_controlled_allowlist_and_chrome_identity() {
    use dam_hopper_server::browser_host::stealth::{
        sanitize_headless_request_headers, ChromeIdentity, ANTI_DETECTION_SCRIPT,
        DEFAULT_CHROME_VERSION,
    };
    use serde_json::json;

    let tmp = tempdir().unwrap();
    for bad_blink_flag in [
        "--disable-blink-features=SitePerProcess",
        "--disable-blink-features=AutomationControlled,WebSecurity",
        "--disable-blink-features=",
    ] {
        let mut config = BrowserLaunchConfig::new(tmp.path().to_path_buf());
        config.additional_args.push(bad_blink_flag.to_string());
        let res = BrowserProcess::launch(config).await;
        assert!(
            matches!(res, Err(ProcessError::LaunchFailed(_))),
            "flag '{bad_blink_flag}' should have been rejected by allowlist"
        );
    }

    let mut ok_config = BrowserLaunchConfig::new(tmp.path().to_path_buf());
    ok_config.executable_path = Some(Path::new("/nonexistent/chrome_bin").to_path_buf());
    ok_config
        .additional_args
        .push("--disable-blink-features=AutomationControlled".to_string());
    // Passes allowlist check and fails at executable lookup
    let res = BrowserProcess::launch(ok_config).await;
    assert!(matches!(res, Err(ProcessError::ExecutableNotFound(_))));

    let parsed = ChromeIdentity::from_version_str(Some(
        "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) HeadlessChrome/144.0.7559.177 Safari/537.36",
    ));
    assert_eq!(parsed.full_version, "144.0.7559.177");
    assert_eq!(parsed.major_version, "144");
    assert!(parsed.user_agent.contains("Chrome/144.0.0.0 Safari/537.36"));
    assert!(!parsed.user_agent.contains("HeadlessChrome"));
    let params = parsed.user_agent_override_params();
    assert_eq!(params["userAgent"], parsed.user_agent);
    assert_eq!(
        params["userAgentMetadata"]["brands"],
        json!([
            { "brand": "Not;A=Brand", "version": "8" },
            { "brand": "Chromium", "version": "144" },
            { "brand": "Google Chrome", "version": "144" }
        ])
    );
    assert_eq!(
        params["userAgentMetadata"]["fullVersionList"][2]["version"],
        "144.0.7559.177"
    );

    let from_payload = ChromeIdentity::from_get_version(Some(&json!({
        "product": "Chrome/156.0.8078.79",
        "userAgent": "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) HeadlessChrome/156.0.0.0 Safari/537.36"
    })));
    assert_eq!(from_payload.full_version, "156.0.8078.79");
    assert_eq!(from_payload.major_version, "156");
    assert!(from_payload.user_agent.contains("Chrome/156.0.0.0"));
    assert_eq!(
        from_payload.user_agent_override_params()["acceptLanguage"],
        "en-US,en"
    );

    for malformed in [None, Some(""), Some("HeadlessChrome/not-a-version"), Some("0.0.0")] {
        let fallback = ChromeIdentity::from_version_str(malformed);
        assert_eq!(fallback.full_version, DEFAULT_CHROME_VERSION);
        assert_eq!(fallback.major_version, "136");
    }

    assert!(sanitize_headless_request_headers(None).is_none());
    assert!(sanitize_headless_request_headers(Some(&json!({
        "User-Agent": "Mozilla/5.0 Chrome/136.0.0.0 Safari/537.36",
        "sec-ch-ua": "\"Not;A=Brand\";v=\"8\", \"Chromium\";v=\"136\", \"Google Chrome\";v=\"136\""
    })))
    .is_none());

    let rewritten = sanitize_headless_request_headers(Some(&json!({
        "User-Agent": "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 HeadlessChrome/144.0.7559.177 Safari/537.36",
        "sec-ch-ua": "\"Not;A=Brand\";v=\"8\", \"Chromium\";v=\"144\", \"HeadlessChrome\";v=\"144\"",
        "Accept": "text/html"
    })))
    .expect("headers with HeadlessChrome should be sanitized");
    let map: std::collections::HashMap<String, String> = rewritten
        .into_iter()
        .map(|entry| {
            (
                entry["name"].as_str().unwrap().to_string(),
                entry["value"].as_str().unwrap().to_string(),
            )
        })
        .collect();
    assert!(map["User-Agent"].contains("Chrome/144.0.0.0"));
    assert!(!map["User-Agent"].contains("HeadlessChrome"));
    assert!(map["sec-ch-ua"].contains("Google Chrome"));
    assert!(!map["sec-ch-ua"].contains("HeadlessChrome"));
    assert_eq!(map["Accept"], "text/html");
    let mut autoplay_ok = BrowserLaunchConfig::new(tmp.path().to_path_buf());
    autoplay_ok.executable_path = Some(Path::new("/nonexistent/dam_hopper_chrome_bin").to_path_buf());
    autoplay_ok
        .additional_args
        .push("--autoplay-policy=no-user-gesture-required".to_string());
    assert!(
        matches!(
            BrowserProcess::launch(autoplay_ok).await,
            Err(ProcessError::ExecutableNotFound(_))
        ),
        "--autoplay-policy=no-user-gesture-required must pass allowlist"
    );

    for rejected_autoplay in [
        "--autoplay-policy=document-user-activation-required",
        "--autoplay-policy=user-gesture-required",
        "--autoplay-policy=",
    ] {
        let mut bad = BrowserLaunchConfig::new(tmp.path().to_path_buf());
        bad.additional_args.push(rejected_autoplay.to_string());
        assert!(
            matches!(
                BrowserProcess::launch(bad).await,
                Err(ProcessError::LaunchFailed(_))
            ),
            "{rejected_autoplay} must be rejected by allowlist"
        );
    }

    assert!(ANTI_DETECTION_SCRIPT.contains("webdriver"));
    assert!(ANTI_DETECTION_SCRIPT.contains("Google Chrome"));
    assert!(ANTI_DETECTION_SCRIPT.contains("canPlayType"));
    assert!(ANTI_DETECTION_SCRIPT.contains("isTypeSupported"));
    assert!(ANTI_DETECTION_SCRIPT.contains("Symbol.for('dh.a')"));
}
