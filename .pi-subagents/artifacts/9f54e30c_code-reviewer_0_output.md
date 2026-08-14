## Code Review Summary

### Scope
- Files: `shutdown.rs`, `lib.rs`, `browser_debug/controller.rs`, `ssh_forward/manager.rs`, `Cargo.toml`, Phase 04 plan.
- Focus: Phase 04 shutdown/listener completion.
- No files edited.

### Overall Assessment
Build/lint and targeted tests pass on this Windows host. Refactor is structurally sound, but acceptance remains **not complete**. Several plan claims overstate what tests prove.

### High Priority Findings
1. **Shutdown MockRuntime test does not exercise shutdown trigger/event behavior.**  
   `close_and_exit_disposal_is_one_shot_and_bounded` uses `tauri::test::mock_app()`, but directly calls `begin_disposal()` and private `dispose_resources()` (`shutdown.rs:118-134`). It never calls `trigger()`, observes `app.exit(0)`, or dispatches `CloseRequested`/`ExitRequested`.  
   Thus it proves coordinator state + direct disposal, not Tauri close/exit prevention/final-exit integration.

2. **“Before commit” listener-closure claim is not proven.**  
   The scope-switch test waits until `activate_scope(..., None)` returns, then verifies closure (`manager.rs:2455-2483`). It has no barrier/observer proving listener closure occurs before `commit_scope`; the test name overclaims ordering.

3. **Listener probes use injected synthetic workers, not the production forwarding worker.**  
   `install_listener_worker` creates a bare `TcpListener`, manually inserts `RuntimeEntry`, and closes on a oneshot (`manager.rs:2137-2160`). These tests prove `stop`, `stop_all_workers`, and `dispose` signal/await manager-owned worker handles and release a real TCP port. They do **not** prove `run_profile`’s actual listener/SSH/channel cleanup path.

4. **Force-close cannot guarantee map cleanup under lock contention.**  
   `force_close()` uses `runtimes.try_lock()` and silently skips runtime-map cleanup if unavailable (`manager.rs:1180-1192`). The shutdown test has no concurrent command/worker holding that mutex. This fails to substantiate Phase 04’s “no task/handle remains in manager maps” claim under timeout/reentrancy.

### Medium Priority Improvements
- `close_workers_until` aborts then only joins until the shared deadline (`manager.rs:1752-1760`). If the deadline expires, it returns with `JoinSet` entries unreaped. The plan statement that pending joins are always “reaped” is stronger than implementation/test evidence.
- The generic `Runtime` refactor is correctly applied to Browser Debug `destroy`/`cleanup_on_main_close` and coordinator methods. Test-only Tauri feature is correctly scoped in `[dev-dependencies]`; no production dependency feature expansion observed.

### Positive Observations
- Tauri is pinned identically in regular and dev dependencies; `test` feature is dev-only.
- Targeted manager tests genuinely bind and reconnect to loopback TCP ports.
- `cargo check`, strict clippy, format check, and relevant tests passed locally.
- Shutdown uses an atomic one-shot state and concurrent manager/Browser Debug disposal under one deadline.

### Recommended Actions
1. Keep Phase 04 **Blocked**, not complete/release-ready.
2. Add MockRuntime coverage that calls `trigger()` and verifies one final exit after repeated close/exit triggers; ideally test event prevention at the `run` callback seam.
3. Add a production-worker listener test or extract a testable listener-worker factory; probe stop/switch/dispose against that worker.
4. Add a scope-commit barrier/assertion to prove listener release precedes commit.
5. Resolve/test `force_close` lock-contention behavior and only claim maps/join handles are cleared if guaranteed.

### Metrics
- Targeted Rust tests: manager **14/14**, commands **1/1**, shutdown **3/3**.
- `cargo check`: pass.
- `cargo clippy --all-targets -- -D warnings`: pass.
- Formatting: pass.
- Acceptance: **incomplete**; plan correctly leaves shutdown and listener acceptance unchecked, plus challenge/purge/Phase 05 work pending.

### Unresolved Questions
- Does Tauri’s actual Windows `CloseRequested`/`ExitRequested` flow call `app.exit(0)` without reentrant prevention issues? Current tests do not establish it.