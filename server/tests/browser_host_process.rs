use std::path::Path;
use std::time::Duration;
use tempfile::tempdir;

use dam_hopper_server::browser_host::process::{
    discover_ws_endpoint, find_browser_executable, is_canonical_uuid, validate_browser_path,
    validate_loopback_endpoint, BrowserLaunchConfig, BrowserProcess, ProcessError,
    MAX_STDERR_CAPTURE_BYTES,
};
#[cfg(unix)]
use dam_hopper_server::browser_host::process::live_members;

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
    assert!(!is_canonical_uuid("e90e79e7-5782-4281-b83a-1dc27f852305/extra"));
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
    assert!(validate_loopback_endpoint(&format!("ws://127.0.0.1:9222/devtools/browser/{VALID_UUID}")).is_ok());
    assert!(validate_loopback_endpoint(&format!("ws://[::1]:9222/devtools/browser/{VALID_UUID}")).is_ok());
    assert!(validate_loopback_endpoint(&format!("ws://localhost:9222/devtools/browser/{VALID_UUID}")).is_ok());

    // Non-canonical UUID paths must be rejected
    assert!(validate_loopback_endpoint("ws://127.0.0.1:9222/devtools/browser/123").is_err());
    assert!(validate_loopback_endpoint("ws://127.0.0.1:9222/devtools/browser/abc-123").is_err());
    assert!(validate_loopback_endpoint("ws://127.0.0.1:9222/devtools/browser/").is_err());
    assert!(validate_loopback_endpoint("ws://127.0.0.1:9222/devtools/browser/E90E79E7-5782-4281-B83A-1DC27F852305").is_err());
    assert!(validate_loopback_endpoint(&format!("ws://127.0.0.1:9222/devtools/browser/{VALID_UUID}/extra")).is_err());
    assert!(validate_loopback_endpoint(&format!("ws://127.0.0.1:9222/devtools/browser/{VALID_UUID}?q=1")).is_err());
    assert!(validate_loopback_endpoint(&format!("ws://127.0.0.1:9222/devtools/browser/{VALID_UUID}#frag")).is_err());

    // Non-loopback endpoints MUST be rejected
    assert!(validate_loopback_endpoint(&format!("ws://192.168.1.100:9222/devtools/browser/{VALID_UUID}")).is_err());
    assert!(validate_loopback_endpoint(&format!("ws://0.0.0.0:9222/devtools/browser/{VALID_UUID}")).is_err());
    assert!(validate_loopback_endpoint(&format!("ws://10.0.0.1:9222/devtools/browser/{VALID_UUID}")).is_err());
    assert!(validate_loopback_endpoint(&format!("ws://google.com/devtools/browser/{VALID_UUID}")).is_err());
}

#[test]
fn test_validate_loopback_endpoint_strict_rejections() {
    // Scheme must be ws
    assert!(validate_loopback_endpoint(&format!("http://127.0.0.1:9222/devtools/browser/{VALID_UUID}")).is_err());
    // Port must be explicit and > 0
    assert!(validate_loopback_endpoint(&format!("ws://127.0.0.1/devtools/browser/{VALID_UUID}")).is_err());
    assert!(validate_loopback_endpoint(&format!("ws://127.0.0.1:0/devtools/browser/{VALID_UUID}")).is_err());
    // Credentials forbidden
    assert!(validate_loopback_endpoint(&format!("ws://user:pass@127.0.0.1:9222/devtools/browser/{VALID_UUID}")).is_err());
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

#[tokio::test]
async fn test_find_browser_executable_requires_explicit_configuration() {
    // When DAM_HOPPER_BROWSER_EXECUTABLE is not set, find_browser_executable(None) MUST fail closed.
    // Automatic PATH and standard-location discovery is disabled per architecture-contracts §2.
    let saved_env = std::env::var("DAM_HOPPER_BROWSER_EXECUTABLE").ok();
    std::env::remove_var("DAM_HOPPER_BROWSER_EXECUTABLE");

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

    // Restore environment
    if let Some(val) = saved_env {
        std::env::set_var("DAM_HOPPER_BROWSER_EXECUTABLE", val);
    }
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
        assert_eq!(survivors, 0, "no background sleeper descendant should survive failed launch");
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

    let mut process = BrowserProcess::launch(config).await.expect("failed to launch browser");

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
    std::fs::write(&port_file, format!("9222\n/devtools/browser/{VALID_UUID}\n")).unwrap();

    let mock_stderr = std::io::Cursor::new(
        format!("Random log line\nDevTools listening on ws://127.0.0.1:9222/devtools/browser/{VALID_UUID}\nMore logs\n").into_bytes()
    );

    let res = discover_ws_endpoint(mock_stderr, tmp.path()).await;
    assert!(res.is_ok());
    let (endpoint, _) = res.unwrap();
    assert_eq!(endpoint, format!("ws://127.0.0.1:9222/devtools/browser/{VALID_UUID}"));
}

#[tokio::test]
async fn test_corroboration_mismatch_fails() {
    let tmp = tempdir().unwrap();
    let port_file = tmp.path().join("DevToolsActivePort");
    // Port file says port 9222
    std::fs::write(&port_file, format!("9222\n/devtools/browser/{VALID_UUID}\n")).unwrap();

    // Stderr says port 9999 (mismatched)
    let mock_stderr = std::io::Cursor::new(
        format!("DevTools listening on ws://127.0.0.1:9999/devtools/browser/{VALID_UUID}\n").into_bytes()
    );

    let res = discover_ws_endpoint(mock_stderr, tmp.path()).await;
    assert!(matches!(res, Err(ProcessError::InvalidEndpoint(msg)) if msg.contains("endpoint corroboration failed")));
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
        format!("DevTools listening on ws://127.0.0.1:9222/devtools/browser/{VALID_UUID}").into_bytes()
    );

    let res = discover_ws_endpoint(mock_stderr, tmp.path()).await;
    assert!(res.is_ok(), "expected successful endpoint discovery on EOF without newline: {:?}", res);
    let (endpoint, _) = res.unwrap();
    assert_eq!(endpoint, format!("ws://127.0.0.1:9222/devtools/browser/{VALID_UUID}"));
}

