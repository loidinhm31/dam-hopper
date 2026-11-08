use std::time::Duration;

use tempfile::tempdir;

use dam_hopper_server::browser_host::process::{
    discover_ws_endpoint, find_browser_executable, validate_loopback_endpoint, BrowserLaunchConfig,
    BrowserProcess, ProcessError, MAX_STDERR_CAPTURE_BYTES,
};

#[test]
fn test_loopback_validation() {
    assert!(validate_loopback_endpoint("ws://127.0.0.1:9222/devtools/browser/123").is_ok());
    assert!(validate_loopback_endpoint("ws://[::1]:9222/devtools/browser/123").is_ok());
    assert!(validate_loopback_endpoint("ws://localhost:9222/devtools/browser/123").is_ok());

    // Non-loopback endpoints MUST be rejected
    assert!(validate_loopback_endpoint("ws://192.168.1.100:9222/devtools/browser/123").is_err());
    assert!(validate_loopback_endpoint("ws://0.0.0.0:9222/devtools/browser/123").is_err());
    assert!(validate_loopback_endpoint("ws://10.0.0.1:9222/devtools/browser/123").is_err());
    assert!(validate_loopback_endpoint("ws://google.com/devtools/browser/123").is_err());
}

#[tokio::test]
async fn test_reject_insecure_flags() {
    let tmp = tempdir().unwrap();
    let mut config = BrowserLaunchConfig::new(tmp.path().to_path_buf());
    config.additional_args.push("--no-sandbox".to_string());

    let res = BrowserProcess::launch(config).await;
    assert!(matches!(res, Err(ProcessError::LaunchFailed(_))));

    let mut config2 = BrowserLaunchConfig::new(tmp.path().to_path_buf());
    config2.additional_args.push("--disable-web-security".to_string());
    let res2 = BrowserProcess::launch(config2).await;
    assert!(matches!(res2, Err(ProcessError::LaunchFailed(_))));
}
#[tokio::test]
async fn test_allowlist_rejects_arbitrary_and_override_flags() {
    let tmp = tempdir().unwrap();
    let forbidden_candidates = [
        "--remote-debugging-address=0.0.0.0",
        "--remote-allow-origins=*",
        "--user-data-dir=/tmp/bad",
        "--load-extension=/tmp/ext",
        "--disable-site-isolation-trials",
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

    tokio::time::sleep(Duration::from_millis(150)).await;

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
        // ESRCH (no such process) proves that the entire process group has exited
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
    std::fs::write(&port_file, "9222\n/devtools/browser/abc-123\n").unwrap();

    let mock_stderr = std::io::Cursor::new(
        b"Random log line\nDevTools listening on ws://127.0.0.1:9222/devtools/browser/abc-123\nMore logs\n".to_vec()
    );

    let res = discover_ws_endpoint(mock_stderr, tmp.path()).await;
    assert!(res.is_ok());
    let (endpoint, _) = res.unwrap();
    assert_eq!(endpoint, "ws://127.0.0.1:9222/devtools/browser/abc-123");
}

#[tokio::test]
async fn test_corroboration_mismatch_fails() {
    let tmp = tempdir().unwrap();
    let port_file = tmp.path().join("DevToolsActivePort");
    // Port file says port 9222
    std::fs::write(&port_file, "9222\n/devtools/browser/abc-123\n").unwrap();

    // Stderr says port 9999 (mismatched)
    let mock_stderr = std::io::Cursor::new(
        b"DevTools listening on ws://127.0.0.1:9999/devtools/browser/abc-123\n".to_vec()
    );

    let res = discover_ws_endpoint(mock_stderr, tmp.path()).await;
    assert!(matches!(res, Err(ProcessError::InvalidEndpoint(msg)) if msg.contains("endpoint corroboration failed")));
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
    // Stderr ends abruptly at EOF without \n or trailing whitespace
    let mock_stderr = std::io::Cursor::new(
        b"DevTools listening on ws://127.0.0.1:9222/devtools/browser/abc-123".to_vec()
    );

    let res = discover_ws_endpoint(mock_stderr, tmp.path()).await;
    assert!(res.is_ok(), "expected successful endpoint discovery on EOF without newline: {:?}", res);
    let (endpoint, _) = res.unwrap();
    assert_eq!(endpoint, "ws://127.0.0.1:9222/devtools/browser/abc-123");
}

#[test]
fn test_validate_loopback_endpoint_strict_rejections() {
    // Scheme must be ws
    assert!(validate_loopback_endpoint("http://127.0.0.1:9222/devtools/browser/123").is_err());
    // Port must be explicit and > 0
    assert!(validate_loopback_endpoint("ws://127.0.0.1/devtools/browser/123").is_err());
    assert!(validate_loopback_endpoint("ws://127.0.0.1:0/devtools/browser/123").is_err());
    // Path must start with /devtools/browser/ and have nonempty identifier
    assert!(validate_loopback_endpoint("ws://127.0.0.1:9222/devtools/browser/").is_err());
    assert!(validate_loopback_endpoint("ws://127.0.0.1:9222/other/path").is_err());
    // Credentials, query, fragment forbidden
    assert!(validate_loopback_endpoint("ws://user:pass@127.0.0.1:9222/devtools/browser/123").is_err());
    assert!(validate_loopback_endpoint("ws://127.0.0.1:9222/devtools/browser/123?q=1").is_err());
    assert!(validate_loopback_endpoint("ws://127.0.0.1:9222/devtools/browser/123#frag").is_err());
}

#[tokio::test]
async fn test_delayed_stderr_corroboration_matching_succeeds() {
    let tmp = tempdir().unwrap();
    let port_file = tmp.path().join("DevToolsActivePort");
    std::fs::write(&port_file, "9222\n/devtools/browser/abc-123\n").unwrap();

    let (mut client, server) = tokio::io::duplex(1024);
    tokio::spawn(async move {
        use tokio::io::AsyncWriteExt;
        tokio::time::sleep(Duration::from_millis(50)).await;
        let _ = client.write_all(b"DevTools listening on ws://127.0.0.1:9222/devtools/browser/abc-123\n").await;
    });

    let res = discover_ws_endpoint(server, tmp.path()).await;
    assert!(res.is_ok());
    let (endpoint, _) = res.unwrap();
    assert_eq!(endpoint, "ws://127.0.0.1:9222/devtools/browser/abc-123");
}

#[tokio::test]
async fn test_delayed_stderr_corroboration_mismatch_fails() {
    let tmp = tempdir().unwrap();
    let port_file = tmp.path().join("DevToolsActivePort");
    std::fs::write(&port_file, "9222\n/devtools/browser/abc-123\n").unwrap();

    let (mut client, server) = tokio::io::duplex(1024);
    tokio::spawn(async move {
        use tokio::io::AsyncWriteExt;
        tokio::time::sleep(Duration::from_millis(50)).await;
        let _ = client.write_all(b"DevTools listening on ws://127.0.0.1:9999/devtools/browser/abc-123\n").await;
    });

    let res = discover_ws_endpoint(server, tmp.path()).await;
    assert!(matches!(res, Err(ProcessError::InvalidEndpoint(msg)) if msg.contains("endpoint corroboration failed")));
}
