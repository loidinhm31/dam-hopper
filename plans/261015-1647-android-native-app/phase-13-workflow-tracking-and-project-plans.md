---
title: "Phase 13 — Workflow tracking and project plans"
description: "Deliver native manual workflow tracking and read-only project-plan overview, timeline, and documents as distinct products."
status: completed
priority: P2
effort: unestimated
branch: feat/android-native-app
tags: [feature, frontend, android, kotlin, compose, workflow, plans]
created: 2026-10-15
---

# Phase 13 — Workflow tracking and project plans

## Context Links

- [Overview](./plan.md) · [scope and acceptance](./scope-and-acceptance.md) · [contracts/modules](./contracts-and-modules.md) · [execution guide](./execution-guide.md).
- [Proposed architecture](../../docs/architecture/android-native-client.md) · [reviewed research](./research/android-platform-research.md).
- Dependencies: [Phase 07](./phase-07-terminal-sessions-replay-input-and-agents.md), [Phase 09](./phase-09-native-editor-language-services-and-safe-saves.md)

## Overview

- Date: 2026-10-15. Completion date: 2026-10-16. Priority: P2. Implementation status: **completed (2026-10-16)**. Review status: **User approved Cycle 3 review with noted limitations deferred to Phase 18 qualification**. Progress: **100%**.
- Scope: W01–W02.
- Goal: Deliver native manual workflow tracking and read-only project-plan overview/timeline/documents as distinct products.
- Deliverables: Workflow models and REST DTOs (`WorkflowModels.kt` including `WorkflowDomainHelpers`), repositories for workflow and project plan operations (`WorkflowRepository.kt`, `ProjectPlansRepository.kt`), reactive controllers (`WorkflowController.kt`, `ProjectPlansController.kt`), and native Compose UI surfaces and dialogs (`WorkflowPanelScreen.kt`, `WorkflowScreens.kt`, `WorkflowModals.kt`, `WorkflowSessionsAndEventsView.kt`, `ProjectPlanScreens.kt`, `ProjectPlanModels.kt`).

## Key Insights

- Workflow session lifecycle is user-managed; observed terminal exit never proves task completion.
- Project plan status comes from declared plan.md metadata/phase rows, not tests or filesystem mtime.

## Requirements

- Manual plan/phase/task items, sessions/end/abandon/links, notes/events/history purge with CAS/request identity.
- Folder-first project plans and selected plan overview/timeline/linked document navigation and watcher degradation.
- Qualified native Markdown documents; explicit unsupported Mermaid rendering per approved exception.

## Architecture

WorkflowRepository uses server SQLite-backed API; ProjectPlansRepository uses strict rooted read-only filesystem APIs. Both use explicit captured owner/target and bounded event/watch coordination; no local database mirror or plan-file rewriting.

## Related Code Files

Existing references (read/reuse contracts; no server/web modification by default):
- `/home/loidinh/WS/worktrees/dam-hopper-android-native-app/docs/api/workflow.md`
- `/home/loidinh/WS/worktrees/dam-hopper-android-native-app/docs/workflow-api.md`
- `/home/loidinh/WS/worktrees/dam-hopper-android-native-app/docs/workflow-client-state.md`
- `/home/loidinh/WS/worktrees/dam-hopper-android-native-app/docs/api/filesystem-and-media.md`
- `/home/loidinh/WS/worktrees/dam-hopper-android-native-app/server/src/api/plans.rs`
- `/home/loidinh/WS/worktrees/dam-hopper-android-native-app/docs/system-architecture.md`

