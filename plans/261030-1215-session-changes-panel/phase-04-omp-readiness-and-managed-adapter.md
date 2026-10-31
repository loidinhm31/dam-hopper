# Phase 04 — Await root OMP readiness and deliver settled controls safely

Priority: P2. Status: completed. Owner: **OMP adapter owner**.

## Context and prerequisites

[Canonical overview](plan.md) · [Frozen contracts](contracts.md) · [Ownership](ownership.md) · [Acceptance matrix](acceptance-matrix.md).

contracts S1–S2,S6–S7,S11–S12; omp-lifecycle-evidence. Installed18.13.3 hooks awaited but runner30s fail-open. Current standalone asset must remain independently installable; no UI module imports.

Dependencies are exact task IDs in the single contract fence below; no phase-order inference. Monotonic12s barrier,10s request budget, prepared/activate/receipt proof, exact per-session failure latch and reconnect no-recapture. Root interactive only; use existing250ms settled path, not raw agent_end.

## Architecture and boundaries

Existing extension factory gets async session_start/session_switch and before_agent_start safety checks. HTTP URL derived from validated status URL/token; existing WS semantic protocol remains source-free. Managed installer detects owned asset changes and refuses modified user files.

Parallelization: only incomparable tasks with disjoint literal ownership may run together; see ownership.md execution groups. Same-file handoffs are explicitly dependency-ordered. At each coherent task handoff main coordinator parks writers sharing its Rust crate/TS build, runs prerequisite-local compile/tests/smoke and collects independent review, then completes task and releases descendants. No concurrent check over half-edited peer files. Final full suites/integrated OMP/native acceptance remain separate downstream gates. Contract drift stops affected consumers; no new scheduler or hydration by authoring.

## Exact writable file actions

No deletes planned. Files not listed remain read-only; escalate a missing caller instead of expanding ownership. Create means first task creator; later DAG-ordered owners Modify the already-created file.

### `await-omp-baseline-receipt` — OMP adapter owner

- Modify `/home/loidinh/WS/dam-hopper/server/src/agent_status/assets/omp-agent-status.ts` — task implementation/test or scoped evidence artifact.
- Modify `/home/loidinh/WS/dam-hopper/server/tests/omp-agent-status.test.ts` — task implementation/test or scoped evidence artifact.

### `package-omp-session-adapter` — OMP adapter owner

- Modify `/home/loidinh/WS/dam-hopper/server/src/agent_status/integration.rs` — task implementation/test or scoped evidence artifact.
- Modify `/home/loidinh/WS/dam-hopper/server/tests/agent_status_hooks.rs` — task implementation/test or scoped evidence artifact.
- Modify `/home/loidinh/WS/dam-hopper/server/tests/agent_status_integration.rs` — task implementation/test or scoped evidence artifact.

## Ordered implementation steps

### `await-omp-baseline-receipt`

