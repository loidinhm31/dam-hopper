# Native editor and file explorer

Status: **approved design**. User explicitly selected “Approve this design” in this brainstorm. Approval authorizes this record only; no implementation or planning consent implied.

## Problem and final artifact

`apps/web/` hosts shared React UI from `packages/ui/`. Android `native-app/` is Kotlin Multiplatform/Compose, not the Tauri `apps/native/`. Its active root exposes login → projects → terminal; retained Files/Editor modules are not reachable. The visible native editor is a Compose `TextField`; the recorded Sora adapter is an in-memory model, not a mounted code editor.

Approved implementation artifact: a reachable project workspace with Terminal / Files / Editor, real remote filesystem operations and a native code-editor widget, preserving the current terminal implementation. This brainstorm does not implement that artifact.

## Agreed scope and constraints

User choices: **Editing + file management** and **Native code editor**.

In scope:
- Lazy tree expansion, hidden-file toggle, refresh, selection, create file/folder, rename, move, confirmed delete, copy remote path.
- Target-scoped tabs, line numbers, syntax highlighting, selection, undo/redo, in-file find, dirty indicators, conditional saves and conflicts.
- Loading, empty, disconnected, unavailable-target and unsupported-file states.
- Lifecycle, ownership, watcher and save-race corrections necessary for these behaviors.

Out of scope for this increment:
- Upload/download, project-wide search/replace, Git/diff/blame, rich previews, TypeScript semantic services/LSP, durable offline drafts.
- Backend changes, WebView, framework migration, local device filesystem editing, unrelated dormant workbench panels.

Constraints:
- Reuse KMP shared state, Android-only widget integration and existing REST/WebSocket transports; no parallel file API.
- Existing platform baseline: Java 17, Android minSdk 29, arm64-v8a and x86_64.
- One inline navigation row below the project header, one visible content area on phone/tablet, no FAB or second navigation surface.
- Scope is an increment, not replacement of the broader approved native release contract. Existing preview/language-service release requirements are not declared satisfied or deleted.
- No deadline or staffing constraint supplied. No estimate asserted.

## Alternatives and decision

| Approach | Benefit | Trade-off / rejection |
| --- | --- | --- |
| Focused native integration — selected | Reuses existing feature modules without exposing unrelated panels | Must correct lifecycle, ownership and synchronization gaps |
| Mount retained 12-panel workbench | Existing Files→Editor wiring | Broadens scope; retains known generation/event/lifecycle gaps and older terminal wiring |
| Embed React/Monaco web UI | Direct web UI reuse | Violates no-WebView constraint; rejected |

## Design and interfaces

### Project workspace

Keep login → project list → project workspace. Use a focused host around the current terminal screen and reusable files/editor components. Terminal / Files / Editor are project-local panel state, not separate authentication flows. Opening a file selects Editor. Switching panels retains tree position, editor documents and selected PTY; only the visible panel accepts input. Preserve current Back hierarchy, with dirty-state resolution before destructive workspace departure.

The shared host owns feature lifetimes independently of visible-panel composition. Configuration recreation retains document state; widgets release resources at actual lifecycle end. Do not mount the monolithic retained workbench simply to obtain its Files→Editor callbacks.

### Native editor and document authority

Preferred candidate: Sora `CodeEditor`, via Android-only Compose bridge. Shared Kotlin retains target identity, saved baseline, dirty/revision/save state. The editor document owns interactive changes and undo history; toolbar actions use that same authority, not a competing shared snapshot stack.

Apply incremental edits. Recomposition must not call full-document replacement. Explicit load/reload is a revision-controlled document replacement with defined undo reset. Retain documents, undo, cursor/selection and scroll across panel changes and rotation; do not retain an Activity-bound widget beyond its lifecycle. IME behavior is a device qualification gate.

Syntax highlighting is not semantic language-service parity. Unsupported grammars remain explicitly plain text, not fabricated diagnostics or completion.

Recorded candidate `0.23.4` exists and is upstream-marked prerelease. Verify exact version-specific Maven coordinates and compatibility; do not combine current documentation coordinates with the older pin. No silent version upgrade. Dependency resolution, mounted widget behavior, language-module compatibility and LGPL distribution/relinking obligations are implementation/release gates.

### Target and asynchronous ownership

Every file action captures profile, connection generation, project/worktree and relative path. Every tab callback also captures tab/session incarnation and appropriate revision watermark. Reject retired owner responses and results from a closed/reopened incarnation, including loads, reloads, saves and diagnostics.

Retain buffers across panel switches and ordinary reconnect. Retire old transport authority immediately. Rebind only to the exact same logical target and reconcile current server metadata before enabling writes. Never retarget a dirty document to the newly selected profile/project.

### Explorer and live synchronization

