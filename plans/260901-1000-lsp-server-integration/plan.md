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

**Phase 07 shared Monaco semantic client and navigation administratively complete under approved exceptions; approved by user (in-progress 66.7% - 176/264h planned effort accounting; release qualification pending).** Phase 01 spike (24h planned), Phase 02 framing and child owner (16h planned), Phase 03 pinned tool provisioning and resource controls (28h planned), Phase 04 semantic session supervisor (28h planned), Phase 05 authenticated semantic WebSocket gateway (28h planned), Phase 06 admin-only global hot toggle and bundled engines gate (20h planned), and Phase 07 shared Monaco semantic client and navigation (32h planned) delivered under approved exceptions. Delivers dedicated owner-bound `SemanticClient` (`packages/ui/src/api/semantic-client.ts`), virtual wire URI mediation (`packages/ui/src/lib/semantic-model-uri.ts`), Monaco TS/JS Definition and Implementation providers (`packages/ui/src/lib/semantic-monaco.ts`), ephemeral reveal intent store (`packages/ui/src/stores/semantic-navigation.ts`), and editor lifecycle integration (`packages/ui/src/components/organisms/MonacoHost.tsx`, `EditorTabs.tsx`, `packages/ui/src/stores/editor.ts`) with adaptive single-kind sync (<64KB full vs ≥64KB incremental) and monotonic wire versioning. QA test execution report records 128 tests passing across test tiers (38 backend unit, 8 backend integration, 27 frontend unit, 2 Vitest browser component tests in Chromium, 53 regression tests) with 0 typecheck errors (`tsc` and `cargo check`) and 3,167/3,167 full UI suite tests passing. Reviewer Cycle 3 score 6/10 noted open critical issues and warnings; user authorized administrative acceptance on 2026-10-23 under tracked items (Phase 07 C-1 reconnect client ref lookup, Phase 07 C-2 / G8 live web browser coexistence, Phase 07 W-1 destination freshness G5, Phase 07 W-2 to W-10 status/error/cleanup items tracked for Phase 08/09/10).

- Worktree: `/home/loidinh/WS/worktrees/dam-hopper-lsp-server-integration`.
- Base: local `main`, `60b07c1423fd5b3536632f3c3735c7f658b9fc59`.
- Review Verdict: Phase 07 Cycle 3 review scored 6/10; approved by user on 2026-10-23 under tracked items (reports: `plans/reports/tester-261023-2012-phase-07-monaco-client.md`, `plans/reports/code-reviewer-261023-2030-phase-07-monaco-client-cycle-3.md`).
- Reports & Harness: Phase 01–07 reports in `plans/reports/` and `plans/260901-1000-lsp-server-integration/reports/`. Automated test suites in `server/tests/semantic_websocket.rs`, `server/tests/semantic_settings.rs`, `server/tests/semantic_supervisor.rs`, `server/tests/semantic_tool_profile.rs`, `server/tests/semantic_resources.rs`, `server/tests/semantic_child_process.rs`, `packages/ui/src/lib/semantic-model-uri.test.ts`, `packages/ui/src/api/semantic-client.test.ts`, `packages/ui/src/lib/semantic-monaco.test.ts`, `packages/ui/src/stores/semantic-navigation.test.ts`, `packages/ui/src/components/organisms/MonacoHost.semantic.test.tsx`, `packages/ui/browser-tests/semantic-navigation.browser.tsx`, and full UI suite (3,167/3,167 tests passing).
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
| 05 | [Authenticated semantic WebSocket gateway](./phase-05-authenticated-semantic-websocket-gateway.md) | DONE (2026-10-23) | 100% | 28h | 04 |
| 06 | [Admin-only global hot toggle; bundled engines only](./phase-06-global-hot-toggle-and-unsafe-override-gate.md) | DONE (2026-10-23) | 100% | 20h | 05 |
| 07 | [Shared Monaco semantic client and navigation](./phase-07-shared-monaco-semantic-client-and-navigation.md) | DONE (2026-10-23) | 100% | 32h | 01, 05, 06 |
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
- [x] Implement Phase 05 Authenticated semantic WebSocket gateway (completed 2026-10-23: dedicated route /ws/semantic/v1, subprotocol dam-hopper.semantic.lsp.v1, Origin allowlist and query-token/cookie parity, live fail-closed watcher, cancellation-first session teardown, strict virtual URI containment dam-hopper://semantic/<id>/<path>, bounded JSON-RPC framing, and FIFO navigation extension handling; 64 scoped unit and integration tests passing; user-approved Cycle 3 review).
- [x] Implement Phase 06 Admin-only global hot toggle and bundled engines gate (administratively complete 2026-10-23 under approved exceptions: GET and PATCH /api/semantic/settings, GlobalConfig.semantic.enabled default-OFF, fresh current-admin authorization and no-auth rejection, zero-child passive integrity ON, cancellation-first OFF teardown, protected global config raw filesystem and workspace tampering guards across wired sinks, SettingsPage admin toggle and read-only presentation; 115 focused tests and 3,140/3,140 UI tests passing per QA report; approved by user following Cycle 2 review; release qualification pending).
- [x] Implement Phase 07 Shared Monaco semantic client and navigation (administratively complete 2026-10-23 under user-approved exceptions: SemanticClient owner-bound WebSocket client, virtual wire URI mediation, TS/JS Definition and Implementation providers, ephemeral reveal intent routing, MonacoHost and EditorTabs editor lifecycle integration, adaptive full/incremental sync; QA report records 128/128 target and regression tests passing, 3,167/3,167 full UI tests passing; reviewer Cycle 3 scored 6/10, with user-approved administrative acceptance tracking Phase 07 C-1, C-2/G8, W-1..W-10 for Phase 08/09/10).
- [ ] Complete subsequent implementation and qualification gates before claiming release support; static review and copied research are not runtime proof.

### Recommendation and Remaining Gates

**Phase 07 administratively complete under approved exceptions; proceed to Phase 08 (Lifecycle invalidation and recovery).** Shared Monaco semantic client and navigation delivered with owner-bound `SemanticClient`, virtual wire URI mapping, Definition and Implementation providers, ephemeral reveal intent routing, and MonacoHost/EditorTabs lifecycle integration. Planned effort accounting reaches 66.7% (176/264h). Open gates and tracked items carried forward include: Phase 05 gateway items (W-A reader loop on writer death, W-B cancelled request answering null id, W-C invalid id echo / notification response, W-D pre-actor rejection overlay invalidation); Phase 06 toggle items (W1 cancellation safety / detached transition, W2 child terminal status / leak detection in shutdown, W3 re-enable block while unclean sessions exist, W4 teardown timeout margin, W5 failure regression tests, W6 transition error sanitization); and Phase 07 client items (C-1 call-time client resolution in `onChange`/`notifyDidClose` across reconnect and generation changes, C-2/G8 live browser Monaco definition action verification across owned and non-owned models with clean restore on OFF, W-1 unopened destination file freshness fence G5, W-2/W-4 typed error states and visible status indicators, W-3 direct EditorTabs semantic effect test coverage, W-5 `$/cancelRequest` timeout and handshake margin, and W-6 to W-10 ambient defaults, singleton options, global boolean switch, resync path, and zustand store updater side-effects). Unopened file destination freshness G5 and G8 live web navigation remain open gates. Release qualification remains pending.

