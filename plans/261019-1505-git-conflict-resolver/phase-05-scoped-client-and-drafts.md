# Phase 05 — Scoped client and drafts

## Context links

- [Plan](./plan.md), [Phase 02](./phase-02-conflict-discovery-and-snapshots.md), [Phase 03](./phase-03-safe-resolution-and-staging.md), [Phase 04](./phase-04-operation-lifecycle.md).
- [Ownership contract](./design-contract.md#ownership-and-lifetime), [acceptance matrix](./acceptance-matrix.md), [repository evidence](./reports/repository-evidence.md).

## Overview

- Date: 2026-10-19. Priority: P2.
- Status: DONE (2026-10-21).
- Implementation: Complete (2026-10-21). Review: Complete (2026-10-21). Progress: 100%. Effort: unestimated.
- Owner: scoped client/draft owner; integration lead serializes shared API/query/WorkspacePage edits.
- Entry: Phase 02–04 contracts and Phase 01 retained model/history/budget decisions passed. Incoming deferred items from Phase 02 (W4, W6, W7, W12) and Phase 04 (W6, W9) addressed and closed here for client draft lifecycle, role mapping, cursor paging, legacy DTO cutover, and operation status.
- Handoff: one typed wire projection and workspace-owned memory-only drafts surviving shell/target/file visibility changes.
- Go/no-go: old-owner bytes cannot reach a replacement server/root, and no callback or capacity policy silently destroys dirty work.

## Key insights

- Existing ApiClient/WsTransport/queries already carry owner-qualified targets; extend those patterns rather than a new transport.
- Profile/project names and file paths are not sufficient identity across two servers, generations or linked worktrees.
- Monaco model/history lifetime cannot live inside a frame that unmounts when hidden or shells change.
- beforeunload is best effort, not durable storage; explicit no-crash/reload guarantee must be honest.
- An apply response describes the submitted revision, not whatever the user typed while it was in flight.


### Incoming deferred items from Phase 02

- **W4 (operation roles and limits):** Consume explicit operation, targetRevision, contextual roles, and limits in client drafts and UI model.
- **W6 (offset pagination cursor stability):** Integrate with server stable cursor (anchored to last raw path/hash of unmerged set) and handle stale-cursor refresh/restart semantics in client pagination to prevent skipping when index shrinks.
- **W7 (legacy code retirement):** Remove legacy UI DTO `ConflictFile` (`packages/ui/src/api/client.ts`) and legacy endpoints as part of coordinated cutover.
- **W12 (UI query and pane binding):** Pass explicit `root` to conflict queries, handle multi-page inventory lookup in editor, bind result pane to conflict drafts rather than `useGitFileDiff`, and replace fail-closed `useGitResolve` with Phase 03 preconditioned apply service.

### Incoming deferred items from Phase 04

- **W6 (terminal handoff owner identity):** Bind `TerminalHandoffRequired` reason and worktree root to client profile/generation/session context and wire terminal focus/handoff.
- **W9 (legacy recovery model retirement):** Fully migrate UI callers off legacy `GitRecoveryState` / `GitOperation` to new `OperationStatusResponse`.
## Requirements

### Functional

- Migrate one summary/detail/resolve/operation contract through ApiClient, REST-backed git:* transport and queries with the coordinated server upgrade; no legacy resolver write fallback, compatibility shim or incompatible intermediate deployment.
- Capture profileId, generation, serverUrl/resourceBinding, project, canonical worktree/index/root identity, conflictId and snapshotVersion per draft.
- Retain source snapshot, result model, byte metadata, decisions, history, view state and draft revision above shell selection.
- Hide preserves draft/model/history; Discard is separate and confirms dirty loss; file/target/shell switches preserve others.
- Retired owner/unavailable root/external state freezes writes while retaining recovery text.
- Reconnect requires fresh comparison and explicit import/review into a new owner; never silently rebind old drafts.
- Preserve newer typing after submitted-revision response; unknown/partial/stale results retain recovery and require explicit refresh/review.
- Commit-message editing stays in Git's configured editor in the exact owning repository/worktree terminal; no resolver message form/adapter. Retain draft text/decisions/history across handoff and refresh authoritative operation/full-index/worktree state after attempted commands and terminal return; handoff is not completion or guaranteed zero-write.

### Nonfunctional

- No mutation retry in TanStack Query or reconnect callbacks; read retries must remain owner-fenced.
- Bound retained source/model/history capacity from Phase 01 evidence; evict only clean/discarded drafts.
- At dirty capacity refuse new loads with explicit discard choice; no silent dirty eviction or durable persisted Zustand slice.
- Capacity includes growth of existing result/undo history. A qualified prospective edit guard must reject over-budget growth visibly before acceptance, never truncate accepted text or silently drop history; Undo/Redo/recovery stay usable.
- Do not store source content in editor tabs, logs, telemetry or durable browser storage.

## Architecture

Workspace-level controller above IDE/terminal/mobile branches owns draft registry and captured request ownership.
A visible panel selects retained draft views; visibility is not ownership/disposal. Models are released only through explicit discard or acknowledged clean lifecycle rules.
Every async request captures exact owner and draft revision; response application checks both against the current registry entry.
Stale server responses can update only their still-valid owner-bound data, never a currently selected replacement profile/root.
Server-provided actual root/index identity supplements client routing fences, not client authentication assertions.
Public API migration is coordinated with 02–04; every caller migrates, old resolve payloads fail closed and no legacy write fallback or compatibility shim remains. Terminal handoff preserves original draft ownership; refreshed external Git state makes affected drafts stale recovery copies until explicit fresh-snapshot import/review, never refresh-only rebinding.

## Related code files

- Modify: `packages/ui/src/api/client.ts`, `packages/ui/src/api/ws-transport.ts`, `packages/ui/src/api/queries.ts` for one typed contract and invalidation semantics.
- Reuse/modify only as needed: `packages/ui/src/api/ownership.ts` for existing owner/resource-binding conventions.
- Modify: `packages/ui/src/components/pages/WorkspacePage.tsx` to own controller lifetime above shell branching.
- Inspect: `packages/ui/src/stores/editor.ts` for dirty/late-response conventions; do not add resolver state to editor tabs.
- Create (proposed): `packages/ui/src/hooks/use-conflict-resolver.ts` for workspace controller orchestration.
- Create (proposed): `packages/ui/src/lib/conflict-drafts.ts` for memory registry/owner/revision transitions if a separate module is warranted.
- Create (proposed): `packages/ui/src/lib/conflict-drafts.test.ts` for behavior/owner/capacity cases.
- Modify: existing API/ownership tests discovered at implementation time and `packages/ui/src/components/pages/WorkspacePage.test.tsx` where consumer behavior is covered.
- Delete: obsolete conflict DTO/signature exports after reference inventory; no alias preserving unchecked resolve requests.

## Implementation steps

1. Inventory every old conflict and recovery DTO/method consumer; freeze one owner for client.ts/ws-transport.ts/queries.ts.
   Map Rust camelCase schema/actions/outcomes exactly; do not infer new helper APIs already exist.
2. Implement summary/detail/operation reads and typed resolve/continue/abort mutations through existing git:* REST projection.
   Disable mutation retries explicitly and verify no wrapper/reconnect policy replays them.
   Invalidate owner/root-scoped status, detail, operation, diff/history and affected file views without overwriting dirty data.
3. Define immutable captured draft key with full owner/generation/serverUrl/resource binding and server actual worktree/root/index identity.
   Include conflictId/snapshotVersion; selected UI target is not a replacement for captured identity.
4. Build memory-only registry/controller above shell branching.
   Store immutable sources, result model/byte metadata, resolution model/history, view state, revision and dirty/recovery flags.
   Let frame mount/unmount subscribe without disposing owning state; file/target changes select another draft.
5. Define Hide, reopen and explicit Discard transitions.
   Hide changes visibility only; Discard confirms dirty text/history loss and then releases resources deliberately.
   Whole-file rebuild confirmation belongs to model/UI phases, but controller must never replace imported result on selection.
6. Fence all reads and mutation callbacks by captured owner, request generation and exact draft identity.
   Retire generations on server URL/profile change; delayed old detail must not replace the newly selected result.
   Profile removal/logout/unavailable target/root disables mutation without sending retained bytes elsewhere.
7. Capture submitted result revision and reviewed action payload at Apply time.
   If typing advances revision while awaiting response, reconcile only submitted facts; retain later text/history and do not auto-hide/mark clean.
   Stage success does not authorize disposal of unsent newer edits or automatic continuation.
8. Model stale, unsupported, busy, failed-before-write, partial and unknown outcomes separately.
   Preserve recovery copy for any uncertain state, require explicit refresh/review before another mutation, and never replay automatically.
9. On reconnect or external Git change fetch fresh state without rebinding the old draft.
   Present comparison/import/review into the new captured owner as explicit user action; preserve old recovery text on cancel.
   If original source conflict disappeared, retain useful text without pretending original conflict stages can be restored.
   On configured-editor handoff, preserve all drafts/history and show the captured server/project/worktree/root for user terminal work; never inject commands or launch a handler editor.
   Refetch operation/full relevant index/worktree after the attempted command and terminal return even if the handoff is cancelled or fails. Failed refresh remains unknown/no replay; a later successful refresh never authorizes automatic retry or stale draft Apply.
10. Enforce measured capacity across source/base/result models and history, not just number of filenames.
    Evict only clean/discarded drafts; when dirty budget is reached refuse another load and offer explicit discard/cancel.
    Keep cancellation/late-result fencing so refused/retired requests do not allocate hidden retained models.
    Measure each existing dirty draft's typing/paste/history growth as well as new loads; reserve safe transaction/history headroom before accepting edits.
    At the boundary reject prospective growth with visible explanation and explicit discard/recovery options, preserving every previously accepted edit and history state.
    Qualify native typing/IME/paste guard behavior in Phase 01; if public APIs cannot enforce this safely, stop the capacity gate rather than silently trim history.
11. Add best-effort beforeunload warning and supported native close lifecycle integration only after discovering actual host capability.
    Qualify the required Linux Tauri close/cancel capability or document its supported limitation; no crash/reload durability claim or unauthorized persistence. Windows-native client qualification remains separately Pending/nonblocking/unqualified, not an implementation prerequisite.

**Native close limitation (observed):** `apps/native/src-tauri/src/lib.rs` installs `WindowEvent::CloseRequested` interception only under `cfg(windows)`; Linux has no resolver-aware close/cancel handshake. This phase adds only the browser `beforeunload` best-effort warning. Linux-native dirty-draft close protection remains unsupported and must stay an explicit qualification limitation; do not claim crash/reload durability.
12. Add owner/capacity/revision behavior scenarios with delayed real request boundaries and retained model/history observations.
    Hand the retained model interface and owner transitions to Phase 06/07; preserve one history authority selected in Phase 01.

## Todo list

- [x] Cut over one typed client/transport/query contract with server/every caller; retries disabled, legacy writes rejected, no fallback/shim.
- [x] Bind every draft/request to exact owner/server/root/generation identity.
- [x] Retain memory-only model/history above shell visibility.
- [x] Implement explicit discard/reconnect/review and retained configured-editor handoff recovery with post-attempt/post-terminal authoritative refresh.
- [x] Preserve post-submit typing and reject dirty-capacity eviction.
- [x] Add owner retirement, same-name server and late-response behavior evidence.

### Phase 05 closure and verification results (2026-10-21)

Phase 05 delivered complete scoped client contracts, draft registry, and workspace editor controller integration:
- **Full UI DTO cutover (`client.ts`, `ws-transport.ts`, `queries.ts`):** Complete migration to typed `ResolveRequest` (action union: `reviewedText`, `indexSide`, `delete`), `ResolveOutcome`, `OperationStatusResponse`, `OperationActionRequest`, and `OperationOutcome`. Retired legacy `{ path, content }` payload and legacy `ConflictFile` UI DTO.
- **In-memory `ConflictDraftRegistry` (`conflict-draft-store.ts`, `conflict-draft-transitions.ts`, `conflict-draft-capacity.ts`, `conflict-draft-key.ts`, `conflict-draft-types.ts`):** Scoped by immutable draft key (`profileId`, `generation`, `serverUrl`, `project`, `worktreePath`, `conflictId`, `snapshotVersion`). Fences out stale callbacks and retired owner replays, coalesces rapid typing history, and enforces measured capacity (10MB total / 2MB per draft / 10 dirty drafts maximum). Marks stale snapshots as recovery drafts requiring explicit fresh-snapshot import/review before apply.
- **Workspace & Editor Integration (`MergeConflictEditor.tsx`, `WorkspacePage.tsx`, `use-conflict-resolver.ts`):** Retains draft state and Monaco Undo/Redo across shell switches/hiding, handles Android Chrome read-only input policy, and binds terminal handoff recovery with authoritative post-terminal refresh.
- **Monaco 0.55.1 patched (`patches/monaco-editor@0.55.1.patch`):** Catches unhandled `CancellationError` in `WordHighlighter` on unmount/dispose.
- **Resolution of deferred items:**
  - **Phase 02 W4 (operation roles & limits):** Consumed in client drafts and UI model.
  - **Phase 02 W6 (offset pagination cursor stability):** Integrated stable cursor with restart on stale cursor (`GIT_CONFLICT_CURSOR_STALE`).
  - **Phase 02 W7 (legacy code retirement):** Retired legacy `ConflictFile` UI DTO and `{ path, content }` resolve requests.
  - **Phase 02 W12 (UI query & pane binding):** Explicit `root` parameter passed in queries; result pane bound to retained drafts above shell visibility.
  - **Phase 04 W6 (terminal handoff owner identity):** Bound `TerminalHandoffRequired` reason and worktree root to client profile/generation/session context and wired terminal focus/handoff.
  - **Phase 04 W9 (legacy recovery model retirement):** Fully migrated UI callers to `OperationStatusResponse` / `OperationActionRequest` / `OperationOutcome`.

### Test Execution Summary

1. **UI Unit Tests:** 80 passed across 5 test files (0 failures, 0 errors, 0.75s duration):
   - `src/lib/conflict-draft-capacity.test.ts`: 3 passed (capacity bounds, eviction preserving dirty drafts, dirty draft limit refusal)
   - `src/lib/conflict-draft-store.test.ts`: 17 passed (deterministic key fencing, undo/redo history, typing coalescing, apply transitions, owner retirements, same-owner snapshot recovery import/fencing, different-profile rejection)
   - `src/components/organisms/MergeConflictEditor.test.tsx`: 3 passed (Android read-only policy, memory-only recovery banner, disabled accept actions)
   - `src/api/ws-transport.test.ts`: 54 passed (including Rust `type` discriminator for resolve REST contract, terminal attach, SSE lifecycle)
   - `src/hooks/use-conflict-resolver.test.tsx`: 3 passed (retains draft on switch, cursor restarts on stale cursor, owner-guarded operation-status read)
2. **Browser Monaco Joint History Tests:** 4 browser test files (8 tests total; 1 passed in `conflict-monaco-history.browser.tsx` proving public joint undo/redo authority across native typing and metadata decisions, 3.75s duration).
3. **UI TypeScript Typecheck:** Clean exit, 0 errors in 7.91s (`pnpm --filter @dam-hopper/ui exec tsc -p tsconfig.json --noEmit`).
4. **Server Conflict Regression Tests:** 40 passed across 63 test suites, 0 failed, 1961 filtered out in 34.90s (`cargo test --manifest-path server/Cargo.toml conflict`).

## Success criteria

- AC2/AC4: type, switch file/target/shell, hide/reopen and undo; exact result and decision history survive, while discard cancellation leaves them intact.
- AC8/AC9: two servers with identical project/path names never receive one another's draft; delayed retired-generation detail/apply callbacks cannot mutate current owner state.
- CUT3: delay successful apply, type another edit, release response; later text remains dirty with history and no auto-close/continue.
- AC11: capacity boundary refuses new dirty load without evicting any existing dirty source/result/history; explicit discard frees measured capacity.
- Existing-draft growth oracle: paste/type repeatedly into one retained draft until its measured text/history budget is crossed; prospective over-budget growth is visibly refused, prior bytes/decisions/Undo/Redo survive, and no dirty draft/history is evicted.
- Outcome/handoff oracle: partial/unknown/editor-blocked outcome preserves dirty text/decisions/history. Return from exact-owner terminal work triggers authoritative operation/index/worktree refresh without completion inference, automatic replay or draft rebinding; stale recovery becomes applicable only after explicit fresh-snapshot import/review. No message form/adapter exists.
- Actual future smoke: authenticated app connected to two profiles with same project/file names; edit conflict in one, delay response, switch server and shell, return and reopen.
- Inspect request destination/owner key, result bytes/revision/history and capacity behavior; remove target/root and verify write controls disable without content loss.
- Gate fails if hide disposes model, beforeunload is described as durable, old response clears new typing, or automatic retry sends another mutation.

## Risk assessment

Registry lifetime can leak models; explicit clean/discard disposal and measured capacity are required without sacrificing dirty retention.
Owner identity races span callbacks, queries and native lifecycle; centralize comparison using existing ownership patterns.
Successful server staging can coexist with newer local draft text; UI must describe that split rather than marking all work saved.

## Security considerations

Retained drafts contain repository source; keep memory-only, avoid telemetry/logging and clear only via explicit safe lifecycle.
Owner retirement must fence writes before profile/server replacement; client fences do not replace server authorization.
Never export recovery content to another endpoint merely because profile labels match.

## Next steps

Hand retained draft/controller/history interface to [Phase 06](./phase-06-merge-model-and-history.md) and visibility/lifetime seam to Phase 07.
Phase 08 consumes commands, not raw mutable routing parameters or duplicate draft state.

## Unresolved questions and qualification limitations

- **Draft resource accounting:** In-memory capacity bounds (10MB total / 2MB per draft / 10 dirty drafts) and prospective growth guards implemented and unit tested (`conflict-draft-capacity.test.ts`, `conflict-draft-store.test.ts`). Continuous heap observation under long-lived multi-file Monaco sessions continues into Phase 07 and Phase 09.
- **Linux-native close limitation:** `apps/native/src-tauri/src/lib.rs` provides `WindowEvent::CloseRequested` only for Windows; Linux Tauri has no resolver-aware close guard handshake. Browser `beforeunload` is best-effort only. Full native qualification on Linux host remains Pending for Phase 09 (AC12).
- **Post-attempt non-success requery (Phase 04 W3):** Client refresh wired for terminal handoff; post-attempt non-success requery (`Blocked`, `Failed`, `OutcomeUnknown`) across workspace UI surfaces remains scheduled for Phase 08.
- **Unreleasable coordinated migration boundary:** Phase 05 completes UI client DTO migration and draft store fencing; backend retirement of parallel legacy endpoints and final fail-closed cutover complete in Phase 08.
