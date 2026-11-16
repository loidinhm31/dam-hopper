//! Cancelling a browser launch mid-startup must not leak the supervisor death-pipe descriptor.
//!
//! The write end of that pipe lives across the async startup wait; the manager's outer startup
//! timeout drops the launch future there. This binary holds a single test on purpose: descriptor
//! counts of the whole process are compared, so no sibling test may open files concurrently.
#![cfg(target_os = "linux")]

use std::os::unix::fs::PermissionsExt;
use std::time::Duration;

use dam_hopper_server::browser_host::process::{BrowserLaunchConfig, BrowserProcess};

fn open_fd_count() -> usize {
    std::fs::read_dir("/proc/self/fd").expect("read /proc/self/fd").count()
}

#[tokio::test]
async fn cancelled_launch_closes_the_death_pipe_descriptor() {
    let tmp = tempfile::tempdir().unwrap();
    // A "browser" that starts but never publishes DevToolsActivePort or a DevTools endpoint, so
    // the launch parks in the endpoint-discovery wait.
    let fake = tmp.path().join("fake-browser.sh");
    std::fs::write(&fake, "#!/bin/sh\nexec sleep 60\n").unwrap();
    std::fs::set_permissions(&fake, std::fs::Permissions::from_mode(0o755)).unwrap();

    let launch_once = |n: usize| {
        let mut config = BrowserLaunchConfig::new(tmp.path().join(format!("profile-{n}")));
        config.executable_path = Some(fake.clone());
        async move { tokio::time::timeout(Duration::from_millis(1500), BrowserProcess::launch(config)).await }
    };

    // Warm-up: lazily opened process-wide descriptors (runtime, /dev/urandom, ...) must not count.
    let warm = launch_once(0).await;
    if matches!(warm, Ok(Err(_))) {
        // Launch refused outright (e.g. kernel without pidfd group signalling): nothing parks in
        // the wait, so there is nothing to cancel.
        return;
    }
    tokio::time::sleep(Duration::from_millis(300)).await;
    let before = open_fd_count();

    for n in 1..=8 {
        let outcome = launch_once(n).await;
        assert!(outcome.is_err(), "launch must still be parked in endpoint discovery when cancelled");
    }
    tokio::time::sleep(Duration::from_millis(500)).await;

    let after = open_fd_count();
    assert!(
        after <= before + 2,
        "8 cancelled launches leaked descriptors: {before} before, {after} after"
    );
}