#[tokio::test]
async fn test_delayed_stderr_corroboration_matching_succeeds() {
    let tmp = tempdir().unwrap();
    let port_file = tmp.path().join("DevToolsActivePort");
    std::fs::write(&port_file, format!("9222\n/devtools/browser/{VALID_UUID}\n")).unwrap();

    let (mut client, server) = tokio::io::duplex(1024);
    tokio::spawn(async move {
        use tokio::io::AsyncWriteExt;
        tokio::time::sleep(Duration::from_millis(50)).await;
        let msg = format!("DevTools listening on ws://127.0.0.1:9222/devtools/browser/{VALID_UUID}\n");
        let _ = client.write_all(msg.as_bytes()).await;
    });

    let res = discover_ws_endpoint(server, tmp.path()).await;
    assert!(res.is_ok());
    let (endpoint, _) = res.unwrap();
    assert_eq!(endpoint, format!("ws://127.0.0.1:9222/devtools/browser/{VALID_UUID}"));
}

#[tokio::test]
async fn test_delayed_stderr_corroboration_mismatch_fails() {
    let tmp = tempdir().unwrap();
    let port_file = tmp.path().join("DevToolsActivePort");
    std::fs::write(&port_file, format!("9222\n/devtools/browser/{VALID_UUID}\n")).unwrap();

    let (mut client, server) = tokio::io::duplex(1024);
    tokio::spawn(async move {
        use tokio::io::AsyncWriteExt;
        tokio::time::sleep(Duration::from_millis(50)).await;
        let msg = format!("DevTools listening on ws://127.0.0.1:9999/devtools/browser/{VALID_UUID}\n");
        let _ = client.write_all(msg.as_bytes()).await;
    });

    let res = discover_ws_endpoint(server, tmp.path()).await;
    assert!(matches!(res, Err(ProcessError::InvalidEndpoint(msg)) if msg.contains("endpoint corroboration failed")));
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
    config.executable_path = Some(exec);
    config.headless = true;

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
    use std::io::{BufRead, BufReader};
    use nix::sys::signal::{kill, killpg, Signal};
    use nix::unistd::Pid;

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
    let sibling_pid = sibling_pid_opt.expect("helper failed to provide sibling_pid within deadline");

    // Assert that Chrome process group has active members
    let initial_count = live_members(pgid).expect("failed to check live members of Chrome pgid");
    assert!(initial_count > 0, "Chrome process group {pgid} should have active members initially");

    // Assert that sibling process is alive
    assert!(
        kill(Pid::from_raw(sibling_pid as i32), None).is_ok(),
        "sibling process should be running"
    );

    // SIGKILL the helper supervisor parent process
    let helper_pid = helper.id() as i32;
    kill(Pid::from_raw(helper_pid), Signal::SIGKILL).expect("failed to send SIGKILL to helper parent");
    let _ = helper.wait();

    // Verify bounded termination of Chrome process group descendants:
    // Both procfs non-zombie count must be 0 and kernel killpg must return ESRCH
    let poll_deadline = std::time::Instant::now() + Duration::from_secs(5);
    let mut clean = false;
    while std::time::Instant::now() < poll_deadline {
        let members = live_members(pgid).unwrap_or(1);
        let esrch = matches!(killpg(Pid::from_raw(pgid), None), Err(nix::errno::Errno::ESRCH));
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
    use std::io::{BufRead, BufReader};
    use nix::sys::signal::{kill, killpg, Signal};
    use nix::unistd::Pid;

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
    let sibling_pid = sibling_pid_opt.expect("helper failed to provide sibling_pid within deadline");

    // IMMEDIATELY SIGKILL the helper supervisor parent process in the startup window
    let helper_pid = helper.id() as i32;
    kill(Pid::from_raw(helper_pid), Signal::SIGKILL).expect("failed to send SIGKILL to helper parent");
    let _ = helper.wait();

    // Verify bounded termination of Chrome process group descendants:
    // Both procfs non-zombie count must be 0 and kernel killpg must return ESRCH
    let poll_deadline = std::time::Instant::now() + Duration::from_secs(5);
    let mut clean = false;
    while std::time::Instant::now() < poll_deadline {
        let members = live_members(pgid).unwrap_or(1);
        let esrch = matches!(killpg(Pid::from_raw(pgid), None), Err(nix::errno::Errno::ESRCH));
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
async fn test_watcher_exec_failure_fails_closed_and_cleans_up_chrome() {
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
    // Arm failure test: force grandchild watcher to attempt execve on a nonexistent path
    config._test_mock_watcher_exec_fail = true;

    let res = BrowserProcess::launch(config).await;

    // Launch MUST fail closed with LaunchFailed
    assert!(
        matches!(&res, Err(ProcessError::LaunchFailed(msg)) if msg.contains("supervisor watcher execve failed")),
        "launch must fail closed when watcher execve fails"
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
        assert_eq!(survivors, 0, "no Chrome processes should survive failed watcher initialization");
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
        assert_eq!(survivors, 0, "no Chrome processes should survive failed watcher pre-exec setup");
    }
}