Reuse `FileRepository`, `FileTreeState`, tree screens and mutation coordinator. Preserve virtualized rows and lazy fetching.

The server watches directories nonrecursively. Share watches for expanded directories and open-file parent directories; route each event by subscription ID, socket lifetime and captured target. Reconcile snapshot/event ordering so delayed listings cannot overwrite newer changes. Bound event buffering; overflow and reconnect trigger refetch of relevant loaded directories. Pause watches while backgrounded and reconcile on foreground return.

### Mutations and document identity

Coordinate rename/move/delete with in-flight saves for the affected file or directory descendants. Resolve dirty affected documents before destructive mutations. Publish tab-key/session-path/selection/watcher changes only after confirmed server success. Failed operations retain original identity. Successful rename/move preserves coherent document identity; remote deletion preserves dirty text as unavailable and cannot silently recreate the file.

Use existing server mutation/path protections; do not add new server behavior or bypass root/protected-path rejection. Move is an explicit touch-friendly operation, not required drag/drop parity.

### Saves and dirty-state safety

Normal writes use the observed mtime. Conflict actions: Reload / Explicit overwrite / Cancel. Explicit overwrite probes fresh metadata and remains conditional. Edits made after the submitted snapshot stay dirty when that save completes.

Unknown post-submission outcomes retain local edits and require server reconciliation, not automatic retry/overwrite. Dirty close or project/profile exit offers Save / Discard / Cancel; Save must succeed before destructive departure. Authentication/transport loss revokes writes without silently destroying buffers. Durable process-death recovery is excluded; do not claim in-memory retention survives process termination.

Encryption is a client-selected mode in the inspected web context, not an established server-enforced project policy. Do not invent a policy service. Preserve existing explicit encrypted-request safety: a missing/invalid owner-bound crypto session blocks that request, never downgrades to plaintext. No new OPAQUE enrollment/transfer feature in this increment; do not advertise encrypted-save readiness without its separate proven prerequisites.

### File tiers

Retain existing tiers: normal below 1 MiB; degraded from 1 MiB to below 5 MiB; read-only range view from 5 MiB. Binary/media classification takes precedence. Provide noneditable notices for unsupported file types; rich previews are excluded. Invalid text must not be lossy-decoded and saved as corrupted content. Bound retained document memory separately from remote file size; no whole-file load for the range tier.

## Likely touchpoints

- Shared `ui/screens/DamHopperMobileApp.kt`, `ui/flow/AppFlowState.kt`, `AppFlowNavigation.kt`: reachable project panels and lifecycle boundaries.
- Current project terminal screen/controllers: retain session and input isolation; avoid older workbench terminal cutover.
- `features/files/`: `FileRepository`, `FileTreeState`, `FileTreeSubscription`, `FileMutationCoordinator`, tree/action screens.
- `features/editor/`: `EditorTabsState`, `EditorSession`, `EditorRepository`, `EditorTabSaveCoordinator`, `NativeTextEditorView`, editor screens/toolbars. Replace obsolete model-only adapter behavior on the active path rather than preserving duplicate editing authorities.
- Android `platform/editor/AndroidEditorSurface.kt`, platform host injection, dependency declarations and `gradle/libs.versions.toml`; native widget/language resources and notices.
- Existing files/editor/flow behavioral tests and actual Android device journeys; no static source assertions as feature proof.
- `native-app/README.md`, `docs/architecture/android-native-client.md`, `docs/android-native-acceptance.md`, project changelog as appropriate after implementation.
- External systems: existing Rust server filesystem APIs and Sora/Maven distribution. No new server daemon or database dependency.

## Acceptance and validation

All below are future implementation acceptance checks, **not executed results**:

1. Installed Android app: authenticate/select project → Files → expand nested folder → open text → edit → save → close/reopen. Read server bytes to establish correct target and content.
2. Create file/folder, rename, move, copy path and confirmed delete work through real server APIs. Tree and open tabs reconcile, including moved directory descendants. Failed mutations do not change local identities.
3. Multiple files retain correct buffers, undo, selection and dirty state across panel changes and rotation. Reopening an existing file focuses its tab. Closing a dirty file supports Save / Discard / Cancel without losing edits on save failure.
4. External modifications refresh clean tabs or mark dirty tabs stale. Normal save conflicts do not overwrite remote content; explicit overwrite and reload behave as described.
5. Exercise edit-during-save, close/reopen-during-load, rename/delete-during-save, reconnect-during-save and post-commit timeout. No stale callback or old incarnation changes current state; unknown outcomes reconcile before retry.
6. Identical paths in different profiles/projects/worktrees stay isolated. Connection-generation retirement rejects old callbacks and writes while retaining appropriate local buffers.
7. Nested changes update expanded folders/open documents. Background/foreground, socket replacement and watcher overflow restore current state without duplicate subscriptions or unbounded queues.
8. Test multiline IME composition, selection, paste, undo/redo, in-file find and keyboard focus on a real widget. Hidden terminal/editor receives no input; current PTY/session remains intact across panel changes.
9. Exercise just below/at 1 MiB and 5 MiB, binary/media and invalid text. Read-only/unsupported paths cannot save or accidentally load full large files. Encrypted requests without valid sessions send no plaintext fallback.
10. Build the selected exact dependency set, qualify Android 29 compatibility and relevant emulator/device ABIs, record visual/IME evidence and satisfy distribution obligations before release.

