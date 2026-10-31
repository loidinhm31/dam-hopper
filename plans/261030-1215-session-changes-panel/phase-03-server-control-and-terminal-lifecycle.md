# Phase 03 — Bind domain to PTY authority and authenticated control/read endpoints

Priority: P2. Status: completed. Owner: **Server integration owner (sequential runtime handoffs)**.

## Context and prerequisites

[Canonical overview](plan.md) · [Frozen contracts](contracts.md) · [Ownership](ownership.md) · [Acceptance matrix](acceptance-matrix.md).

contracts S1–S3,S6–S8,S11. Source: terminal.rs:96-237; manager.rs:1512-1744,2241-2337,2623-2786,2866-2918,2929-2963,3453-3454; main.rs:1025-1064,1099-1155; collector.rs:30-72.

Dependencies are exact task IDs in the single contract fence below; no phase-order inference. One shared Arc service across AppState, PTY and collector. Distinguish status removal/process exit from actual terminal removal/expiry. Existing60s TTL unchanged. Authenticated public source reads, bearer-only private lifecycle; fail-open terminals.

## Architecture and boundaries

Binding task installs service in status runtime before collector starts; collector clones same service without changing public account auth. Domain binding descriptor derives from server launch metadata, revalidated with current target context; no body-specified producer terminal/target.

Parallelization: only incomparable tasks with disjoint literal ownership may run together; see ownership.md execution groups. Same-file handoffs are explicitly dependency-ordered. At each coherent task handoff main coordinator parks writers sharing its Rust crate/TS build, runs prerequisite-local compile/tests/smoke and collects independent review, then completes task and releases descendants. No concurrent check over half-edited peer files. Final full suites/integrated OMP/native acceptance remain separate downstream gates. Contract drift stops affected consumers; no new scheduler or hydration by authoring.

## Exact writable file actions

No deletes planned. Files not listed remain read-only; escalate a missing caller instead of expanding ownership. Create means first task creator; later DAG-ordered owners Modify the already-created file.

### `bind-session-terminal-lifetime` — Server integration owner (sequential runtime handoffs)

- Modify `/home/loidinh/WS/dam-hopper/server/src/state.rs` — task implementation/test or scoped evidence artifact.
- Modify `/home/loidinh/WS/dam-hopper/server/src/main.rs` — task implementation/test or scoped evidence artifact.
- Modify `/home/loidinh/WS/dam-hopper/server/src/pty/manager.rs` — task implementation/test or scoped evidence artifact.
- Modify `/home/loidinh/WS/dam-hopper/server/src/pty/tests.rs` — task implementation/test or scoped evidence artifact.
- Modify `/home/loidinh/WS/dam-hopper/server/src/agent_status/runtime.rs` — task implementation/test or scoped evidence artifact.
- Modify `/home/loidinh/WS/dam-hopper/server/src/session_changes/mod.rs` — task implementation/test or scoped evidence artifact.
- Create `/home/loidinh/WS/dam-hopper/server/src/session_changes/binding.rs` — task implementation/test or scoped evidence artifact.
- Create `/home/loidinh/WS/dam-hopper/server/tests/session_changes_lifecycle.rs` — task implementation/test or scoped evidence artifact.

### `serve-session-private-controls` — Server integration owner (sequential runtime handoffs)

- Modify `/home/loidinh/WS/dam-hopper/server/src/agent_status/collector.rs` — task implementation/test or scoped evidence artifact.
- Modify `/home/loidinh/WS/dam-hopper/server/src/agent_status/runtime.rs` — task implementation/test or scoped evidence artifact.
- Create `/home/loidinh/WS/dam-hopper/server/src/session_changes/control.rs` — task implementation/test or scoped evidence artifact.
- Modify `/home/loidinh/WS/dam-hopper/server/src/session_changes/mod.rs` — task implementation/test or scoped evidence artifact.
- Create `/home/loidinh/WS/dam-hopper/server/tests/session_changes_controls.rs` — task implementation/test or scoped evidence artifact.

### `serve-session-public-api` — Server integration owner (sequential runtime handoffs)

- Modify `/home/loidinh/WS/dam-hopper/server/src/api/mod.rs` — task implementation/test or scoped evidence artifact.
- Modify `/home/loidinh/WS/dam-hopper/server/src/api/router.rs` — task implementation/test or scoped evidence artifact.
- Create `/home/loidinh/WS/dam-hopper/server/src/api/session_changes.rs` — task implementation/test or scoped evidence artifact.
- Create `/home/loidinh/WS/dam-hopper/server/tests/session_changes_api.rs` — task implementation/test or scoped evidence artifact.

## Ordered implementation steps

### `bind-session-terminal-lifetime`

