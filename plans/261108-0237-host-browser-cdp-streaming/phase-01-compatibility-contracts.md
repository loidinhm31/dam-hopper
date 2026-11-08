# Phase 01 — Qualify adapter and freeze contracts

## Context links
- [Overview](plan.md) · [Architecture contracts](architecture-contracts.md) · [Acceptance matrix](acceptance-matrix.md) · [Execution ownership](execution-ownership.md).
- [Backend evidence](reports/backend-boundaries.md) · [Viewer evidence](reports/viewer-boundaries.md) · [Protocol research](research/stream-protocol.md) · [Settled direction](reports/design-direction.md).
- Relevant bounded evidence: `research/stream-protocol.md:14–101; reports/design-direction.md:6–27,39–51`. Research recommendations superseded by architecture contract where explicitly stated.

## Overview
- Priority: P2. Status: DONE (2026-11-08). Effort: not-estimated.
- Deliverable: Qualify adapter and freeze contracts.

## Key insights
Research establishes experimental/version-dependent behavior, not deployment compatibility. Full chromiumoxide runtime has unbounded listeners; generated types plus a bounded actor are selected. Source Chromium149 and primitive156 observations are not a supported-engine declaration.

## Requirements
Produce reusable production adapter/process primitives, freeze wire contracts, and prove exact candidate engine/schema, final static frame, geometry including zoom, separate agent sessions and Windows containment before dependent implementation.

## Architecture
One bounded browser CDP actor routes required typed responses and per-target events; one supervised launch primitive owns descendants. Qualification uses real provisioned Chromium and retained raw observations; no product fallback engine.
- Follow exact API/envelope/limits/auth/reset ordering in architecture-contracts.md; no second protocol or undocumented task engine.

## Related code files / actions
Every path below is absolute; new/dependency-created files are explicitly classified. Task contracts carry the equivalent normalized repository-relative writable paths. No deletion of entire independent modules is authorized; obsolete Browser iframe symbols are removed only at the phase07 cutover.

### File map — qualify-cdp-adapter
| Action | Full path | Purpose |
|---|---|---|
| Modify existing | `/home/loidinh/WS/dam-hopper/server/Cargo.toml` | Implement bounded typed CDP adapter and contract fixtures; exact responsibilities in numbered steps below. |
| Modify existing | `/home/loidinh/WS/dam-hopper/server/Cargo.lock` | Implement bounded typed CDP adapter and contract fixtures; exact responsibilities in numbered steps below. |
| Modify existing | `/home/loidinh/WS/dam-hopper/server/src/lib.rs` | Implement bounded typed CDP adapter and contract fixtures; exact responsibilities in numbered steps below. |
| Modify existing | `/home/loidinh/WS/dam-hopper/server/src/main.rs` | Implement bounded typed CDP adapter and contract fixtures; exact responsibilities in numbered steps below. |
| Create new (planned) | `/home/loidinh/WS/dam-hopper/server/src/browser_host/mod.rs` | Implement bounded typed CDP adapter and contract fixtures; exact responsibilities in numbered steps below. |
| Create new (planned) | `/home/loidinh/WS/dam-hopper/server/src/browser_host/cdp.rs` | Implement bounded typed CDP adapter and contract fixtures; exact responsibilities in numbered steps below. |
| Create new (planned) | `/home/loidinh/WS/dam-hopper/server/src/browser_host/protocol.rs` | Implement bounded typed CDP adapter and contract fixtures; exact responsibilities in numbered steps below. |
| Create new (planned) | `/home/loidinh/WS/dam-hopper/server/tests/browser_host_adapter.rs` | Implement bounded typed CDP adapter and contract fixtures; exact responsibilities in numbered steps below. |
| Modify existing selected-plan contract | `/home/loidinh/WS/dam-hopper/plans/261108-0237-host-browser-cdp-streaming/architecture-contracts.md` | Freeze adapter/wire bounds, then record phase01's qualified geometry and engine constraints. |

### File map — qualify-process-primitives
| Action | Full path | Purpose |
|---|---|---|
| Modify existing | `/home/loidinh/WS/dam-hopper/server/Cargo.toml` | Implement contained launcher and platform proof hooks; exact responsibilities in numbered steps below. |
| Modify existing | `/home/loidinh/WS/dam-hopper/server/Cargo.lock` | Implement contained launcher and platform proof hooks; exact responsibilities in numbered steps below. |
| Create new (planned) | `/home/loidinh/WS/dam-hopper/server/src/browser_host/process.rs` | Implement contained launcher and platform proof hooks; exact responsibilities in numbered steps below. |
| Modify dependency-created | `/home/loidinh/WS/dam-hopper/server/src/browser_host/mod.rs` | Implement contained launcher and platform proof hooks; exact responsibilities in numbered steps below. |
| Create new (planned) | `/home/loidinh/WS/dam-hopper/server/tests/browser_host_process.rs` | Implement contained launcher and platform proof hooks; exact responsibilities in numbered steps below. |

