---
title: "TypeScript and JavaScript LSP Semantic Navigation MVP"
description: "Plan bundled TS/JS Definition and Implementation on Linux server + web; implementation remains gated by a real-process spike."
status: in-progress
priority: P1
effort: 264h
branch: feat/lsp-server-integration-reassess
tags: [feature, frontend, backend, api, auth, security, experimental]
created: 2026-09-01
---

# TypeScript and JavaScript LSP Semantic Navigation MVP

## Implementation status — 2026-10-23

**Phase 04 semantic session supervisor administratively complete under authorized exceptions; approved by user (in-progress 36.4% - 96/264h planned effort).** Phase 01 spike (24h planned), Phase 02 framing and child owner (16h planned), Phase 03 pinned tool provisioning and resource controls (28h planned), and Phase 04 semantic session supervisor (28h planned, 100% of phase scope) delivered. Immutable bundled engine layout (`lib/semantic-engine/`), passive zero-child integrity verification (`ToolProfile::verify_integrity`), centralized `ResourcePolicy` constants (`resources.rs`), Linux child-only cgroups attachment via pre-exec with honest `PortableOnly` degradation (`resources/linux.rs`), strict manifest inventory validation (`inventory_validation.rs`), SPDX 2.3 SBOM generation, AppState-owned disabled-by-default `SemanticSupervisor` (`server/src/state.rs`, `server/src/semantic/supervisor.rs`), isolated per-connection/target `SemanticSession` actors (`server/src/semantic/session.rs`), atomic adaptive `OverlayMap` (`server/src/semantic/overlay.rs`), FIFO navigation sequencing with `params.damHopperDocumentVersion` extension capture and stripping (`server/src/semantic/protocol.rs`), document-scoped close preserving dirty sibling overlays, and bounded complete-tree cleanup on shutdown/drop implemented. Verified by 10/10 tests in `server/tests/semantic_supervisor.rs` and 23/23 unit tests in `cargo test --lib semantic` per code reviewer cycle 3 validation (62 total passing tests across semantic suites reported by Main). Cycle 3 review scored 8/10 with 0 critical issues and explicit user approval on 2026-10-23 under tracked exceptions (reports: `plans/reports/tester-261023-1205-phase-04-cycle-2.md`, `plans/reports/code-reviewer-261023-1205-phase-04-cycle-3.md`). Tracked exceptions (W1 preemptible init / bounded supervisor shutdown, W2/S-W2b surface reap status/timeout from shutdown, W3 actor drop test polish, N-W1 per-connection atomic admission check TOCTOU, and G5 unopened file destination freshness) tracked for Phase 05/09 integration; release qualification remains pending. Next phase: Phase 05 (Authenticated semantic WebSocket gateway).

- Worktree: `/home/loidinh/WS/worktrees/dam-hopper-lsp-server-integration`.
- Base: local `main`, `60b07c1423fd5b3536632f3c3735c7f658b9fc59`.
- Review Verdict: Phase 04 Cycle 3 review scored 8/10 (0 critical issues) with explicit user approval on 2026-10-23 under tracked exceptions (W1-W3 and G5 unopened file destination freshness tracked for Phase 05/09; reports: `plans/reports/tester-261023-1205-phase-04-cycle-2.md`, `plans/reports/code-reviewer-261023-1205-phase-04-cycle-3.md`).
- Reports & Harness: Phase 01/02/03/04 reports in `plans/reports/` and `plans/260901-1000-lsp-server-integration/reports/`. Automated test suites in `server/tests/semantic_supervisor.rs` (10/10 passing), `server/tests/semantic_tool_profile.rs`, `server/tests/semantic_resources.rs`, `server/tests/linux_release_manifest.rs`, `server/tests/semantic_child_process.rs`, and unit tests in `server/src/semantic/` (23/23 passing; 62 passing tests total across semantic suites).
## Outcome

First supported release: shared Monaco Definition and Implementation for `.ts`, `.tsx`, `.js`, and `.jsx` through authenticated `/ws/semantic/v1`, filtered LSP JSON-RPC, and bounded bundled TSLS children on a Linux x64 server, consumed by the web client. Runtime ships OFF. Native-client qualification (including Linux Tauri), Windows-server qualification, and Android support are deferred and non-blocking; native origin policy remains unchanged. Java/Rust require separate integration, qualification, and release work.

## Frozen boundaries

