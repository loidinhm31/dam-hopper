# Code Standards

## Rust Backend (server/)

### Project Structure

```
server/src/
├── main.rs           # Bootstrap, router setup
├── lib.rs            # Crate root and public module exports
├── state.rs          # AppState definition
├── error.rs          # Top-level AppError
├── api/              # HTTP handlers + WebSocket
│   ├── mod.rs
│   ├── router.rs     # Route registration
│   ├── error.rs      # ApiError mapping
│   ├── fs.rs         # File explorer (list, read, stat)
│   └── ...
├── config/           # TOML parsing
│   ├── mod.rs
│   └── schema.rs     # Type definitions
├── fs/               # Filesystem sandbox + operations
│   ├── mod.rs        # FsSubsystem
│   ├── error.rs
│   ├── sandbox.rs    # Path validation
│   └── ops.rs        # Directory/file operations
├── persistence/      # SQLite session store, worker, restore, migrations
│   └── migrations/   # Ordered additive SQL migrations
├── workflow/         # Workflow domain, observation, reconciliation, and store
│   ├── model/        # Enums, value types, validation
│   ├── store/        # Workspace/item/session/note/event repositories
│   ├── observation.rs # Closed terminal observations + bounded worker
│   ├── reconcile.rs  # Startup terminal-link reconciliation
│   └── observation_tests.rs # Lifecycle and fault-isolation tests
├── web/              # Frontend shared logic
│   └── lib/
│       ├── file-decoration.ts       # Shared decoration registry + lookup helpers
│       ├── file-decoration-icon.tsx # Thin icon wrapper around the shared registry
│       └── mime-to-language.ts      # Compatibility wrapper for MIME-only callers
├── pty/              # Terminal sessions
├── idle_suspend/     # Bounded suspend policy, helper IPC, preflight, audit
│   ├── protocol.rs   # Versioned frames and execution-only validation
│   ├── backend.rs    # Option<u64> RTC seam and fixed suspend backend
│   ├── preflight.rs  # Suspend/RTC/inhibitor checks
│   ├── helper_server.rs # Peer, dedupe, audit, and side-effect ordering
│   └── audit.rs      # Bounded mode-0600 helper JSONL audit
├── git/              # Git operations
├── agent_store/      # Item distribution
└── commands/         # Command registry
```

### Error Handling Pattern

Each module defines `thiserror` enum:

```rust
use thiserror::Error;

#[derive(Error, Debug)]
pub enum FsError {
    #[error("IO error: {0}")]
    Io(#[from] std::io::Error),
    #[error("Path outside workspace")]
    OutOfBounds,
    #[error("Feature unavailable")]
    Unavailable,
}
```

Top-level `AppError` wraps module errors:

```rust
pub enum AppError {
    Fs(FsError),

    Git(GitError),
    NotFound(String),
}
```

API handlers map to HTTP status via `ApiError::from(AppError)`.

### Idle-suspend protocol and helper patterns (Phase 01)

Keep automatic timing validation separate from execution validation:

- `validate_timing_pair` and persisted `IdleSuspendConfig` retain
  `quiet_period_seconds`/`wake_after_seconds` bounds of `60..=86400`.
- `validate_suspend_wake_seconds` accepts only `0` or `60..=86400` for the
  fixed helper request. Do not widen the shared configuration minimum.
- Keep the wire DTO numeric and required (`wakeAfterSeconds`); convert `0` to
  `Option<u64>::None` only at the helper/backend boundary.

Side-effect ordering is part of the security contract:

1. Verify enrolled peer credentials and decode one bounded version-1 frame.
2. Validate request ID/wake domain, then deduplicate the request ID.
3. Run suspend, RTC ownership, and inhibitor preflight.
4. Sync the helper intent audit before any RTC mutation.
5. Clear/read back RTC state; timed mode then writes and verifies a checked
   target epoch. `None` must never enter epoch arithmetic.
6. Invoke only the fixed suspend backend and write a typed completion audit.

Drop synchronous mutex guards before every `.await`; the helper dedupe guard is
scoped before response writes and backend work. Error paths are fail-closed:
busy alarms, audit-intent failures, RTC clear/readback/write failures,
unsupported capabilities, and inhibitors produce no suspend call. Tests use
`tempfile` RTC/audit paths and fake preflight/backends; never use real power
management or host RTC state.

Keep the Phase 01 policy/configuration contract separate from runtime
observation:

- `IdleSuspendAutomaticPolicy` serializes as `empty-fleet` (the default) or
  `agent-activity`.
- `IdleSuspendConfig` uses camelCase JSON fields (`automaticPolicy` and
  `agentExecutables`) with snake_case input aliases; canonical TOML writes
  `automatic_policy` and `agent_executables`.
- Agent entries are literal, case-sensitive basenames or absolute paths. Keep
  validation lexical and deterministic: require 1–32 unique entries, bound
  each entry to 1–256 UTF-8 bytes, and reject controls, traversal, path
  metacharacters, and generic interpreter basenames.
- `StartupIdleSuspendPolicy` owns the validated policy and matcher set after
  startup. Reload, import, and workspace activation must reapply those
  startup-owned values; only the runtime timing pair is mutable.

### PTY activity observation and input admission (Phase 02)

Keep PTY activity evidence at the existing manager/session boundaries; do not
derive authority from terminal text, display labels, retained scrollback, or
foreground process-group IDs. The detailed contract is in
[PTY Activity Observation](./pty-activity-observation.md).

- Store each concrete PTY incarnation as `TerminalIdentity { session_id,
incarnation }` plus `RootQualification`. A qualified `ProcessIdentity`
  requires both the child PID and `/proc/<pid>/stat` `start_ticks`; failed or
  unsupported probes remain explicit `Uncertain`/`Unavailable` states while
  the terminal stays usable.
- Allocate one `Arc<AtomicU64>` raw-output sequence per incarnation. Start it
  at zero for create, restore, and respawn; increment once for each successful
  nonempty raw reader chunk before parser, buffer, persistence, or event work.
  Use the shared saturating helper and treat `u64::MAX` as unavailable; never
  wrap or convert the sequence into a byte count.
- Keep `input_revision` and `last_input_at` manager-wide and private. Empty
  input is a no-op. Under the existing manager lock, gate nonempty writes on
  handoff/manager/session state, record evidence before `LiveSession::write`,
  and roll back the evidence if the writer returns an error. Rejected input is
  not queued or replayed, and no client-side expected revision is implied.
- `PtyActivitySnapshot` is bounded and content-free. Capture fleet state,
  input revision/time, root identities, and cloned counter handles under the
  manager lock; never perform procfs I/O or copy terminal content there.
  Exceeding 256 live roots, an unqualified root, counter saturation, or
  revision saturation must be represented as incomplete, not as quiet.
- `PtyActivityWatcher` is a private coalescing `watch` receiver, not an event
  log or public status channel. Mark cloned receivers seen before waiting.
  Combine it with `PtyFleetWatcher` when complete lifecycle wakeups are
  required.

No PTY reader/input path may log or persist command text, arguments,
environment, terminal bytes, or socket details. Phase 03 process discovery
consumes this seam through a bounded `ProcessSource`; Phase 04 TCP sampling
and the Phase 05 transactional sampler preserve fail-closed behavior and do
not add a second writer path. See [Agent Activity Automatic Admission](./agent-activity-automatic-admission.md).

### Bounded process discovery and attribution (Phase 03)

Keep Linux process discovery behind the synchronous, private
`ProcessSource` trait. `LinuxProcSource` is the production `/proc`
implementation; tests should use `ProcessDiscovery::with_source` with a
deterministic source rather than host process state. Preparation must happen
outside PTY manager locks and must commit state only after the complete sample
is accepted.

