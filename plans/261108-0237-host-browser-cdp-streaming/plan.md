---
title: "Host Browser CDP and bounded JPEG streaming"
description: "Implement a Rust-managed principal Browser shared by human viewers and existing CDP agents."
status: in-progress
priority: P2
effort: not-estimated
branch: feat/ai-os-redesign
tags: [feature, frontend, backend, api, auth]
created: 2026-11-08
---
# Host Browser / CDP / JPEG

Planning only; no implementation approval, hydration or product verification. Canonical selected overview is this file.

## Outcome and settled architecture
- Rust-supervised admin-principal Chromium; guarded loopback no-auth profile; same live human/agent target.
- Maintained generated CDP types + bounded actor; prompt producer ACK, viewer10FPS, one shared complete target-only BHJF Bytes/publication; subscription bound immutably to fresh admitted media/control sockets, not binary header.
- Root-owned canvas continuity; full navigation/input/zoom/Android-web/selection; persistent credentials, confirmed shared-profile wipe after all descendants exit.
- Logout offers keep Browser data / confirmed clear shared Browser data / Cancel, with NO preselected choice (user-confirmed V1). Both logout branches call server revoke-FIRST; missing/stale reset consent returns200 retained/resetRequired; expiry/revoke retains profile.
- Raw CDP is privileged instance authority, not target/egress/local-user isolation. No full-media/sidecar/nativeAndroid scope or iframe fallback.

## Phases (effort not estimated)
| # | Phase | Status |
|---|---|---|
| 01 | [Qualify adapter and freeze contracts](phase-01-compatibility-contracts.md) | DONE (2026-11-08) |
| 02 | [Configure and supervise principal profiles](phase-02-managed-lifecycle.md) | DONE (2026-11-08) |
| 03 | [Authorize sessions attachments and ordered input](phase-03-admission-control.md) | DONE (2026-11-08) |
| 04 | [Expose authenticated instance-scoped raw CDP](phase-04-agent-cdp-gateway.md) | DONE (2026-11-09) |
| 05 | [Stream bounded native JPEG with independent credits](phase-05-producer-fanout.md) | pending |
| 06 | [Build owner-fenced canvas decoder and Android-web input](phase-06-viewer-client.md) | pending |
| 07 | [Integrate root Browser lifecycle and retire iframe path](phase-07-os-cutover.md) | pending |
| 08 | [Secure selection artifacts and confirmed logout reset](phase-08-selection-credential-reset.md) | pending |
| 09 | [Qualify full app security platforms and efficiency](phase-09-integrated-qualification.md) | pending |
| 10 | [Reconcile documentation and controlled rollout evidence](phase-10-documentation-rollout.md) | pending |

Phase 01 marked DONE per user approval (2026-11-08); adapter, process primitives, and Linux qualification verified (62/62 tests passing across 6 targets, code review score 9/10). Native Windows containment remains fail-closed (`ContainmentUnavailable`) and native browser zoom remains UNVERIFIED (`inputTrusted: false`) per contract §8.

Phase 02 marked DONE (2026-11-08); principal profile layout, advisory OS locking, reset idempotence, process crash recovery, capabilities evaluation, and graceful shutdown containment verified (221/221 tests passing across 6 targets: `browser_host_lifecycle` [10/10], `browser_host_shutdown` [3/3], `auth_no_auth` [14/14], `config` [157/157], `browser_host_process` [19/19, 2 ignored], `browser_host_adapter` [18/18], code review score 9.6/10 approved with 0 critical and 0 high findings).

Phase 03 marked DONE (2026-11-08); admin admission security model, idempotent session REST routes, single-use purpose capability tickets, independent live-auth supervisor with cancellation, bounded reliable input dispatch queue with coalescing, and network/URL request policy verified (86/86 tests passing across 6 targets: `browser_host_admission` [7/7], `browser_host_auth` [6/6], `browser_host_input` [7/7], `auth_no_auth` [14/14], `auth_device_sessions` [5/5], and lifecycle regressions [52/52, 2 ignored]; code review score 9.8/10 approved with 0 critical and 0 high findings).

Phase 04 marked DONE per user approval with noted issues after Cycle 3 (2026-11-09; score 7/10; 57/57 tests and validation gates passing across 5 targets: `browser_host_gateway` [14/14], regressions [33/33 across `lifecycle` 10/10, `shutdown` 3/3, `admission` 7/7, `auth` 6/6, `input` 7/7], `browser_host_qualification` check, TypeScript E2E typecheck clean with 0 errors, and Playwright agent qualification suite `agent.spec.ts` [8/8]). Exposes authenticated discovery rewriting (`/api/browser/cdp/json/version`, `/json/list`), instance-scoped raw CDP WebSocket gateway (`/api/browser/cdp/ws`), dedicated upstream browser relay with bearer-header authentication, exact approved Origin enforcement, concurrent connection limits, independent live-auth cancellation, and Playwright same-target and revocation isolation. Phase 05 unblocked.

## Contracts and execution
- [Exact architecture/wire/lifecycle/limits](architecture-contracts.md), [acceptance matrix](acceptance-matrix.md), [task-derived ownership](execution-ownership.md).
- Phase01 engine geometry/header proof uses absolute-root Cargo-artifact prebuild outside60s tests,20s readiness after binary spawn, bounded cleanup. Phase02 domain DTO,04 actual gateway/native-session harness,06 isolated components; mandatory full stream+human/physical Android SPA proof phase09 (failures reopen04/06).
- Single sequential integration owner. Phase05 producer and06 viewer may overlap only after phase03 frozen auth/contracts, with disjoint writes; phase07 joins.
- [Evidence intake and related-plan disposition](reports/planning-intake.md), [settled direction](reports/design-direction.md), [authoring check](reports/authoring-check.md).
- Related auth/device-login and OS/privacy plans: concurrent file overlap, serialize writers; old media authorization informational only; no whole-plan dependency or inherited pass claims.
- Preferred architecture.md files absent; current system/browser architecture baseline preserved; maintained docs reconcile in phase10, not during planning.

## Gates and assumptions
- Independent review and targeted follow-up COMPLETE; F1/F2/F3 resolved, U1/U2 clarified. User validation V1 confirmed no preselected logout choice; final structural/Advisor receipt recorded separately. Implementation remains unauthorized.
- Defaultq65/1280x900/10FPS are tuning proposals;1admin/2targets/2viewers qualification, CPU/RSS/latency and human Android-web/visual acceptance remain future obligations.
- Only live admission+Origin/confirmation/epoch clears shared data; Remove profile retains credentials. Cooperative definitions preserved via existing harnesses, no invented current SPA mount.
- Explicit selected path authoritative; session persistence unavailable (EVCRATE_SESSION_ID absent). No tasks.json or execution-state writes.

## Unresolved questions
None requiring user decisions. Engine/platform/performance and actual human/device outcomes remain future blocking qualification; no runtime passes claimed.

## Validation Summary
- Validated 2026-11-08; one genuine question (settled scope not re-interviewed). V1: **No preselected choice** in logout dialog; explicit keep / clear / Cancel remain available.
- V1 propagated to architecture, phase08 prose/task acceptance+verification, phase10 docs, matrix and execution contract. Choosing neither and pressing Enter must not dispatch logout or wipe.