- Server owns the bundled integrity-pinned Node/TypeScript/TSLS tuple, target root, method filter, URI mediation, and bounded resource policy. No custom executable/argument selection through host config, flags, environment, APIs, imports, or UI.
- Isolation is one TSLS child per semantic connection + target + descriptor; clients receive only target-scoped `dam-hopper://semantic` URIs.
- Adaptive sync sends full changes below the measured UTF-8 byte threshold and incremental changes at/above it; `didOpen`, reconnect/restart replay, and resync are full.
- TS/JS Definition + Implementation only; Rust returns `unsupported`, with no generic plugin system.
- Current auth/exact Origin and live-session invalidation policy apply. Global enable/disable mutations require current admin authority across every write path; ordinary authenticated users may use enabled semantics.
- Trusted workspaces only: child filesystem access remains that of the server account, not an OS sandbox. Gateway path/result containment is separate. Project-supplied plugins, executable hooks, and inherited execution hooks must remain disabled and be verified with real processes.
- Portable bounds are mandatory before exposure. Missing Linux hard resource controls warns/reports `portable-only` degradation and still runs; this is neither filesystem isolation nor a hard memory guarantee. Phase 09 tunes final numeric limits/threshold from evidence.
- ON performs passive integrity/config checks and starts zero semantic children; executable compatibility is checked in bounded qualification or the first authorized lazy session. Failed OFF cleanup/persistence reports safe-disabled/configured-intent mismatch, not reconstructed user sessions.
- Phase 01 must prove one negotiated sync kind and the explicit filtered-profile navigation version extension, stripped before child dispatch. Actual writer ordering is not an LSP acknowledgment; exact source-version and destination-content/range freshness remain gates.

## Dependency-ordered phases

| # | Phase | Status | Progress | Effort | Direct dependencies |
|---|---|---|---|---|---|
| 01 | [Protocol, dependency, and real-process spike](./phase-01-protocol-dependency-real-process-spike.md) | DONE (2026-10-23) | 100% | 24h | Reconciled policy + partially superseded ADR |
| 02 | [LSP framing and child owner](./phase-02-lsp-framing-and-child-owner.md) | DONE (2026-10-23) | 100% | 16h | 01 |
| 03 | [Pinned tool provisioning and resource controls](./phase-03-pinned-tool-provisioning-and-resource-controls.md) | DONE (2026-10-23) | 100% | 28h | 02 |
| 04 | [Semantic session supervisor](./phase-04-semantic-session-supervisor.md) | DONE (2026-10-23) | 100% | 28h | 03 |
| 05 | [Authenticated semantic WebSocket gateway](./phase-05-authenticated-semantic-websocket-gateway.md) | Pending | 0% | 28h | 04 |
| 06 | [Admin-only global hot toggle; bundled engines only](./phase-06-global-hot-toggle-and-unsafe-override-gate.md) | Pending | 0% | 20h | 05 |
| 07 | [Shared Monaco semantic client and navigation](./phase-07-shared-monaco-semantic-client-and-navigation.md) | Pending | 0% | 32h | 01, 05, 06 |
| 08 | [Lifecycle invalidation and recovery](./phase-08-lifecycle-invalidation-and-recovery.md) | Pending | 0% | 20h | 04, 05, 06, 07 |
| 09 | [Security, real-process tests, and performance qualification](./phase-09-security-real-process-tests-and-performance-qualification.md) | Pending | 0% | 40h | 03, 08 |
| 10 | [Linux server + actual web qualification; native deferred](./phase-10-linux-web-and-desktop-remote-client-validation.md) | Pending | 0% | 16h | 09 |
| 11 | [Documentation, roadmap, changelog, and release cleanup](./phase-11-documentation-roadmap-changelog-and-release-cleanup.md) | Pending | 0% | 12h | 09, 10 |

## Critical path and rollback boundary

01 → 02 → 03 → 04 → 05 → 06 → 07 → 08 → 09 → 10 → 11. Direct dependencies above include explicit input contracts; transitive prerequisites are retained. No runtime exposure to child creation before Phases 05–06 auth/control gates. Phase 01 records finite candidate bounds before execution; Phase 03 enforces them before admission; Phase 09 tunes measured final values. Runtime stays release-default OFF. Protocol, hook suppression, containment, portable-limit, sync/freshness, orphan-process, auth, or core-server regression blocks progress. Missing hard controls do not block qualified `portable-only`; unexercised hard mode remains unqualified. Actual built-web qualification requires fresh captures and human acceptance. Native is not a release gate. Rollback removes semantic exposure while preserving core behavior.

### Re-estimate — 2026-10-23

**264h provisional**, replacing inherited 198h (+66h). Backend/process/auth/config phases 01–06: 144h; client/lifecycle/qualification/docs phases 07–11: 120h. Increased work covers hostile loading and tree ownership, real release packaging, current-role/all-write-path authorization, stable model identity/freshness, live-auth backpressure, and actual built-web/human-review qualification. Phase files record individual rationale. This is an engineering estimate, not elapsed time or a commitment: failed Phase 01 gates require explicit replan/re-estimate; external review waiting and failed-gate redesign are not included.

## Canonical evidence