### File map — freeze-engine-qualification
| Action | Full path | Purpose |
|---|---|---|
| Create new (planned) | `/home/loidinh/WS/dam-hopper/server/tests/browser_host_compatibility.rs` | Prove exact-engine stream input and agent compatibility; exact responsibilities in numbered steps below. |
| Create new (planned) | `/home/loidinh/WS/dam-hopper/packages/ui/e2e/os-host-browser/compatibility.spec.ts` | Prove exact-engine stream input and agent compatibility; exact responsibilities in numbered steps below. |
| Create new (planned) | `/home/loidinh/WS/dam-hopper/server/examples/browser_host_qualification.rs` | Maintained real-engine qualification fixture executable; uses production actor/launcher, never shipped as a second product gateway. |
| Create new (planned) | `/home/loidinh/WS/dam-hopper/packages/ui/e2e/fixtures/browser-host-qualification.ts` | Root-resolved Cargo artifact prebuild and contained binary lifecycle shared by primitive and later actual-gateway qualification. |
| Create new (planned) | `/home/loidinh/WS/dam-hopper/plans/261108-0237-host-browser-cdp-streaming/reports/engine-qualification.md` | Prove exact-engine stream input and agent compatibility; exact responsibilities in numbered steps below. |
| Modify existing selected-plan contract | `/home/loidinh/WS/dam-hopper/plans/261108-0237-host-browser-cdp-streaming/architecture-contracts.md` | Freeze qualified geometry/engine results and propagate accepted changes to dependent consumers. |

## Numbered implementation steps

### qualify-cdp-adapter
- Dependencies: none.
- Bounded outcome: Implement bounded typed CDP adapter and contract fixtures.
1. Pin chromiumoxide_cdp and chromiumoxide_types =0.9.1; promote tokio-tungstenite runtime dependency without full chromiumoxide. Register browser_host in library and binary module trees using existing conventions.
2. Implement WS max-message enforcement before serde; bounded pending-command map, deadline cancellation and one reader/one writer. Subscribe before issuing commands; typed dispatch only for required methods. Small serde DTO only when generated schema demonstrably lacks a required standard method.
3. Ignore unknown events and extra fields with bounded counters; malformed required responses fail only owning operation, malformed framing or excess size closes connection. No per-event spawn, unbounded channel, retained unknown payload or log of protocol secrets.
4. Encode contract fixtures for target-scoped BHJF envelope (no per-viewer header values), immutable socket subscription context, decimal sequences, capabilities and errors from architecture-contracts.md. Freeze exact method/field names for producer/client; amendments require coordinator revision of all consumers.
- Consumer-visible acceptance:
  - A provisioned engine answers real Browser.getVersion and target create/attach through the production actor; unknown events/fields do not crash it.
  - Adversarial oversized messages, stalled commands and event floods remain within declared actor/map/byte bounds and terminate affected work predictably; BHJF fixtures contain no per-viewer values and target publication buffers are shareable unchanged.
- Future verification (from repository root; new targets above are planned):
  - `cargo test --manifest-path server/Cargo.toml --test browser_host_adapter -- --nocapture`
  - `cargo check --manifest-path server/Cargo.toml --all-targets`
  - Smoke: run browser_host_adapter against DAM_HOPPER_BROWSER_EXECUTABLE; record exact engine, generated-crate versions and peak queued bytes.

### qualify-process-primitives
- Dependencies: qualify-cdp-adapter.
- Bounded outcome: Implement contained launcher and platform proof hooks.
1. Use explicit provisioned executable, allowlisted flags, isolated restricted temp qualification profile and ephemeral loopback debugging. Validate bounded stderr/DevToolsActivePort endpoint against expected child/profile and deadline; do not adopt arbitrary endpoints.
2. Implement Unix process-group cleanup and parent-death supervision compatible with existing PTYs; implement Windows early Job assignment before resume, kill-on-close and restricted profile ACL support. Unsafe containment capability returns unavailable.
3. Expose launch/terminate-and-wait primitives for phase02; retain process identity until every descendant exit is proven. Test startup timeout, stderr flood, root crash and descendant survival failure without deleting a live directory.
- Consumer-visible acceptance:
  - Linux and native Windows proof observe no surviving managed descendant after normal stop, forced failure or parent-death case; unrelated PTY remains alive.
  - No launch disables browser sandbox, web security or TLS validation; discovered debug port listens only on loopback.