- Use exact `(pid, start_ticks)` identities and stat-before/stat-after checks
  around mutable procfs reads. Walk managed-root and retained descendants,
  require exactly one root attribution, and retain detached lineage across
  samples. Never substitute process-group IDs or a PID-only match.
- Match native executables by exact configured basename or normalized absolute
  path. For `node`, `bun`, Python, and supported shells, use the finite
  entrypoint grammar; reject eval/print/`-c`/stdin/unknown forms and
  substring matches. Store only the bounded safe executable identity needed
  for evidence.
- Enforce hard limits of 256 live roots, 8,192 listed processes, 1,024
  relevant processes, 4,096 file descriptors per process, 8,192 owned socket
  inodes, and 16 KiB command lines. Require relevant processes to share the
  terminal network namespace.
- Treat procfs permission, timeout, disappearance, identity, namespace,
  malformed-socket, counter, and bound failures as typed unavailable outcomes.
  Never convert partial discovery into a quiet/eligible result. A zero-agent
  sample must not perform file-descriptor or socket scanning.
- Keep `PreparedProcessSample` transactional: compare against committed
  identity/output observations, then call `commit_sample` only once the sample
  passes all checks. Invalidation may clear the baseline while preserving
  retained attribution needed for reparenting.

### Owned TCP byte observation and baseline comparison (Phase 04)

Keep Linux socket diagnostics behind the synchronous, private
`SocketDiagnosticsSource` trait. `LinuxSocketDiagnostics` is the production
`NETLINK_SOCK_DIAG` implementation; tests should inject deterministic sources
instead of depending on host sockets or network traffic.

- Parse kernel wire data with explicit checked offsets, slice bounds, native
  endian conversions, and 4-byte alignment. Never cast netlink payloads or
  `INET_DIAG_INFO` bytes to local C structs. Require the 208-byte `tcp_info`
  prefix before reading `tcpi_bytes_received` (`128..136`) and
  `tcpi_bytes_sent` (`200..208`); accept trailing kernel extensions.
- Open only an unprivileged nonblocking socket. Encode
  `SOCK_DIAG_BY_FAMILY` requests with explicit sequence numbers and validate
  sender PID, sequence, message type, lengths, attributes, `NLMSG_DONE`,
  `NLMSG_ERROR`, and `NLM_F_DUMP_INTR`. Treat malformed, interrupted,
  overrun, duplicate, or truncated streams as unavailable; never use a
  partial dump as quiet evidence.
- Carry one monotonic `Instant` deadline through poll, send, peek, receive,
  and every dump. Use `MSG_PEEK | MSG_TRUNC` to size each datagram before
  allocation and enforce the global 16 MiB response budget before allocating.
- Verify `NetworkNamespaceIdentity::current_thread()` immediately before and
  after collection. Do not change namespaces. Classify owned inodes still
  unresolved after all applicable dumps as retryable close races; malformed or
  corrupt records remain hard diagnostics failures.
- Key persistent sockets by namespace, family, and diagnostic cookie. Keep
  inode only as join/reuse metadata. Compare each socket independently:
  `BaselineEstablished` initializes state, `Unchanged` requires identical
  keys/inodes/counters, and `Activity` covers byte changes/resets, new or
  retired sockets, and inode replacement.
- Keep `prepare_sample` read-only and return an explicit prepared state.
  Commit the next baseline only after the caller accepts the complete sample;
  invalidation must force a new baseline. Do not expose raw netlink payloads,
  addresses, command data, credentials, or terminal content.

### Transactional sampling and automatic admission (Phase 05)

Keep the configured-agent integration private and single-owner. Construct one
sampler worker per coordinator; the worker owns `ProcessDiscovery` and
`TcpObserver` state and exposes only bounded observations or opaque final
tickets to the coordinator. Do not move either baseline into a Tokio task or
create a parallel observer.

- Use a one-slot mailbox with scheduled coalescing. Final requests supersede
  queued work and cancel in-flight work cooperatively. Recovery requests
  invalidate both baselines after resume or handoff release.
- Carry one monotonic deadline through process preparation, TCP diagnostics,
  output fencing, and the post-snapshot check. Retry one retryable close race
  only while that original deadline remains; never retry arbitrary diagnostics
  failures.
- Prepare process and TCP samples sequentially. Enrich TCP failures with at
  most 32 safe process identities from the uncommitted process preparation,
  then drop that preparation. Commit both prepared states back-to-back only
  after cancellation, deadline, raw-output, fleet-generation, and input
  revision checks pass.
- Treat only an unchanged final sample as ticket-eligible. The manager gate
  must verify policy, request/activity/epoch/timing revisions, quiet deadline,
  observation age, input revision, fleet generation, exact root incarnation
  identities, raw output counters, and closing/disposal/lifecycle flags under
  one `PtySessionManager` lock.
- Keep `automaticPolicy` required in v1 status. Emit `activity` only for
  `agent-activity`; warnings contain a closed reason and at most 32 sorted,
  deduplicated PID/safe-identity records. Never expose args, environment,
  terminal bytes, socket addresses, inodes, or raw diagnostics.
- `is_meaningful_change` must ignore heartbeat/timestamp and elapsed-duration
  churn while preserving semantic state, activity, warning, fleet, timing, and
  epoch changes. Join the sampler before PTY teardown during shutdown.

### Protected status decoding and presentation (Phase 06)

Keep external status data at an explicit `unknown` boundary. The
`api.system.idleSuspendStatus()` transport call must decode through
`decodeIdleSuspendStatusV1`; TypeScript generic casts are not runtime
validation. Validate the base version-1 fields and all additive policy/activity
constraints before exposing data to React Query.

- Normalize only a valid base payload with both additive own properties absent.
  Reject XOR omission, present `undefined`, unknown enums, unsafe numeric
  domains, invalid warning ordering/identity bounds, and policy/activity
  mismatches. Preserve transport/auth errors; never catch and fabricate legacy
  status, zero counts, or quiet state.
- Keep warning reason mappings exhaustive and local to the UI. Render nullable
  counts as `Unknown`, and keep coordinator state independent from measurement
  state. Initializing/unavailable measurement must not claim quiet or completion.
- Derive the only browser countdown from server `armDeadlineMs`. A bounded
  local display tick may render elapsed warning duration, but it must not poll,
  invalidate queries, publish events, persist status, or make eligibility
  decisions. Stop the tick when no deadline/warning remains.
- Preserve manual force behavior: confirmation uses
  `liveCount + creatingCount + restartPendingCount`, never observer counts or
  reason codes. Keep existing handoff, pending, conflict, retry, auth, origin,
  and audit gates.
- Expose only the bounded warning projection (PID and safe executable identity).
  Do not log or render command arguments, matcher lists, environment, terminal
  or socket identities, bytes, tokens, counters, or raw diagnostics. Use
  accessible persistent text; do not make limitations hover-only or color-only.

### Integrated qualification and test-surface ownership (Phase 07)

Keep integrated verification at the public boundary it protects:

- `server/tests/idle_suspend.rs` uses the real `PtySessionManager`, public
  coordinator, fixture-owned PTYs, and a fake executor. Assert state,
  eligibility/deadline, lifecycle counts, and exact executor calls; do not
  reach into crate-private observer state.
- `server/src/api/tests.rs` uses the Axum router boundary for authentication,
  `Cache-Control: no-store`, policy/activity nullability, warning bounds, and
  privacy omissions. Serialize and inspect consumer-visible DTOs rather than
  echoing constructor fields.