- [Planning ADR — accepted in part; superseded decisions marked locally](../reports/brainstorm-260901-1000-lsp-server-integration.md)
- [Monaco/transport research](./research/researcher-01-lsp-client-transport.md)
- [TSLS provisioning/resource research](./research/researcher-02-tsls-provisioning-resource-controls.md)

## Unresolved technical gates

Phase 01 owns explicit STOP/GO gates: G0 finite execution policy/corpus; G1 exact pinned tuple/layout/provenance; G2 transport/lazy bundle; G3 TSLS handshake/config replies; G4 single-kind adaptive sync; G5 source-version/incarnation and exact destination-coordinate/content freshness; G6 project plugin/engine/execution-hook suppression; G7 complete-tree ownership/reaping in required portable mode; G8 actual-web navigation, stable local/wire binding and model-scoped provider coexistence. Candidate numeric bounds, including a 64 KiB sync threshold, are finite experiment settings, not measured release capacity. Every gate must pass before Phase 02. Phase 09 owns final measured limits/threshold and predeclared numerical qualification budgets; Phase 10 owns actual application evidence/human acceptance. No unresolved user policy choices or native/Windows/Android qualification gate blocks this scope.

## Historical Validation — 2026-09-01

**Validated:** 2026-09-01 · **Questions asked:** 7 · **Revision state:** Historical; conflicting decisions superseded by 2026-10-23 validation.

### Applied Revisions

- [x] Runtime release default OFF retained. **Superseded scope:** required Linux desktop Tauri qualification is withdrawn; Linux server + web only is blocking.
- [x] Windows/Android explicitly unqualified and non-blocking; Android-hosted TSLS excluded.
- [x] One child per connection + target + descriptor and adaptive full/incremental sync with deterministic crossing, Unicode/range equivalence, and full replay.
- [x] Bundled offline integrity-pinned Linux Node + TypeScript + TSLS artifact is blocking.
- [x] Missing Linux hard controls yields warned/degraded `portable-only` operation, not startup refusal.
- [x] Phase 09 owns threshold and numeric resource-limit selection.

## Validation Summary

**Validated:** 2026-10-23 (interview began 2026-10-22) · **Questions asked:** 7 presentations (4 decision topics, 3 clarification reasks) · **Revision state:** Applied in place to all phase files, command overviews, and linked ADR on 2026-10-23; implementation remains Pending (0%).

### Confirmed Decisions

- **Release scope:** Linux server + web first. Defer Linux Tauri/native qualification; do not weaken current same-origin policy.
- **Global control:** Admins only may enable/disable the server-global semantic runtime; authenticated users may use it when enabled.
- **Workspace trust:** Trusted workspaces only; accept server-account filesystem authority, with no OS sandbox claim. Restrict project-controlled executable loading.
- **Engine selection:** Included engines only. Remove all custom executable override paths, including host-only overrides. Ordinary navigation and ON/OFF do not restart DamHopper; installing updated bundled engines through a server release normally does.
- **Future languages:** Included engines are not permanently limited to TS/JS. Java/Rust need their own integration and real-process/security/resource qualification before inclusion in a later release; adding a binary alone is insufficient.

These supersede September decisions requiring Linux Tauri remote qualification, allowing every authenticated user global mutation, or permitting startup-opted-in arbitrary-command overrides. The ADR now marks those decisions superseded locally. Historical research remains non-authoritative where conflicting.

### Evidence and Applied Phase-Revision Ledger