Proposed implementation files (create unless introduced earlier; modify thereafter):
- `/home/loidinh/WS/worktrees/dam-hopper-android-native-app/native-app/shared/src/commonMain/kotlin/dev/damhopper/nativeapp/features/workflow/WorkflowModels.kt` (includes `WorkflowDomainHelpers`)
- `/home/loidinh/WS/worktrees/dam-hopper-android-native-app/native-app/shared/src/commonMain/kotlin/dev/damhopper/nativeapp/features/workflow/WorkflowRepository.kt`
- `/home/loidinh/WS/worktrees/dam-hopper-android-native-app/native-app/shared/src/commonMain/kotlin/dev/damhopper/nativeapp/features/workflow/WorkflowController.kt`
- `/home/loidinh/WS/worktrees/dam-hopper-android-native-app/native-app/shared/src/commonMain/kotlin/dev/damhopper/nativeapp/features/workflow/WorkflowPanelScreen.kt`
- `/home/loidinh/WS/worktrees/dam-hopper-android-native-app/native-app/shared/src/commonMain/kotlin/dev/damhopper/nativeapp/features/workflow/WorkflowScreens.kt`
- `/home/loidinh/WS/worktrees/dam-hopper-android-native-app/native-app/shared/src/commonMain/kotlin/dev/damhopper/nativeapp/features/workflow/WorkflowModals.kt`
- `/home/loidinh/WS/worktrees/dam-hopper-android-native-app/native-app/shared/src/commonMain/kotlin/dev/damhopper/nativeapp/features/workflow/WorkflowSessionsAndEventsView.kt`
- `/home/loidinh/WS/worktrees/dam-hopper-android-native-app/native-app/shared/src/commonMain/kotlin/dev/damhopper/nativeapp/features/workflow/ProjectPlanModels.kt`
- `/home/loidinh/WS/worktrees/dam-hopper-android-native-app/native-app/shared/src/commonMain/kotlin/dev/damhopper/nativeapp/features/workflow/ProjectPlansRepository.kt`
- `/home/loidinh/WS/worktrees/dam-hopper-android-native-app/native-app/shared/src/commonMain/kotlin/dev/damhopper/nativeapp/features/workflow/ProjectPlansController.kt`
- `/home/loidinh/WS/worktrees/dam-hopper-android-native-app/native-app/shared/src/commonMain/kotlin/dev/damhopper/nativeapp/features/workflow/ProjectPlanScreens.kt`
- `/home/loidinh/WS/worktrees/dam-hopper-android-native-app/tests/test-phase-13-workflow-plans.sh`

No deletion of existing web/Tauri hosts or unrelated files. Any necessary backend contract change requires a documented design/compatibility review before code.

## Implementation Steps

1. Implement overview/filter/hierarchy and strict create/update/delete item, notes and manual session flows; retain UUID requestId/updatedAt CAS and distinguish conflict from request failure.
2. Implement terminal/agent link selection using current qualified PTY/project/worktree/incarnation and bounded manual identifiers; never infer link through terminal text or create observation-ingress API.
3. Implement sessions end/abandon/link/unlink and history purge with explicit target-labelled confirmation, current retention semantics and current server response/error states.
4. Implement immediate plan-folder browsing then selected-plan overview/timeline/documents, showing reported status/undated milestones without execution claims or duration inference.
5. Use strict64KiB plan-document reads and safe linked-path decoding/containment; serialize watcher installation/rebinding and re-read authoritative state before claiming live coverage.
6. Preserve disappeared/replaced root/doc/listing truncation/degraded watch states and explicit retry; native Markdown/GFM renders text while Mermaid render remains explicitly unavailable.
7. Exercise concurrent workflow edits/CAS, duplicate request identities under documented replay semantics, stale terminal links, changed plan files/root replacement and profile/worktree switches.

## Todo List

- [x] Deliver manual workflow CRUD/sessions/notes/events.
- [x] Deliver folder-first read-only project-plan views/watch lifecycle.
- [ ] Verify CAS/identity/read-only/reporting semantics (automated unit tests and static shell assertions passed; live qualification open under Phase 18).
- [ ] Update requirement/evidence ledger and affected docs after actual runtime proof; record device/server/version limitations (live runtime proof open under Phase 18).

## Phase 13 Completion Record (2026-10-16)

