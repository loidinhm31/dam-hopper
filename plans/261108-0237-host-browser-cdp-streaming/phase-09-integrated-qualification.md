# Phase 09 — Qualify full app security platforms and efficiency

## Context links
- [Overview](plan.md) · [Architecture contracts](architecture-contracts.md) · [Acceptance matrix](acceptance-matrix.md) · [Execution ownership](execution-ownership.md).
- [Backend evidence](reports/backend-boundaries.md) · [Viewer evidence](reports/viewer-boundaries.md) · [Protocol research](research/stream-protocol.md) · [Settled direction](reports/design-direction.md).
- Relevant bounded evidence: `approved brainstorm:88–143; reports/design-direction.md:74–80`. Research recommendations superseded by architecture contract where explicitly stated.

## Overview
- Priority: P2. Status: pending. Effort: not-estimated. Planning only; commands below are future obligations, not exercised checks.
- Deliverable: Qualify full app security platforms and efficiency.

## Key insights
Primitive frame observation and structural plan checks are not feature qualification. Required capacity is1active admin process,2targets,2viewers; broader concurrency is explicitly unqualified. Human visual and physical Android-web evidence cannot be synthesized from desktop tests.

## Requirements
Real application acceptance, Linux/systemd and native Windows containment/sandbox, ordinary/admin/noauth auth matrix, reset/artifact security and matched test-only polling benchmark with raw numeric records.

## Architecture
One integration owner runs coherent checks after all branches/shared edits land. New behavioral tests use provisioned engine and real API/web fixture, not source-text assertions or mock-only passes. Fixes reopen owning tasks and rerun impacted checks.
- Follow exact API/envelope/limits/auth/reset ordering in architecture-contracts.md; no second protocol or undocumented task engine.

## Related code files / actions
Every path below is absolute; new/dependency-created files are explicitly classified. Task contracts carry the equivalent normalized repository-relative writable paths. No deletion of entire independent modules is authorized; obsolete Browser iframe symbols are removed only at the phase07 cutover.

### File map — qualify-real-app-security
| Action | Full path | Purpose |
|---|---|---|
| Create new (planned) | `/home/loidinh/WS/dam-hopper/server/tests/browser_host_security.rs` | Exercise integrated same-target lifecycle and authorization; exact responsibilities in numbered steps below. |
| Create new (planned) | `/home/loidinh/WS/dam-hopper/packages/ui/e2e/os-lifecycle/host-browser.spec.ts` | Exercise integrated same-target lifecycle and authorization; exact responsibilities in numbered steps below. |
| Create new (planned) | `/home/loidinh/WS/dam-hopper/packages/ui/e2e/fixtures/host-browser-app.ts` | Exercise integrated same-target lifecycle and authorization; exact responsibilities in numbered steps below. |
| Create new (planned) | `/home/loidinh/WS/dam-hopper/packages/ui/e2e/os-host-browser/same-target.spec.ts` | Mandatory actual production-stream SPA+Playwright same-target/independent-session interference, not phase04 primitive proof. |
| Create new (planned) | `/home/loidinh/WS/dam-hopper/plans/261108-0237-host-browser-cdp-streaming/reports/integrated-qualification.md` | Exercise integrated same-target lifecycle and authorization; exact responsibilities in numbered steps below. |

### File map — qualify-host-platforms
| Action | Full path | Purpose |
|---|---|---|
| Create new (planned) | `/home/loidinh/WS/dam-hopper/server/tests/browser_host_platform.rs` | Qualify native Linux Windows crash reset and release prerequisites; exact responsibilities in numbered steps below. |
| Create new (planned) | `/home/loidinh/WS/dam-hopper/plans/261108-0237-host-browser-cdp-streaming/reports/platform-qualification.md` | Qualify native Linux Windows crash reset and release prerequisites; exact responsibilities in numbered steps below. |