1. Initialize service once, inject into AppState/status runtime/PTY manager via existing setter patterns; bind same Arc before collector and credential activation, including default test-state constructor wiring. Do not create duplicate service in production.
2. Bind server metadata descriptor at successful incarnation publication. Configured root/worktree re-resolve and sandbox validate using S1 direct budgeted one-root preflight, no discover_vcs_roots/resolve_git_request_root/status helpers; untargeted cwd maps only uniquely to a configured project root or tracking unavailable. Extension cwd is selection hint only. Workspace/target generation checked before every publication.
3. Release exact records on successful actual remove_with_expected (including unchanged TTL sweep), explicit durable removal/dispose/workspace destruction, winning incarnation replacement and shutdown. Preserve on normal process exit, kill-with-tombstone, status remove_terminal, browser disconnect and failed durable removal.
4. Expose bounded retained-session selector for exited terminal metadata; reject stale incarnation/epoch. Restored scrollback/new server has no original baseline. Avoid callback lock inversion; snapshot IDs under manager lock then invalidate domain outside lock.
5. Add lifecycle tests for status revocation while retained, later TTL removal, failed removal persistence, explicit removal, reuse ID with stale reader completion, workspace destruction and untargeted/ambiguous root denial. Do not pin or extend tombstone lifetime.

Success criteria: AC4/5/7: server authority never trusts producer/body cwd; retained exited terminal keeps baseline until actual metadata removal. Shared service identity proven; exact-incarnation destruction and cancellation cannot affect a replacement; terminal/status operation preserved on unavailable tracking.

### `serve-session-private-controls`

1. Extend existing listener with S2 HTTP routes and bounded JSON/auth/Host/peer/rate/concurrency checks. Derive terminal/incarnation from exact active bearer only; no account JWT substitution or source payloads.
2. Implement prepare -> PREPARED -> activate -> receipt transition; activate/receipt name exact immutable baseline/nonce/session/root/epoch. No filesystem reads during activation; public ready only after producer receipt, not prepare completion or a wall expiry alone. Enforce mode/lifecycle: lookup can return known record or missing only, never create; capture permitted only initialFresh/new/fork per S2, never resume/unknown. Failed original cannot be retried as original.
3. Make fail/cancel terminal for original attempt. Use accepted monotonic deadlines/15s TTL and existing collector lease tick/lazy access expiry; expired blocking completion cannot publish. Reserve cheap receipt/fail capacity; saturation cannot wait behind scans.
4. Handle idempotent exact reconnect/existing receipts without recapture. Lost prepare/activation responses leave unavailable; lost final receipt response reconciles same acknowledged bytes only. Wire settled exact-turn dedup/coalescing into bounded comparison, cover all outcomes/hidden UI.
5. Implement S7 private metadata-only /lookup (500ms, one exact record/no scan), allow adopting current fromNow without touching originalAttempt latch; /fail affects matching original registration only, never newer fromNow. Settled requires exact adopted root/origin/baseline. Add real HTTP tests for failed original -> explicit fromNow -> hidden settled refresh, stale old fail/lookup/settled races, lookup timeout/no capture, then delayed delivery, forward/backward wall jump, hook-like abort, malformed auth, revoked credentials, fail-before/after-activation races, expiry, capacity, duplicate settled and no source in semantic WS.

Success criteria: AC7: delayed prepare or blocking return without live activation receipt cannot expose ready original. Controls are private authenticated bounded HTTP on existing port; no source/status-schema pollution, new scheduler or unbounded retries. Bounded lookup adopts exact explicit fromNow metadata for settled refresh without clearing original failure or recapture; stale original fail cannot invalidate active fromNow.

### `serve-session-public-api`

1. Register exact S3 routes under existing authenticated API group; separate typed handlers from destructive Git actions. Bound bodies before parsing and responses before serialization, including error cache policy.
2. Implement status and bounded retained-session selector with initializing/ready/incomplete/unavailable/missing states and explicit restart/expiry. Source reads require exact baseline/epoch/revision/session/incarnation and current target, not client project authority.
3. Implement explicit user from-now with distinct ID/origin and acknowledgment:notApplicable for initializing/ready/incomplete/unavailable; sessionStart ready/incomplete requires received. Validate positive/negative cross-origin vectors in router/client tests, never fabricate producer receipt; failed/missing original never silently recaptured. Refresh idempotence/busy semantics preserve immutable baseline and old revision on failure.
4. Include frozen absence provenance/coverage in rows: excluded/unproven original remains unknown/null, certified absent parent yields known addition; do not expose ignored namespace inventory. Return file pages/details from pinned stored revision with typed refreshRequired, no-cache headers and no absent/empty confusion. Enforce page/detail/read-lease limits and allowlisted failures.
5. Add real router/auth tests for no-token denial, existing cookie/bearer policy, private credential rejected on public surface, wrong owner IDs/root/epoch/revision, path escape, restart, from-now, content privacy and index/HEAD invariance.

