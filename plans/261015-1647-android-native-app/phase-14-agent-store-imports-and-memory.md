---
title: "Phase 14 — Agent Store imports and memory"
description: "Deliver all current server-owned Agent Store distribution/import and agent memory-management flows."
status: completed
priority: P2
effort: unestimated
branch: feat/android-native-app
tags: [feature, frontend, android, kotlin, compose, agents, memory, store]
created: 2026-10-15
---

# Phase 14 — Agent Store imports and memory

## Context Links

- [Overview](./plan.md) · [scope and acceptance](./scope-and-acceptance.md) · [contracts/modules](./contracts-and-modules.md) · [execution guide](./execution-guide.md).
- [Proposed architecture](../../docs/architecture/android-native-client.md) · [reviewed research](./research/android-platform-research.md).
- Dependencies: [Phase 09](./phase-09-native-editor-language-services-and-safe-saves.md)

## Overview

- Date: 2026-10-15. Completion date: 2026-10-16. Priority: P2. Implementation status: **completed (2026-10-16)**. Review status: **User approved Cycle 2 review (score 7/10) with documented open limitations deferred to Phase 18 qualification** (see `plans/reports/code-reviewer-261016-1730-phase-14-cycle-2.md`). Progress: **100%**.
- Scope: S01–S02.
- Goal: Deliver all current server-owned Agent Store distribution/import and agent memory-management flows.
- Deliverables: Agent Store models and REST contracts (`AgentStoreModels.kt`), repositories for agent store, memory, and import (`AgentStoreRepository.kt`, `AgentMemoryRepository.kt`, `AgentImportRepository.kt`), reactive controllers (`AgentStoreController.kt`, `AgentMemoryController.kt`, `AgentImportController.kt`), native Compose UI surfaces and dialogs (`AgentStoreScreens.kt`, `AgentDistributionMatrixView.kt`, `AgentStoreModals.kt`, `AgentMemoryScreens.kt`, `AgentImportScreens.kt`, `AgentsUnifiedPanelScreen.kt`), workbench navigation integration (`WorkbenchScreen.kt`), and automated test suite (`AgentControllersFencingAndDraftTest.kt`, `tests/test-phase-14-agent-store-memory.sh`).
## Key Insights

- Agent Store is not the retired plugin platform and does not run plugins on Android.
- An import “local” scan refers to server-local paths, not Android device storage or another profile.

## Requirements

- Catalog/category/list/detail/content/matrix/scan/health, ship/unship/absorb/bulk distribution and delete.
- Remote/local import scan review/selection/confirmation; memory templates/read/edit/apply.
- Captured-owner drafts and partial-failure/denial feedback, with no cross-server distribution fallback.

## Architecture

AgentStoreRepository and AgentMemoryRepository own exact-server catalog/project distribution state; native screens use editor/Markdown components for content and explicit reviewed mutation intents.

## Related Code Files

Existing references (read/reuse contracts; no server/web modification by default):
- `/home/loidinh/WS/worktrees/dam-hopper-android-native-app/docs/architecture/agent-store-ports-and-browser.md`
- `/home/loidinh/WS/worktrees/dam-hopper-android-native-app/docs/api/workspace-settings.md`
- `/home/loidinh/WS/worktrees/dam-hopper-android-native-app/server/src/api/router.rs`
- `/home/loidinh/WS/worktrees/dam-hopper-android-native-app/packages/ui/src/api/client.ts`

