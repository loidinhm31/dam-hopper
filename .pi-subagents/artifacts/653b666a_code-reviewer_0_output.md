Turn budget wrap-up was requested after 8 assistant turns (soft limit 8, grace 1). Process-mode live steering is unavailable, so the child was warned at launch to wrap up by this budget. Output may be partial.

## Code Review Summary

### Scope
- Phase 04 plan, Rust manager/IPC/shutdown, native host loader tests, `build.rs`, `windows.manifest`.
- No files modified.

### Overall Assessment
Windows test-loader fix works: native Rust test executables now run, not `0xc0000139`. Build manifest change is minimal and scoped safely to Windows MSVC.

### High — Phase completion remains blocked
Phase acceptance requires actual listener-closure probes and Tauri close/exit runtime coverage. Current tests do not prove either:
- `shutdown_contract_is_single_owner_and_bounded` only asserts constants (`shutdown.rs:92`).
- Manager tests exercise task cleanup, but no test starts a real forwarded listener then verifies Stop/scope switch/app exit rejects reconnection within five seconds.
- Plan TODO still lists shutdown/listener closure as pending; static command/ACL tests do not execute Tauri authorization paths.

**Decision:** do **not** mark Phase 04 complete yet. The previous native-test-loader blocker is resolved, but required runtime acceptance evidence is still absent.

### Medium — Plan status is stale
`phase-04-native-manager-tauri-ipc.md` says all native test executables fail pre-assertion. On this Windows 11 host they now pass:
- `cargo test --manifest-path apps/native/src-tauri/Cargo.toml`: **125 passed, 1 ignored**
- manager subset: **11 passed**
- commands subset: **1 passed**
- shutdown subset: **2 passed**

Update the plan from “runtime validation deferred” to “loader fixed; listener/Tauri lifecycle acceptance still pending” when edits are permitted.

### `build.rs` / `windows.manifest`
**Safe/minimal.**
- Guarded strictly by `target_os == windows && target_env == msvc`.
- Supplies one embedded Common Controls v6 dependency only; no execution-level, capability, updater, or network policy expansion.
- `WindowsAttributes::new_without_app_manifest()` prevents Tauri’s duplicate bin-only manifest, while linker args cover Cargo test executables.
- Evidence: Rust tests now execute and `cargo build`, `cargo clippy --all-targets -- -D warnings`, `cargo fmt --check`, and `git diff --check` pass.

### Positive
- Exact 12-command mapping test passes; full suite includes mobile-absent and permission-manifest checks.
- Native loader test suite passes: **17/17**.
- `pnpm --filter @dam-hopper/native build` passes.

### Recommended Actions
1. Add/run a Windows runtime probe: establish listener, Stop/switch/exit, assert loopback reconnect fails within 5s.
2. Exercise real Tauri close/exit prevention and one-time SSH + Browser Debug disposal.
3. Then update Phase 04 TODO/status and mark complete.

### Unresolved Questions
- None.