### File map — qualify-performance-and-human
| Action | Full path | Purpose |
|---|---|---|
| Create new (planned) | `/home/loidinh/WS/dam-hopper/packages/ui/e2e/os-host-browser/performance.spec.ts` | Measure efficiency and collect human Android-web acceptance; exact responsibilities in numbered steps below. |
| Create new (planned) | `/home/loidinh/WS/dam-hopper/packages/ui/browser-tests/host-browser-android.browser.tsx` | Measure efficiency and collect human Android-web acceptance; exact responsibilities in numbered steps below. |
| Create new (planned) | `/home/loidinh/WS/dam-hopper/packages/ui/e2e/os-host-browser/android.spec.ts` | Actual full-SPA Android-web IME/touch/zoom sequence supporting mandatory physical-device human receipt. |
| Create new (planned) | `/home/loidinh/WS/dam-hopper/plans/261108-0237-host-browser-cdp-streaming/reports/performance-qualification.md` | Measure efficiency and collect human Android-web acceptance; exact responsibilities in numbered steps below. |
| Create new (planned) | `/home/loidinh/WS/dam-hopper/plans/261108-0237-host-browser-cdp-streaming/reports/human-acceptance.md` | Measure efficiency and collect human Android-web acceptance; exact responsibilities in numbered steps below. |

## Numbered implementation steps

### qualify-real-app-security
- Dependencies: migrate-account-logout-ui.
- Bounded outcome: Exercise integrated same-target lifecycle and authorization.
1. Implement real authenticated host-browser-app fixture with synthetic admin/ordinary/foreign principals and2logins, actual matching production API/SPA/native engine, no production credentials. Reuse absolute-root Cargo compiler-artifact setup outside60s test and post-spawn readiness/contained startup-failure cleanup (architecture2). Own same-target.spec.ts: human/types marker in actual Browser canvas input, existing Playwright reads/mutates exact correlated DOM while production producer/media remains live; agent Page.disable/stopScreencast cannot stop production stream. Emulation/zoom advances epoch and rejects stale input. Automated real SPA action sequence plus mandatory actual human observation recorded by qualify-performance-and-human (A02/A40); no human dependency back into04.
2. Exercise every acceptance-matrix security row: ticket replay/purpose/Origin, nonloopback noauth/tunnel headers, role demotion, auth DB failure/deadline, blocked writers, stale epochs/input/ACK and profile reset. Managed artifacts must deny demoted same-subject at all legacy operations; cooperative owner remains usable.
3. Drive two targets/two viewers concurrently; stall one and check other target/viewer and PTY/control responsiveness. Test missing-first/static-final/resize, shared identical full BHJF bytes and last-clone memory charge, fresh sockets on rebind/old-socket ACK/discard, decoder failure/privacy late decode, actual Cognito/PIN/modal/OS hide, full web zoom/DPR/scroll, close and terminal replacement races. Distinguish01 engine geometry/06 injected component privacy from these actual SPA proofs.
4. Write exact commands, engine/client versions, outcomes, raw-record locations and failure dispositions. Any missing required scenario is incomplete; any defect reopens producing task, no narrowed test used as acceptance.
- Consumer-visible acceptance:
  - All integrated automated rows pass real API+SPA: same-target.spec production stream survives agent disable/stop, full zoom/OS privacy/socket rebind and managed selection; primitive/component/bridge-only rows use their actual earlier harness (not invented SPA mount). No stale/ordinary host access; actual human/physical receipts required by later task.
  - Stalled media cannot delay control/auth/PTY and one viewer/target cannot stall another.
- Future verification (from repository root; new targets above are planned):
  - `cargo test --manifest-path server/Cargo.toml --test browser_host_security -- --nocapture`
  - `pnpm --filter @dam-hopper/ui test:e2e -- os-lifecycle/host-browser.spec.ts`
  - `pnpm --filter @dam-hopper/ui test:e2e -- os-host-browser/same-target.spec.ts`
  - `pnpm --filter @dam-hopper/ui build`
  - `cargo test --manifest-path server/Cargo.toml`
  - Smoke: record authenticated2target/2viewer human+agent trace with session identities and independent PTY echo timestamps.

