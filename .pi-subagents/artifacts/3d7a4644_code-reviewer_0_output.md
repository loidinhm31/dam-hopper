## Code Review Summary

**Score: 7/10 — implementation substantial; Phase 04 not ready to close.**  
Files reviewed: Phase plan; `manager.rs`, `commands.rs`, `shutdown.rs`, `lib.rs`, DTO/store/ACL/config changes.  
Commands: catalogs generated; `git diff --check` passed; no native executable run (deferred Windows `0xc0000139` blocker). No edits.

### Already implemented
- 12 command handlers, Windows-only registration, main-webview guard, permission/capability manifests.
- Manager-owned context/token admission, numeric `WireCounter`, scope lifecycle, runtime state, reconnect rejection, bounded worker disposal.
- Profile CRUD/start/stop/restart/key/trust/purge implementations.
- Updater plugin removal; static no-restart/relaunch test.
- Basic manager tests for token ordering, delayed A/B/C, client epoch, session mismatch, same-scope generation, worker reaping.

### Critical
- None found.

### Warnings
1. **High — lifecycle proof still incomplete:** `apps/native/src-tauri/src/ssh_forward/manager.rs:1651-1686` can reach the five-second deadline and stop waiting with join handles still not joined. `force_close()` aborts handles but does not synchronously reap them. Add a deterministic stubborn-worker test proving forced cancellation reaps worker, SSH session/channel tasks, and manager maps within deadline.
2. **High — auto-start is serialized, not concurrency 4:** `manager.rs:1489-1499` awaits each `start_inner` sequentially. The handshake semaphore caps at four but never permits parallel auto-start handshakes. Implement reserved queued starts as concurrent tasks/JoinSet while preserving sorted admission; add order/cap/concurrency/skipped tests.
3. **Medium — plan-required test coverage absent:** no tests for explicit purge denial/races, challenge repeat → approval → explicit restart, complete A/B/C barrier boundaries, event coalescing payload behavior, close/exit/reentrant/timeout/reload, or exact handler list equality against handler registration. These are static/test gaps independently completable without native test execution.
4. **Medium — plan state overstates readiness:** `plans/.../phase-04-native-manager-tauri-ipc.md` says two lifecycle fixes remain, but its TODO list remains entirely unchecked although portions are implemented. Update checklist with implemented vs pending evidence and list runtime-only blocker separately.

### Suggestions
- Add adapter-side event-context filter tests once Phase 05 code exists; no adapter implementation appears in current diff.
- Replace the handler test’s count/first/last assertion (`commands.rs:163-166`) with equality against a single source/registration fixture.
- Keep generated/unrelated artifacts (`.pi-subagents/`, `.pnpm-store/`, `NUL`, `artifacts/`) out of commits.

### Prioritized next tasks
1. Complete robust forced shutdown/reaping semantics + deterministic tests.
2. Make auto-start launches concurrent (max four) after deterministic reservation + tests.
3. Add remaining pure Rust/static tests and reconcile Phase 04 plan TODO status.
4. Later: resolve Windows loader failure, then run native runtime assertions.

### Runtime-only blocker
Native test executables remain blocked before assertions by Windows `STATUS_ENTRYPOINT_NOT_FOUND (0xc0000139)`; deferred per direction. Static diff validation passed.

### Metrics
- Native executable tests: not run (runtime blocker).
- Diff whitespace errors: 0.
- Staged files: none.
- Test coverage: unavailable.

### Unresolved questions
- None beyond deferred Windows loader remediation.