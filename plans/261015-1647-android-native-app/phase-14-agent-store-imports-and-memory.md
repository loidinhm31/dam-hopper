# Phase 14 — Agent Store imports and memory

## Context Links

- [Overview](./plan.md) · [scope and acceptance](./scope-and-acceptance.md) · [contracts/modules](./contracts-and-modules.md) · [execution guide](./execution-guide.md).
- [Proposed architecture](../../docs/architecture/android-native-client.md) · [reviewed research](./research/android-platform-research.md).
- Dependencies: [Phase 09](./phase-09-native-editor-language-services-and-safe-saves.md)

## Overview

- Date: 2026-10-15. Priority: P2. Implementation status: **pending**. Review status: **pending**. Progress: **0%**.
- Scope: S01–S02.
- Goal: Deliver all current server-owned Agent Store distribution/import and agent memory-management flows.
- No implementation performed by this plan. Paths and commands below are future work; evidence must be observed, not inferred.

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

Proposed implementation files (create unless introduced earlier; modify thereafter):
- `/home/loidinh/WS/worktrees/dam-hopper-android-native-app/native-app/shared/src/commonMain/kotlin/dev/damhopper/nativeapp/features/agents/AgentStoreRepository.kt`
- `/home/loidinh/WS/worktrees/dam-hopper-android-native-app/native-app/shared/src/commonMain/kotlin/dev/damhopper/nativeapp/features/agents/AgentStoreScreens.kt`
- `/home/loidinh/WS/worktrees/dam-hopper-android-native-app/native-app/shared/src/commonMain/kotlin/dev/damhopper/nativeapp/features/agents/AgentImportController.kt`
- `/home/loidinh/WS/worktrees/dam-hopper-android-native-app/native-app/shared/src/commonMain/kotlin/dev/damhopper/nativeapp/features/agents/AgentMemoryRepository.kt`

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

- [ ] Deliver complete catalog/distribution/import/memory UI.
- [ ] Preserve reviewed mutation and partial-failure semantics.
- [ ] Observe real server filesystem outcomes and isolation.
- [ ] Update requirement/evidence ledger and affected docs after actual runtime proof; record device/server/version limitations.

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