Implemented files:
- `/home/loidinh/WS/worktrees/dam-hopper-android-native-app/native-app/shared/src/commonMain/kotlin/dev/damhopper/nativeapp/features/agents/AgentStoreModels.kt`
- `/home/loidinh/WS/worktrees/dam-hopper-android-native-app/native-app/shared/src/commonMain/kotlin/dev/damhopper/nativeapp/features/agents/AgentStoreRepository.kt`
- `/home/loidinh/WS/worktrees/dam-hopper-android-native-app/native-app/shared/src/commonMain/kotlin/dev/damhopper/nativeapp/features/agents/AgentMemoryRepository.kt`
- `/home/loidinh/WS/worktrees/dam-hopper-android-native-app/native-app/shared/src/commonMain/kotlin/dev/damhopper/nativeapp/features/agents/AgentImportRepository.kt`
- `/home/loidinh/WS/worktrees/dam-hopper-android-native-app/native-app/shared/src/commonMain/kotlin/dev/damhopper/nativeapp/features/agents/AgentStoreController.kt`
- `/home/loidinh/WS/worktrees/dam-hopper-android-native-app/native-app/shared/src/commonMain/kotlin/dev/damhopper/nativeapp/features/agents/AgentMemoryController.kt`
- `/home/loidinh/WS/worktrees/dam-hopper-android-native-app/native-app/shared/src/commonMain/kotlin/dev/damhopper/nativeapp/features/agents/AgentImportController.kt`
- `/home/loidinh/WS/worktrees/dam-hopper-android-native-app/native-app/shared/src/commonMain/kotlin/dev/damhopper/nativeapp/features/agents/AgentStoreScreens.kt`
- `/home/loidinh/WS/worktrees/dam-hopper-android-native-app/native-app/shared/src/commonMain/kotlin/dev/damhopper/nativeapp/features/agents/AgentDistributionMatrixView.kt`
- `/home/loidinh/WS/worktrees/dam-hopper-android-native-app/native-app/shared/src/commonMain/kotlin/dev/damhopper/nativeapp/features/agents/AgentStoreModals.kt`
- `/home/loidinh/WS/worktrees/dam-hopper-android-native-app/native-app/shared/src/commonMain/kotlin/dev/damhopper/nativeapp/features/agents/AgentMemoryScreens.kt`
- `/home/loidinh/WS/worktrees/dam-hopper-android-native-app/native-app/shared/src/commonMain/kotlin/dev/damhopper/nativeapp/features/agents/AgentImportScreens.kt`
- `/home/loidinh/WS/worktrees/dam-hopper-android-native-app/native-app/shared/src/commonMain/kotlin/dev/damhopper/nativeapp/features/agents/AgentsUnifiedPanelScreen.kt`
- `/home/loidinh/WS/worktrees/dam-hopper-android-native-app/native-app/shared/src/jvmTest/kotlin/dev/damhopper/nativeapp/features/agents/AgentControllersFencingAndDraftTest.kt`
- `/home/loidinh/WS/worktrees/dam-hopper-android-native-app/tests/test-phase-14-agent-store-memory.sh`
No deletion of existing web/Tauri hosts or unrelated files. Any necessary backend contract change requires a documented design/compatibility review before code.

## Implementation Steps

1. Map all Phase01 agent-store/memory/import routes and actual item/category/content response models; retain current naming, limits, capability and error behavior.
2. Implement native catalog/detail/Markdown-content and distribution matrix/health/scan views, with qualified server/project labels and explicit stale/unavailable state.
3. Implement ship/unship/absorb/delete/bulk mutation review and results; a failed profile/target must not re-route to another server catalog.
4. Implement import remote/local scan, candidate review/edit/selection and confirmation using captured owner; retire pending drafts/results on endpoint/generation change without silently importing elsewhere.
5. Implement memory list/content/template/apply/edit over server routes, respecting current conflict/validation semantics and using safe native editor behavior.
6. Refresh affected catalog/project state after confirmed mutations; distinguish partially completed distribution and uncertain result from all-success.
7. Exercise real temporary server catalogs/projects, symlink distribution outcomes, invalid/duplicate items, partial failures, import-generation races and memory save/template application.

## Todo List

- [x] Deliver catalog/distribution/import/memory UI incl. absorb, project scan, force-unship.
- [x] Preserve reviewed mutation and partial-failure semantics (reviewed cell dialog, visible mutation errors).
- [ ] Observe real server filesystem outcomes and isolation (live physical device and remote server qualification deferred to Phase 18).
- [x] Update requirement/evidence ledger and affected docs (completed in scope-and-acceptance.md, plan.md, docs/project-roadmap.md).
- [x] Cycle-1 criticals: C1 (Save gated on loaded target), C2 (`setProjects` preserves draft), W1, W2, W3, W7(a,c) verified in code.
- [ ] Cycle-2 review findings and open limitations: H1 (save locked out after action error), H2 (`setProjects` missing on controller re-creation), H3 (revision fencing on `confirmImport` result and REPO cleanup), M1-M6 (deferred to Phase 18 qualification).

## Phase 14 Completion Record (2026-10-16)

- **Completed:** 2026-10-16
- **Status:** 100% complete (user-approved implementation baseline with documented open limitations and runtime qualification deferred to Phase 18)
- **Validation:** User approved Cycle 2 review (score 7/10 per `plans/reports/code-reviewer-261016-1730-phase-14-cycle-2.md`; open limitations accepted and deferred to Phase 18 qualification). 100% automated pass rate across:
  - 252 shared JVM unit tests passed (`:shared:jvmTest`)
  - 51 Android unit tests passed (`:androidApp:testDebugUnitTest :androidApp:testReleaseUnitTest`)
  - 99 Phase 14 static invariant assertions passed (`tests/test-phase-14-agent-store-memory.sh`)
  - 953 total static assertions across all 13 regression suites passed (Phases 02-14)
  - Clean `:androidApp:assembleDebug` APK build