- `packages/ui/browser-tests/idle-suspend-settings-status.browser.tsx` uses
  Chromium and rendered/accessibility assertions for status, warnings,
  countdown, manual action, and old-server compatibility. Keep jsdom/unit
  tests for pure decode or component behavior, not browser proof.
- `activity_live_linux_pty_tcp_smoke` is an explicitly ignored Linux
  qualification test. It may use test-owned loopback TCP and direct procfs/
  netlink observation, but its executor must panic on suspend. It must never
  invoke the helper, RTC, `systemctl suspend`, `sudo`, root installation, or
  external services.

Record command-level results and the target-host context in the Phase 07 QA
report. A passing fake or live observer test is not evidence of a real suspend
canary; that decision belongs to Operations.

### Documentation, controlled rollout, and operational standards (Phase 08)

Phase 08 establishes operational documentation, controlled rollout, and maintenance standards for the `agent-activity` idle-suspend feature:

1. **Documentation Truthfulness and Honest Boundaries**:
   - Documentation must never represent automated test passes as real-host suspend qualification. Automated tests use fake executors; real-host execution is an Operations gate.
   - Explicitly document all heuristic limitations in operator-facing guides: polling intervals can miss short-lived processes, detached descendants may escape attribution, raw PTY bytes cannot identify individual writers, and service-only terminals do not prevent sleep.
   - Never market `networkCoverage: "tcp4-tcp6"` as generic networking; explicitly state that UDP, QUIC, external proxies, and non-observer namespaces fail closed or remain unmeasured.

2. **Bounded Parser and Socket Diagnostics Rules**:
   - All procfs and socket diagnostics parsers must enforce hard bounds: 256 live roots, 8,192 listed processes, 1,024 relevant processes, 4,096 file descriptors, 8,192 owned socket inodes, 16 KiB command lines, and 16 MiB netlink buffer.
   - `tcp_info` parsing requires a 208-byte prefix and native-endian slice decoding of byte counters; raw netlink bytes must never be cast directly to C structs.

3. **Monotonic Revisions and WebSocket Meaningful-Change Filtering**:
   - Coordinator state revisions, PTY input revisions, and epoch counters must advance monotonically.
   - WebSocket notifications (`host:idleSuspendChanged`) must be filtered with `is_meaningful_change` to prevent notifying on periodic 2s heartbeats, display timestamps (`sampledAtMs`, `lastActivityAtMs`), or elapsed warning durations.

4. **Lock Invariant: No Blocking Work Under Manager Lock**:
   - Procfs traversal, netlink socket polling, sleep intervals, file I/O, and helper IPC must never be executed while holding `PtySessionManager` synchronous locks.
   - Snapshots and admission claims must be completed in bounded, atomic transactions under lock.

5. **Fake-Only Automated Suspend Testing**:
   - All tests in `server/tests/` and unit test suites must use fake executors or panic executors.
   - Automated tests are strictly prohibited from programming real host RTC wakealarms (`/sys/class/rtc/rtc0/wakealarm`), calling `systemctl suspend`, executing `sudo`, or modifying host systemd state.

### Linux release manager service lifecycle and verification (Production CLI Phases 03–04)

Keep helper lifecycle ownership centralized in `server/src/linux_release/`:

- Define `HELPER_SERVICE_UNIT` once and include it in `ALL_SERVICE_UNITS`; use
  those constants for stop, backup, restore, enable, and status paths.
- For every server-role `start`, attempt the helper before the API. Log helper
  start/enable errors with `tracing::warn!` and continue API activation; API
  startup and API/web health-gate errors remain fatal.
- Stop the managed-unit set before replacing units or release pointers. Restore
  transaction-owned files before `daemon-reload`, then restart helper before API
  and re-run the health gate.
- Boot recovery must disable the helper with application units for pending
  state, repair helper enablement only for server roles, and stop/disable every
  managed unit on `RECOVERY_REQUIRED`.
- Keep `status` read-only: report systemd active state and best-effort process
  evidence for API, helper, web, and recovery; Phase 04 check 14 confirms the
  helper constant, server-role staging/start wiring, and status projection.
- Do not treat missing helper process evidence as a suspend or API-operation
  exception. Check 13 separately protects API `PIDFile`, `ExecStartPost`, and
  `ExecStopPost` enrollment hooks.

### Async Patterns

**Never hold locks across `.await`:**

❌ Bad:

```rust
let fs = state.fs.sandbox()?;  // holds lock
let result = async_op(&fs).await;  // lock held!
```

✅ Good:

```rust
let fs = state.fs.sandbox()?;  // clone fields out
let sandbox_root = fs.root().to_path_buf();  // release lock
let result = async_op(&sandbox_root).await;  // safe
```

**Clone-cheap types:**

- Arc<T> (includes PtySessionManager, FsSubsystem, AgentStoreService)
- Pass clones into async tasks

### Testing

Integration tests use real filesystems via `tempfile` crate:

```rust
#[tokio::test]
async fn test_list_dir() {
    let temp = TempDir::new().unwrap();
    let result = ops::list_dir(temp.path()).await;
    assert!(result.is_ok());
}
```

No mocking of filesystem or git.

### PTY Session Manager Patterns (Phase 04+)

**Restart Policies** — `RestartPolicy` enum:

```rust
pub enum RestartPolicy {
    Never,          // Don't restart on any exit
    OnFailure,      // Restart on non-zero exit (see limitation below)
    Always,         // Restart on any exit (including 0)
}
```

**Creating with Restart Policy:**

```rust
let opts = PtyCreateOpts {
    id: "build:test".into(),
    command: "npm run build".into(),
    restart_policy: RestartPolicy::OnFailure,
    restart_max_retries: 3,
    // ... other fields
};
let meta = manager.create(opts)?;
```

**Supervisor Pattern** — how restarts work:

1. **Reader Thread** (std::thread blocking I/O)
   - Reads PTY output in 4KB chunks
   - On EOF: infer exit code, check if killed, send RespawnCmd
   - Immediately exits (don't block supervisor waiting for response)

2. **Superviser Task** (async tokio)
   - Receives RespawnCmd from bounded channel (256 slots)
   - Waits for backoff delay (exponential: 1s → 30s max)
   - Checks killed flag (TOCTOU-safe, reader released lock)
   - Calls `create()` with same session ID (no network changes)
   - Updates restart_count, resets on clean exit

3. **Bounded Channel Defense**
   - Prevents unbounded respawn queue if supervisor hangs
   - 256 slots = ~5× typical max sessions (50)
   - If full, reader tries_send fails, respawn dropped (session in dead map)
   - Supervisor dead/slow → next reader will also fail → cascading drop

**Exit Code Inference Limitation** (Phase 04):

```rust
fn infer_exit_code(id: &str, inner: &Arc<Mutex<Inner>>) -> i32 {
    let guard = inner.lock().unwrap();
    // portable-pty signals EOF but not waitpid status
    if guard.live.contains_key(id) {
        0  // Process still in live map (shouldn't happen — reader just exited)
    } else {
        -1  // Process removed from live (assumed natural exit/eof)
    }
    // Cannot distinguish: exit 0, exit 1, exit 127, etc.
    // All EOF = -1 or 0 (depending on timing of removal)
}
```

**Workaround:** OnFailure policy currently indistinguishable from Always. To fix:

- Future work: wrap child in `std::process::Command`
- Call `waitpid()` before EOF to capture actual status
- Requires architecture change (not Phase 04 scope)

**Session ID Reuse** (Important):

When respawning, the same session ID is used. Frontend **does not** need to navigate or reconnect:

- Session ID remains stable across respawns
- WebSocket subscribers notified via `send_terminal_change()`
- Buffer optionally retained (clearing old content on restart optional)
- User continues typing as if session never died

**Tombstone Lifecycle:**

```
LiveSession
    ↓ (EOF)
DeadSession (will_restart=true, restart_in_ms=1000)
    ↓ (backoff delay)
    ↓ (supervisor create)
LiveSession (restart_count=1)
    ↓ (EOF again, but exit==0 — clean)
DeadSession (will_restart=false) — restart_count reset to 0
    ↓ (60s TTL sweeps)
<removed from map>
```

**Tests for Restart Engine:**

- `test_restart_decision_never` — Never policy rejects restart
- `test_restart_decision_on_failure` — OnFailure on exit≠0 approves restart
- `test_restart_decision_always` — Always approves any exit
- `test_restart_count_increments` — Each respawn increments counter
- `test_restart_count_resets_on_clean_exit` — Clean exit resets counter
- `test_backoff_exponential_growth` — 1s → 2s → 4s → ... → 30s max
- `test_killed_session_no_restart` — Killed sessions don't restart
- `test_bounded_channel_prevents_dos` — Queue full drops respawn (safe)

### Idempotent Creation Pattern (Phase 07)

**Problem:** Without the killed set, a race between supervisor restart and user create could allow two shells to spawn with the same ID.

**Solution:** Three-phase killed set lifecycle ensures at most one winner:

| Phase             | Action                          | Killed Set State |
| ----------------- | ------------------------------- | ---------------- |
| Create pre-spawn  | User calls `create()`           | Insert ID        |
| Slow I/O          | Lock released, openpty + spawn  | Held in set      |
| Create post-spawn | Lock reacquired, session active | Remove ID        |

**Reader/Supervisor Interaction:**

- Reader detects EOF, sends RespawnCmd, releases lock
- Meanwhile, user calls `create()` — enters killed set
- Supervisor wakes from backoff, checks killed set — ID is there → skip respawn
- Create finishes, removes ID — now future kills can mark session again

**TOCTOU Guard (Create):**

```rust
{
    let mut inner = self.inner.lock().unwrap();
    // TOCTOU: If another thread inserted this ID while we spawned,
    // detect it here and replace (matches pre-existing behavior).
    if let Some(existing) = inner.live.get(&opts.id) {
        warn!("Concurrent create detected, replacing");
        existing.signal_shutdown();
    }
    inner.dead.remove(&opts.id);        // Clean tombstone
    inner.killed.remove(&opts.id);      // Clear kill flag
    inner.live.insert(opts.id.clone(), session);
}
```

**Lock Optimization (Create):**
The lock is released before slow I/O:

```rust
// ❌ Bad: lock held during openpty + spawn (~50ms)
{
    let mut inner = self.inner.lock().unwrap();
    let pair = pty_system.openpty(...)?;  // This blocks!
    // ... spawn ...
}

// ✅ Good: only held for state changes
self.kill_internal(&opts.id);  // Insert into killed, remove from live
// <LOCK RELEASED>
let pair = pty_system.openpty(...)?;   // No lock contention
// ...spawn...
// <LOCK REACQUIRED>
{
    let mut inner = self.inner.lock().unwrap();
    // TOCTOU check here
    inner.dead.remove(&opts.id);
    inner.killed.remove(&opts.id);
    inner.live.insert(opts.id.clone(), session);
}
```

**Cleanup Task (30s interval):**

```rust
pub fn spawn_cleanup_task(&self) {
    let inner = Arc::clone(&self.inner);
    tokio::spawn(async move {
        let mut interval = tokio::time::interval(Duration::from_secs(30));
        loop {
            interval.tick().await;
            let mut guard = inner.lock().unwrap();
            // Sweep dead tombstones (60s TTL)
            guard.dead.retain(|_, d| d.died_at.elapsed() < DEAD_SESSION_TTL);
            // Prune orphaned killed set entries
            // (IDs no longer in live or dead maps)
            let orphaned: Vec<String> = guard.killed.iter()
                .filter(|id| !guard.live.contains_key(*id)
                         && !guard.dead.contains_key(*id))
                .cloned()
                .collect();
            for id in orphaned {
                guard.killed.remove(&id);
            }
        }
    });
}
```

**Why Killed Set Can Grow Unbounded (without cleanup):**

- Session X exits while supervisor backoff is in progress
- User calls `create(X)` → ID inserted into killed set
- Create finishes, ID removed from killed set
- If sessions are never reused (different project each time), killed set grows forever

**Test Case:**

```rust
#[test]
fn create_during_backoff_cancels_pending_restart() {
    let mgr = make_manager();
    // Process exits with OnFailure policy, supervisor queues 1s backoff restart
    mgr.create(opts("test:id", "exit 1"))?;
    wait_for(Duration::from_secs(2), || !mgr.is_alive("test:id"));

    // During backoff window (200ms later), user calls create again
    std::thread::sleep(Duration::from_millis(200));
    mgr.create(opts("test:id", "echo hello")).unwrap();

    // Wait past original backoff window (1.2s total)
    std::thread::sleep(Duration::from_millis(1500));

    // Verify only one session exists (not double-spawned)
    let sessions = mgr.list();
    let count = sessions.iter().filter(|s| s.id == "test:id").count();
    assert_eq!(count, 1);
}
```

## Persistence Patterns (Phase 04-06)

### Session Persistence Architecture

**Three-layer strategy** for surviving server restarts:

1. **Phase 04: Schema + Persistence Worker**
   - SQLite database (`~/.config/dam-hopper/sessions.db`)
   - Two tables: `sessions` (metadata + env), `session_buffers` (scrollback)
   - Persistence worker thread batches writes, deduplicates updates

2. **Phase 05: Async Worker**
   - Dedicated thread consumes `PersistCmd` from bounded channel
   - Batching via HashMap: only latest state per session written
   - Flush triggers: 5s timer, session exit (immediate), shutdown
   - 16KB throttling reduces snapshot frequency 100/sec → 6/sec

3. **Phase 06: Startup Restore**
   - Load sessions from SQLite on startup
   - Filter by restart policy and project existence
   - Spawn PTY processes with saved command/cwd/env
   - Lazy buffer load on `terminal:attach`

**Configuration:**

```toml
[server]
session_db_path = "~/.config/dam-hopper/sessions.db"       # SQLite file location
session_buffer_ttl_hours = 24                              # Cleanup old buffers after 24h

[[projects]]
name = "api-server"
restart_policy = "on-failure"        # Never | OnFailure | Always
restart_max_retries = 5              # Max consecutive restarts
```

### Restore Sessions Function (Phase 06)

**Location**: `server/src/persistence/restore.rs`

**Filter Logic** (non-fatal, logged):

- Skip `RestartPolicy::Never` → DEBUG
- Skip sessions for removed projects → WARN
- Skip dead sessions (alive=false at persist) → DEBUG
- Restore restartable sessions → INFO

**Per-Session Error Handling**:

```rust
for session in persisted {
    // Filter checks...
    match pty_manager.create(opts) {
        Ok(_) => {
            info!(id = %session.meta.id, "Restored session from persistence");
            restored += 1;
        }
        Err(e) => {
            // Non-fatal: log and continue
            warn!(id = %session.meta.id, error = %e, "Failed to restore session");
        }
    }
}
```

**Config-Driven Retry Count** (no hardcoding):

```rust
let restart_max_retries = session
    .meta
    .project
    .as_ref()
    .and_then(|proj_name| {
        config.projects.iter()
            .find(|p| &p.name == proj_name)
            .map(|p| p.restart_max_retries)
    })
    .unwrap_or(DEFAULT_RESTART_MAX_RETRIES);
```

### Lazy Buffer Loading (Phase 06)

**Fallback in `get_buffer_with_offset()`**:

```rust
pub fn get_buffer_with_offset(
    &self,
    id: &str,
    from_offset: Option<u64>
) -> Result<(String, u64), AppError> {
    let inner = self.inner.lock().unwrap();

    // Fast path: in-memory buffer (live sessions)
    if let Some(session) = inner.live.get(id) {
        let buf = session.buffer.lock().unwrap();
        let (data, offset) = buf.read_from(from_offset);
        return Ok((String::from_utf8_lossy(data).into_owned(), offset));
    }

    // Release lock before slow I/O
    drop(inner);

    // Slow path: SQLite load (dead sessions)
    if let Some(store) = &self.session_store {
        if let Some((data, total_written)) = store
            .load_buffer(id)
            .map_err(|e| AppError::PersistenceError(e.to_string()))?
        {
            return Ok((String::from_utf8_lossy(&data).into_owned(), total_written));
        }
    }

    Err(AppError::SessionNotFound(id.to_string()))
}
```

**Why This Works**:

- Live sessions: in-memory ring buffer (fast, hot path ~100μs)
- Dead sessions: lazy load on `terminal:attach` request (deferred I/O, no startup overhead)
- Lock released before I/O (prevents blocking new session creation)
- Graceful fallthrough: error if not found in either store

### Integration Points

**Main.rs Startup** (after PtySessionManager::with_persist):

```rust
if let Some(store) = &session_store {
    match persistence::restore_sessions(store, &pty_manager, &config).await {
        Ok(count) => {
            tracing::info!(count, "Restored sessions from persistence");
        }
        Err(e) => {
            tracing::warn!(error = %e, "Failed to restore sessions from persistence");
        }
    }
}
```

**PtySessionManager Constructor**:

```rust
pub fn with_persist(
    sink: Arc<dyn EventSink>,
    persist_tx: Option<SyncSender<PersistCmd>>,
    session_store: Option<Arc<SessionStore>>,
) -> Self {
    // Fields stored:
    // - persist_tx: Send commands to worker thread
    // - session_store: Reference for lazy buffer loads
}
```

### Startup Performance

**Typical Time Breakdown** (3 sessions, 500MB buffers):

- Load from SQLite: ~150ms
- Spawn 3 PTY processes: ~50ms
- Cleanup expired buffers: ~10ms
- **Total: ~210ms** (< 1s target) ✅

**Scaling**:

- 10 sessions: ~300ms
- 50 sessions: ~1.2s (acceptable, rarely occurs)
- With parallel spawning (future): could reduce further

### Workflow domain, service, REST API, and lifecycle correlation (Phases 01–03)

Workflow code is split by responsibility:

- `server/src/workflow/model/` owns serializable domain structs, snake_case
  enum conversion, validation constants, and state-transition rules.
- `server/src/workflow/store/` owns synchronous SQLite repository helpers,
  grouped by workspace, item, session/resource, note, event, and overview.
- `server/src/workflow/observation.rs` owns the closed terminal observation
  payload, non-blocking recorder, `sync_channel(256)` worker, and transactional
  resource-link state updates.
- `server/src/workflow/reconcile.rs` compares persisted terminal links with the
  restored live `(sessionId, incarnation)` set after startup restore.
- `server/src/workflow/tests.rs` exercises the model, migration, repository,
  hierarchy, idempotency, retention, and aggregation contracts.
- `server/src/workflow/observation_tests.rs` covers lifecycle mapping,
  incarnation ordering, duplicate suppression, startup reconciliation, queue
  overflow, manual harness bounds, and PTY fault isolation.
- `server/src/workflow/service.rs` is the HTTP/service boundary. It captures
  current config scope, validates projects and registered worktrees, dispatches
  blocking `WorkflowStore` calls through `spawn_blocking`, and exposes startup
  reconciliation.
- `server/src/api/workflow/` owns strict camelCase DTOs, timestamp/target
  mapping, opaque event cursors, and separate overview/events, item,
  session/link, note, and purge handlers. The router keeps these routes behind
  the existing auth layer and a focused 32 KiB body limit.
- `server/tests/workflow_api.rs` is the protected HTTP integration target;
  keep API contract coverage separate from domain/store and lifecycle tests.

`SessionStore::open()` is the only database-opening path. It enables foreign
keys, applies migrations 001–009, then applies migration 010 when
`workflow_workspaces` is absent. Migration 010 is additive and shares the
terminal session database; it must not rename, reset, or reinterpret existing
session tables. `WorkflowStore::new(session_store.connection())` shares the
same `Arc<Mutex<Connection>>`; it does not open a second workflow database.

The PTY manager starts with `NoopWorkflowObservationRecorder`; production
wiring replaces it with `BoundedObservationRecorder` after the workflow store
is available. PTY readers and the restart supervisor call only non-blocking
`try_send`. The observation worker owns SQLite access, and queue/storage
failures are counted or logged without blocking terminal input, output, or
restart handling. Lifecycle payloads are allowlisted metadata only: terminal
ID, incarnation, project/validated worktree target, server time, exit code,
restart count/delay, and action. Never add command text, arguments, CWD, env,
prompts, output, or arbitrary adapter JSON.

Startup ordering is strict: restore live PTYs first, collect their
`(sessionId, incarnation)` identities, then run terminal-link reconciliation.
`attached`, `stale`, `exited`, `crashed`, and `detached` are link health states;
older incarnations cannot regress a newer link and deterministic event IDs
suppress replay duplicates. Observation and reconciliation paths may update
only link health/last-seen/suggested-end fields. Manual session
`status`/`startedAt`/`endedAt` are user-owned and immutable there.

Agent resources remain manual in this phase. Accept bounded `harnessLabel` and
`runId` values through the protected link route; do not inspect PTY commands or
ship a harness-specific producer.

**Domain model conventions:**

- `ItemKind` is `Plan | Phase | Task`.
- `ItemStatus` is `Backlog | Next | InProgress | Blocked | Done | Canceled`.
- `SessionStatus` is `Running | Ended | Abandoned`.
- `ResourceLinkType` is `Terminal | Agent`.
- `ResourceObservedState` is `Attached | Exited | Stale | Detached | Crashed |
`Unknown`; terminal lifecycle processing emits the first five as applicable.
- `WorkflowSource` identifies `Manual | Terminal | Git | Agent | System`.
- `WorkflowEventType` is a closed set of item, session, resource, note, and
  workspace activity classifications.

Persist enum values with each type's `as_str()` representation and deserialize
using case-insensitive `FromStr`; SQL `CHECK` constraints mirror the allowed
values. Domain structs use `#[serde(rename_all = "camelCase")]` for the client
contract. `WorkflowWorkspace::locator` is `#[serde(skip_serializing)]` because
it is a canonical filesystem path, not client data.

**Validation before persistence:**

- Trim and reject empty item titles; cap them at 200 characters.
- Reject empty note bodies; cap raw body size at 8 KiB.
- Reject empty external IDs; cap them at 200 characters.
- Cap agent harness labels at 64 characters and run IDs at 128 characters.
- Cap event JSON payloads at 4 KiB.
- Reject session end times earlier than start times.
- Use explicit item/session transition validators; self-transitions are
  idempotent, while closed sessions only reopen through a new session record
  (session transitions do not reopen `Ended`/`Abandoned`).

**Plan-first hierarchy invariant:**

| Child kind | Allowed parent           |
| ---------- | ------------------------ |
| `Plan`     | None (root only)         |
| `Phase`    | `Plan` (required)        |
| `Task`     | None, `Plan`, or `Phase` |

`Task` cannot parent another task. Item creation reads the parent inside the
same transaction, checks workspace and project scope, walks ancestors, rejects
cycles, and enforces `MAX_HIERARCHY_DEPTH = 3`. The self-referencing
`parent_id` foreign key cascades descendant deletion. The overview builder
keeps a parentless legacy phase visible as an orphan root rather than
silently rewriting data.

**Repository transaction pattern:**

```rust
let mut conn = self.lock()?;
let tx = conn.transaction()?;
let result = item::create_item_tx(&tx, item, event)?;
tx.commit()?;
Ok(result)
```

Use a transaction for every mutation that can include an event. The focused
`*_tx` helper validates inputs, checks same-workspace references, mutates the
entity, records an optional event on the same transaction, and returns only
after commit. Any error drops the transaction and rolls back both entity and
event. Read methods use the locked connection and include workspace scope in
entity lookups.

| Repository area | Required behavior                                                                                                                                                                             |
| --------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Workspace       | Get-or-create by unique canonical locator; look up by ID or locator.                                                                                                                          |
| Items           | Create/update/delete with hierarchy and transition checks; list with project/status filters and bounded limits.                                                                               |
| Sessions        | Start with optional item, resource link, and event atomically; end/abandon only through validated transitions; overlapping sessions are allowed.                                              |
| Resources       | Upsert by session/type/external ID; observations update link state and suggested end time only, never session status or timestamps; compare terminal incarnations and keep unlink idempotent. |
| Notes           | Require an item or session target in the same workspace; soft-delete first; list can include deleted rows.                                                                                    |
| Events          | `INSERT OR IGNORE` by event ID for retry idempotency; keyset page by `(recorded_at DESC, id DESC)`; purge expiry in bounded transactions.                                                     |
| Overview        | Bound project/item/session counts, include a `truncated` flag, attach non-deleted notes and active sessions, and compute factual task progress.                                               |

`WorkflowStoreError` is the public repository error boundary. Keep SQLite
errors, model validation errors, not-found errors, duplicate requests, and
hierarchy violations distinguishable so API adapters can map them without
matching error strings.
The API adapter maps these typed errors to sanitized workflow codes and
statuses: invalid/domain-limit requests to 400, missing scoped entities to 404,
CAS/target/transition conflicts to 409, route body-cap failures to 413, and
unavailable workflow storage to 503. Mutation handlers require UUID
`requestId`; item and note/link updates require `updatedAt` for optimistic
concurrency.

**PTY/workflow fault-isolation rules:**

- Keep workflow SQLite out of PTY input/output, reader, and supervisor locks.
- Lifecycle callbacks must copy or clone a recorder handle and return
  immediately after `try_send`; never wait for SQLite or an unbounded queue.
- Keep create/final-exit/removal observations ordered; restart observations
  remain incarnation-aware and replay-safe.
- Test full queues, unavailable storage, stale incarnations, clean restart,
  crash/final exit, explicit removal, and manual timestamp preservation.

## TypeScript Frontend (`apps/web`, `apps/native`, `packages/ui`)

### Profile Management Pattern

Multi-server profile management lives in `packages/ui/src/api/server-config.ts` with a client-side-only architecture.

**Data Model:**

```typescript
export interface ServerProfile {
  id: string; // UUID v4 via crypto.randomUUID()
  name: string; // User-friendly name
  url: string; // Server endpoint (auto-normalized: strip trailing slash, prepend http:// if no scheme)
  authType: "basic" | "none"; // Authentication type
  username?: string; // Display name (password never stored)
  createdAt: number; // Unix timestamp from Date.now()
}
```

**CRUD Functions:**

```typescript
// Retrieval
export function getProfiles(): ServerProfile[] {
  /* parse localStorage */
}
export function getActiveProfileId(): string | null {
  /* from localStorage */
}
export function getActiveProfile(): ServerProfile | null {
  /* find active */
}

// Mutation
export function createProfile(
  data: Omit<ServerProfile, "id" | "createdAt">,
): ServerProfile {
  // auto-generate id + timestamp, append to profiles list, persist
}

export function updateProfile(
  id: string,
  data: Partial<Omit<ServerProfile, "id" | "createdAt">>,
): void {
  // merge fields, persist
}

export function deleteProfile(id: string): void {
  // remove from list, clear active if deleted profile is active, persist
}

export function setActiveProfile(id: string): boolean {
  /* returns whether the profile-scoped localStorage write succeeded */
}

// Persistence
export function saveProfiles(profiles: ServerProfile[]): boolean {
  // Wrapper around JSON.stringify + localStorage.setItem; failures are reported
}

// Backward Compatibility
export function migrateToProfiles(): void {
  // Repair the active profile and safely migrate a matching legacy token
  // If legacy damhopper_server_url exists → create "Default Server" profile
  // Called in DamHopperApp at startup
}
```

**localStorage Keys:**

- `damhopper_server_profiles` — JSON stringified array of `ServerProfile[]`
- `damhopper_active_profile_id` — active profile UUID
- `damhopper_server_url` — _(legacy, migrated away)_ single server URL
- `damhopper_auth_token_<profileId>` — _(localStorage)_ profile-scoped Bearer token (survives browser close; readable by JavaScript)
- `damhopper_auth_username` — _(sessionStorage, not localStorage)_ username (cleared on tab close)

**Error Handling:**

All localStorage operations are wrapped in `try/catch`. Reads return safe defaults; token writes return failure so login is not reported as saved when persistence is unavailable. Legacy tokens are migrated only when their URL matches the destination profile; otherwise they are discarded rather than sent to an unrelated server.

**Component Integration:**

- `ServerProfilesDialog.tsx` — modal list for switching/deleting profiles
  - calls `getProfiles()` + `getActiveProfileId()` on open
  - calls `setActiveProfile(id)` on switch
  - calls `deleteProfile(id)` on delete (with confirmation)
  - exports profile to parent via `onEditProfile`, `onSwitchProfile` callbacks (for page reload if needed)

- `ServerSettingsDialog.tsx` — form for creating/editing profile
  - calls `createProfile(data)` or `updateProfile(id, data)`
  - accepts profile object (or null for new)
  - auto-normalizes URL (strips trailing slash, prepends http:// if no scheme)
  - clears the profile token when the normalized backend URL changes

- `Sidebar.tsx` — active profile pill + "Change Server" button
  - displays `getActiveProfile()?.name` or "Not Connected"
  - opens `ServerProfilesDialog` on click

**Testing Notes:**

- localStorage is mocked in test environments (jsdom default). Manually mock localStorage if testing profile persistence.
- No server call involved — all operations are synchronous (except JSON parse/stringify).

### Build & Type Checking

```bash
pnpm build       # Vite build
pnpm dev         # Watch + HMR
pnpm lint        # ESLint
pnpm format      # Prettier
```

**TypeScript:** `strict: true`, `target: ES2022`, `moduleResolution: bundler`.

### Naming Conventions

| Location                       | Convention     | Example                                              |
| ------------------------------ | -------------- | ---------------------------------------------------- |
| React component files (`.tsx`) | **PascalCase** | `FileTree.tsx`, `SearchPanel.tsx`                    |
| Hook files (`hooks/`)          | **kebab-case** | `use-file-search.ts`, `use-fs-ops.ts`                |
| Store files (`stores/`)        | **kebab-case** | `search-ui.ts`, `workspace.ts`                       |
| Non-component TS files         | **kebab-case** | `ws-transport.ts`, `fs-types.ts`, `server-config.ts` |
| Rust source files              | **snake_case** | `fs_subsystem.rs`, `sandbox.rs`                      |
| Docs / command `.md` files     | **kebab-case** | `code-standards.md`, `api-reference.md`              |

> **Rule of thumb:** component-style modules (`components/`, `contexts/`, `App.tsx`) use PascalCase; hooks, stores, and every other support module use kebab-case. Hook export names stay camelCase even when the filename is kebab-case.

### Component Structure

```
packages/ui/src/
├── api/
│   ├── client.ts          # Typed API facade and shared client types
│   ├── fs-types.ts        # Filesystem-specific types
│   ├── query-client.ts    # Profile-scoped TanStack Query key hashing
│   ├── queries.ts         # Shared TanStack Query barrel
│   ├── transport.ts       # Transport interface and singleton lifecycle
│   ├── workflow-domain-helpers.ts # Pure workflow domain helpers
│   ├── workflow-dto-types.ts      # Workflow wire DTOs and requests
│   ├── workflow-queries.ts        # Workflow TanStack Query hooks
│   ├── workflow-types.ts          # Workflow contract barrel
│   └── ws-transport.ts            # REST mapper and WebSocket client
├── components/
│   ├── atoms/             # Smallest reusable primitives (Button, Badge)
│   ├── molecules/         # Composed atoms (EditorTab, SidebarTabSwitcher)
│   ├── organisms/         # Feature-complete components (FileTree, TerminalPanel)
│   ├── pages/             # Full-screen route pages
│   ├── templates/         # Page-level layout shells (IdeShell, AppLayout)
│   └── ui/                # Low-level headless UI primitives (Select)
├── hooks/                 # Custom React hooks (kebab-case filenames)
├── lib/                   # Pure utilities, no React
├── stores/                # Zustand stores (kebab-case filenames)
└── types/                 # Shared TypeScript type declarations
```

`apps/web` owns browser bootstrapping only: `QueryClientProvider`, `initTransport(new WsTransport(getServerUrl()))`, DOM mount, and host Vite config.

`apps/native` owns Tauri bootstrapping only: the same `QueryClientProvider` and `DamHopperApp` mount, native Vite config on strict port `1420`, and the minimal `src-tauri` shell. Native Browser Debug is Windows v1 after the WebView2 gate; Linux is runtime-unverified and macOS deferred. Android uses the iframe adapter. Windows supports approved cross-origin profiles; non-Windows native targets require same-origin profiles. Do not add backend sidecars, filesystem permissions, shell permissions, or opener/http plugins without a phase plan.

Native startup must not depend on packaged webview same-origin fallback. Use the shared server profile flow, and keep the no-profile transport idle until the shared `ServerProfileGuard` prompts for an explicit profile.

`packages/ui` owns components, hooks, stores, shared styling, assets, and tests.

`packages/shared` owns dependency-free runtime utilities used across packages. Current rule: keep logger config, level resolution, and metadata redaction centralized in `src/logger.ts`, and prefer it over ad hoc `console` calls in transport, auth, terminal, dashboard, error boundary, and filesystem code.

Frontend diagnostics that need feature-specific breadcrumbs should go through `recordClientDiagnostic()` from `packages/ui/src/lib/diagnostics-client.ts`. For terminal agent notifications, only record safe metadata such as `sessionId`, `source`, `permission`, `reason`, and `agent`; never attach raw terminal output, raw OSC payloads, or full command arguments.

### Client Types

Types in `packages/ui/src/api/` intentionally duplicate the server's Rust API
shapes to keep the shared UI package independent of a generated TypeScript
library. General client types remain in `client.ts`; Phase 04 workflow DTOs
live in `workflow-dto-types.ts`, are re-exported by `workflow-types.ts`, and
must stay aligned with the server's camelCase wire fields.

Update the matching DTO/request type whenever the API changes. Do not widen a
workflow field to `string` or `Record<string, unknown>` to bypass an enum or
shape change.

```typescript
// Rest API
export interface DirEntry {
  name: string;
  kind: "file" | "dir";
  size: number;
  mtime: number;
  isSymlink: boolean;
}

// WS protocol (Phase 04+)
export interface FsReadResponse {
  ok: boolean;
  binary: boolean;
  mime?: string;
  mtime?: number;
  size?: number;
  data?: string; // base64-encoded
  code?: string;
}

export interface FsWriteResponse {
  ok: boolean;
  newMtime?: number;
  conflict: boolean;
  error?: string;
}
```

### API Client Pattern

```typescript
// REST via fetch
const entries = await transport.invoke("GET /api/fs/list", {
  project: "web",
  path: "src",
});

// WS protocol (Phase 04+)
const content = await transport.fsRead(project, path);
await transport.fsWriteFile(project, path, content, mtime);
```

### Workflow Client Contracts (Phase 04)

Keep workflow wire contracts and domain logic separate:

- `workflow-dto-types.ts` owns explicit DTO/request interfaces and closed
  unions for `ItemKind`, `ItemStatus`, `SessionStatus`, `ResourceLinkType`,
  `ResourceObservedState`, `WorkflowSource`, and `WorkflowEventType`.
- Treat `kind`, `status`, `resourceType`, `observedState`, `source`, and
  `eventType` as discriminating fields. Exhaustive branches should preserve the
  closed union; do not add arbitrary payload maps.
- `workflow-domain-helpers.ts` is pure TypeScript. Keep Plan-first parent rules,
  status predicates, factual tracked-Task labels, timestamp validation,
  elapsed formatting, and deterministic item ordering out of React components.
- `workflow-types.ts` is the public barrel. Import workflow DTOs/helpers from
  it when a consumer needs the shared contract.

Optional/null fields are meaningful wire states. Preserve distinctions such as
missing versus `null` `worktreePath`, `endedAt`, `completedAt`,
`suggestedEndTime`, or `deletedAt`; do not invent client defaults that change
server authority. A workflow request carries a caller-owned UUID `requestId`;
CAS writes retain the server-provided `updatedAt`.

### Workflow Transport and Query Standards (Phase 04)

`api.workflow` in `client.ts` is thin typed wiring. It calls
`getTransport().invoke()` with stable channel names and typed response
parameters. It must not construct URLs, duplicate auth, or silently mutate
request bodies. `WsTransport` owns the channel-to-REST mapper:

- Use the exact protected `/api/workflow/*` method/path for each operation.
- Remove path identifiers (`id` or `sessionId`) from JSON bodies after placing
  them in the URL.
- Use `encodeURIComponent` for every dynamic path identifier and
  `URLSearchParams` for event `cursor`/`limit`.
- Keep manual session `end` and `abandon` as separate channels; preserve
  caller-supplied timestamp bodies.
- Let `invoke` normalize non-2xx responses to `ApiRequestError` with status and
  optional server error code; do not render raw response bodies.

Implement workflow hooks in `workflow-queries.ts`, not directly in the broad
`queries.ts` module. Use one `workflowQueryKeys.all` root, an overview key containing the
current transport generation, and an events key containing normalized
`cursor`/`limit` values. The overview hook subscribes to transport replacement
with `useSyncExternalStore`, preserves prior observer data while refetching,
uses no polling interval, and leaves focus/reconnect refetches to QueryClient
defaults.
The shared `queries.ts` entry point re-exports `workflow-queries.ts` for
consumers that use the common query API barrel.

Both host bootstraps configure `profileScopedQueryKeyHash`, which hashes
`[activeProfileId, queryKey]`. The transport singleton increments its generation
on `initTransport`, `reconfigureTransport`, and `resetTransport`; profile
replacement destroys the old transport before installing the new one. Workflow
data is memory-only, never a localStorage cache.

Mutation hooks invalidate the `['workflow']` root only from `onSuccess`.
Do not perform optimistic snapshot writes in this layer. A failure must retain
the authoritative cache and expose the typed mutation error so the component
can retry the same request ID safely. Keep filters, drafts, focus, pending
action state, and elapsed-clock ticks component-local; workflow hooks must not
read/write `useSearchParams`, terminal registries, editor state, or Zustand
workflow stores.

For the complete Phase 04 contract and operation table, see
[Workflow Client State](./workflow-client-state.md).

## Authentication & Security Patterns (Phase 01+)

### No-Auth Dev Mode

The `--no-auth` flag enables development without MongoDB authentication. It binds to the configured host, including the default `0.0.0.0`; use only on a trusted development network, never publicly or with sensitive data:

```bash
# Command-line flag
cd server && cargo run -- --no-auth --config /path/to/dam-hopper.toml

# Environment variable
DAM_HOPPER_NO_AUTH=1 cargo run -- --config /path/to/dam-hopper.toml
```

**Implementation Pattern** (auth.rs):

```rust
pub async fn require_auth(
    State(state): State<AppState>,
    jar: CookieJar,
    request: Request,
    next: Next,
) -> Response {
    // Dev mode: bypass all auth checks
    if state.no_auth {
        return next.run(request).await;
    }

    // Normal JWT validation...
}
```

**Production Safety**:

- Panics if MongoDB configured while no-auth enabled
- Panics if RUST_ENV or ENVIRONMENT set to "production"
- Multi-line trusted-network warning banner on startup
- ERROR-level logging for visibility

The Phase 01 auth-bypass design is historical; the source plan is no longer present. Current auth and safety rules are maintained in [API Reference](./api-reference.md).

### JWT Pattern

- **Token Storage**: `~/.config/dam-hopper/server-token` (hex UUID)
- **Signing Algorithm**: HS256 (HMAC-SHA256)
- **Cookie Transport**: auth cookies are `HttpOnly; SameSite=Strict`; media uses a host-only `HttpOnly; SameSite=Lax; Path=/api/fs` cookie without `Secure` for HTTP compatibility
- **Validation**: Constant-time comparison via `subtle` crate
- **Expiry**: 30 days for production, 30 days for dev mode

## Project Registry (dam-hopper.toml)

The canonical registry file lives at `~/.config/dam-hopper/dam-hopper.toml`. Relative project paths resolve against the registry file directory, while `env_file` and terminal `cwd` stay project-relative.

```toml
[workspace]
name = "my-workspace"

[[projects]]
name = "project-name"
path = "./relative/path"
type = "npm"  # npm | pnpm | cargo | maven | gradle | custom
build_command = "npm run build"
run_command = "npm start"
tags = ["backend", "critical"]

[features]
ide_explorer = true
```

On-disk uses snake_case; serde `#[serde(rename = "...")]` handles mapping.

## Code Style Guidelines

### Rust

- Module-level error types (no top-level catch-all)
- Arc<Mutex<T>> for shared mutable state, RwLock<T> for mostly-read
- `Result<T, E>` everywhere; no unwrap in library code
- Explicit `await` — don't hide async with wrapper functions
- Single-line docs for public items

### TypeScript

- Functional components with hooks
- Explicit prop typing (no `any`)
- Handle loading/error states in components
- One component per file (unless very small atoms)
- CSS class names via Tailwind utilities
- **File naming**: component files → PascalCase; hook, store, and other support files → kebab-case

### Commit Messages

Format: `type(scope): description`

```
feat(fs): add read endpoint with range support
fix(pty): handle SIGTERM gracefully
refactor(api): extract fs handlers to module
test(fs): add sandbox validation tests
docs: update architecture diagram
```

Types: feat, fix, refactor, test, docs, perf, ci, chore.

## Build Artifacts

**Rust:**

- Release: `server/target/release/dam-hopper-server`
- Binary includes all dependencies (musl-libc for portability)

**Web:**

- Vite output: `apps/web/dist/`
- Served by Rust binary via `tower-http::ServeDir`

## Dependency Policy

**Rust:**

- Core: axum, tokio, serde
- Optional: git2 (git ops), portable-pty (terminals), notify (file watching)
- Security: subtle (constant-time comparison), walkdir (path safety)

**Web:**

- Core: react, vite, tailwind, typescript
- API: TanStack Query (data fetching)
- Terminal: xterm.js for PTY rendering; `@xterm/addon-search` for client-only terminal find

No additional heavy dependencies without discussion.

## Feature Flags

Conditional compilation gates feature-specific code.

```rust
#[cfg(feature = "ide_explorer")]
fn my_handler() { ... }
```

Routes registered conditionally at router construction time.

## Documentation

- Public items must have doc comments (`/// ...`)
- Complex algorithms explain the "why"
- Link to related modules/types
- Examples in docs for non-obvious APIs

## Security Checklist

- [ ] Path validation (workspace sandbox)
- [ ] Bearer token authentication
- [ ] No shell injection (avoid shlex parsing for commands)
- [ ] No symlink traversal (validate all path operations)
- [ ] Cross-origin browser access, when needed, uses exact `DAM_HOPPER_CORS_ORIGINS` entries; wildcard CORS is never enabled
- [ ] Media ticket issuance requires authentication; actor/session-bound tickets preserve expiry, revocation, revalidation, and no-store responses
- [ ] Auth cookies remain SameSite=Strict; media cookies remain host-only SameSite=Lax when used, with cleartext interception/modification risk documented
- [ ] Error messages don't leak paths/credentials

## Telemetry Privacy and Fault Boundaries

- Keep Codex usage telemetry behind the opt-in control; the loopback OTLP receiver is the sole
  usage write source and PTY code has no usage sink or fallback hook.
- Keep shell lifecycle handling separate from usage telemetry. The Codex loopback OTLP receiver
  accepts only allowlisted token counters and bounded metadata. Never persist commands, argv, cwd,
  environment, PTY output, prompts, responses, tool content, or raw OTLP.
- Keep telemetry persistence off the PTY hot path: bounded `try_send`, a dedicated worker, one
  SQLite writer, and read-only aggregate connections.
- SQLite fault paths (locked, full, readonly, corrupt, or unavailable) must degrade analytics
  without blocking or terminating PTY operation. Tests should assert this at the store and API
  boundaries.
- Aggregate responses must use nullable values for unavailable token components and expose
  approximate/unattributed coverage rather than manufacturing zeros or exact attribution.
- Destructive usage operations require explicit confirmation, UTC-aligned range validation, and an
  ordered admission barrier. Full deletion rotates the HMAC key only after the store is empty.
- Session summaries are retention-bounded detail records, not permanent history; aggregate retention
  is configured separately.
- A clean telemetry reset removes only `telemetry.db` and its `-wal`/`-shm` sidecars after shutdown.
  The separate `sessions.db` is protected and must remain intact; the two paths must not resolve to
  the same file.

### Browser Debug host rules

- Keep `BrowserDebugKeepAliveHost` alive across shell changes; target/profile changes reset bridge state and generation.
- Native child geometry uses raw rendered bounds and mirrored app zoom. Validate source/origin/nonce/request identity and capability negotiation before commands.
- The v1 relay exposes picker/navigation only; console forwarding is disabled. Popup/download/permission policies are explicit and platform-qualified.
- The iframe bridge is semantic DOM/ARIA metadata only; never transmit HTML, forms, secrets, or page content.
- Profile, editor, transport-generation, and Encrypt persistence boundaries are metadata-only, profile-scoped, or memory-only as described in source.

See [Native Browser Debug Support](./native-browser-debug-support.md) and [Configuration Guide](./configuration-guide.md).
