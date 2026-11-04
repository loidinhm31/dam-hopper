# P02 — Atomic guarded backend termination

Priority P2 · Status pending · Effort 16h · Owner BackendOwner.

## Context, parallelization and prerequisites
Read [C1/C2](architecture-contracts.md), [P01](phase-01-shared-contracts.md), [terminal evidence](reports/session-contract-evidence.md), [accepted V2/V3 source screening](reports/validation-decisions.md), [guard qualification](acceptance-matrix.md#guard). Sources: `server/src/pty/manager.rs:803-845,2445-2449,2622-2637,3218-3291,3551-3578,4302-4348,4554-4608`; `server/src/pty/session.rs:328-408`; `server/src/pty/fleet_state.rs:268-308`; existing terminal/router/API tests. Read entire participating functions before implementation.
After `freeze-shared-contracts`, this branch runs concurrently with P03/P05/P06, not P04. BackendOwner serially owns its two tasks; API task follows domain task. Source handoff does not mean runtime qualification. No privileged-host capability API or SessionChanges producer edits.

## Requirements and architecture
Dedicated authenticated route preserves legacy DELETE for unrelated clients. Manager UUID per authority construction, clone-shared/not persisted. Selection linearized under persistence_gate ->inner; pending replacement refusal before ANY mutation. Live request fallible signal !=exit; exact dead restart/backoff cancellation completes immediately before replacement admission. Additive API-only exact-string/state inventory from one snapshot, no new supervision runtime/persistence authority/lock across wait or await.

### Task `guarded-termination-domain`
**Modify:** `server/src/pty/manager.rs`, `server/src/pty/session.rs`, `server/src/pty/fleet_state.rs`, `server/src/pty/tests.rs`. **Create/Delete:** none. BackendOwner only; fleet_state scope limited to exact read predicates `is_restart_pending(id,incarnation)` / `is_creating(id,incarnation)` and their narrow tests if colocated; reuse existing exact cancel. No fleet transition/scheduler redesign. API task consumes final domain snapshot/outcome signatures.

1. Add manager-lifetime UUID at authority construction/restore, clone-shared. Expose `termination_epoch()`; never borrow AgentStatus/SessionChanges/time identity. No dependency addition without separate approval.
2. Introduce `GuardedTerminationError`, `GuardedTerminationOutcome::{TerminationRequested,RestartCancelled}` and `request_termination(id,&expected_epoch,expected_incarnation) -> Result<GuardedTerminationOutcome,GuardedTerminationError>`. Parse outside domain. Under persistence_gate then inner enforce P01 precedence: epoch/lifecycle/pending replacement first, then existing live/dead exact identity, prior request/cancellation and admissible action. Never preflight then bare-ID kill/remove. Refusals inspect only: allocator/killed/pending/fleet/live/dead/persistence/status/ports unchanged, no signal.
3. Add fallible `LiveSession::request_termination() -> Result<(),...>` separate from legacy best-effort `terminate()`. Use existing process-group kill, then platform child-killer fallback. Return success only when a signal operation succeeds; if all attempts fail return typed sanitized failure. Never call `signal_shutdown()` first: that could end the reader and manufacture a wait path despite failed signal. Keep current platform behavior for legacy teardown, no process supervision rewrite.
4. Select exact LiveSession and execute only the bounded synchronous signal syscall under the selection boundary; no process wait, await, sleep, network/persistence work there. Respect existing nested mutex order used by legacy signal paths; do not add new lock inversion. After success record exact `(id,incarnation)` termination-requested marker in Inner, while retaining live session/fleet/status/ports. Use the exact marker (not a raw-ID permanent killed flag) to suppress restart in reader decision. Duplicate same-identity requests return 409 without signaling again. Failure has no requested marker or lifecycle changes; process remains observable. If a platform call is ambiguous, UI may reconcile but server never claims an exit.
5. Exact dead source with `will_restart` + matching fleet restart_pending and NO pending replacement: in same selection transaction set `will_restart=false`, `restart_in_ms=None`, `restart_cancelled=true` on exact DeadSession, then `fleet.cancel_restart_pending(id,incarnation)`; publish existing terminal/activity invalidation after acceptance. Return RestartCancelled immediately with exact identity; no signal/live cleanup, tombstone/history eviction, raw-ID killed marker or new DB field. Add runtime-only completion field to DeadSession, initialize false in every constructor/literal and retain for that tombstone lifetime (ordinary expiry/removal/replacement clears naturally). Do not infer cancellation from ordinary exited/will_restart=false. Later explicit same-ID create must remain possible.
6. Keep existing exact-source base `respawn_source_is_current`. Add `respawn_admission_is_current`: base + dead.will_restart + exact fleet pending + no pending_replacements. Queue receipt/timer wake and respawn reservation recheck admission under inner; cancelled stale commands no-op, exact cleanup cannot affect newer identity. Under that same lock begin_replacement + pending-to-creating reservation. Publication uses `respawn_replacement_is_current`: base + exact pending replacement + fleet creating, plus existing generation/lifecycle checks, NOT admission/pending entry already consumed. No restart of cancelled source; no refusal/cancellation of already-admitted spawn; normal respawn still publishes. Preserve persistence_gate ->inner ordering; all sleeps/awaits outside synchronous locks.
   - Explicit asynchronous failure boundary: `supervisor_loop` target validation at `manager.rs:3597-3607` can fail before reservation and currently records `TerminalFinalExit` before `finish_respawn_source_failure` (`:3678-3697,3763-3797`). Recheck exact still-active, uncancelled restart ownership under persistence_gate -> inner before authorizing any failure mutation. Gate tombstone/target-unavailable persistence and final-exit/workflow events on the accepted transition result; cancelled/superseded commands have no authoritative effects. Do not use consumed-pending admission requirements for post-reservation failure handling. Keep failure result/event identity exact through publication.
   - Add deterministic regression: pause target validation before reservation; accept exact End cancellation; resume validation with target-loss error. Assert retained `restartCancelled` marker and inventory projection/history unchanged, no target-unavailable rewrite, no stale persistence/workflow/final-exit event; lost cancellation response still reconciles. Include non-target validation failure variant and ordinary uncancelled failure behavior. Existing manager/domain task owns all changes; no new file/runtime/poller.
7. Implement `termination_inventory_snapshot(include_buffer_bytes:bool) -> TerminalInventorySnapshot {server_epoch:Uuid,rows:Vec<TerminalInventorySnapshotRow>}` in manager.rs. Internal row `{meta:SessionMeta,incarnation:u64,termination_state:TerminalInventoryState,buffer_bytes:Option<usize>}`; six-state enum names map exactly to P01 wire strings. Clone metadata/exact identity/state+optional existing detailed size under ONE inner lock, not list then state query. Same marker/fleet/replacement precedence; unverified/target-unavailable/replacement/lifecycle conflict ->unavailable, restartPending not exited. Ordinary list/list_detailed/SessionMeta/persistence unchanged. API-only wire mapping supplied next task.
8. Child reader successful wait + exact incarnation/shutdown Arc ownership remain final live-exit authority. Guarded-requested identity must not use wait().unwrap_or(0): failed wait stays unresolved live/requested, no fake tombstone/restart/status/ports cleanup or new watcher. Consume live requested marker only on authoritative completion/exact retirement; old reader cannot tombstone/suppress/unregister newer replacement. Retain actual exit/history cleanup after real exit, never at202.
9. Deterministic barriers at restart admission/publication, signal and exit boundaries: two manager epochs same id/incarnation; cancellation wins before reservation (200 domain outcome, full exact state); reservation first refuses without effect; stale queued/timer wake; normal uncancelled respawn publishes after pending consumption; explicit new same-ID create after cancellation survives; pending initial create/old-live respawn conflicts; ordinary exited/missing/closing/duplicate request/cancel; signal/wait failure, delayed successful wait, replacement after live acceptance. Compare allocator/pending/fleet/killed/request/cancel markers/live/dead/persistence/status/ports on refusal. Max-u64 snapshot states and cancellation marker lifetime/lost-response observation covered. Existing inline manager predicate tests must adopt split semantics. Inject only syscall/wait collaborators; no timing-sleep oracle. Real PTY gates separate.

### Task `guarded-termination-http`
**Modify:** `server/src/api/terminal.rs`, `server/src/api/router.rs`, `server/src/api/tests.rs`. **Create/Delete:** none. BackendOwner; blocked by `guarded-termination-domain`. Terminal API handler owns request bounds/errors; keep global unrelated ApiError behavior unchanged.

1. Add route beside existing terminal routes; inherit same authentication/rate/CORS protections. Apply route-local 512-byte pre-deserialization body limit, reject unknown fields with strict serde DTO and typed JSON rejection mapping. Reject noncanonical UUID/u64 string and numeric incarnation, unsupported version and malformed request with frozen errors. Profile/generation never accepted as server authority.
2. Return202 terminationRequested only after exact live signal success; return200 restartCancelled only after exact pending cancellation. Echo canonical string identity/P01 envelope, map frozen errors/statuses. No success from bare missing/non-live state or process-exited response; pending replacement refusal takes precedence.
3. Define serializable API-only `TerminalInventoryRowDto` in terminal.rs: `meta:SessionMeta` with serde(flatten), `incarnation_exact:String` renamed `"incarnationExact"`, `termination_state:TerminalInventoryState` renamed `"terminationState"` with frozen camel-case variant strings, `buffer_bytes:Option<usize>` omitted when None. Each handler calls `termination_inventory_snapshot(false|true)` ONCE, maps rows/stringifies original u64 and emits snapshot UUID/capability/no-store headers after releasing lock. Array/numeric/detailed keys compatible; both projections additive flat fields. No second state query, persisted SessionMeta authority, wildcard CORS or new endpoint.
4. Actual router/auth/extraction tests: strict fields/types/canonical/overflow/max-u64, >512, auth/media errors, all domain refusals, 202 vs200 exact outcomes and no signal for cancellation. List AND detailed flattening/exact/state/legacy numeric/array compatibility + CORS headers from same snapshot, all six states, cancellation marker retained after response loss. Same P01 fixtures; legacy DELETE tests remain unrelated compatibility.

## Consumer-visible acceptance and exact future checks
- Original lifetime A observation cannot affect B with equal id/incarnation; every refusal no-op. Exact pending restart cancels only before reservation; pending replacement remains protected. Normal uncancelled restart and later explicit create still succeed.
- Live202 retains observable ownership until successful reader wait; only captured live process exits without restart. Pending200 completes exact cancellation immediately, retains tombstone/history and exposes marker for loss reconciliation. Signal/wait failures not fake success.
- P08: `cargo test --manifest-path server/Cargo.toml pty::tests`; `cargo test --manifest-path server/Cargo.toml pty::manager::tests` for existing colocated predicate tests; `cargo test --manifest-path server/Cargo.toml api::tests`; full cargo suite. Record actual discovered module names/results, never inferred counts.
- Real PTY: capture headers+exact row for process group; live POST202 then exact exited row +child termination. Separately real restart-pending process POST200 retains history/no replacement after wake. Exercise normal uncancelled restart publication. Legacy array clients decode both projections; no raw event as exit proof.

## Failure, rollback, security and resources
Any refusal mutation, false tombstone, unsupported platform signaling or lock inversion blocks integration. On accepted response loss keep client unresolved; never replay automatically. API rollback disables guarded capability along with route; safe web fails closed on older server. Retain legacy APIs but no web fallback. Test processes/persistence paths isolated; clean only owned processes after recording evidence. Signal failure detail must not leak commands/paths. API rollback never kills unknown work or evicts history.

All checks below are FUTURE implementation checks, executed once by P08 after branches and integration land, not by this plan author or mid-flight workers. Read installed test principles before execution; retain failures/skips/blocks. No Git, dependencies, release or implementation authorization is conveyed by this phase. Root for all literal paths: `/home/loidinh/WS/dam-hopper`. Escalate any additional writable path before editing; no directory-wide permissions. No source file deletions unless explicitly listed. Existing incidental-wording/default assertions must be replaced/deleted for changed semantics, not re-pinned; add permanent tests only for named behavioral risks.

## Durable tasks

```evcrate-tasks
[
  {
    "id": "guarded-termination-domain",
    "title": "Implement atomic exact live End and pending restart cancellation",
    "blocked_by": [
      "freeze-shared-contracts"
    ],
    "allowed_files": [
      "server/src/pty/manager.rs",
      "server/src/pty/session.rs",
      "server/src/pty/fleet_state.rs",
      "server/src/pty/tests.rs"
    ],
    "constraints": [
      "BackendOwner only; preserve persistence-gate then inner lock order.",
      "No state mutation on refusal; no wait/await under selection locks; no fake tombstone."
    ],
    "acceptance": [
      "Epoch/exact identity atomically matched; cancellation-before-admission wins and admitted replacement refusal is no-op.",
      "Live signal stays requested until real exit; pending cancellation retains exact tombstone completion/history without signal or raw-ID kill.",
      "Single snapshot projects all six states; stale wakes and pre-reservation validation failures are no-op after cancellation, normal respawn publishes and later same-ID create survives."
    ],
    "verification": [
      "P08: cargo test --manifest-path server/Cargo.toml pty::tests and cargo test --manifest-path server/Cargo.toml pty::manager::tests; cancellation/admission/publication/full-state probes including held target-validation failure after cancellation, real PTY exit, pending cancellation and normal respawn."
    ]
  },
  {
    "id": "guarded-termination-http",
    "title": "Expose bounded guarded route and original-observation headers",
    "blocked_by": [
      "guarded-termination-domain"
    ],
    "allowed_files": [
      "server/src/api/terminal.rs",
      "server/src/api/router.rs",
      "server/src/api/tests.rs"
    ],
    "constraints": [
      "BackendOwner consumes frozen P01 protocol and completed domain contract.",
      "Keep legacy DELETE, numeric fields and array shape; additive API-only exact/state projection, no new capability endpoint."
    ],
    "acceptance": [
      "Strict bounded authenticated POST returns frozen errors, 202 exact live request or 200 exact pending cancellation.",
      "Both inventory arrays carry exact string/state rows and same-snapshot exposed capability/epoch/no-store headers without persisted authority."
    ],
    "verification": [
      "P08: cargo test --manifest-path server/Cargo.toml api::tests; cargo test --manifest-path server/Cargo.toml; actual authenticated HTTP headers/error/body checks."
    ]
  }
]
```

- [ ] <!-- evcrate-task:guarded-termination-domain --> Implement atomic exact live End and pending restart cancellation
- [ ] <!-- evcrate-task:guarded-termination-http --> Expose bounded guarded route and original-observation headers