Use focused deterministic tests for meaningful state/race boundaries, then actual active-root server-backed Android journeys. Build/unit success alone does not prove mounted editor or application integration.

## Feasibility and stakeholder impact

Source-backed feasibility: existing remote repositories, tabs, save coordinator and screens provide reusable foundations; Sora exposes relevant native editing features and upstream requirements fit the Java17/minSdk29 baseline. This is not a two-button wiring task: watcher coverage, document authority and lifecycle/data-safety gaps require real integration work.

Users gain a coherent browse/manage/edit loop without unrelated panels. Developers retain one native architecture and transport model. Operators gain no new service requirement. Distribution owners must resolve editor/language asset licensing and release packaging.

## Evidence and limits

Both read-only scouts reached terminal completion: WebEditorExplorer and NativeEditorExplorer. Parent inspected relevant source and upstream docs; Advisor reviewed the proposal. No product code changed, no build/test/device/server journey run. No runtime qualification or full web/native parity claimed.

Repository evidence:
- `apps/web/src/main.tsx:1-58`: shared web host.
- `packages/ui/src/components/organisms/FileTree.tsx:333-405,605-839`: tree activation and mutations.
- `packages/ui/src/stores/editor.ts:575-742,891-1110`: target-scoped opens and conditional saves.
- `packages/ui/src/contexts/EncryptContext.tsx:1-15,52-65,113-143`: ephemeral owner/project encrypted mode, not server policy.
- `native-app/shared/src/commonMain/kotlin/dev/damhopper/nativeapp/ui/screens/DamHopperMobileApp.kt:71-109,147-203`: active root and generation-aware repository construction.
- `native-app/shared/src/commonMain/kotlin/dev/damhopper/nativeapp/features/editor/NativeTextEditorView.kt:27-98`: current Compose input.
- `native-app/shared/src/commonMain/kotlin/dev/damhopper/nativeapp/features/editor/EditorTabsState.kt:65-110,132-188`: tab loading, unguarded closes, saves/reloads.
- `native-app/shared/src/commonMain/kotlin/dev/damhopper/nativeapp/features/editor/EditorTabSaveCoordinator.kt:16-53`: submitted snapshot handling.
- `native-app/shared/src/commonMain/kotlin/dev/damhopper/nativeapp/features/files/FileTreeState.kt:55-99,142-185`: root watch and recovery.
- `native-app/shared/src/commonMain/kotlin/dev/damhopper/nativeapp/features/files/FileMutationCoordinator.kt:45-132`: mutations currently refresh directories.
- `native-app/androidApp/build.gradle.kts:63-80`: no Sora dependency declared.
- `server/src/fs/watcher.rs:181-192`: nonrecursive watches.
- `docs/architecture/android-native-client.md:37-49,130-151`: existing shell constraints, file tiers, native editor candidate and semantic-service blocker.

Primary external evidence:
- [Version-specific Sora README](https://github.com/Rosemoe/sora-editor/blob/0.23.4/README.md): capabilities, historical Maven group badge, LGPL-2.1-or-later.
- [Sora 0.23.4 release](https://github.com/Rosemoe/sora-editor/releases/tag/0.23.4): real release; API metadata marks prerelease.
- [Current getting-started guide](https://project-sora.github.io/sora-editor-docs/guide/getting-started): widget lifecycle, Java/API baseline, current coordinates and TextMate desugaring guidance; not proof of the older pin's exact requirements.

Documentation helper found no Context7 index; used primary upstream repository/documentation fallback. No helper installation or script modification.

## Planning status

User explicitly selected **Defer planning** after approving the design. No planner/router invoked; no implementation plan created by this brainstorm. Existing suggested Android plan is context only, not a selected or newly completed plan. Next: decision-summary journal, then await a later explicit planning request.

## Remaining risks, assumptions and questions

- Integration gates: exact Sora dependency/version compatibility, mounted IME/performance, language assets/licenses and LGPL obligations. Failure requires explicit design revision, not a silent basic-text fallback.
- Assumption: retain normal/degraded file tiers only where widget/device qualification supports them; any threshold change requires explicit approval.
- In-memory drafts do not survive process death. No persistence guarantee implied.
- No unresolved product-scope or planning-consent question. Planning explicitly deferred.