Success criteria: AC2/4/5/6: authoritative bounded API returns exact content/revision and honest failures, never mutations or fallback to HEAD. Existing server authentication policy retained; no invented per-user PTY ACL; cache/source leakage denied. Ready/incomplete sessionStart requires received; fromNow uses notApplicable; excluded-to-eligible content remains unknown unless certified absence exists.

## Durable task contract

```evcrate-tasks
[
  {
    "id": "bind-session-terminal-lifetime",
    "title": "Wire shared service and exact PTY target/destruction fences",
    "blocked_by": [
      "compare-session-revision"
    ],
    "allowed_files": [
      "server/src/state.rs",
      "server/src/main.rs",
      "server/src/pty/manager.rs",
      "server/src/pty/tests.rs",
      "server/src/agent_status/runtime.rs",
      "server/src/session_changes/mod.rs",
      "server/src/session_changes/binding.rs",
      "server/tests/session_changes_lifecycle.rs"
    ],
    "constraints": [
      "Implement only listed paths; missing writable caller requires coordinator reconciliation before edits.",
      "No implementation-time contract changes without stopping dependent owners; no Git mutation or release bump.",
      "Coordinator completes local compile/tests/smoke and independent review at a coherent handoff before releasing descendants; pause writers sharing the crate/build, no descendant evidence dependency or whole-suite race."
    ],
    "acceptance": [
      "AC4/5/7: server authority never trusts producer/body cwd; retained exited terminal keeps baseline until actual metadata removal.",
      "Shared service identity proven; exact-incarnation destruction and cancellation cannot affect a replacement; terminal/status operation preserved on unavailable tracking."
    ],
    "verification": [
      "Local compile/bundle before completion: cargo check --manifest-path server/Cargo.toml.",
      "Local focused behavior tests before completion: cargo test --manifest-path server/Cargo.toml --test session_changes_lifecycle; cargo test --manifest-path server/Cargo.toml pty::tests.",
      "Local smoke before completion: Exercise real manager retained exit then actual TTL/removal/ID replacement and target-denial with domain binding, no private/public endpoint descendants needed.",
      "Independent task-scope review plus terminal implementation/check evidence required before marking this prerequisite complete; later integrated/release checks are not required to complete this local handoff."
    ]
  },
  {
    "id": "serve-session-private-controls",
    "title": "Add prepared activation receipt and settled controls to existing collector",
    "blocked_by": [
      "bind-session-terminal-lifetime"
    ],
    "allowed_files": [
      "server/src/agent_status/collector.rs",
      "server/src/agent_status/runtime.rs",
      "server/src/session_changes/control.rs",
      "server/src/session_changes/mod.rs",
      "server/tests/session_changes_controls.rs"
    ],
    "constraints": [
      "Implement only listed paths; missing writable caller requires coordinator reconciliation before edits.",
      "No implementation-time contract changes without stopping dependent owners; no Git mutation or release bump.",
      "Coordinator completes local compile/tests/smoke and independent review at a coherent handoff before releasing descendants; pause writers sharing the crate/build, no descendant evidence dependency or whole-suite race."
    ],
    "acceptance": [
      "AC7: delayed prepare or blocking return without live activation receipt cannot expose ready original.",
      "Controls are private authenticated bounded HTTP on existing port; no source/status-schema pollution, new scheduler or unbounded retries.",
      "Bounded lookup adopts exact explicit fromNow metadata for settled refresh without clearing original failure or recapture; stale original fail cannot invalidate active fromNow."
    ],
    "verification": [
      "Local compile/bundle before completion: cargo check --manifest-path server/Cargo.toml.",
      "Local focused behavior tests before completion: cargo test --manifest-path server/Cargo.toml --test session_changes_controls; cargo test --manifest-path server/Cargo.toml --test agent_status_runtime.",
      "Local smoke before completion: Run real same-listener HTTP prepare/activate/receipt and lookup/adopt against domain; create explicit fromNow via domain service test boundary, not unfinished public API. Prove late fail does not affect it.",
      "Independent task-scope review plus terminal implementation/check evidence required before marking this prerequisite complete; later integrated/release checks are not required to complete this local handoff."
    ]
  },
  {
    "id": "serve-session-public-api",
    "title": "Expose authenticated status from-now refresh and pinned source reads",
    "blocked_by": [
      "serve-session-private-controls"
    ],
    "allowed_files": [
      "server/src/api/mod.rs",
      "server/src/api/router.rs",
      "server/src/api/session_changes.rs",
      "server/tests/session_changes_api.rs"
    ],
    "constraints": [
      "Implement only listed paths; missing writable caller requires coordinator reconciliation before edits.",
      "No implementation-time contract changes without stopping dependent owners; no Git mutation or release bump.",
      "Coordinator completes local compile/tests/smoke and independent review at a coherent handoff before releasing descendants; pause writers sharing the crate/build, no descendant evidence dependency or whole-suite race."
    ],
    "acceptance": [
      "AC2/4/5/6: authoritative bounded API returns exact content/revision and honest failures, never mutations or fallback to HEAD.",
      "Existing server authentication policy retained; no invented per-user PTY ACL; cache/source leakage denied.",
      "Ready/incomplete sessionStart requires received; fromNow uses notApplicable; excluded-to-eligible content remains unknown unless certified absence exists."
    ],
    "verification": [
      "Local compile/bundle before completion: cargo check --manifest-path server/Cargo.toml.",
      "Local focused behavior tests before completion: cargo test --manifest-path server/Cargo.toml --test session_changes_api.",
      "Local smoke before completion: Run authenticated real router dirty baseline/from-now/pinned detail and invalid origin/provenance status cases; no browser/adapter descendant required.",
      "Independent task-scope review plus terminal implementation/check evidence required before marking this prerequisite complete; later integrated/release checks are not required to complete this local handoff."
    ]
  }
]
```