### qualify-host-platforms
- Dependencies: qualify-real-app-security.
- Bounded outcome: Qualify native Linux Windows crash reset and release prerequisites.
1. Run against exact provisioned engine on Linux service-user environment and native Windows release host. Check sandbox/libraries/fonts/profile permissions/debug-loopback binding, Windows nested jobs and no system Node prerequisite.
2. Inject parent/root/renderer crash, startup discovery timeout/stderr flood, lock contention/stale orphan, full disk/metadata failure, denied delete, shutdown watchdog and restart during reset. Capture descendant inventories and persistent tombstone status; unrelated terminal processes are not killed.
3. Verify storage restart and passive auth preservation, explicit confirmed logout/reset deletion only after process wait, and no dirty-profile relaunch. Missing native Windows machine or failing sandbox is a blocker, not Linux cross-compilation pass.
4. Exercise binary/config rollback with saved profile untouched and unsupported-browser capability UI; explicit wipe is irreversible and cannot be rolled back from evidence logs.
- Consumer-visible acceptance:
  - Linux and native Windows prove containment/cleanup/reset/crash safety with restricted credentials and Chromium sandbox enabled.
  - Release works with separately installed browser and no system Node; unsupported environment fails Browser only with actionable reason.
- Future verification (from repository root; new targets above are planned):
  - `cargo test --manifest-path server/Cargo.toml --test browser_host_platform -- --nocapture`
  - `Native Windows PowerShell: cargo test --manifest-path server/Cargo.toml --test browser_host_platform -- --nocapture`
  - Smoke: launch native release binary under documented service/user account, force kill parent during reset and record descendants, lock, tombstone and subsequent recovery.

### qualify-performance-and-human
- Dependencies: qualify-host-platforms.
- Bounded outcome: Measure efficiency and collect human Android-web acceptance.
1. Benchmark same provisioned engine/hardware/page,viewport1280x900,q65 for native prompt-ACK stream versus test-only10Hz captureScreenshot baseline; never ship polling engine. Workloads static60s,scroll30s,60Hz animation30s,2viewers slowACK30s,resize10cycles,disconnect/reconnect10cycles.
2. Record presentedFPS and frame age,p50/p95 input-to-application-present,web/loopback bytes/s,Chromium+serverCPU,RSS,allocation/queue highwater,drop/discard counts and screenshot calls. Use monotonic local clocks for durations, bounded page markers; application-present is not physical scanout.
3. Enforce numerical safety caps and measure proposed performance goals, not achieved facts. Bounded approved tuning grid: JPEG55/65/75, max960x675 or1280x900, everyNthFrame1/2 (<=12settings). everyNthFrame2 eligible only after final-settled-frame proof without periodic screenshot/ACK pacing; otherwise disqualify. If no setting meets goals+safety+final-frame, or required10FPS delivery needs unacceptable producerCPU/bytes, stop release and revisit architecture; no endless tuning/hidden fallback.
4. Own android.spec.ts actual SPA sequence plus mandatory physical Android Chrome human run: Vietnamese/Japanese composition commits once, soft-keyboard focus, paste/tap/drag/scroll/cancel/pinch and zoom. Collect actual desktop Chrome/Firefox human ledger including same-target human+Playwright production-stream interference from A02 (agent disable/stop and Emulation), focus/modifiers,zoom,Cognito/PIN/modal,find/copy,dialogs,selection/handoff and target continuity. Automated mobile emulation supplements but cannot mark physical/human rows passed; retain pending until acceptance actually supplied.
- Consumer-visible acceptance:
  - Static has no periodic screenshots and hard caps hold at1admin/2targets/2viewers; tune only JPEG55/65/75, max960x675|1280x900 and everyNthFrame1/2 (<=12settings). everyNth2 needs final-settled-frame proof; no passing safety+goals+final-frame setting => stop release and revisit architecture.
  - Mandatory actual human production-stream/same-target+agent-interference and physical Android full-SPA Vietnamese/Japanese IME/soft keyboard/touch/zoom have person/date/device/browser receipts or task remains incomplete/release blocked; never substitute04 native sessions/06 components/mobile emulation.
