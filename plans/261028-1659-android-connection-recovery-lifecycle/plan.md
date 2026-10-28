---
title: "Android connection recovery and lifecycle reconciliation"
description: "Repair Android WebSocket liveness and autonomous recovery; separate terminal transport, process and stream readiness."
status: pending
priority: P1
effort: 36h
branch: feat/android-native-features
tags: [bugfix, android, transport, lifecycle, terminal]
created: 2026-10-28
---

# Android connection recovery and lifecycle reconciliation

## 1. Executive Summary & Architecture Blueprint

Fix active native transport, not Rust server. [RCA](../reports/debugger-261028-1631-android-connection-indicator-rca.md) establishes missing client liveness deadline/recovery owner and stale terminal status; initial physical drop trigger remains unknown. Current server already sends 30s Ping / 90s liveness timeout. Ktor3.1.0 Android uses OkHttp; JVM tests use Java engine.

**Boundary:** product code only `native/android-app/shared/` and `androidApp/`; existing native README updated for documentation. ZERO `server/`, shared wire DTO/schema, endpoints, web/Tauri, root build/dependency, storage-schema or remote PTY ownership changes. Planning artifacts only written now. Existing `/ws` RFC6455 Ping/Pong, `term:attach/fromOffset`, `term:buffer` and REST remain sole server contracts.

**Blueprint:** Android engine heartbeat → single retained owner-qualified recovery supervisor → exact current socket → retained terminal attach/replay coordinator + input admission → shared status policy → both terminal renderers. `ConnectionRef` survives transient loss; only socket identity changes. Profile/account/endpoint change retires owner through existing awaited C2a1 barrier. Root/Activity/screens provide intent/hints, not retry loops; existing Agents/Files subscribers rebaseline on current socket.

**Policy:** 15s engine ping; 15s TCP connect / 30s write; 20s whole WS attempt. Own-deadline expiry retryable; external cancellation stops. Transient retry base1/2/4/8/16/30s with equal jitter, actual delay≤30s; reset after30s stable connection without unresolved recovery-required baseline failure. Attach replacements share backoff. Auth/configuration blocks stop generic retry. Background keeps established socket best-effort, pauses new retries; genuine resume/changed route replaces suspect socket, rotation alone does not. Timings provisional, not device-qualified SLAs; Doze has no wall-clock guarantee.

**Safety:** immediately revoke current-socket readiness/input on loss; foreground environment becomes unverified synchronously on genuine background, so first resumed frame never stale READY. Preserve accepted output/offset, drafts and PTY metadata as stale. Reattach existing retained terminals even while Files/Editor visible. READY requires verified environment + fresh current-socket baseline/drain, not `alive` or successful send. Idle shell may be Ready but never inferred busy. No uncertain command/keystroke/mutation replay; no automatic PTY creation/kill/restart. Same-terminal ambiguous attach requires socket replacement before retry.

**Why this design:** effective engine config + one recovery owner reuse existing seams. Reject dormant-factory-only edit, per-screen timers, REST-as-WS-health, manual Ktor Ping, new server heartbeat, background service/wakelock, command-busy inference and broad framework/refactor. Keep new runtime files <200 lines where practical; extract only affected responsibilities from large existing files.

## 2. Phase 1: Engine Keepalive & Timeouts

[Detailed phase and exact ownership](phase-01-engine-keepalive-timeouts.md) · pending · 4h. Wire actual `PlatformHttpEngine.android.kt`, bound `WsConnection` attempts/teardown, remove unused duplicate factory after caller check. Deadline/cancellation and effective Android engine policy tests; preserve TLS/redirect/security behavior.

## 3. Phase 2: Centralized Reconnection & Recovery Supervisor

[Detailed phase and exact ownership](phase-02-recovery-supervisor.md) · pending · 10h. Pure typed retry policy + retained supervisor, cached exact transport construction, root/VM integration and retirement drain. Covers initial failure, remote drop, 4401/4403 auth-stop,1013/503 transient,4001 resync, handshake/TLS/protocol errors. No transient generation churn or connect-all-profiles.

## 4. Phase 3: Android Lifecycle & Network Change Reconciliation

[Detailed phase and exact ownership](phase-03-lifecycle-network-reconciliation.md) · pending · 6h. Application-context default-network monitor, logical foreground/route epochs, genuine-resume replacement, config-recreation deduplication. Route exists≠server reachable; LAN/VPN need not be Internet-validated. Preserve retained workspace/file-watch/input semantics.

