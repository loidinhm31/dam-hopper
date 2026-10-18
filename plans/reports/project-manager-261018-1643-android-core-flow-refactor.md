# Project Manager Status Report: Android Core Flow Refactor

- **Date:** 2026-10-18
- **Plan:** `plans/261018-1643-android-core-flow-refactor/plan.md`
- **Branch:** `feat/android-native-app`
- **Status:** Six-phase implementation reported complete against documented acceptance criteria; auth-lifecycle follow-up, transport request-path coverage, and Android device/runtime qualification remain open.

---

## 1. Executive Summary

Reviewed all six phase records and current source against their documented criteria. The journey **Profile Login → Project List → Select Project → Terminal** is implemented; six-phase implementation is reported complete against documented criteria, with auth-lifecycle review, transport request-path coverage, and Android device/runtime qualification still open. Current REST, WebSocket, and SSE code gates bearer tokens to secure or recognized loopback targets; password/MFA login is blocked over HTTP. Main reports `ApiClientTest.testCleartextNonLoopbackBlocksBearerToken` green. Current tests provide policy-level coverage, not a full request-path matrix or a device flow test.

The Phase 06 record separately reports `:shared:jvmTest` and `:androidApp:testDebugUnitTest` green. None of these checks were rerun by PM. The debug base config still permits cleartext to any host, and `--no-auth` remains loopback-only per project security guidance; authenticated Wi-Fi use requires HTTPS.

The code-review report previously identified three high-priority root-flow defects. Current `DamHopperMobileApp.kt` source contains the proposed startup gate, active-profile synchronization, immediate repository invalidation, generation-keyed reconstruction, and cancellation propagation. This is source review, not dedicated Compose regression evidence. Historical review remains unchanged; this PM report records the current post-remediation source state.

---

## 2. Six-Phase Acceptance Review

| Phase | Result | Acceptance review |
|---|---|---|
| 1. Foundation & network | **Implementation criteria met** | `AppFlowState`/`AppFlowNavigation` use `StateFlow` and atomic transitions, including hierarchical back handling. Debug config permits cleartext for Wi-Fi/LAN use; release config remains TLS-only. The debug base config is broad, not host-restricted. |
| 2. Profile & login | **Implementation criteria met** | Profile editing, password/MFA login, capability-gated dev login, connection probe, and repository/vault use are present. Password/MFA submission is blocked over HTTP. REST, WebSocket, and SSE Bearer attachment is restricted to secure or recognized loopback hosts. Disposal-time tracker invalidation remains an open lifecycle risk: source shows a synchronous generation bump and a guard before `applyAuthenticatedSession`, but no focused disposal/race test. |
| 3. Project list | **Implementation criteria met** | `WorkspaceRepository.listProjects()` backs loading, error/retry, empty, and populated states; cards expose project details and selection; profile switch and refresh are present. No live project fetch was exercised here. |
| 4. Terminal | **Implemented; runtime validation pending** | PTY sessions are listed and associated with the project; historical replay and live output pass through terminal controllers; command/accessory input and local-only detach are implemented. Display is a bounded ANSI-stripping console, not full terminal-emulator parity. |
| 5. Root wiring | **Implemented; runtime evidence pending** | Root host renders the three stages, synchronizes profile changes, reconstructs repositories by connection generation, and unwinds back navigation. State-machine tests cover back behavior. The supplied evidence does not include an Android launch/device smoke or Activity-recreation test. |
| 6. Verification | **Reported pass** | `phase-06-verification.md` records 100% green `:shared:jvmTest` and `:androidApp:testDebugUnitTest`. The test source checks navigation state, WebView/FAB absence, and manifest invariants; it does not drive a real Compose login/project/terminal journey. |

### Per-phase evidence

- Phase records: `phase-01-foundation-and-network.md` through `phase-06-verification.md` under the plan directory.
- Current source review: flow state/navigation, login, project list, terminal, root host, activity entry point, and corresponding test source.
- Existing code review: `plans/261018-1643-android-core-flow-refactor/code-review-report.md` and `plans/reports/code-review-261018-1824-android-core-flow-refactor.md`.

---

## 3. Milestones & Deliverables

