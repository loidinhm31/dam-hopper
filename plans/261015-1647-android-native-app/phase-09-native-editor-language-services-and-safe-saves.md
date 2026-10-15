# Phase 09 — Native editor language services and safe saves

## Context Links

- [Overview](./plan.md) · [scope and acceptance](./scope-and-acceptance.md) · [contracts/modules](./contracts-and-modules.md) · [execution guide](./execution-guide.md).
- [Proposed architecture](../../docs/architecture/android-native-client.md) · [reviewed research](./research/android-platform-research.md).
- Dependencies: [Phase 05](./phase-05-native-terminal-editor-and-crypto-proof-gates.md), [Phase 08](./phase-08-filesystem-watchers-search-and-replace.md)

## Overview

- Date: 2026-10-15. Priority: P2. Implementation status: **pending**. Review status: **pending**. Progress: **0%**.
- Scope: E01–E02, F02, M01 text/large/binary.
- Goal: Implement retained native editor behavior, current language services and conservative save/recovery state.
- No implementation performed by this plan. Paths and commands below are future work; evidence must be observed, not inferred.

## Key Insights

- Only browser-rendered HTML/Mermaid preview is waived; language services/minimap/folding and safe editing are not.
- Current persisted editor metadata excludes dirty bytes; process restoration is not permission to write plaintext drafts.

## Requirements

- Native editor model/tab/view state, find/replace/undo/folding/minimap/gutters/zoom/shortcuts and JSON/TS behavior inventory.
- Dirty/stale/conflict/unavailable/resource-binding states, mtime safe saves/reload/explicit overwrite and clean-only automatic reload.
- Normal/degraded/large/binary routing, native Markdown/GFM and explicit source-only HTML/Mermaid treatment.

## Architecture

EditorSession owns qualified document/modelVersion/edit epoch, saved baseline and view state; AndroidEditorSurface provides proven platform geometry/input/undo hooks. LanguageService results carry document/version/owner; encrypted save delegates to Phase11 CryptoSession.

## Related Code Files

Existing references (read/reuse contracts; no server/web modification by default):
- `/home/loidinh/WS/worktrees/dam-hopper-android-native-app/packages/ui/src/components/organisms/MonacoHost.tsx`
- `/home/loidinh/WS/worktrees/dam-hopper-android-native-app/packages/ui/src/components/organisms/EditorTabs.tsx`
- `/home/loidinh/WS/worktrees/dam-hopper-android-native-app/packages/ui/src/stores/editor.ts`
- `/home/loidinh/WS/worktrees/dam-hopper-android-native-app/packages/ui/src/lib/monaco-setup.ts`
- `/home/loidinh/WS/worktrees/dam-hopper-android-native-app/packages/ui/src/lib/file-tier.ts`
- `/home/loidinh/WS/worktrees/dam-hopper-android-native-app/packages/ui/src/components/organisms/LargeFileViewer.tsx`
- `/home/loidinh/WS/worktrees/dam-hopper-android-native-app/docs/architecture/workbench-files-editor-and-git.md`

Proposed implementation files (create unless introduced earlier; modify thereafter):
- `/home/loidinh/WS/worktrees/dam-hopper-android-native-app/native-app/shared/src/commonMain/kotlin/dev/damhopper/nativeapp/features/editor/EditorSession.kt`
- `/home/loidinh/WS/worktrees/dam-hopper-android-native-app/native-app/shared/src/commonMain/kotlin/dev/damhopper/nativeapp/features/editor/EditorRepository.kt`
- `/home/loidinh/WS/worktrees/dam-hopper-android-native-app/native-app/shared/src/commonMain/kotlin/dev/damhopper/nativeapp/features/editor/EditorTabsState.kt`
- `/home/loidinh/WS/worktrees/dam-hopper-android-native-app/native-app/shared/src/commonMain/kotlin/dev/damhopper/nativeapp/features/editor/LanguageService.kt`
- `/home/loidinh/WS/worktrees/dam-hopper-android-native-app/native-app/shared/src/commonMain/kotlin/dev/damhopper/nativeapp/features/editor/FileTierPolicy.kt`
- `/home/loidinh/WS/worktrees/dam-hopper-android-native-app/native-app/shared/src/commonMain/kotlin/dev/damhopper/nativeapp/features/editor/EditorScreens.kt`
- `/home/loidinh/WS/worktrees/dam-hopper-android-native-app/native-app/androidApp/src/main/kotlin/dev/damhopper/nativeapp/platform/editor/AndroidLanguageService.kt`

No deletion of existing web/Tauri hosts or unrelated files. Any necessary backend contract change requires a documented design/compatibility review before code.

## Implementation Steps

1. Use Phase05 selected editor/language implementation, not a simpler text field. Build qualified stable document keys and independent models/view state for same paths across profiles/worktrees.
2. Implement editing/undo/redo/find/replace/selection/navigation/shortcuts and current normal/degraded features, including line numbers/glyph margin/folding/minimap/independent editor font where in baseline.
3. Deliver proven current JSON/TS/JS diagnostics/completion/navigation behavior; cancel and discard results after model version/edit epoch/owner changes. Missing native service remains blocking, not silently syntax-only.
4. Implement read/saved baseline/dirty/stale/target-unavailable state; current mtime guarded write_begin/chunk/commit, reload and explicit force-overwrite conflict UI; do not automatically resubmit an uncertain commit.
5. On watcher/Git invalidation reload clean tabs only; keep dirty content with stale notice. Endpoint/account replacement detaches old bindings and prevents stale-owner saves.
6. Implement exact 1MiB/5MiB tier boundaries, 64KiB range large-file viewer and binary route, native Markdown/GFM/edit/preview modes; HTML source stays editable and Mermaid fences show clear render-unavailable notice.
7. Persist only eligible navigation/tab metadata; preserve live editor state on rotation/navigation and show honest unsaved-data loss/recovery semantics after process death. Wire encryption toggle to mandatory Phase11 path without plaintext fallback.
8. Exercise unsaved edits across navigation/profile change, external modifications and conflict choices, UTF8/EOL boundaries, normal/degraded/large thresholds, IME composition and language-result races.

## Todo List

- [ ] Deliver native editor/language-service parity inventory.
- [ ] Implement target-bound safe saves and tab state.
- [ ] Exercise tier/render exceptions and real concurrent file scenarios.
- [ ] Update requirement/evidence ledger and affected docs after actual runtime proof; record device/server/version limitations.

## Success Criteria

- Native editor reproduces retained behavior with real remote files and named IMEs; only approved preview exclusions differ.
- Dirty content is never overwritten by late remote reads; old endpoint/owner cannot save into a replacement profile.
- At size boundaries actual route/read behavior matches baseline; large-file viewing remains read-only and bounded.
- Verification: run changed consumer behavior and record actual output/state; use [execution guide](./execution-guide.md). Compilation/tests alone do not satisfy native-surface acceptance.

## Risk Assessment

- Editor completion/highlighting is not worker-language-service parity; Phase05 decisions must be concrete.
- Model disposal/undo and layout callbacks can race target changes; version/owner fences are required.

## Security Considerations

- No plaintext dirty-byte persistence or secret/file-body diagnostics introduced without explicit approved design.
- Encrypted-mode save remains disabled-with-reason until valid owner-bound crypto session, never silently plaintext.

## Next Steps

Phase10 completes diff/merge/blame and Phase11 encrypted-save/media; editor is not release-complete before those retained paths pass.

## Unresolved Questions

- Resolve this phase's dependency/device/license/capability decisions in the acceptance ledger before marking done; escalate retained requirements that cannot be met rather than narrowing scope.