## 5. Phase 4: Terminal Status Indicator & Stream Readiness Decoupling

[Detailed phase and exact ownership](phase-04-terminal-status-stream-readiness.md) · pending · 16h. Retain collectors/attach/input callbacks outside composition, exact-socket dispatch, no-op success removal, offset/incarnation reconciliation, loss fencing and attach ambiguity handling. Shared transport/process/stream status in active and dormant renderers, accessible labels. Includes journey authoring, qualification and native README change note.

## 6. Verification & Test Strategy

[Commands, test ownership, matrix and regression boundaries](phase-04-terminal-status-stream-readiness.md#verification--test-strategy). Virtual-time policy/concurrency tests; existing shared replay/visibility/ownership/profile/Files/Agents/notification/transfer suites; Android unit tests; debug build and instrumentation compilation; real Android engine Ping/Pong-blackhole fixture plus mounted unchanged-server journeys. Qualify emulator + physical ARM64/API29 and API33+ across matrix. JVM/config tests never substitute for actual OkHttp timers or OS network/Doze evidence. Planner ran no builds/tests/device checks.

**Scheduling:** one integration owner; sequential task DAG: `wire-active-engine-keepalive → implement-recovery-supervisor → retain-authorized-recovery-runtime → reconcile-lifecycle-and-network → restore-current-socket-terminal-streams → decouple-terminal-status-presentation → author-recovery-device-journeys → qualify-integrated-android-recovery → document-android-recovery-contract`. Same-file handoffs serialized. Phase task fences are sole durable authoring contract; no tasks.json hydration or execution approval here. Coordinator runs integrated verification once after writers land; failed checks return to exact owning task.

## 7. Rollback & Risk Mitigation

[Detailed risks and rollback](phase-04-terminal-status-stream-readiness.md#rollback--risk-mitigation). Gate on retirement lock reentry, cancellation/late socket publication, stale input admission, ambiguous same-socket buffer, parser drain, callback retention, duplicate collectors and battery/reconnect load. Ship Phases2–4 cohesively; restore previous scoped client change set/APK if isolation/data/auth regressions. No server deployment/storage migration/vault reset; Phase1 independent only after qualification.

**Related-plan writable overlap:** [Agents sidebar](../261025-1157-android-terminal-agents-sidebar/plan.md), [Settings/notifications](../261024-2042-android-notifications-settings/plan.md), [Editor/explorer](../261023-1429-native-editor-file-explorer/plan.md) and [IDE enhancements](../261024-1627-native-editor-ide-enhancements/plan.md) share root/VM/workspace/terminal ownership. Coordinator must establish writer release before implementation; prior completion labels are not release/device evidence. Existing accepted warnings stay outside scope unless they block this contract. No other plan modified/imported.

**Evidence / architecture:** root README, native README, current construction/registry/lifecycle/controller/queue/active screen/retained VM source and installed planning/mobile skills inspected; supplied version-specific RCA reused, no redundant external research. [Native architecture](../../docs/architecture/android-native-client.md) invariants retained; existing document contains historical paths/caveats. This scoped plan is intended design; root-doc update outside assignment not performed. No architecture skip claimed for structural recovery work.

**Planning gate status:** authoring complete; pending coordinator independent plan review and final validation. Two Advisor consultations incorporated exact input admission, retained callbacks, attach ambiguity/backoff, timeout-vs-cancellation, non-reentrant retirement boundary and environment freshness; not independent-review approval or implementation evidence. Coordinator alone runs checks after writers land and reruns affected checks after repairs; implementers do not run mid-flight suites. Active-plan setter warned missing `EVCRATE_SESSION_ID`; session persistence unavailable, explicit selected path remains authoritative.

## Unresolved questions / external gates

- No blocking product/API choice: selected indicator contract is stream readiness plus separate process liveness, not command activity. Timings/battery behavior require device qualification and may need measured tuning.
- Incident device/API, deployed server/proxy version and exact drop cause remain unknown; collect redacted correlated diagnostics during qualification, not prerequisites to fixing source-established gaps.
- Coordinator owns shared-file writer release, independent risk review/final plan validation and real-device/current-server evidence. Missing devices/network control blocks release qualification, not plan authoring; no claimed implementation approval.
