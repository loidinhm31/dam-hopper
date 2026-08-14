## scout-260812-2359-phase-04-audit

**Phase 04: blocked; not approvable.**

### Findings
- **BLOCKER — worker cancellation/reaping:** `apps/native/src-tauri/src/ssh_forward/manager.rs:1153-1172,1542-1600,1883-1893` aborts worker/channel tasks but lacks a bounded proof that all `JoinHandle`/`JoinSet` children are joined/reaped. `force_close()` clears handles/maps immediately; `close_workers()` allows only a separate 100ms post-abort wait; `abort_channel_tasks()` exits on deadline with unfinished children. Worker owns listener/session/channel tasks, so shutdown cannot attest no surviving task/handle within shared 5s.
- **BLOCKER — reconnect listener admission:** `apps/native/src-tauri/src/ssh_forward/manager.rs:1255-1306` retains `TcpListener` while `reconnect_session()` awaits retries. The listener is not polled during that await, but stays kernel-bound; new local TCP clients can queue in its backlog rather than receive rejection while runtime is `Reconnecting`.
- **HIGH — uncommitted ownership risk:** Core Phase-04 additions are untracked: `src/shutdown.rs`, `src/ssh_forward/commands.rs`, `src/ssh_forward/manager.rs`. They are absent from `git diff --name-only`; a normal staged/partial commit can omit the implementation entirely.
- **MEDIUM — mixed ownership scope:** Modified Phase-02/03 files (`instance.rs`, `known_hosts.rs`, `model.rs`, `store.rs`) plus Phase-04 plan/status files are co-mingled with Phase-04 wiring. Establish ownership/commit boundary before remediation.

### Present Phase-04 coverage
- Exact 12-command handler and Windows/main-webview capability surface: `commands.rs`, `command_names.in.rs`, `permissions/ssh-forward.toml`, `capabilities/ssh-forward.json`, `lib.rs`.
- Manager ordering, profile lifecycle, reconnect state, scope activation/autostart: `manager.rs`.
- Close/exit coordinator and Browser Debug coordination: `shutdown.rs`, `lib.rs`.
- IPC DTO/counter contracts: `model.rs`; client epoch/session: `instance.rs`.

### Dependency map
`model.rs + instance.rs + store.rs + known_hosts.rs + ssh_client.rs`
→ `manager.rs`
→ `commands.rs`
→ `mod.rs` ACL checks + permission/capability/command-name manifests
→ `lib.rs` Tauri state/handler registration
→ `shutdown.rs` + `lib.rs` CloseRequested/ExitRequested lifecycle.

Blocker remediation dependency:
1. Make worker/channel/session/listener ownership externally disposable and fully reaped under one 5s aggregate deadline.
2. Change reconnect admission so accepted/new clients are rejected while reconnecting (or listener is temporarily closed/rebound with specified semantics).
3. Add runtime probes/tests for both; then rerun Phase-04 gates.

### Minimal validation commands
```powershell
cargo fmt --manifest-path apps/native/src-tauri/Cargo.toml --check
cargo check --manifest-path apps/native/src-tauri/Cargo.toml
cargo clippy --manifest-path apps/native/src-tauri/Cargo.toml --all-targets -- -D warnings
cargo test --manifest-path apps/native/src-tauri/Cargo.toml ssh_forward::manager
cargo test --manifest-path apps/native/src-tauri/Cargo.toml ssh_forward::commands
cargo test --manifest-path apps/native/src-tauri/Cargo.toml shutdown
git status --short
```
Runtime tests are expected to be environment-blocked currently by Windows `0xc0000139 STATUS_ENTRYPOINT_NOT_FOUND`, per plan status; static gates alone do not close the blockers.