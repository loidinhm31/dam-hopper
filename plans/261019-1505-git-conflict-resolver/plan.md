---
title: "Git conflict resolver implementation plan"
description: "Deliver a safe shared floating Git resolver with lossless drafts and qualified operation recovery."
status: in-progress
priority: P2
effort: null
branch: main
tags: [feature, frontend, backend, api]
created: 2026-10-19
---

# Git conflict resolver

## Overview and authority

Phase 01 (Feasibility and contract gates), Phase 02 (Conflict discovery and snapshots), Phase 03 (Safe resolution and staging), Phase 04 (Operation lifecycle), Phase 05 (Scoped client and drafts), Phase 06 (Merge model and history), Phase 07 (Floating Monaco surface), and Phase 08 (Workspace integration and cutover) complete (2026-10-21). Phase 02 (Conflict discovery and snapshots), Phase 04 (Operation lifecycle), Phase 07 (Floating Monaco surface), and Phase 08 (Workspace integration and cutover) administratively closed with accepted deferrals (2026-10-19, 2026-10-20, and 2026-10-21). Phase 03 delivered typed preconditioned mutation (`POST /api/git/{project}/resolve`), truthful `ResolveOutcome` taxonomy, application-wide `GitMutationCoordinator` across 14 writers, CUT1 generic stage preflight, and retired legacy Rust resolver. Phase 04 delivered authoritative operation detection and stage roles (`GET /api/git/{project}/operation`), guarded continue/abort lifecycle (`POST /api/git/{project}/operation`), truthful `OperationOutcome` taxonomy, bounded noninteractive runner with editor sentinel detection, and terminal handoff contract with accepted deferrals. Phase 05 delivered full UI DTO cutover, owner-bound in-memory `ConflictDraftRegistry` with measured capacity and recovery draft lifecycle, `useConflictResolver` integration across `MergeConflictEditor.tsx` and `WorkspacePage.tsx`, and patched Monaco 0.55.1 unmount/cancellation safety. Phase 06 delivered lossless line tokenization, deterministic diff3 source regions, conservative imported-result mapping, atomic text+metadata decisions, confirmed whole-file actions, unified draft history with decision snapshots, and Monaco Chromium browser qualification. Phase 07 delivered shared floating `ConflictResolverPanel` host in `WorkspacePage` above shells, unified `floatingPanelStack` identity and z-index ordering across `WorkspacePage` and `TerminalWorkspaceShell`, scoped Escape key arbitration, responsive narrow tabbed mode (Theirs/Result/Ours/Base), exact region-id action binding on non-stable conflict blocks, in-memory model paths, and Chromium browser tests. Phase 08 delivered single-source conflict reveal intent routing (`buildConflictRevealIntent`, `deriveAggregateConflictRoot`), row click and operation banner integration in `ChangedFilesList`, floating `ConflictResolverPanel` activation with nonce de-duplication (`lastConsumedNonceRef`), CUT1 generic staging bypass closure in UI and `server/src/git/diff.rs` under `GitMutationCoordinator` lock, CUT2 retirement of legacy `conflict-parser.ts` and `ConflictBlock` exports, legacy `{ path, content }` payload rejection (`LEGACY_PAYLOAD_REJECTED`), truthful action presentation, configured-editor terminal guidance without message adapter, and Android read-only policy preservation, with live-daemon multi-worktree smoke testing handed off to Phase 09. Phase 09 remains.

Build one workspace-owned floating resolver for terminal-started merge/rebase/cherry-pick/revert and index conflicts. Immutable sources/base, editable retained result, full reviewed decisions, explicit Apply & stage, separate Continue/Abort, truthful unsupported/partial/unknown outcomes. Initial release qualification requires web and actual Linux-native runtime evidence; Windows-native remains explicitly unqualified until separately tested.

