Turn budget wrap-up was requested after 6 assistant turns (soft limit 6, grace 1). Process-mode live steering is unavailable, so the child was warned at launch to wrap up by this budget. Output may be partial.

## Test design

### A. Loopback listener unreachable after `stop`/`dispose`

**Smallest meaningful test:** Windows-only async integration/unit test around a real `SshForwardManager`, using an in-process local SSH test server.

1. Create isolated temp config directory.
2. Construct manager with `SshForwardManager::new`.
3. Seed one valid scope/profile:
   - `local_port = 0` preferred, if model supports ephemeral ports; otherwise reserve an unused Windows port.
   - SSH endpoint points to an in-process `russh` server.
   - target points to a harmless local TCP test service.
4. Open client, activate scope, start profile.
5. Poll snapshot until `Running`; obtain the assigned local port.
6. Confirm `TcpStream::connect(("127.0.0.1", port))` succeeds.
7. Call `manager.stop(...)` (separate test) or `manager.dispose()` (acceptance test).
8. Within a 5-second deadline, repeatedly attempt new connections until they fail with `ConnectionRefused`/`NotFound`.
9. Assert no connection succeeds after shutdown completion.

Important implementation detail already present: `run_profile` drops `listener` before waiting for SSH/channel cleanup. The test should assert **port reachability**, not merely worker state.

Recommended helper:

```rust
async fn assert_unreachable_within(addr: SocketAddr, deadline: Duration) {
    let end = Instant::now() + deadline;
    loop {
        match TcpStream::connect(addr).await {
            Err(_) => return,
            Ok(stream) => {
                drop(stream);
                if Instant::now() >= end {
                    panic!("loopback listener still reachable: {addr}");
                }
            }
        }
        tokio::time::sleep(Duration::from_millis(25)).await;
    }
}
```

Use a bounded timeout around `stop`/`dispose` itself as well.

**Smallest lower-level alternative:** extract listener ownership/drop into a testable worker abstraction and test it with a `TcpListener` directly. This proves the shutdown invariant but does not prove manager wiring; therefore the real-manager test is preferable for Phase 04 acceptance.

### B. Shutdown coordinator one-shot and bounded

`NativeShutdownCoordinator` currently has no WebView-specific dependency in its state; only `BrowserDebugController` and `AppHandle` are required.

Use Tauri 2.11.5’s mock runtime (`tauri::test::mock_app`, if available under the enabled test/runtime features):

1. Build `Arc<SshForwardManager>` using a temp directory.
2. Build `Arc<BrowserDebugController::default()>`.
3. Construct coordinator.
4. Assert initial state:
   - `should_prevent_exit() == true`
   - `is_disposed() == false`
5. Call `trigger(mock_app.handle().clone())` twice or from two concurrent tasks.
6. Await until `is_disposed()` becomes true, bounded by slightly over 5 seconds.
7. Assert:
   - coordinator reaches disposed exactly once;
   - repeated trigger does not schedule another disposal;
   - `should_prevent_exit() == false`;
   - manager is shutting down;
   - no panic despite no registered WebView.
8. Call `force_close_now()` repeatedly; assert it remains disposed and returns promptly.

The current `compare_exchange(RUNNING, DISPOSING)` is the one-shot gate. The test should preferably instrument a test-only disposal counter, because state alone cannot prove that exactly one cleanup task ran. If production instrumentation is undesirable, concurrent triggers plus repeated calls provide a weaker observable check.

`cleanup_on_main_close` is safe to exercise without a real WebView: `destroy` should return an error when no child exists, and the error is ignored. No WebView2 process is needed.

### API/build validation

Run from `apps/native/src-tauri`:

```powershell
cargo test --target x86_64-pc-windows-msvc
cargo test --target x86_64-pc-windows-msvc shutdown
cargo test --target x86_64-pc-windows-msvc ssh_forward
```

Tauri mock-runtime API must be checked against the locally resolved 2.11.5 source; avoid assuming older `tauri::test` signatures.

## Limitations

- A real manager listener cannot reach the bind phase unless SSH handshake succeeds; a fake “listener-only” test does not cover manager lifecycle.
- In-process `russh` testing adds substantial setup and may be slower/flakier than a lower-level listener test.
- Windows connection-refusal timing can vary; poll until 5 seconds rather than assert immediate refusal.
- `AppHandle::exit(0)` may terminate/mock-runloop behavior differently under Tauri’s mock runtime. Coordinator state should be the primary assertion.
- Without a disposal counter or injected cleanup callbacks, exactly-once cleanup is inferred from atomic state, not directly measured.
- Existing coordinator tests only assert constants/configuration; they do not prove runtime boundedness or one-shot behavior.