- Future verification (from repository root; new targets above are planned):
  - `pnpm --filter @dam-hopper/ui test:e2e -- os-host-browser/performance.spec.ts`
  - `pnpm --filter @dam-hopper/ui test:browser -- browser-tests/host-browser-android.browser.tsx`
  - `pnpm --filter @dam-hopper/ui test:e2e -- os-host-browser/android.spec.ts`
  - Smoke: export <=12setting comparison with captureFPS distinct from presentedFPS; disqualify everyNth2 on final-frame loss and explicitly record architecture-revisit blocker if no eligible setting meets budgets.
  - Smoke: actual human watches production Browser stream while Playwright mutates same target/disable/stop/Emulation; physical Android remote SPA commits Vietnamese/Japanese once with keyboard/paste/tap/drag/scroll/cancel/pinch/zoom. Record person/date/device/browser/target/result in human-acceptance.md; failures reopen originating04 or06 tasks/dependents, never narrow proof.

## Durable task contracts / todo
Exactly one fence; task IDs/markers stable across revisions. No tasks.json or hydration in this planning assignment.

```evcrate-tasks
[
  {
    "id": "qualify-real-app-security",
    "title": "Exercise integrated same-target lifecycle and authorization",
    "blocked_by": [
      "migrate-account-logout-ui"
    ],
    "allowed_files": [
      "server/tests/browser_host_security.rs",
      "packages/ui/e2e/os-lifecycle/host-browser.spec.ts",
      "packages/ui/e2e/fixtures/host-browser-app.ts",
      "packages/ui/e2e/os-host-browser/same-target.spec.ts",
      "plans/261108-0237-host-browser-cdp-streaming/reports/integrated-qualification.md"
    ],
    "constraints": [
      "Follow architecture-contracts.md; preserve unrelated workflows; escalate any required write outside this literal file set."
    ],
    "acceptance": [
      "All integrated automated rows pass real API+SPA: same-target.spec production stream survives agent disable/stop, full zoom/OS privacy/socket rebind and managed selection; primitive/component/bridge-only rows use their actual earlier harness (not invented SPA mount). No stale/ordinary host access; actual human/physical receipts required by later task.",
      "Stalled media cannot delay control/auth/PTY and one viewer/target cannot stall another."
    ],
    "verification": [
      "cargo test --manifest-path server/Cargo.toml --test browser_host_security -- --nocapture",
      "pnpm --filter @dam-hopper/ui test:e2e -- os-lifecycle/host-browser.spec.ts",
      "pnpm --filter @dam-hopper/ui test:e2e -- os-host-browser/same-target.spec.ts",
      "pnpm --filter @dam-hopper/ui build",
      "cargo test --manifest-path server/Cargo.toml",
      "Smoke: record authenticated2target/2viewer human+agent trace with session identities and independent PTY echo timestamps."
    ]
  },
  {
    "id": "qualify-host-platforms",
    "title": "Qualify native Linux Windows crash reset and release prerequisites",
    "blocked_by": [
      "qualify-real-app-security"
    ],
    "allowed_files": [
      "server/tests/browser_host_platform.rs",
      "plans/261108-0237-host-browser-cdp-streaming/reports/platform-qualification.md"
    ],
    "constraints": [
      "Follow architecture-contracts.md; preserve unrelated workflows; escalate any required write outside this literal file set."
    ],
    "acceptance": [
      "Linux and native Windows prove containment/cleanup/reset/crash safety with restricted credentials and Chromium sandbox enabled.",
      "Release works with separately installed browser and no system Node; unsupported environment fails Browser only with actionable reason."
    ],
    "verification": [
      "cargo test --manifest-path server/Cargo.toml --test browser_host_platform -- --nocapture",
      "Native Windows PowerShell: cargo test --manifest-path server/Cargo.toml --test browser_host_platform -- --nocapture",
      "Smoke: launch native release binary under documented service/user account, force kill parent during reset and record descendants, lock, tombstone and subsequent recovery."
    ]
  },
  {
    "id": "qualify-performance-and-human",
    "title": "Measure efficiency and collect human Android-web acceptance",
    "blocked_by": [
      "qualify-host-platforms"
    ],
    "allowed_files": [
      "packages/ui/e2e/os-host-browser/performance.spec.ts",
      "packages/ui/browser-tests/host-browser-android.browser.tsx",
      "packages/ui/e2e/os-host-browser/android.spec.ts",
      "plans/261108-0237-host-browser-cdp-streaming/reports/performance-qualification.md",
      "plans/261108-0237-host-browser-cdp-streaming/reports/human-acceptance.md"
    ],
    "constraints": [
      "Follow architecture-contracts.md; preserve unrelated workflows; escalate any required write outside this literal file set."
    ],
    "acceptance": [
      "Static has no periodic screenshots and hard caps hold at1admin/2targets/2viewers; tune only JPEG55/65/75, max960x675|1280x900 and everyNthFrame1/2 (<=12settings). everyNth2 needs final-settled-frame proof; no passing safety+goals+final-frame setting => stop release and revisit architecture.",
      "Mandatory actual human production-stream/same-target+agent-interference and physical Android full-SPA Vietnamese/Japanese IME/soft keyboard/touch/zoom have person/date/device/browser receipts or task remains incomplete/release blocked; never substitute04 native sessions/06 components/mobile emulation."
    ],
    "verification": [
      "pnpm --filter @dam-hopper/ui test:e2e -- os-host-browser/performance.spec.ts",
      "pnpm --filter @dam-hopper/ui test:browser -- browser-tests/host-browser-android.browser.tsx",
      "pnpm --filter @dam-hopper/ui test:e2e -- os-host-browser/android.spec.ts",
      "Smoke: export <=12setting comparison with captureFPS distinct from presentedFPS; disqualify everyNth2 on final-frame loss and explicitly record architecture-revisit blocker if no eligible setting meets budgets.",
      "Smoke: actual human watches production Browser stream while Playwright mutates same target/disable/stop/Emulation; physical Android remote SPA commits Vietnamese/Japanese once with keyboard/paste/tap/drag/scroll/cancel/pinch/zoom. Record person/date/device/browser/target/result in human-acceptance.md; failures reopen originating04 or06 tasks/dependents, never narrow proof."
    ]
  }
]
```