1. Introduce bounded per-session attempt map with original failure/success/live token and canonical prepared receipt fields. Validate URL/token as today; derive same-listener HTTP paths; never log bearer/source/raw cwd. Extend narrow standalone context typing for actual getEntries/getSessionFile and session_switch reason, without upstream edits.
2. Await start/switch before first prompt. Determine S2 freshness from switch new/fork or initial no-conversation metadata plus absent local allocated session file; inspect only role/type/existence, no transcript contents/path logging. Persisted/history-bearing/resume/unknown sessions lookup only, never original capture; missing capability conservatively unavailable/from-now. For eligible capture: prepare, validate identity+monotonic liveness, activate exact prepared bytes, receive validated activation readiness receipt while live, submit receipt. No fresh read on activation; late continuations check canceled token before any control send.
3. Keep immutable originalAttempt latch separate from activeReview metadata pointer. At existing preflight/settled hook only, perform one bounded500ms /lookup to adopt exact current fromNow or received original; no retry/poller/capture, no clearing failed original. Recheck session/root/incarnation/epoch after await; stale old lookup/fail cannot replace/invalidate fromNow. Catch errors inside hook and latch original unavailable before returning, cancel token before AbortController. Add before_agent_start identity/failure check only, never retry original after model begins. Session switch/new/fork distinguishes exact identity; existing known record reused, missing after restart explicit.
4. Distinguish lost activation response (failure/no receipt) from lost final receipt submission response (already acknowledged bytes; reconcile same receipt without recapture). Handler/event loop suspension, wall jumps and runner fail-open cannot send readiness for a late newly captured baseline.
5. Lookup/adopt once then send exact root/origin/baseline/session/turn settled private control from handleSettledEnd for every outcome using exact turn/session/baseline; keep250ms retry/compaction suppression. Map semantic blocked state=>blocked, error=>error, interrupted=>aborted, ended+idle=>completed, elseunknown for private control only. Preserve existing semantic enum/status behavior and child/noUI exclusions.
6. Add asynchronous adapter/factory tests with controllable HTTP boundary and hook promise ordering: initialFresh/new/fork capture eligibility; persisted initial/resume/unknown lookup-only; first edit after receipt; delayed prepare past12s; activation response after timeout; throwing handler; switch rollback/reconnect; duplicate turn; blocked/error outcomes; lost final response and no original retries. Add failed-original->browser fromNow->hidden settled refresh test, stale original failure races, lookup timeout/epoch change, fromNow notApplicable acceptance and original failure latch preservation.

Success criteria: Local awaited factory/HTTP-boundary tests prove live receipt ordering/failure latch; bounded lookup/adoption refreshes fromNow without original recapture. Actual OMP integration belongs to prove-live-omp-first-turn, not this prerequisite. No lifecycle/status regression, new flag/env/port/runtime or source payload; settled refresh is exact and bounded.

### `package-omp-session-adapter`

1. Update managed adapter content version only as needed for changed bundled asset; preserve content-hash ownership checks and standalone install location. No application release version bump.
2. Test new install/current/outdated/update/uninstall/modified refusal with real temporary agent directory. Ensure HTTP lifecycle logic is bundled in same extension; no missing runtime import.
3. Report source applicability18.13.3 and old docs qualification separately. Installation success does not certify live first-turn protocol; hand off actual installed asset hash to integration owner.

Success criteria: Managed adapter can be installed/upgraded/uninstalled without overwriting user-modified files; handshake code actually bundled. No fake OMP qualification or dependency/runtime addition.

## Durable task contract

```evcrate-tasks
[
  {
    "id": "await-omp-baseline-receipt",
    "title": "Implement live guarded lifecycle handshake and exact settled signals",
    "blocked_by": [
      "freeze-session-contract"
    ],
    "allowed_files": [
      "server/src/agent_status/assets/omp-agent-status.ts",
      "server/tests/omp-agent-status.test.ts"
    ],
    "constraints": [
      "Implement only listed paths; missing writable caller requires coordinator reconciliation before edits.",
      "No implementation-time contract changes without stopping dependent owners; no Git mutation or release bump.",
      "Coordinator completes local compile/tests/smoke and independent review at a coherent handoff before releasing descendants; pause writers sharing the crate/build, no descendant evidence dependency or whole-suite race."
    ],
    "acceptance": [
      "Local awaited factory/HTTP-boundary tests prove live receipt ordering/failure latch; bounded lookup/adoption refreshes fromNow without original recapture. Actual OMP integration belongs to prove-live-omp-first-turn, not this prerequisite.",
      "No lifecycle/status regression, new flag/env/port/runtime or source payload; settled refresh is exact and bounded."
    ],
    "verification": [
      "Local compile/bundle before completion: bun build server/src/agent_status/assets/omp-agent-status.ts --target=bun --outdir /tmp/dam-hopper-session-adapter-check-$$.",
      "Local focused behavior tests before completion: bun test server/tests/omp-agent-status.test.ts.",
      "Local smoke before completion: Exercise real adapter factory awaited hooks against controlled HTTP boundary with delayed prepare/receipt and failed-original->fromNow lookup adoption. This local protocol smoke does not claim actual OMP qualification; that belongs to prove-live-omp-first-turn.",
      "Independent task-scope review plus terminal implementation/check evidence required before marking this prerequisite complete; later integrated/release checks are not required to complete this local handoff."
    ]
  },
  {
    "id": "package-omp-session-adapter",
    "title": "Update ownership-safe managed asset packaging and installation coverage",
    "blocked_by": [
      "await-omp-baseline-receipt"
    ],
    "allowed_files": [
      "server/src/agent_status/integration.rs",
      "server/tests/agent_status_hooks.rs",
      "server/tests/agent_status_integration.rs"
    ],
    "constraints": [
      "Implement only listed paths; missing writable caller requires coordinator reconciliation before edits.",
      "No implementation-time contract changes without stopping dependent owners; no Git mutation or release bump.",
      "Coordinator completes local compile/tests/smoke and independent review at a coherent handoff before releasing descendants; pause writers sharing the crate/build, no descendant evidence dependency or whole-suite race."
    ],
    "acceptance": [
      "Managed adapter can be installed/upgraded/uninstalled without overwriting user-modified files; handshake code actually bundled.",
      "No fake OMP qualification or dependency/runtime addition."
    ],
    "verification": [
      "Local compile/bundle before completion: cargo check --manifest-path server/Cargo.toml.",
      "Local focused behavior tests before completion: cargo test --manifest-path server/Cargo.toml --test agent_status_hooks --test agent_status_integration.",
      "Local smoke before completion: Install/check/update/uninstall real bundled extension in isolated temporary OMP agent directory, verify hash and modified-file refusal, no live model prerequisite.",
      "Independent task-scope review plus terminal implementation/check evidence required before marking this prerequisite complete; later integrated/release checks are not required to complete this local handoff."
    ]
  }
]
```