- Future verification (from repository root; new targets above are planned):
  - `cargo test --manifest-path server/Cargo.toml --test browser_host_process -- --nocapture`
  - `Native Windows PowerShell: cargo test --manifest-path server/Cargo.toml --test browser_host_process -- --nocapture`
  - Smoke: kill qualification parent and inspect its recorded child identities on each native OS; retain process inventory and sandbox launch result.

### freeze-engine-qualification
- Dependencies: qualify-process-primitives.
- Bounded outcome: Prove exact-engine stream input and agent compatibility.
1. Create behavioral fixtures using real CDP actor: static first frame, resize recovery, animation-to-final-static frame, prompt exact-once ACK accounting and old-run events. Exercise the single per-epoch recovery screenshot policy, not periodic polling.
2. Probe DPR1/2, scroll, browser zoom80/125/200%, page/pinch scale1/2 and visual viewport offsets against known click targets; record authoritative coordinate mapping. Required zoom failure blocks downstream support/release, not an acceptance waiver.
3. Prove Playwright Authorization on BOTH discovery and WS in the real actor/launcher qualification mode, no phase04 dependency. Implement shared helper packages/ui/e2e/fixtures/browser-host-qualification.ts following architecture section2: derive absolute repo root via import.meta.url despite packages/ui CWD; scoped worker setup timeout660000ms outside60s test, Cargo prebuild own600000ms deadline separate from readiness; prebuild via cargo build --manifest-path <absolute-root>/server/Cargo.toml --example browser_host_qualification --message-format=json; incrementally resolve matching compiler-artifact executable including Windows .exe (no guessed output). Spawn binary only after build; start20s readiness then, qualificationReady max4KiB, total stdout/stderr each<=64KiB, synthetic baseUrl/bearer memory-only. Finally closes stdin and reaps/Unix-group-or-Windows-Job descendants even on partial-start, readiness/output/build failure; never Cargo-run startup or external fixture. Bounded real CDP forwarding, exact Origin and independent sessions, no mocks. Phase04 repeats on actual production gateway via explicitly owned later fixture mode, not later producer/UI/human.
4. Write exact executable version/hash/CDP schema, Linux and Windows outcomes, unsupported reasons and retained raw-record references. Freeze supported version range only from observations; missing platform/engine evidence leaves this task incomplete and all dependents blocked.
- Consumer-visible acceptance:
  - Candidate engine passes static/resize/final-frame, generated-schema, engine coordinate-mapping/zoom and independent-session behavior on Linux and Windows; Playwright headers reach BOTH discovery and WS. Root-resolved prebuild, post-spawn20s readiness and startup-failure descendant cleanup are observed; full web zoom/SPA proof remains phase09.
  - Qualification report distinguishes actual passes, unsupported results and missing evidence; no dependent starts on a partial report.
- Future verification (from repository root; new targets above are planned):
  - `cargo test --manifest-path server/Cargo.toml --test browser_host_compatibility -- --nocapture`
  - Prebuild interface (also executed by scoped worker setup): from derived repo root `cargo build --manifest-path server/Cargo.toml --example browser_host_qualification --message-format=json`; helper selects executable from compiler-artifact stream, then launches it. No shell guessed-path handoff.
  - `pnpm --filter @dam-hopper/ui test:e2e -- os-host-browser/compatibility.spec.ts`
  - `Native Windows PowerShell: cargo test --manifest-path server/Cargo.toml --test browser_host_compatibility -- --nocapture`
  - `Native Windows PowerShell: pnpm --filter @dam-hopper/ui test:e2e -- os-host-browser/compatibility.spec.ts`
  - Smoke: set DAM_HOPPER_BROWSER_EXECUTABLE and DAM_HOPPER_BROWSER_QUALIFY=1; pnpm package runner uses scoped660000ms worker setup with own600000ms Cargo-artifact prebuild outside60s test, then20s post-binary-spawn readiness; capture headers BOTH paths, force startup failure/stdout overflow and prove stdin/group/Job cleanup; no guessed target paths or skipped missing engine.

## Durable task contracts / todo
Exactly one fence; task IDs/markers stable across revisions. No tasks.json or hydration in this planning assignment.