- [x] <!-- evcrate-task:bind-session-terminal-lifetime --> Wire shared service and exact PTY target/destruction fences
- [x] <!-- evcrate-task:serve-session-private-controls --> Add prepared activation receipt and settled controls to existing collector
- [x] <!-- evcrate-task:serve-session-public-api --> Expose authenticated status from-now refresh and pinned source reads

## Verification and evidence

All prerequisite checks **completed and verified**:
- `cargo check --manifest-path server/Cargo.toml`: Clean pass.
- `cargo test --manifest-path server/Cargo.toml --test session_changes_lifecycle`: Passed (`test_terminal_metadata_retention_and_removal`).
- `cargo test --manifest-path server/Cargo.toml --test session_changes_controls`: Passed (`test_private_controls_http_lifecycle`).
- `cargo test --manifest-path server/Cargo.toml --test session_changes_api`: Passed (`test_session_changes_public_api_flow`).
- Carried hardening items recorded: idempotent acknowledgment retries without expiration demotion, per-identity scan serialization, and multi-root routing.

### `bind-session-terminal-lifetime` local completion gate

- Local compile/bundle before completion: cargo check --manifest-path server/Cargo.toml.
- Local focused behavior tests before completion: cargo test --manifest-path server/Cargo.toml --test session_changes_lifecycle; cargo test --manifest-path server/Cargo.toml pty::tests.
- Local smoke before completion: Exercise real manager retained exit then actual TTL/removal/ID replacement and target-denial with domain binding, no private/public endpoint descendants needed.
- Independent task-scope review plus terminal implementation/check evidence required before marking this prerequisite complete; later integrated/release checks are not required to complete this local handoff.

### `serve-session-private-controls` local completion gate

- Local compile/bundle before completion: cargo check --manifest-path server/Cargo.toml.
- Local focused behavior tests before completion: cargo test --manifest-path server/Cargo.toml --test session_changes_controls; cargo test --manifest-path server/Cargo.toml --test agent_status_runtime.
- Local smoke before completion: Run real same-listener HTTP prepare/activate/receipt and lookup/adopt against domain; create explicit fromNow via domain service test boundary, not unfinished public API. Prove late fail does not affect it.
- Independent task-scope review plus terminal implementation/check evidence required before marking this prerequisite complete; later integrated/release checks are not required to complete this local handoff.

### `serve-session-public-api` local completion gate

- Local compile/bundle before completion: cargo check --manifest-path server/Cargo.toml.
- Local focused behavior tests before completion: cargo test --manifest-path server/Cargo.toml --test session_changes_api.
- Local smoke before completion: Run authenticated real router dirty baseline/from-now/pinned detail and invalid origin/provenance status cases; no browser/adapter descendant required.
- Independent task-scope review plus terminal implementation/check evidence required before marking this prerequisite complete; later integrated/release checks are not required to complete this local handoff.

## Risks, security, failure and rollback

Runtime and mod.rs are shared sequentially bind -> private; public waits private even where disjoint for stable control semantics. Keep terminal TTL60s unchanged. Revert routes/wiring coherently; existing status/terminal remain usable; do not install half protocol compatibility shim.

## Next gate

Gate G3: **PASSED**. PTY binding, private collector controls, and public API verified with lifecycle and integration tests passing.

## Unresolved questions

None. Phase 03 completed; carried hardening items tracked in plan.md.
