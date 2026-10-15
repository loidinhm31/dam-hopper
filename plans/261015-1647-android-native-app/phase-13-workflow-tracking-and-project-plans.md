# Phase 13 — Workflow tracking and project plans

## Context Links

- [Overview](./plan.md) · [scope and acceptance](./scope-and-acceptance.md) · [contracts/modules](./contracts-and-modules.md) · [execution guide](./execution-guide.md).
- [Proposed architecture](../../docs/architecture/android-native-client.md) · [reviewed research](./research/android-platform-research.md).
- Dependencies: [Phase 07](./phase-07-terminal-sessions-replay-input-and-agents.md), [Phase 09](./phase-09-native-editor-language-services-and-safe-saves.md)

## Overview

- Date: 2026-10-15. Priority: P2. Implementation status: **pending**. Review status: **pending**. Progress: **0%**.
- Scope: W01–W02.
- Goal: Deliver native manual workflow tracking and read-only project-plan overview/timeline/documents as distinct products.
- No implementation performed by this plan. Paths and commands below are future work; evidence must be observed, not inferred.

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
- `/home/loidinh/WS/worktrees/dam-hopper-android-native-app/native-app/shared/src/commonMain/kotlin/dev/damhopper/nativeapp/features/workflow/WorkflowRepository.kt`
- `/home/loidinh/WS/worktrees/dam-hopper-android-native-app/native-app/shared/src/commonMain/kotlin/dev/damhopper/nativeapp/features/workflow/WorkflowScreens.kt`
- `/home/loidinh/WS/worktrees/dam-hopper-android-native-app/native-app/shared/src/commonMain/kotlin/dev/damhopper/nativeapp/features/workflow/ProjectPlansRepository.kt`
- `/home/loidinh/WS/worktrees/dam-hopper-android-native-app/native-app/shared/src/commonMain/kotlin/dev/damhopper/nativeapp/features/workflow/ProjectPlanScreens.kt`

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

- [ ] Deliver manual workflow CRUD/sessions/notes/events.
- [ ] Deliver folder-first read-only project-plan views/watch lifecycle.
- [ ] Verify CAS/identity/read-only/reporting semantics.
- [ ] Update requirement/evidence ledger and affected docs after actual runtime proof; record device/server/version limitations.

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