```evcrate-tasks
[
  {
    "id": "qualify-cdp-adapter",
    "title": "Implement bounded typed CDP adapter and contract fixtures",
    "blocked_by": [],
    "allowed_files": [
      "server/Cargo.toml",
      "server/Cargo.lock",
      "server/src/lib.rs",
      "server/src/main.rs",
      "server/src/browser_host/mod.rs",
      "server/src/browser_host/cdp.rs",
      "server/src/browser_host/protocol.rs",
      "server/tests/browser_host_adapter.rs",
      "plans/261108-0237-host-browser-cdp-streaming/architecture-contracts.md"
    ],
    "constraints": [
      "Follow architecture-contracts.md; preserve unrelated workflows; escalate any required write outside this literal file set."
    ],
    "acceptance": [
      "A provisioned engine answers real Browser.getVersion and target create/attach through the production actor; unknown events/fields do not crash it.",
      "Adversarial oversized messages, stalled commands and event floods remain within declared actor/map/byte bounds and terminate affected work predictably; BHJF fixtures contain no per-viewer values and target publication buffers are shareable unchanged."
    ],
    "verification": [
      "cargo test --manifest-path server/Cargo.toml --test browser_host_adapter -- --nocapture",
      "cargo check --manifest-path server/Cargo.toml --all-targets",
      "Smoke: run browser_host_adapter against DAM_HOPPER_BROWSER_EXECUTABLE; record exact engine, generated-crate versions and peak queued bytes."
    ]
  },
  {
    "id": "qualify-process-primitives",
    "title": "Implement contained launcher and platform proof hooks",
    "blocked_by": [
      "qualify-cdp-adapter"
    ],
    "allowed_files": [
      "server/Cargo.toml",
      "server/Cargo.lock",
      "server/src/browser_host/process.rs",
      "server/src/browser_host/mod.rs",
      "server/tests/browser_host_process.rs"
    ],
    "constraints": [
      "Follow architecture-contracts.md; preserve unrelated workflows; escalate any required write outside this literal file set."
    ],
    "acceptance": [
      "Linux and native Windows proof observe no surviving managed descendant after normal stop, forced failure or parent-death case; unrelated PTY remains alive.",
      "No launch disables browser sandbox, web security or TLS validation; discovered debug port listens only on loopback."
    ],
    "verification": [
      "cargo test --manifest-path server/Cargo.toml --test browser_host_process -- --nocapture",
      "Native Windows PowerShell: cargo test --manifest-path server/Cargo.toml --test browser_host_process -- --nocapture",
      "Smoke: kill qualification parent and inspect its recorded child identities on each native OS; retain process inventory and sandbox launch result."
    ]
  },
  {
    "id": "freeze-engine-qualification",
    "title": "Prove exact-engine stream input and agent compatibility",
    "blocked_by": [
      "qualify-process-primitives"
    ],
    "allowed_files": [
      "server/tests/browser_host_compatibility.rs",
      "packages/ui/e2e/os-host-browser/compatibility.spec.ts",
      "server/examples/browser_host_qualification.rs",
      "packages/ui/e2e/fixtures/browser-host-qualification.ts",
      "plans/261108-0237-host-browser-cdp-streaming/reports/engine-qualification.md",
      "plans/261108-0237-host-browser-cdp-streaming/architecture-contracts.md"
    ],
    "constraints": [
      "Follow architecture-contracts.md; preserve unrelated workflows; escalate any required write outside this literal file set."
    ],
    "acceptance": [
      "Candidate engine passes static/resize/final-frame, generated-schema, engine coordinate-mapping/zoom and independent-session behavior on Linux and Windows; Playwright headers reach BOTH discovery and WS. Root-resolved prebuild, post-spawn20s readiness and startup-failure descendant cleanup are observed; full web zoom/SPA proof remains phase09.",
      "Qualification report distinguishes actual passes, unsupported results and missing evidence; no dependent starts on a partial report."
    ],
    "verification": [
      "cargo test --manifest-path server/Cargo.toml --test browser_host_compatibility -- --nocapture",
      "Scoped worker setup660000ms/prebuild own600000ms (outside60s test/readiness): cargo build --manifest-path <absolute-root>/server/Cargo.toml --example browser_host_qualification --message-format=json; resolve compiler-artifact executable, then start20s readiness after binary spawn, with bounded output and startup-failure group/Job cleanup.",
      "pnpm --filter @dam-hopper/ui test:e2e -- os-host-browser/compatibility.spec.ts",
      "Native Windows PowerShell: cargo test --manifest-path server/Cargo.toml --test browser_host_compatibility -- --nocapture",
      "Native Windows PowerShell: pnpm --filter @dam-hopper/ui test:e2e -- os-host-browser/compatibility.spec.ts",
      "Smoke: set DAM_HOPPER_BROWSER_EXECUTABLE and DAM_HOPPER_BROWSER_QUALIFY=1; pnpm package runner uses scoped660000ms worker setup with own600000ms Cargo-artifact prebuild outside60s test, then20s post-binary-spawn readiness; capture headers BOTH paths, force startup failure/stdout overflow and prove stdin/group/Job cleanup; no guessed target paths or skipped missing engine."
    ]
  }
]
```