- [x] <!-- evcrate-task:await-omp-baseline-receipt --> Implement live guarded lifecycle handshake and exact settled signals
- [x] <!-- evcrate-task:package-omp-session-adapter --> Update ownership-safe managed asset packaging and installation coverage

## Verification and evidence

All prerequisite checks **completed and verified**:
- `bun test server/tests/omp-agent-status.test.ts`: Passed.
- `cargo check --manifest-path server/Cargo.toml`: Clean pass.
- `cargo test --manifest-path server/Cargo.toml --test agent_status_hooks --test agent_status_integration`: Passed.
- Asset bundling and lifecycle handshakes verified against collector control endpoints.
- Carried hardening items recorded: dirty-turn preservation and coalesced retry handling on busy/failed scans.

### `await-omp-baseline-receipt` local completion gate

- Local compile/bundle before completion: bun build server/src/agent_status/assets/omp-agent-status.ts --target=bun --outdir /tmp/dam-hopper-session-adapter-check-$$.
- Local focused behavior tests before completion: bun test server/tests/omp-agent-status.test.ts.
- Local smoke before completion: Exercise real adapter factory awaited hooks against controlled HTTP boundary with delayed prepare/receipt and failed-original->fromNow lookup adoption. This local protocol smoke does not claim actual OMP qualification; that belongs to prove-live-omp-first-turn.
- Independent task-scope review plus terminal implementation/check evidence required before marking this prerequisite complete; later integrated/release checks are not required to complete this local handoff.

### `package-omp-session-adapter` local completion gate

- Local compile/bundle before completion: cargo check --manifest-path server/Cargo.toml.
- Local focused behavior tests before completion: cargo test --manifest-path server/Cargo.toml --test agent_status_hooks --test agent_status_integration.
- Local smoke before completion: Install/check/update/uninstall real bundled extension in isolated temporary OMP agent directory, verify hash and modified-file refusal, no live model prerequisite.
- Independent task-scope review plus terminal implementation/check evidence required before marking this prerequisite complete; later integrated/release checks are not required to complete this local handoff.

## Risks, security, failure and rollback

OMP fails open on extension failure. Do not try to change upstream runner or promise hard model blocking; preserve honest coverage. Rollback ownership-safe prior asset/installer only; no edits to installed user package or unrelated hooks.

## Next gate

Gate G4: **PASSED**. Adapter bundle, lifecycle handshake, and managed installer tests verified.

## Unresolved questions

None. Phase 04 completed; carried hardening items tracked in plan.md.