- [ ] <!-- evcrate-task:qualify-real-app-security --> Exercise integrated same-target lifecycle and authorization
- [ ] <!-- evcrate-task:qualify-host-platforms --> Qualify native Linux Windows crash reset and release prerequisites
- [ ] <!-- evcrate-task:qualify-performance-and-human --> Measure efficiency and collect human Android-web acceptance

## Success criteria
- Every task acceptance above is observed with applicable compile/typecheck, behavioral tests and real smoke evidence; missing or failed proof keeps task incomplete.
- Acceptance matrix rows owned by this phase have precise observations, not source-text assertions or mocked-only feature success.
- Writable scope and prerequisite outputs match execution-ownership.md; no competing shared-file writers or product verification storms.

## Risk assessment / failure and rollback
No supplied deadline or numeric user SLO. Proposed local-LAN performance goals require measurements and acceptance, while hard safety bounds are mandatory. Human ledger can block shipping even when automation passes.
Later integrated same-target/gateway interference failure reopens qualify-agent-interoperability/serve-agent-cdp as appropriate; decoder/input/Android failures reopen render-bounded-canvas/implement-web-input plus affected dependents. Earlier isolated/native passes are not acceptance waivers.
- On a defect, stop dependent work, reopen the producing task and rerun impacted behavioral checks under the single integration owner; do not narrow acceptance. Disable Browser capability if safe operation cannot be established, never restore iframe fallback.

## Security considerations
Synthetic data only; raw captures scrub credentials, bearer/tickets/debug endpoints and real selected text. Ordinary-user denial includes demoted same-subject managed artifacts.
- Do not store/log bearer/tickets/raw loopback endpoints, real site credentials or sensitive page/selection payload in diagnostics/evidence.

## Next steps
Phase10 documentation reconciles actual supported outcomes only after all required automated/platform/human gates pass; no unsupported wider capacity claim.
- Parent owns independent plan review/optional validation and implementation permission. This phase text neither executes tasks nor supplies approval.

## Unresolved questions
- No additional product interview here. Exact compatibility/platform/performance and human observations remain future gates where applicable; their absence is not a pass.