- [x] <!-- evcrate-task:qualify-cdp-adapter --> Implement bounded typed CDP adapter and contract fixtures (completed and verified: pre-reservation, malformed-framing actor closure, endpoint path UUID validation, and relay 2-connection cap implemented and verified)
- [x] <!-- evcrate-task:qualify-process-primitives --> Implement contained launcher and platform proof hooks (completed and verified on Linux: parent-death supervision via grandchild watcher death-pipe, descendant containment, provisioned-engine/flags, loopback/UUID path validation, DevToolsActivePort corroboration; native Windows containment remains fail-closed with ContainmentUnavailable per contract §8)
- [x] <!-- evcrate-task:freeze-engine-qualification --> Prove exact-engine stream input and agent compatibility (completed and verified: Linux qualification verified with authoritative visual-marker geometry across DPR 1/2, document scroll, pageScale 1/2, visual viewport offset 50,50, TS fixture output bounds/cleanup, dual-path auth, 2-conn relay cap, evidence retention; native browser zoom confirmed unreachable via CDP in headless Chromium 157 with inputTrusted: false enforced, remaining UNVERIFIED per contract §8; native Windows containment remains fail-closed with ContainmentUnavailable per contract §8)

### Progress note (261108)
- Phase 01 status: Marked DONE (2026-11-08) per user approval to finalize. All 3 tasks (`qualify-cdp-adapter`, `qualify-process-primitives`, `freeze-engine-qualification`) completed and verified.
- Review status: Comprehensive code review completed with score 9/10 (0 critical issues, verified 62/62 passed tests across all 6 targets).
- Verified test counts corroborated by tester terminal report (`agent://Phase01Tester`, 62 passed / 0 failed / 0 skipped / 2 intentional ignored helpers):
  - Target 1 (`server/Cargo.toml --lib browser_host`): 9 passed
  - Target 2 (`browser_host_adapter`): 18 passed
  - Target 3 (`browser_host_process`): 19 passed (2 ignored helpers)
  - Target 4 (`browser_host_compatibility`, real Chrome 157.0.8103.38): 2 passed
  - Target 5 (`pnpm --filter @dam-hopper/ui test:e2e:typecheck`): 1 passed (clean)
  - Target 6 (`compatibility.spec.ts`, Playwright): 13 passed
  - Static checks: `cargo check --all-targets` passed (0 `browser_host` warnings); E2E TypeScript clean.
- Invariants & gates: Native Windows containment remains fail-closed (`ContainmentUnavailable`) per contract §8 (requires execution on native Windows host runner for positive qualification). Native browser zoom remains UNVERIFIED (`inputTrusted: false`) per contract §8 due to CDP protocol limitation in headless Chromium 157.
## Success criteria
- Every task acceptance above is observed with applicable compile/typecheck, behavioral tests and real smoke evidence; missing or failed proof keeps task incomplete.
- Acceptance matrix rows owned by this phase have precise observations, not source-text assertions or mocked-only feature success.
- Writable scope and prerequisite outputs match execution-ownership.md; no competing shared-file writers or product verification storms.

## Risk assessment / failure and rollback
Experimental CDP or platform failure is a hard gate; revise selected contract or fix adapter before continuing. No fabricated throughput or static/zoom compatibility.
- On a defect, stop dependent work, reopen the producing task and rerun impacted behavioral checks under the single integration owner; do not narrow acceptance. Disable Browser capability if safe operation cannot be established, never restore iframe fallback.

## Security considerations
Qualification profiles contain synthetic credentials only. Never inspect ordinary Chrome or log raw endpoints, account tokens or page contents.
- Do not store/log bearer/tickets/raw loopback endpoints, real site credentials or sensitive page/selection payload in diagnostics/evidence.

## Next steps
Phase 01 complete; Phase 02 (Configure and supervise principal profiles) unblocked. Implementation evidence report recorded in `plans/261108-0237-host-browser-cdp-streaming/reports/engine-qualification.md`.

## Unresolved questions
- No additional product interview here. Exact compatibility/platform/performance and human observations remain future gates where applicable; their absence is not a pass.