- Foundation state machine and debug network policy; release network remains TLS-only.
- Mobile profile/login surface backed by existing `ProfileRepository` and `CredentialVault`.
- Workspace project list with loading/error/empty/populated states and project selection.
- Project PTY screen with reconciled replay/live output, text command input, accessory keys, and graceful local detach that preserves the remote PTY.
- `DamHopperMobileApp` root host and `MainActivity` wiring with back-stack unwinding and connection-generation-scoped repository reconstruction.
- Navigation and simple-flow unit tests; zero-WebView/zero-FAB and manifest assertions.
- Plan metadata/status, project roadmap entry, changelog entry, and this PM report.

---

## 4. Test & Verification Status

| Check | Recorded result | Evidence / qualification |
|---|---|---|
| `:shared:jvmTest` | **PASS (reported)** | Phase 06 verification record; not rerun by PM. |
| `:androidApp:testDebugUnitTest` | **PASS (reported)** | Phase 06 verification record; not rerun by PM. |
| `ApiClientTest.testCleartextNonLoopbackBlocksBearerToken` | **PASS (reported)** | Main reports green; current test observes a loopback HTTP REST request, checks non-loopback HTTP through the policy helper, and inspects WebSocket URL construction. Remote REST behavior is not asserted through an actual non-loopback request; PM did not rerun it. |
| `compileKotlinJvm compileDebugKotlin` | **PASS (reported)** | Phase 02 implementation record; not rerun by PM. |
| Android device/runtime journey | **Not evidenced here** | No launch/device smoke report supplied for this refactor. Keep broader Android device qualification gates separate. |
| Real Compose end-to-end journey | **Not evidenced here** | `SimpleFlowJourneysTest` exercises the navigation model and static invariants, not live UI/auth/network/PTY interaction. |

No tests, builds, or linters were run as part of this PM documentation review.

---

## 5. Risks & Remaining Follow-Ups

1. **Debug cleartext scope:** Android debug `base-config cleartextTrafficPermitted="true"` permits cleartext to all hosts. This is not a security boundary; unauthenticated HTTP is still observable/modifiable. Use HTTPS for authenticated Wi-Fi. Project README says `--no-auth` is loopback-only and must not be exposed to LAN/untrusted networks.
2. **Transport request-path coverage:** Current source gates REST, WebSocket, and SSE Bearer tokens to secure or recognized loopback targets. The REST test observes only a loopback HTTP request; its remote-host checks call the policy helper directly. `HostResourceSseTest` observes a loopback request but evaluates the remote-host policy expression directly rather than exercising a non-loopback request; no HTTPS SSE retention assertion was identified. Add request-level mock-engine tests proving non-loopback HTTP omits `Authorization` and HTTPS retains it for REST/SSE. `HostResourceSseClient` is wired from the retained `WorkbenchScreen` resource-stream setup, but it is outside the new guided mobile flow.
3. **Disposal-time attempt-tracker invalidation:** Source shows a synchronous `operationGeneration` increment on disposal and a generation check before `applyAuthenticatedSession`; whether that check and session commit are atomic is unverified. `attemptTracker.invalidate()` is then launched from `rememberCoroutineScope`, which may already be cancelled. No focused lifecycle/race regression test was supplied; keep tracker cleanup and commit-race behavior open.
4. **Navigation state on Activity recreation:** `MainActivity` retains `AppFlowNavigation` with Compose `remember`; state may reset on Activity recreation. No rotation/recreation test was supplied.
5. **Terminal allocation/scope:** `cleanAnsiCodes()` constructs three `Regex` instances per invocation. The display is a bounded ANSI-stripping console, not full terminal-emulator parity.
6. **Runtime qualification:** No Android device launch, screen rendering, live server project fetch, or PTY attach/detach evidence was supplied. Do not convert unit-test status into a device/runtime pass.
7. **Root remediation coverage:** Prior high-priority root findings appear corrected in current source, but no focused Compose integration tests for profile switching/back navigation or generation-change isolation were identified.

---

## 6. Main-Agent Handoff

Main-agent handoff: The implementation-plan closeout is complete for traceability, not a release or security signoff. Priority follow-ups: add request-level REST/SSE tests proving non-loopback HTTP omits `Authorization` and HTTPS retains it; resolve and regression-test disposal-time auth-attempt invalidation/commit-race behavior; qualify device login, project fetch, terminal attach/detach, and Activity recreation. Keep broad debug cleartext and loopback-only `--no-auth` constraints explicit. Completing the plan matters for traceability; close these follow-ups before broader Android security or release claims.

## 7. Unresolved Questions

- None requiring a decision for this implementation-status record. Device/runtime qualification and listed follow-ups remain open work, not unanswered questions.