Authority: [validated decisions](#validation-summary), [design contract](./design-contract.md), [acceptance matrix](./acceptance-matrix.md), [repository evidence](./reports/repository-evidence.md), [Git semantics](./research/git-semantics.md), [merge model](./research/merge-model.md), [validation record](./reports/plan-validation.md). The [brainstorm](../reports/brainstorm-261019-1326-git-conflict-resolver.md) remains historical; these decisions supersede its generic qualification scope and closing refusal to plan.

No editor-tab/DiffViewer integration, operation initiation, auto-continue/skip, AI merge, private workbench code, durable draft store, config/hook/signing bypass, resolver commit-message form/adapter, new service or legacy write fallback/compatibility shim. Binary whole-side and delete/modify are required; complex unsupported entries stay visible with handoff. Shared web/native architecture is unchanged.

## Phases — authoritative status table

| # | Phase | Depends on | Implementation | Review | Progress |
| --- | --- | --- | --- | --- | --- |
| 01 | [Feasibility and contract gates](./phase-01-feasibility-and-contract-gates.md) | None | Complete | Complete | 100% |
| 02 | [Conflict discovery and snapshots](./phase-02-conflict-discovery-and-snapshots.md) | 01 | Complete* | Complete* | 100% |
| 03 | [Safe resolution and staging](./phase-03-safe-resolution-and-staging.md) | 02 | Complete | Complete | 100% |
| 04 | [Operation lifecycle](./phase-04-operation-lifecycle.md) | 03 | Complete* | Complete* | 100% |
| 05 | [Scoped client and drafts](./phase-05-scoped-client-and-drafts.md) | 02–04 | Complete | Complete | 100% |
| 06 | [Merge model and history](./phase-06-merge-model-and-history.md) | 01, 05 | Complete | Complete (Cycle 3 score: 7.0/10, approved by user) | 100% |
| 07 | [Floating Monaco surface](./phase-07-floating-monaco-surface.md) | 05–06 | Complete* | Complete* (Cycle 3 score: 6.0/10, approved by user) | 100% |
| 08 | [Workspace integration and cutover](./phase-08-workspace-integration-and-cutover.md) | 03–07 | Complete* | Complete* (Cycle 3 score: 6.0/10, approved by user) | 100% |
| 09 | [Qualification and documentation](./phase-09-qualification-and-documentation.md) | 01–08 | Pending | Pending | 0% |

### Phase 02 closure with accepted deferrals (2026-10-19)

Phase 02 delivered bounded conflict inventory and snapshot read endpoints (`GET /api/git/{project}/conflicts`, `GET /api/git/{project}/conflicts/file`). Test report `plans/reports/tester-261019-2314-phase-02-conflict-discovery-snapshots.md` recorded 9 backend API integration tests (`tests/git_conflict_discovery_api.rs`), 6 conflict unit tests (`server/src/git/conflict.rs`), and 51 UI tests passing.

Cycle-3 review (`plans/reports/code-reviewer-261019-2332-phase-02-conflict-discovery-snapshots-cycle3.md`) identified 6 gate-relevant warnings. User approved administrative closure with these items formally deferred to Phases 03 and 05. The implemented `StateFingerprint` currently covers HEAD OID, active operation string, full index hash, and worktree mtime/size; mid-read `.gitattributes`/config changes and coarse-mtime same-size filesystem modifications remain undetected until W2 lands. Safety gates remain open:
- **Phase 03 safe resolution and staging:**
  - **W1 (read error status mapping):** Map per-descriptor unreadable worktree (`WorktreeKind::Unreadable`), dangling/escaping symlinks (`WorktreeKind::Symlink`), and blob read errors (`StageKind::ReadError`) to truthful descriptors instead of HTTP 5xx/4xx; handle backslash paths consistently.
  - **W2 (attribute and content coherence):** Expand `StateFingerprint` to include effective attributes and config before/after reading, covering both the discovery/detail snapshot window and mutation revalidation; re-hash worktree content across the window to detect coarse-mtime races.
  - **W3 (conversion policy gating):** Expand conversion policy inspection (`text`, `crlf`, `binary`, `diff`, `merge`, `core.autocrlf`, `core.eol`, `core.safecrlf`); gate `ident=true` and `working-tree-encoding` to unsupported before mutation.
  - **W4 (operation roles/limits):** Provide explicit operation, targetRevision, contextual roles, and limits in snapshot DTO.
- **Phase 05 scoped client and drafts:**
  - **W4 (operation roles/limits):** Consume operation context and stage roles in client drafts and UI model.
  - **W6 (offset pagination cursor stability):** Bind opaque v2 cursors to the full unmerged conflict-set fingerprint and last raw-path anchor; reject changed sets/missing anchors with `GIT_CONFLICT_CURSOR_STALE` and restart pagination once from the first page.
  - **W12 (UI query and pane binding):** Pass explicit `root` parameter, handle multi-page inventory lookup, bind result pane to conflict drafts, and replace fail-closed `useGitResolve`.
- **Phase 03/05/08 clean cutover:**
  - **W7 (legacy code retirement):** Remove legacy `get_conflicts`, `read_blob_utf8`, `resolve_conflict`, Rust `ConflictFile`, and UI `ConflictFile` as part of coordinated cutover once mutation callers migrate.

*\*Note: Phase 02, Phase 04, Phase 07, and Phase 08 are administratively closed with accepted deferrals; safety, UX remediation, and qualification gates remain open until remediated in downstream phases (Phases 03, 05, 08, 09).*

### Phase 03 closure (2026-10-20)

Phase 03 delivered safe preconditioned resolution and staging backend (`POST /api/git/{project}/resolve`):
- **Discriminated action union (`ResolveAction`):** Enforces strict types (`reviewedText`, `indexSide`, `delete {}` with `deny_unknown_fields`) bound to scope, `conflictId`, and precondition `StateFingerprint`. Validates parent traversal prevention (`dunce`), symlink/reparse ancestor security, and executes safe atomic file publication before stage manipulation.
- **Truthful outcome taxonomy (`ResolveOutcome`):** Returns explicit observed facts (`applied`, `stale`, `unsupported`, `busy`, `failedBeforeWrite`, `worktreeChangedStageFailed`, `outcomeUnknown`) detailing stage presence, mandatory refresh indicators, and bounded diagnostics without misleading `ok: true`.
- **Application-level `GitMutationCoordinator`:** In-memory exclusive lock keyed via canonical repository `commondir` (or canonical gitdir), coordinating 14 application Git writers (`apply_conflict_resolution`, `stage_files`, `unstage_files`, `discard_file`, `discard_hunk`, `commit_files`, `checkout_branch`, `reset_to_commit`, `undo_last_commit`, `cherry_pick`, `drop_commit`, `revert_commit`, `squash_commits`, `edit_commit_message`). *Boundary note:* Coordination is process-local and covers internal app writers; CLI fallback commands (`continue`, `abort`, `merge`, `rebase`), `pull`, `fetch`, and branch create/delete operations remain deferred to Phase 04 Operation lifecycle. Process-local coordination does not serialize external Git CLI/terminal processes.
- **CUT1 generic stage preflight:** `stage_files` in `server/src/git/diff.rs` inspects all unmerged entries in a single pass, rejecting any batch containing conflicted paths or directory prefixes before any staging mutation occurs.
- **Phase 02 deferral disposition:**
  - **W1 (read error status mapping):** Resolved in mutation preflight and outcome taxonomy (unreadable/symlink descriptors fail before write or report truthful status).
  - **W2 (attribute & content coherence):** `StateFingerprint` expanded with `EffectiveAttributes`, target revision, and worktree bytes check.
  - **W3 (conversion policy gating):** Non-supported conversions (`ident=true`, `working-tree-encoding`, non-default autocrlf policies) return `ResolveOutcome::Unsupported` before mutation.
  - **W4 (operation roles/limits):** Target revision and stage roles preserved in backend precondition; client model consumption proceeds in Phase 05.
  - **W7 (legacy code retirement):** Completely removed legacy `resolve_conflict`, `get_conflicts`, `read_blob_utf8`, and the legacy Rust `ConflictFile` DTO from `diff.rs` and `types.rs`. UI `client.ts` legacy caller cleanup proceeds in Phase 05.
- **Deployment restriction:** Phase 03 is backend delivery within an **unreleasable coordinated migration**; writable UI integration remains blocked until Phases 04–05 deliver operation lifecycle and scoped client drafts.
- **Verification & review:** Validated by 10 integration tests in `tests/git_conflict_exact_staging.rs`, 11 in `tests/git_conflict_discovery_api.rs`, and 203 unit tests in `server::git` passing 100%. Cycle 3 code review (7.0/10) completed; critical `undo_last_commit` guard scope verified and resolved; user approved on 2026-10-20.

### Phase 04 closure with accepted deferrals (2026-10-20)

Phase 04 delivered the operation lifecycle backend, authoritative status detection, guarded mutation endpoints, truthful outcomes, and terminal handoff contract:
- **Authoritative detection & role labels:** `active_operation_kind` in `server/src/git/operation.rs` and `cli_fallback.rs` provides single-source detection for `none`, `merge`, `rebase`, `cherry_pick`, `revert`, `unsupported`, and `unknown` operations using `.git` worktree metadata (`MERGE_HEAD`, `rebase-merge/`, `rebase-apply/` distinguishing `git am`, `CHERRY_PICK_HEAD`, `REVERT_HEAD`, `sequencer/todo`). Generates truthful `StageRoleLabels` (e.g., rebase onto/replayed swap).
- **Operation status query (`GET /api/git/{project}/operation`):** Returns `OperationStatusResponse` with `OperationFingerprint` (capturing HEAD OID, active operation kind, sequencer metadata, full index hash including stage 0 and stages 1..3), stage role labels, stopped reason, blockers, and allowed actions (`can_continue`, `can_abort`).
- **Guarded operation mutation (`POST /api/git/{project}/operation`):** Strictly revalidates `OperationFingerprint` under `GitMutationCoordinator` lock before executing server-selected `git <op> --continue` or `--abort`. Rejects stale preconditions (409 Conflict) and unexpected inputs (`deny_unknown_fields`).
- **Guarded abort lifecycle:** Requires explicit client confirmation (`confirmed: true`); safely cleans worktree and verifies clean state (`Aborted { worktree_cleaned }`).
- **Bounded runner & process protection:** `run_bounded_git_command` enforces `GIT_TERMINAL_PROMPT=0`, stdin null, bounded stdout/stderr draining (64KB limits), `kill_on_drop(true)` on direct child process, and process-group SIGKILL on 15s timeout.
- **Truthful outcome taxonomy (`OperationOutcome`):** Explicit observed facts (`Continued`, `Aborted`, `Blocked`, `Failed`, `StalePrecondition`, `ConflictDetected`, `OutcomeUnknown`) without misleading `ok: true`.
- **Configured-editor terminal handoff:** Intercepts `EDITOR_SENTINEL` when commit message editing is required, returning `Blocked(MessageEditRequired)` with `TerminalHandoffRequired` directing user to the exact owning terminal.
- **Fail-closed mutation guards:** `cli_fallback::active_git_operation` fails closed for `unsupported` (e.g. `git am`, `bisect`, contradictory metadata) and `unknown` states.
- **UI type alignment:** Added `"unsupported"` to `GitRecoveryState.operation` union in `packages/ui/src/api/client.ts`.
- **Deployment restriction:** Phase 04 backend delivery is part of an **unreleasable coordinated migration**; UI caller migration proceeds in Phase 05 scoped client and drafts.
- **Verification & review:** Validated by 11 integration tests in `git_conflict_operation_lifecycle.rs`, 5 in `git_conflict_operation_api.rs`, 2 in `git_conflict_operation_metadata.rs`, and 204 unit tests in `server::git` passing 100%. Cycle 3 review (score 7.0/10) completed; administrative closure approved with accepted deferrals on 2026-10-20.

**Accepted deferrals for downstream phases:**
- **Phase 05 scoped client and drafts:**
  - **W6 (Terminal handoff owner identity):** Bind `TerminalHandoffRequired` (reason and worktree root) to client profile/generation/session context and wire terminal focus/handoff.
  - **W9 (Legacy recovery model retirement):** Fully migrate UI callers off legacy `GitRecoveryState` / `GitOperation` to new `OperationStatusResponse`.
- **Phase 08 workspace integration and cutover:**
  - **W3 (Post-attempt requery on non-success):** Immediate requery is implemented on exit-0 (`Continued`); non-success outcomes (`Blocked`, `Failed`, `OutcomeUnknown`) return `requires_refresh: true`; wire explicit client post-attempt and post-terminal authoritative requery in the workspace conflict surface.
- **Phase 09 qualification and documentation:**
  - **W1 (EOL line-ending normalization):** Clean up working tree / index line-ending normalization on `server/src/api/git_diff.rs`.
  - **W2 (Process group termination & cancellation):** `kill_on_drop(true)` terminates direct child process; expand process group cleanup across Unix/Windows and verify detached task cancellation semantics under production runtime.
  - **W4 (Hook classification via requery):** Replace output substring classification heuristic with authoritative post-attempt metadata and sequencer status inspection.
  - **W5 (Runner qualification):** Validate 15s deadline against slow hooks/signing agents, verify pipe draining under daemon processes, and qualify Windows child process tree cleanup.
  - **W7 (Extended test matrix):** Execute production qualification proofs for timeout, hanging descendant daemons, revert continue/abort under hooks, GPG signing, and conflictless edit/exec rebase stops.
  - **W10 (Unredacted diagnostics):** Apply bounded redaction/filtering for paths and sensitive metadata in `Failed` diagnostics.
  - **W11 (Metadata-read fail-open edges):** Harden metadata parsing against I/O errors and distinguish unsupported vs unknown stopped reasons.

### Phase 05 closure (2026-10-21)

Phase 05 delivered the scoped client DTO cutover, memory-retained draft registry, and workspace editor controller:
- **Full UI DTO cutover (`client.ts`, `ws-transport.ts`, `queries.ts`):** Completely replaced legacy `{ path, content }` payload with typed `ResolveRequest` (action union: `reviewedText`, `indexSide`, `delete`), `ResolveOutcome`, `OperationStatusResponse`, `OperationActionRequest`, and `OperationOutcome`. Disabled automatic mutation retries and retired legacy write fallbacks.
- **In-memory `ConflictDraftRegistry` (`conflict-draft-store.ts`, `conflict-draft-transitions.ts`, `conflict-draft-capacity.ts`, `conflict-draft-key.ts`, `conflict-draft-types.ts`):** Scoped by immutable draft key (`profileId`, `generation`, `serverUrl`, `project`, `worktreePath`, `conflictId`, `snapshotVersion`). Fences out stale callbacks and retired owner replays, coalesces rapid typing history, and enforces measured capacity (10MB total / 2MB per draft / 10 dirty drafts maximum). Stale snapshots are marked as recovery drafts requiring explicit fresh-snapshot import/review before apply.
- **Workspace & Editor Integration (`MergeConflictEditor.tsx`, `WorkspacePage.tsx`):** Wired with `useConflictResolver` hook, supporting Undo/Redo across retained draft history in Monaco above shell visibility, handling Android Chrome read-only input policy, and binding terminal handoff recovery with authoritative post-terminal refresh.
- **Monaco 0.55.1 patched (`patches/monaco-editor@0.55.1.patch`):** Applied patch to catch unhandled `CancellationError` in `WordHighlighter` on unmount/dispose during rapid component lifecycle changes.
- **Disposition of Phase 02 and Phase 04 deferrals:**
  - **Phase 02 W4 (operation roles & limits):** Consumed `OperationStatusResponse` context and stage roles in client drafts and UI model.
  - **Phase 02 W6 (offset pagination cursor stability):** Integrated client pagination with stable cursor and automatic restart on stale cursor (`GIT_CONFLICT_CURSOR_STALE`).
  - **Phase 02 W7 (legacy code retirement):** Retired legacy UI `ConflictFile` DTO and legacy `{ path, content }` resolve requests in UI; backend parallel legacy endpoints remain gated until Phase 08 cutover.
  - **Phase 02 W12 (UI query & pane binding):** Explicit `root` parameter passed in queries; result pane bound to retained drafts above shell visibility.
  - **Phase 04 W6 (terminal handoff owner identity):** Bound `TerminalHandoffRequired` reason and worktree root to client profile/generation/session context and wired terminal focus/handoff.
  - **Phase 04 W9 (legacy recovery model retirement):** Fully migrated UI callers from legacy `GitRecoveryState` / `GitOperation` to `OperationStatusResponse` / `OperationActionRequest` / `OperationOutcome`; backend retirement proceeds in Phase 08.
- **Verification & review:** Validated by 80 UI unit tests across 5 test files (`conflict-draft-capacity.test.ts`, `conflict-draft-store.test.ts`, `MergeConflictEditor.test.tsx`, `ws-transport.test.ts`, `use-conflict-resolver.test.tsx`), 4 browser test files (8 tests total; latest suite run verified `conflict-monaco-history.browser.tsx`), 40 server conflict regression tests across 63 test suites, and clean TypeScript compilation (`tsc -p tsconfig.json --noEmit`, 0 errors).
- **Deployment boundary & limitations:** Unreleasable coordinated migration boundary remains active; Linux-native dirty-draft close protection remains unsupported (browser `beforeunload` is best-effort); Phase 04 W3 non-success post-attempt requery proceeds in Phase 08.

### Phase 06 closure (2026-10-21)

Phase 06 delivered the structured merge model, lossless tokenization, conservative worktree mapping, and unified draft history authority:
- **Lossless line tokenization (`conflict-tokenization.ts`):** Preserves line endings (LF, CRLF, mixed), trailing newline presence (`hasFinalNewline`), and UTF-8 Byte Order Mark (BOM). Tokenizes base, left (ours), and right (theirs) into immutable token arrays with distinct empty-stage vs absent-stage handling.
- **Deterministic diff3 source regions (`conflict-region-mapper.ts`, `node-diff3`):** Constructs 2-way and 3-way source conflict regions with stable block IDs using approved `node-diff3@3.2.1`. Safely handles absent base (add/add) and empty file combinations with immutable stage line ranges.
- **Conservative imported-result mapping (`conflict-region-mapper.ts`, `conflict-marker-parser.ts`):** Maps source regions against actual worktree text (marker-free partial work, diff3, zdiff3, or manual edits). Ambiguous and unmapped regions conservatively downgrade to `needs-review` / `unmapped` rather than guessing destructive offsets. Advisory marker warnings guide review without blocking valid empty or resolved text.
- **Atomic text+metadata decisions (`conflict-merge-actions.ts`, `conflict-merge-model.ts`):** Implements `acceptSide` (ours/theirs), `acceptBoth` with explicit order preservation (ours-then-theirs, theirs-then-ours), `ignoreSide` (metadata-only, preserves current result text), and `markReviewed`. Validates readiness when all regions are resolved and markers are reviewed. Cycle 3 resolved C-A (BOM offset desync across edits/actions) and C-B (identical-text accept pushing history entries for undoability).
- **Confirmed whole-file actions (`conflict-merge-actions.ts`):** Safe two-step preview and confirmation (`previewWholeFileAction` / `confirmWholeFileAction`) for take-ours, take-theirs, take-base, and rebuild-clean; read-only base comparison.
- **Unified draft history with decision snapshots (`conflict-draft-store.ts`, `conflict-draft-transitions.ts`, `joint-history-authority.ts`):** Integrates decision snapshots into draft history (`ConflictDraftHistoryEntry` with `decisions`, `isReady`, `unresolvedReasons`, `resultRevision`), ensuring Undo/Redo restores both text and metadata-only decisions (e.g. Ignore, no-text-change Accept). Capped depth at 100 entries. Includes standalone `JointHistoryAuthority` providing Monaco-compatible joint transaction semantics with snapshot capture and restore across remounts.
- **Monaco Chromium browser qualification (`browser-tests/conflict-monaco-history.browser.tsx`, `browser-tests/conflict-resolver-history.browser.tsx`):** Proves single joint undo/redo authority across native typing and metadata decisions, atomic text and metadata transaction undo/redo with snapshot restoration in real Chromium runner, and `Ctrl+Z`/`Ctrl+Shift+Z` routing through retained draft history.
- **Verification & review:** Validated by 88 target tests passing (62 UI unit tests across 5 files, 3 browser tests across 2 files under real Chromium runner, 23 backend conflict regression tests) + 3 supplementary UI unit tests (91 total distinct tests passing), clean TypeScript compilation (`tsc -p tsconfig.json --noEmit`, 0 errors). Cycle 3 code review completed (score 7.0/10, approved by user on 2026-10-21).
- **Downstream integration items for Phase 07 and Phase 08:**
  - **Phase 07 floating Monaco surface:**
    - **W-1 (History authority wiring):** Wire production Monaco editor adapter to `draft.history` decision-aware stack (or unify with `JointHistoryAuthority`), retiring dead parallel methods and duplicate keybindings.
    - **W-2 (Typing-then-accept coalescing):** Clear `canCoalesceHistory` before calling `updateResult` in store actions to prevent rapid typing from coalescing with subsequent accept actions.
    - **W-3 (Metadata history metrics):** Route metadata actions through draft capacity calculation and recalculate metrics to account for decision history growth.
    - **W-4 (Decision-divergence dirty tracking):** Include decision divergence in `isDirty` calculation following redo of no-text-change accept.
    - **W-5 (Preview binding):** Enforce mandatory `draftKey` binding and unified revision check in `WholeFileActionPreview`.
    - **W-6 (Authority hardening):** Clean up `JointHistoryAuthority` duplicate keybindings, caller order `recordAtomicAction` discipline, and exception safety on callback pops.
    - **W-7 (Apply nonconflicting changes):** Implement nonconflicting merge change application in UI surface.
    - **W-8 (Extended browser qualification):** Qualify Monaco context-menu Undo and IME input on live editor.
    - **W-9 (BOM boundary responsibility):** Clarify and enforce BOM re-application at Apply/Save boundary.
  - **Phase 08 workspace integration and cutover:**
    - Complete end-to-end workspace surface integration, legacy endpoint retirement, and fail-closed cutover.
- **Deployment boundary:** Unreleasable coordinated migration boundary remains active; UI model and client contracts are unreleasable until Phase 08 cutover.

### Phase 07 closure with accepted deferrals (2026-10-21)

Phase 07 delivered the workspace-owned floating Monaco conflict resolver surface above shell branching:
- **Shared floating host (`ConflictResolverPanel.tsx`, `WorkspacePage.tsx`):** Mounted a single shared conflict resolver host in `WorkspacePage` above IDE, terminal, and mobile shell branching, wired directly to `useConflictResolver` without opening editor tabs or adapting `DiffViewer`.
- **Unified floating panel stacking (`terminal-workspace-panel.ts`, `TerminalWorkspaceShell.tsx`, `WorkspacePage.tsx`):** Extended `FloatingPanelId` to `"files" | "tool" | "resolver"`. Managed `floatingPanelStack` in `WorkspacePage` with z-index derivation (`resolveFloatingPanelZIndex`) across surfaces (`files`: 20, `tool`: 21, `resolver`: 22). Frontmost panel derives `isTopmost` dynamically.
- **Scoped Escape key arbitration (`ConflictResolverPanel.tsx`, `TerminalFloatingToolPanel.tsx`):** Enforces topmost panel ownership and focus containment (`contains(document.activeElement)`). Monaco suggest, find, and context-menu widgets consume Escape first (`querySelector(".monaco-editor .suggest-widget.visible, .find-widget.visible, .monaco-menu-container")`); unconsumed Escape in topmost resolver hides only the resolver without leaking to terminal or closing background panels.
- **Responsive narrow tabbed mode (`MergeConflictEditor.tsx`):** Implemented narrow viewport (<768px) tabbed layout switching between Theirs, Result, Ours, and Base views (`button[role=tab]`) while preserving wide 3-pane layout for desktop.
- **Exact region-id action binding (`MergeConflictEditor.tsx`, `ConflictRegionNav.tsx`):** Keyed region accept/ignore actions to exact `region.id` rather than stale index, correctly handling leading stable text lines. Nav chips jump to target conflict line.
- **In-memory model paths & lifecycle:** Created isolated in-memory model URIs per role (`inmemory://git-conflict/{role}-{path}`) with explicit model disposal on unmount, preventing model leak and dirty draft desynchronization.
- **Verification & review:** Validated by 721 unit tests passing (including `terminal-workspace-panel.test.ts`, `conflict-resolver-panel-state.test.ts`, `conflict-draft-store.test.ts`), 12 browser tests across 4 suites under real Chromium (`git-conflict-resolver.browser.tsx`, `terminal-floating-panels.browser.tsx`, `conflict-resolver-history.browser.tsx`, `conflict-monaco-history.browser.tsx`), 0 TypeScript errors (`tsc -p tsconfig.json --noEmit`), and 0 ESLint errors. Cycle 3 review completed (score 6.0/10; approved by user with accepted deferrals on 2026-10-21).

**Accepted deferrals for Phase 08 workspace integration and cutover:**
- **C1 (Tool & files panel Escape activation):** Ensure shell populates `floatingPanelStack` or activates panels immediately upon toggle/open so Escape closes panels without requiring prior pointer click/focus capture.
- **C2 (Narrow pane switch decoration re-application):** Re-apply Monaco conflict decorations (`applyDecorations`) and reset collection refs on async mount of Theirs/Result/Ours/Base editors during narrow tab switching.
- **C3 (Nav auto-switch line reveal):** Apply pending conflict line reveal (`pendingRevealRef`) upon Result editor mount when navigating from Theirs/Ours/Base tabs.
- **W1 (Files panel Escape stack scoping):** Scope `TerminalFloatingFilePanel` Escape handler to `isTopmost={effectiveFront === "files"}` with focus containment to prevent simultaneous dismissals.
- **W2 / W3 (Extended browser test matrix):** Add multi-panel (files + tool + resolver) z-order arbitration browser tests and wide-viewport (1400px) 3-pane layout tests with `page.viewport()`.
- **W4 (Dead code & allocation cleanup):** Remove or wire `isTopmostFloatingPanel` helper and memoize `updateFloatingPanelStack` when array contents are unchanged.
- **W5 (App chrome z-order alignment):** Validate resolver panel z-order against TopNav (`z-50`) in full application page layout.
- **W6 (Carry-over Cycle 1/2 items):** Implement Monaco view zones and scroll alignment for unequal hunks, retain panel geometry/selected file across hide/reopen without full DOM unmount, consolidate redundant `useConflictResolver` query instances, and remove legacy marker-parser fallbacks.
- **W7 (Escape widget query scoping):** Scope Monaco widget queries to `panelRef.current`.
- **Deployment boundary:** Unreleasable coordinated migration boundary remains active; UI model and client contracts are unreleasable until Phase 08 cutover.

### Phase 08 closure with accepted deferrals (2026-10-21)

Phase 08 delivered the workspace integration, reveal routing, stage bypass closure, and clean cutover:
- **Reveal intent routing & exact owner/root derivation (`ChangedFilesList.tsx`, `WorkspacePage.tsx`, `terminal-workspace-panel.ts`):** `ChangedFilesList` detects conflicts, suppresses normal diff opening and stage checkboxes, exposes "Resolve conflict" context-menu item and active Git operation banner (`Open Resolver`), dispatching through single-source `buildConflictRevealIntent`. For aggregate views, `deriveAggregateConflictRoot` extracts the entry's exact child VCS root and relative project path rather than guessing. `ConflictResolverPanel` consumes the nonce-guarded intent once (`lastConsumedNonceRef`) to prevent selection snapback on background refetch.
- **Action presentation & truthful handling (`MergeConflictEditor.tsx`, `ConflictResolverToolbar.tsx`):** Dedicated presentation for text review, binary side choice, delete/modify choices (derived truthfully from stage presence non-missing side), and unsupported entries with terminal handoff; separates Apply & stage from Continue/Finish and Abort.
- **Generic stage bypass closure (CUT1, `server/src/git/diff.rs`, `ChangedFilesList.tsx`):** Enhanced `stage_files` in `server/src/git/diff.rs` to inspect unmerged index entries under `GitMutationCoordinator` lock, rejecting any batch containing conflicted paths or directory prefixes before any staging mutation occurs; UI staging checkbox and bulk actions disallow conflict staging.
- **Legacy code retirement & fail-closed cutover (CUT2, `client.ts`, `MergeConflictEditor.tsx`):** Completely retired legacy `conflict-parser.ts`, `ConflictBlock` exports, and legacy `{ path, content }` payload; legacy write payloads fail closed (`LEGACY_PAYLOAD_REJECTED`); Android read-only policy coverage preserved via behavioral rewrite in `MergeConflictEditor.test.tsx`.
- **Configured-editor terminal guidance (`MergeConflictEditor.tsx`, `ConflictResolverToolbar.tsx`):** Intercepts commit-message editing requirement and directs user to Git's configured editor in the exact owning repository/worktree terminal without message form/adapter or PTY command injection.
- **Phase 07 inherited items closed:** Closed C1 (panel Escape activation on toggle/open), C2/C3 (narrow tab decoration and line reveal on async mount), W1 (files panel Escape stack scoping to topmost), W4 (dead code and allocation cleanup), and W7 (widget scoping to panelRef).
- **Validation evidence:** Cycle-2 test report (`plans/reports/tester-261021-1406-phase-08-workspace-integration-cutover-cycle2.md`) recorded 364 passing tests (109 UI unit/integration tests across 10 suites, 12 browser component tests across 4 Chromium suites, 39 backend integration tests across 5 suites, 204 server unit tests). Cycle 3 review completed (score 6.0/10; approved by user with accepted deferrals on 2026-10-21). Post-cycle-3 fixes applied for modify/delete stage presence derivation and root-qualified editor keying.
- **Accepted deferrals and formal handoff to Phase 09 (Qualification and documentation):**
  - **Live-daemon multi-worktree smoke testing (Step 12):** Production runtime validation with authenticated app registered to nested repositories, aggregate Changed Files, two conflicts plus unrelated staged file, delayed apply with newer typing, lost response, repeated operation stop, and configured-editor terminal handoff.
  - **Inherited deferrals:** Extended multi-panel browser test matrix (W2/W3), app chrome z-order alignment (W5), and Monaco view zones, panel geometry/selected-file retention & hook consolidation (W6).
- **Deployment boundary:** Coordinated migration complete; legacy write endpoints reject legacy payloads (`LEGACY_PAYLOAD_REJECTED`). Unreleasable coordinated migration boundary remains active until Phase 09 release qualification completes.
## Execution and dependency rules

Execute numbered order by default. Overlap backend and pure model work only after 01 freezes invariants and one integration owner assigns shared `types.rs`, `client.ts`, transport/query and WorkspacePage edits. Each phase states entry artifacts and go/no-go evidence; a failed prerequisite blocks dependents.

Phases 02–05 are an unreleasable coordinated UI/server contract migration until every caller agrees; never deploy an intermediate incompatible API or retain a legacy write fallback/compatibility shim. Phase 08 completes one production renderer/entry path and proves legacy writes fail closed.

Future implementation evidence belongs with this plan's reports; record source fingerprint, commands, versions/platform, fixture and observed state. Proposed source/test paths in phases are not existing modules. Current repository evidence is authoritative over older scout assumptions; repeat reference discovery before export changes.

## Principal gates

- 01: executable imported-result, joint native text/metadata history, byte/conversion, selected-side OID/mode, process and measured-resource proofs. Research alone cannot pass.
- 02–04: coherent bounded snapshots; secure actual root/index/ref mutation; no generic-stage bypass; explicit applied/stale/unsupported/busy/failed-before-write/partial/unknown facts; four real operation lifecycles, configured-editor terminal handoff and post-attempt/post-terminal authoritative refresh.
- 05–08: exact owner/generation/server/root binding; retained memory-only history; no replay/rebind/dirty eviction; aligned public Monaco surface above shell branching; no obsolete marker authority.
- 09: every [AC1–12 and CUT1–5](./acceptance-matrix.md) has real behavior/byte evidence; authenticated production web fixture and actual Linux-native host separately; fresh local captures and explicit human acceptance. Missing required Linux-native/human proof blocks initial release completion; Windows-native qualification is nonblocking and cannot be claimed.

## Validation Summary

**Validated:** 2026-10-19. **Decision topics:** 3; Git-input options explained before final choice.

### Confirmed Decisions
- **API rollout:** coordinated UI/server upgrade; one new contract across every caller, no legacy resolver write fallback, compatibility shim or incompatible intermediate deployment.
- **Commit-message input:** when Continue requires editing, hand off to Git's configured editor in the exact owning repository/worktree terminal; no resolver message form/adapter, handler-launched interactive editor or automatic PTY injection. Preserve hooks/signing and dirty drafts/history; handoff is not completion or proof of zero writes. Authoritative refresh follows each attempted command and terminal return; stale recovery requires fresh explicit review, never automatic replay.
- **Initial platform gate:** authenticated production web + actual Linux Tauri runtime + fresh local full-viewport captures + explicit human ACCEPTED. Windows-native client qualification remains separately Pending, explicitly unqualified and nonblocking; qualify separately before claiming resolver support. This client deferral does not waive shared correctness or applicable supported-server safety.

### Propagation complete
- Overview/access point, all nine affected phases, design/acceptance contracts, supporting research and proposed architecture note now carry these decisions; Phase 01/09 distinguish required web/Linux/human evidence from separately Pending Windows-native qualification.
- [Document verification and historical validation](./reports/plan-validation.md) distinguish this completed documentation reconciliation from Pending/0% implementation and runtime qualification. No product questions or implementation authorization.

## Unresolved technical questions

No product clarification required. Implementation owners must close gates with executable evidence: Phase 01 selects engine/version/license, public history authority, conservative import mapping, lossless byte representation, conversion/hash/path support and safe bounded process/editor detection; 01/09 set measured web/Linux limits and qualify required Linux/human evidence. Windows-native client qualification remains separately Pending/nonblocking/unqualified, not a shared/server-safety waiver. Failure stops dependent work, not silent scope reduction; each phase names owner, scenario, evidence and stop condition.