| Phase | Original assumption / current evidence | Required revision |
|---|---|---|
| 01 | Native spike is blocking; `apps/native/src/native-server-url.ts:11–19` permits only exact same-origin profiles on non-Windows native hosts. | Make the web/real-TSLS spike blocking, defer native proof, and prove project plugins/execution hooks cannot load. Record finite spike bounds before later qualification. |
| 02 | Dedicated child ownership remains applicable. | Retain process-tree shutdown/reap and bounded framing; align fixtures with bundled-only execution and current process-lifecycle conventions. |
| 03 | Custom profile path remains in historical steps; current Linux packaging is in `deploy/release/build-release-archive.sh` and manifest/SBOM generation in `deploy/release/generate-release-manifest.mjs`. | Stage one pinned offline tuple with hashes/licenses and release rollback. Remove override support; establish conservative finite limits before exposure, tune in 09, and apply child controls without starving the core API daemon. |
| 04 | Per-connection/target isolation and overlay fencing remain required. | Preserve independent unsaved overlays, bounded admission/restart/idle policy, and zero-child cleanup; consume early bounded settings without depending on completed Phase 09. |
| 05 | Historical text emphasizes upgrade auth. `server/src/api/ws.rs:518–619` revalidates live sessions every 5 seconds with a 2-second store-check timeout. | Match current Origin, credential-version/revocation, MFA/expiry, and fail-closed auth-backend behavior. Bound child cleanup; slow socket consumers must not postpone cancellation indefinitely. Do not promise unconditional 5-second teardown. |
| 06 | “Current auth has no roles” is stale: `server/src/auth/model.rs:6–13` defines User/Admin; development actor is User in `server/src/api/auth.rs:106–115`. | Require admin for every global write/import/raw-config path; deny non-admin `--no-auth` mutation rather than silently elevate it. Delete override flags/env/config/commands/UI/probes/audit flows; retain atomic ON/OFF and safe failure handling. |
| 07 | Shared host exists, but `MonacoHost.tsx:43–60` lacks explicit semantic target/model URI props. | Integrate stable owner/profile/generation/target-bound models and providers into current editor lifecycle; web qualification only. No command fields. |
| 08 | Current editor/profile ownership must fence replay and navigation. | Reauthorize and invalidate on owner/target/auth changes; replay only matching unsaved models, reject outside-target results, and prove old callbacks cannot affect replacement owners. |
| 09 | Numeric limits are deferred to measurement; previous prose can imply containment stronger than the child actually has. | Qualify real processes, trusted-workspace restrictions, bundled-only policy, admin bypass denial, auth cutoff, portable/hard modes, adaptive sync, and core responsiveness; publish only measured bounds. |
| 10 | Historical phase requires actual Linux Tauri remote client. Current native profile guard conflicts with this topology. | Replace with authenticated Linux-server + actual web application qualification, fresh non-sensitive captures and human review. Native remains explicitly unqualified/non-blocking; no native policy bypass. |
| 11 | Historical publication includes Linux desktop and unsafe override. | Publish only qualified Linux-server/web TS/JS behavior, default OFF, admin controls, trusted-workspace limits, included-engine updates, and unqualified platform boundaries. Reconcile README/API/config/architecture/roadmap/changelog/release claims. |

**Reconciled:** Every required revision above is applied in its linked phase; dates, dependencies, pending progress, acceptance criteria and effort are revised. This records completed documentation work, not completed implementation. Historical filenames for Phases 06/10 are retained to preserve links; their titles and instructions use only current policy.

### Action Items

- [x] Reconcile all 11 phase files, `cmd-plan.md`, requested `evc-cmd-plan.md`, and superseded ADR decisions with this ledger in place.
- [x] Re-estimate every phase and dependency contract; replace inherited 198h with provisional 264h and per-phase rationale.
- [x] Run the revised Phase 01 dependency and real-process spike before committing to implementation feasibility (completed 2026-10-23: G0–G7 proven on real processes, G8 tracked for in-browser qualification in Phases 07 & 10 per explicit user approval).
- [x] Implement Phase 02 LSP framing and child owner (completed 2026-10-23: bounded framing codec, process tree owner, signal escalation, and descendant reaping verified by 24/24 tests; user-approved Cycle 3 review).
- [x] Package pinned tool provisioning and resource controls (Phase 03 completed 2026-10-23: immutable bundled layout, passive integrity verification, ResourcePolicy constants, Linux child cgroup attachment with portable degradation; 55/55 tests passing across 5 targets, user-approved Cycle 3 review).
- [x] Implement Phase 04 semantic session supervisor (completed 2026-10-23: AppState supervisor ownership, per-connection/target isolated session actors, atomic adaptive overlays, FIFO navigation sequencing, document-scoped close, and complete-tree cleanup on shutdown/drop verified by 10/10 integration tests and 23/23 unit tests; user-approved Cycle 3 review).
- [ ] Complete subsequent implementation and qualification gates before claiming release support; static review and copied research are not runtime proof.

### Recommendation and Remaining Gates

**Phase 04 administratively complete under approved exceptions; proceed to Phase 05 (Authenticated semantic WebSocket gateway).** AppState-owned supervisor, per-connection/target isolated session actors, atomic adaptive overlays (full/incremental sync crossing UTF-8 byte threshold / UTF-16 ranges), FIFO navigation sequencing with `params.damHopperDocumentVersion` extension stripping, document-scoped close preserving dirty sibling overlays, and bounded complete-tree cleanup on shutdown/drop implemented and verified across 10/10 tests in `server/tests/semantic_supervisor.rs` and 23/23 unit tests in `cargo test --lib semantic` per code reviewer cycle 3 validation (62 total passing tests across semantic suites reported by Main). Cycle 3 review approved by user with score 8/10 (0 critical issues). Tracked exceptions (W1 preemptible init / bounded supervisor shutdown, W2/S-W2b surface reap status/timeout from shutdown, W3 actor drop test polish, N-W1 per-connection atomic admission check TOCTOU, and G5 unopened file destination freshness) tracked for Phase 05/09 integration; release qualification remains pending.