- **Deliverables:**
  - **Data Models & REST Contracts (`AgentStoreModels.kt`):** Full typed contracts matching server routes (`AgentStoreItem`, `AgentStoreCategory`, `AgentStoreCatalogResponse`, `AgentStoreContentResponse`, `AgentDistributionMatrix`, `AgentProjectHealth`, `AgentProjectScanResult`, `AgentImportCandidate`, `AgentImportScanResponse`, `AgentImportResult`, `AgentImportConfirmRequest`, `AgentImportConfirmResponse`, `AgentMemoryTemplate`, `AgentMemoryContentResponse`, `AgentMemorySaveResponse`, `AgentMemoryApplyResponse`). Serialization mappings, operation types (`AgentOperation`), source enums (`ImportSourceType`), distribution actions (`ShipAction`).
  - **Repository Layer (`AgentStoreRepository.kt`, `AgentMemoryRepository.kt`, `AgentImportRepository.kt`):** REST API integration for catalog/categories, item details and markdown content, distribution matrix, project health, project scan, distribution mutations (ship symlink/copy, unship, force-unship, absorb, bulk ship/unship, item deletion); import remote git repo / local server folder scan, import candidate confirmation with cleanup flag derivation; agent memory templates, agent memory content retrieval, safe memory save, template application.
  - **Reactive Controllers (`AgentStoreController.kt`, `AgentMemoryController.kt`, `AgentImportController.kt`):** Generation-fenced controllers with immutable connection owner fencing (`{profileId, generation}`), monotonic operation/scan revision tracking, dirty draft protection (`setProjects` preserves draft on matching active target, `pendingTargetSwitch` gating on target change), safe saves capturing content snapshot, cleanup flag derivation (`cleanup = source == REPO`), and explicit controller retirement (`retire()`).
  - **Native UI Surfaces & Modals (`AgentStoreScreens.kt`, `AgentDistributionMatrixView.kt`, `AgentStoreModals.kt`, `AgentMemoryScreens.kt`, `AgentImportScreens.kt`, `AgentsUnifiedPanelScreen.kt`):** Full Compose-based UI. Sub-product navigation with segmented tabs ("Agent Store", "Agent Memory", "Agent Import", and Phase 07 "Observations") unified inside `AGENTS` panel. Distribution matrix with per-cell status indicators and reviewed action modal (`CellActionDialog`). Import candidate review with item-level selection and bulk toggles. Memory template selector, diff preview, and markdown-aware editor. Zero FABs and zero WebViews.
  - **Integrated Workbench Navigation (`WorkbenchScreen.kt`):** Replaced placeholder in `PanelType.AGENTS` with `AgentsUnifiedPanelScreen` hosting unified switcher for Store, Memory, Import, and existing Phase 07 Observation Engine. Single content area adhering to traditional shell workbench invariants.
- **Documented Open Limitations & Residuals (Deferred to Phase 18):**
  - **L1 (Device & Authenticated Live Server Qualification):** Real Android physical device and authenticated remote server live testing (symlink resolution across filesystems, remote network latency, physical device lifecycle and memory pressure) deferred to Phase 18 (`phase-18-integrated-device-security-and-performance-qualification.md`).
  - **L2 (Server Temp Directory & Cleanup Validation):** Live server temp directory removal validation and cleanup failure handling during remote repo imports deferred to Phase 18 qualification.
  - **L3 (API Methods Scoping & Absorb Alignment):** Unused repo methods (`getItem`, `listProjectMemory`) and absorb UI action scoping on unmanaged project-scan items (reconciling server distributor semantics) deferred to Phase 18 qualification.
- **Handoff:** Phase 14 (Agent Store imports and memory) completed with user approval. Phase 17 (Preferences privacy notifications and lifecycle) has prerequisite Phase 14 satisfied (prerequisites 07, 11, 13, 14 satisfied; remaining prerequisites: Phases 15, 16 pending). Physical hardware and live server qualification deferred to Phase 18.
## Success Criteria

- Every current store/import/memory action targets selected server and changes only intended project distribution/files.
- Switching/reconnecting a profile cannot submit an old import draft or content save to a new owner.
- No retired plugin SDK/runtime or local Android execution is introduced.
- Verification: run changed consumer behavior and record actual output/state; use [execution guide](./execution-guide.md). Compilation/tests alone do not satisfy native-surface acceptance.

## Risk Assessment

- Bulk distribution can partly succeed; individual result states must remain visible.
- Content preview rendering must not activate excluded HTML/Mermaid engines or external code.

## Security Considerations

- Server validates remote repo/local scan paths and symlink rules; Android cannot authorize them through display labels.
- No prompts/private memory content/import URLs with secrets in diagnostics.

## Next Steps

Independent of Git/workflow/metrics after editor base; included in Phase17 integration and Phase18 real-app acceptance.

## Unresolved Questions

- Resolve this phase's dependency/device/license/capability decisions in the acceptance ledger before marking done; escalate retained requirements that cannot be met rather than narrowing scope.