- **Completed:** 2026-10-16
- **Status:** 100% complete (user-approved implementation baseline with documented open limitations and runtime qualification deferred to Phase 18)
- **Validation:** User approved Cycle 3 review with noted limitations deferred to Phase 18 qualification (per `plans/reports/qa-261016-1534-phase-13-cycle-3.md` and `plans/reports/code-reviewer-261016-1440-phase-13-workflow-plans-cycle2.md`). 274 unit tests passed (100% pass rate: 224 `:shared:jvmTest` + 50 `:androidApp:testDebugUnitTest`), 854 static invariant assertions across 12 suites passed (100% pass rate: 100 in `tests/test-phase-13-workflow-plans.sh` + 754 across 11 regression suites), and clean `:androidApp:assembleDebug` APK build (65 tasks).
- **Deliverables:**
  - **Workflow Models & REST DTO Contracts (`WorkflowModels.kt` including `WorkflowDomainHelpers`):** Full typed contracts matching server SQLite-backed workflow API (`ItemDto`, `SessionDto`, `LinkDto`, `NoteDto`, `EventDto` with nullable target, `WorkflowOverviewDto`, `WorkflowEventsDto`, `PurgeDto`, `MutationDto`, `TombstoneDto`). Status and item kind enums (`ItemKind`, `ItemStatus`, `SessionStatus`, `ResourceLinkType`, `ResourceObservedState`, `WorkflowSource`) with wire-compatible serialization (`in_progress`, `canceled`), hierarchy validation, and status transitions.
  - **Workflow Repository (`WorkflowRepository.kt`):** Complete REST API integration covering overview retrieval, item lifecycle (create, patch, delete with optimistic concurrency / CAS token support and UUIDv4 client mutation IDs), session management (create, end, abandon, link, unlink), note management (create, delete), event log retrieval with pagination, and workspace history purge. 404 detection for unavailable feature detection.
  - **Project Plans Models & Repository (`ProjectPlanModels.kt`, `ProjectPlansRepository.kt`):** Data structures for plan folders (`PlanFolderState`, `PlanFolderKind`, `PlanFoldersResponse`), file-declared plan metadata (`FilePlan`, `FilePlanPhase`, `ReportedStatus`, `PlanCompletion`, `SelectedPlanResponse`), bounded read enforcement at 64 KiB ceiling (`MAX_DOCUMENT_BYTES`), and strict path containment rejecting `..` traversal, absolute paths (`/`), and external URLs.
  - **Reactive Controllers (`WorkflowController.kt`, `ProjectPlansController.kt`):** Generation-fenced controllers with `ConnectionRef` tracking, CAS conflict warning preservation, auto-open on `PLAN` folder selection without re-entry loops, hierarchical back-navigation stack (`handleBack`), and filter states (project, status).
  - **Native UI Surfaces & Modals (`WorkflowPanelScreen.kt`, `WorkflowScreens.kt`, `WorkflowModals.kt`, `WorkflowSessionsAndEventsView.kt`, `ProjectPlanScreens.kt`):** Complete non-browser workflow tracking and project plans workbench. Sub-product switching between "Workflow Tracking" and "Project Plans", single horizontal panel navigation row, zero FABs, zero WebViews. Markdown/GFM preview (`MarkdownPreviewView`) with explicit unsupported Mermaid fallback exception. Explicit workspace-wide destructive purge confirmation dialog ("Purge All Workspace History") with RFC3339 timestamp validation.
- **Documented Open Limitations & Residuals (Deferred to Phase 18):**
  - **L1 (Device & Emulator Runtime Proof):** Verification completed in JVM unit test and Gradle build environments. Physical device/emulator validation for Compose recomposition performance, hardware gesture back handling, and long sessions deferred to Phase 18 (`phase-18-integrated-device-security-and-performance-qualification.md`).
  - **L2 (Watcher & Live Rebind Lifecycle):** Server watcher installation, filesystem change re-reading, and live socket rebind lifecycle validation across active project plan targets deferred to Phase 18 qualification.
  - **L3 (Cross-Feature Navigation & Evidence Links):** Terminal/agent link picker currently implemented as manual identifier input rather than session picker; direct navigation from plan evidence chips to editor/viewer not yet wired; deferred to Phase 18 qualification.
- **Handoff:** Phase 13 (Workflow tracking and project plans) completed with user approval. Phase 17 (Preferences privacy notifications and lifecycle) has prerequisite Phase 13 satisfied (prerequisites 07, 11, 13 satisfied; remaining prerequisites: Phases 14, 15, 16 pending). Phase 18 has prerequisite Phase 12 satisfied (Phase 17 pending). Physical hardware and live server qualification deferred to Phase 18.

## Success Criteria

- Manual lifecycle remains explicit; terminal observation never marks a workflow item/session done automatically.
- Concurrent edits surface conflicts; request identity is retained only where protocol permits replay.
- Plan routes remain read-only and status labels never imply verification; linked documents cannot escape selected target.
- Verification: run changed consumer behavior and record actual output/state; use [execution guide](./execution-guide.md). Compilation/tests alone do not satisfy native-surface acceptance.

## Risk Assessment

- Merging manual SQLite tracking and file-declared plans creates false state changes; keep repositories/UI labels distinct.
- Watcher registration races cause false live status; require installed coverage plus fresh read.

## Security Considerations

- No terminal transcript/prompts in workflow payloads/logs.
- Strict rooted reads/limits and original-owner cleanup remain server/native boundaries.

## Next Steps

Phase14/15/16 can proceed independently after their base dependencies; workflow joins Phase18 full-app qualification.

## Unresolved Questions

- Resolve this phase's dependency/device/license/capability decisions in the acceptance ledger before marking done; escalate retained requirements that cannot be met rather than narrowing scope.
