# Phase 08 — Workspace integration and cutover

## Context links

- [Plan](./plan.md), [Phase 03](./phase-03-safe-resolution-and-staging.md), [Phase 04](./phase-04-operation-lifecycle.md), [Phase 05](./phase-05-scoped-client-and-drafts.md).
- [Phase 06](./phase-06-merge-model-and-history.md), [Phase 07](./phase-07-floating-monaco-surface.md), [design contract](./design-contract.md#floating-ui-and-cutover).
- [Acceptance matrix](./acceptance-matrix.md), [repository evidence](./reports/repository-evidence.md).

## Overview

- Date: 2026-10-19. Priority: P2.
- Status: Complete* / DONE (2026-10-21; administratively closed with accepted deferrals and handoff to Phase 09).
- Implementation: Complete* (2026-10-21). Review: Complete* (Cycle 3 score: 6.0/10, approved by user with accepted deferrals on 2026-10-21). Progress: 100%. Effort: unestimated.
- Owner: workspace integration lead; affected backend/client/model/surface owners supply passed handoffs.
- Entry: Phase 03–07 contracts, controller, structured model and actual floating host passed.
- Handoff: one end-to-end production entry/apply/recovery path with obsolete marker behavior and staging bypasses removed.
- Go/no-go: both user entry points reach exact owner/root draft without editor tab; generic staging and old resolver cannot bypass reviewed apply.

## Key insights

- Current conflict row selection goes through ordinary diff opening; bulk excludes conflicts but checkbox/context staging still reaches backend.
- WorkspaceGitPanel already has owner/generation/root-qualified reveal conventions to reuse.
- Aggregate view selected root cannot be assumed to own a row; launch must derive that entry's actual root.
- Successful file apply is distinct from operation Continue; new rebase conflicts must remain visible, not auto-close panel.
- Old parser/ConflictBlock and tests are a cleanup target only after references prove a single replacement path exists.

## Requirements

### Functional

- Changed Files conflict row and authoritative operation status open/reveal the dedicated resolver, never an editor tab.
- Capture row/operation owner and actual worktree/root; aggregate view derives each entry's own root.
- Route conflict checkbox/context/bulk actions to resolver semantics; direct generic stage endpoint rejects mixed conflict batches.
- Show explicit reviewed text, binary whole-side, delete/modify and unsupported/handoff actions without empty/missing ambiguity.
- Separate Apply & stage from Continue/Finish and destructive Abort; no implicit operation continuation.
- Preserve stale/partial/unknown recovery drafts and newer edits after submitted revision; configured-editor terminal handoff retains dirty history. Authoritative refresh after attempts and terminal return never wipes/rebinds drafts or implies completion/zero-write.
- Remove old unchecked resolve contract, marker parser/ConflictBlock exports/tests/comments after all references migrate; coordinated UI/server upgrade with no legacy write fallback, compatibility shim or incompatible intermediate deployment.

### Nonfunctional

- One production renderer and new DTO contract across every caller, no compatibility shim, legacy write fallback or hidden second path; legacy write payloads fail closed.
- Reuse owner-scoped events/focus refresh and existing reveal conventions; no new observation service.
- Preserve unrelated dirty editor tabs and optimistic ConflictDialog behavior, which is a different feature.
- Do not replace meaningful Android/privacy coverage with permanent wiring/default/source-text/mock-echo tests.

## Architecture

ChangedFilesList emits owner-bound resolver reveal intent; WorkspaceGitPanel/WorkspacePage resolve exact row root and select retained controller draft.
Operation status reveals same host with authoritative file list/status even when no conflicts remain but an operation is stopped.
Apply builds a captured reviewed action from current model/byte metadata and precondition; response reconciliation uses submitted revision.
Continue/Abort use separate fresh operation identity and consent; repeated stop refreshes inventory and status in the same retained owner.
Required commit-message editing directs the user to Git's configured editor in the exact owning repository/worktree terminal; no resolver form/adapter, handler interactive editor or automatic PTY injection. After every attempted command and terminal return refresh operation/full-index/worktree facts; failed refresh remains unknown/no replay, while stale recovery requires explicit fresh-snapshot import/review.
Scoped invalidation refreshes summaries/details/operation/diff/history/status without replacing dirty tabs or models.
Cutover removes obsolete references only after both entry paths and mutation outcomes work through the one production renderer.

## Related code files

- Modify: `packages/ui/src/components/organisms/ChangedFilesList.tsx` for conflict row/checkbox/context/bulk behavior.
- Modify: `packages/ui/src/components/organisms/WorkspaceGitPanel.tsx`, `packages/ui/src/components/pages/WorkspacePage.tsx` for exact owner/root reveal and shared host integration.
- Modify: `packages/ui/src/api/client.ts`, `packages/ui/src/api/ws-transport.ts`, `packages/ui/src/api/queries.ts` only under shared contract owner for final consumer migration.
- Modify: `packages/ui/src/components/organisms/MergeConflictEditor.tsx` and its existing test for final structured-renderer contract/meaningful input behavior.
- Modify (proposed from Phase 07): `packages/ui/src/components/organisms/ConflictResolverPanel.tsx` for actual Apply/Continue/Abort/recovery controls if created.
- Modify: `packages/ui/src/components/organisms/ChangedFilesList.test.ts`, `packages/ui/src/components/pages/WorkspacePage.test.tsx` with consumer behavior, not handler-name assertions.
- Modify: `server/src/git/diff.rs`, `server/src/api/git_diff.rs`, `server/src/git/types.rs`, `server/src/git/mod.rs` only if final migration leaves unchecked exports/callers.
- Delete: `packages/ui/src/lib/conflict-parser.ts` once no references remain; discover and delete only its obsolete tests/exports, not guessed filenames.
- Delete: obsolete ConflictBlock export/implementation/tests and stale lazy-import comments after exact reference inventory; keep unrelated ConflictDialog.
- Create: none mandated; propose new files only if existing boundaries cannot hold required behavior and label them proposed before work.

## Implementation steps

1. Re-run semantic references where available and targeted search fallback for old conflict DTO, resolve signatures, ConflictBlock, parser and MergeConflictEditor consumers.
   Record exact remaining references, including tests/exports/comments, before changing public boundaries.
2. Add explicit conflict reveal intent to Changed Files row behavior and operation status action.
   Route ordinary nonconflict selection to existing diff as before; conflicts never invoke openDiff/open editor tab.
3. Bind reveal intent to profile/generation/server resource/project/worktree and entry's actual root.
   For aggregate views derive the selected row root from its data, not current aggregate filter or last selected root.
   Refuse unavailable/stale owner/root launch while retaining existing drafts; no arbitrary root guessing.
4. Wire both entry points to one workspace controller/host; revealing an already-open file focuses existing retained draft.
   Operation entry works for conflictless stopped operations and unsupported states without inventing files or commands.
5. Render supported text review, binary existing-side choice and delete/modify choices distinctly.
   Whole-file text selection first changes draft after confirmation; binary side requires explicit confirmation then Apply & stage.
   Unsupported symlink/gitlink/rename/path/encoding/filter entries remain listed with precise terminal handoff and disabled unsafe mutation.
6. Build Apply & stage only from explicitly reviewed current model and complete byte/mode metadata.
   Capture owner, precondition, action and submitted revision once; disable duplicate command while in flight without locking out later local typing.
   Empty reviewed text is allowed; delete is a separate action, never inferred from empty result.
7. Reconcile applied/stale/unsupported/busy/failed-before-write/partial/unknown responses using captured revision and owner.
   Preserve newer typing, dirty history and recovery text; stale/partial/unknown requires refresh/review before another command.
   Do not auto-close, retry, rollback, rebind or continue after server success or response loss.
8. Add separate Continue/Finish and Abort controls bound to authoritative operation status and fresh precondition.
   Abort confirmation names actual operation and likely resolution loss; retain dirty drafts stale afterward.
   New rebase/cherry-pick/revert stop refreshes file list/status in same panel; zero conflicts alone never triggers command.
   If Continue needs commit-message editing, provide exact captured profile/generation/server/project/worktree/root terminal guidance for Git's configured editor, without message form/adapter, handler editor or automatic command injection; preserve hooks/signing/drafts/history.
   Refresh operation/full relevant index/worktree after each attempted command and terminal return, including cancellation/failure; preserve unknown/stale states and require fresh explicit review before recovered Apply. Returning to the resolver is not completion or guaranteed zero-write.
9. Remove conflict stage bypasses from row checkbox/context and bulk selections while preserving normal nonconflict staging.
   Exercise direct app stage endpoint with clean+conflict batch to prove backend preflight rather than UI-only protection.
10. Apply scoped events/focus/visibility refresh after external terminal Git actions and application mutation.
    Mark old snapshots stale without discarding drafts; refresh affected status/diff/history/editor views without replacing dirty editor tabs.
11. Complete coordinated UI/server DTO/resolve migration for every caller; remove unchecked backend behavior, legacy write fallback, compatibility shim and unused exports. Old write payloads must fail closed; no incompatible intermediate deployment.
    Delete parser/ConflictBlock and obsolete tests/comments only after references are exhausted.
    Preserve meaningful Android input/Cognito policy tests by behavioral rewrite, not retaining dead parser logic.
12. Exercise actual production app routing and outcomes before Phase 09 exhaustive evidence.
    Include aggregate/nested root entry, delayed apply with newer typing, lost response, binary/deletion, repeated operation stop and configured-editor terminal handoff/return with retained history and authoritative refresh.
    Confirm ordinary file diff and unrelated ConflictDialog still follow their existing independent paths.

## Todo list

- [x] Wire row and operation-status reveal to one exact owner/root floating host (`buildConflictRevealIntent`, `deriveAggregateConflictRoot`, `lastConsumedNonceRef`).
- [x] Separate text/binary/delete/unsupported and Apply/Continue/Abort, including configured-editor terminal handoff without message form/adapter.
- [x] Preserve submitted-revision and stale/partial/unknown recovery semantics.
- [x] Close every generic conflict stage bypass at UI/backend boundary (CUT1 preflight in `diff.rs` and UI stage-checkbox suppression).
- [x] Complete coordinated UI/server/every-caller cutover; remove parser/ConflictBlock/unchecked behavior (CUT2) and reject legacy writes without fallback/shim (`LEGACY_PAYLOAD_REJECTED`).
- [ ] Exercise actual production entry, repeated stop and unrelated behavior boundaries in live production environment. *(Step 12 live-daemon multi-worktree smoke testing formally handed off to Phase 09 qualification)*

### Inherited Tasks from Phase 07 (Accepted Deferrals)

- [x] **C1 (Tool & files panel Escape activation):** Ensure shell populates `floatingPanelStack` or activates panels immediately upon toggle/open so Escape closes panels without requiring prior pointer click/focus capture.
- [x] **C2 (Narrow pane switch decoration re-application):** Re-apply Monaco conflict decorations (`applyDecorations`) and reset collection refs on async mount of Theirs/Result/Ours/Base editors during narrow tab switching.
- [x] **C3 (Nav auto-switch line reveal):** Apply pending conflict line reveal (`pendingRevealRef`) upon Result editor mount when navigating from Theirs/Ours/Base tabs.
- [x] **W1 (Files panel Escape stack scoping):** Scope `TerminalFloatingFilePanel` Escape handler to `isTopmost={effectiveFront === "files"}` with focus containment to prevent simultaneous dismissals.
- [ ] **W2 / W3 (Extended browser test matrix):** Add multi-panel (files + tool + resolver) z-order arbitration browser tests and wide-viewport (1400px) 3-pane layout tests with `page.viewport()`. *(Deferred / handed off to Phase 09)*
- [x] **W4 (Dead code & allocation cleanup):** Remove or wire `isTopmostFloatingPanel` helper and memoize `updateFloatingPanelStack` when array contents are unchanged.
- [ ] **W5 (App chrome z-order alignment):** Validate resolver panel z-order against TopNav (`z-50`) in full application page layout. *(Deferred / handed off to Phase 09)*
- [ ] **W6 (Monaco view zones, panel geometry/selected file retention & hook consolidation):** Implement Monaco view zones and scroll alignment for unequal hunks, retain panel geometry/selected file across hide/reopen without full DOM unmount, consolidate redundant `useConflictResolver` query instances, and remove legacy marker-parser fallbacks. *(Consolidation, view zones, and panel geometry retention deferred / handed off to Phase 09)*
- [x] **W7 (Escape widget query scoping):** Scope Monaco widget queries to `panelRef.current`.

### Phase 08 Closure and Handoff to Phase 09 (2026-10-21)

Phase 08 delivered the workspace integration, reveal routing, stage bypass closure, and clean cutover:
- **Reveal intent routing & exact owner/root derivation:** `ChangedFilesList` detects conflicts, suppresses normal diff opening and stage checkboxes, provides "Resolve conflict" context-menu item and active Git operation banner (`Open Resolver`), dispatching through single-source `buildConflictRevealIntent`. For aggregate views, `deriveAggregateConflictRoot` extracts the entry's exact child VCS root and relative project path rather than guessing. `ConflictResolverPanel` consumes the nonce-guarded intent once (`lastConsumedNonceRef`) to prevent selection snapback on background refetch.
- **Action presentation & separation:** Dedicated presentations for text review, binary side choice, delete/modify choices (derived truthfully from stage presence non-missing side), and unsupported entries with terminal handoff; separates Apply & stage from Continue/Finish and Abort.
- **Generic stage bypass closure (CUT1):** Enhanced `stage_files` in `server/src/git/diff.rs` to inspect unmerged index entries under `GitMutationCoordinator` lock, rejecting any batch containing conflicted paths or directory prefixes; UI staging checkbox and bulk actions disallow conflict staging.
- **Legacy code retirement & fail-closed cutover (CUT2):** Completely retired legacy `conflict-parser.ts`, `ConflictBlock` exports, and legacy `{ path, content }` payload; legacy write payloads fail closed (`LEGACY_PAYLOAD_REJECTED`); Android read-only policy coverage preserved via behavioral rewrite in `MergeConflictEditor.test.tsx`.
- **Configured-editor terminal guidance:** Intercepts commit-message editing requirement and directs user to Git's configured editor in the exact owning repository/worktree terminal without message form/adapter or PTY command injection.
- **Phase 07 inherited items:** Closed C1 (panel Escape activation on toggle/open), C2/C3 (narrow tab decoration and line reveal on async mount), W1 (files panel Escape stack scoping to topmost), W4 (dead code and allocation cleanup), and W7 (widget scoping to panelRef).
- **Validation evidence:** Cycle-2 test report (`plans/reports/tester-261021-1406-phase-08-workspace-integration-cutover-cycle2.md`) recorded 364 passing tests (109 UI unit/integration tests across 10 suites, 12 browser component tests across 4 Chromium suites, 39 backend integration tests across 5 suites, 204 server unit tests). Cycle 3 review completed (score 6.0/10; approved by user with accepted deferrals on 2026-10-21). Post-cycle-3 fixes applied for modify/delete stage presence derivation and root-qualified editor keying.
- **Explicit handoff to Phase 09 (Qualification and documentation):**
  1. **Step 12 live-daemon multi-worktree smoke testing:** Live production runtime verification with authenticated app registered to nested repositories, aggregate Changed Files, two conflicts plus unrelated staged file, delayed apply with newer typing, lost response, repeated operation stop, and configured-editor terminal handoff.
  2. **Inherited deferrals:** Extended multi-panel browser test matrix (W2/W3), app chrome z-order alignment (W5), and Monaco view zones, panel geometry/selected-file retention & hook consolidation (W6).
## Success criteria

- AC1: terminal-started four-operation conflicts open through row and status into floating resolver; EditorTabs inventory is unchanged.
- AC5/AC6: only intended reviewed text/side/delete stages; last-file apply never continues; unsupported entries remain visible and nonmutating.
- AC8/AC9: aggregate/nested/linked root launch targets actual row root; stale/partial/unknown outcomes retain draft and never silently rebind/replay.
- CUT1: checkbox/context/bulk and direct mixed stage request cannot stage conflicts generically; clean-only staging remains functional.
- CUT2: no production references to old marker parser/ConflictBlock or unchecked payload remain; one coordinated UI/server contract/renderer, legacy writes fail closed without fallback/shim and no incompatible intermediate deployment; Android input policy remains meaningfully covered.
- CUT3: delayed applied response cannot erase typing made after submit or close a panel showing a newly discovered conflict.
- Actual future smoke: authenticated production app registered to nested repos with aggregate Changed Files, two conflicts plus unrelated staged file; open from row, apply reviewed empty text, continue separately into next rebase conflict.
- Delay apply response and type newer text, then reopen from operation status; inspect owner/root requests, raw bytes/index tuples, retained later revision and unchanged tab list.
- Gate fails for second production path, guessed aggregate root, permissive stage endpoint, fallback/shim, automatic Continue, message form/adapter, automatic PTY injection, handoff-as-success or lost recovery/history. Required Linux/human qualification remains a Phase 09 release gate; separately Pending Windows-native client proof alone is nonblocking.

## Risk assessment

Integration callbacks can accidentally reuse currently selected owner rather than submitted owner; route captured immutable identities end-to-end.
Broad cleanup searches can remove unrelated ConflictDialog or Android policy behavior; delete only proven obsolete references.
External git add can remove conflict stages without app mediation; surface stale recovery truthfully rather than attempting original-stage restoration.

## Security considerations

No UI route bypasses server authentication, path validation or preconditions; escaped display paths never become write arguments.
Ensure old draft payload is not sent after profile/root replacement even if component selection changed mid-request.
Keep capture fixtures synthetic and controlled; avoid exposing real repository content in evidence.

## Next steps

Phase 08 is administratively closed with accepted deferrals; hand integrated production path, completed reference inventory, and remaining qualification items to [Phase 09](./phase-09-qualification-and-documentation.md).
Phase 09 executes Step 12 live-daemon multi-worktree smoke testing, W2/W3 extended browser test matrix, W5 z-order alignment, and production web / actual Linux Tauri qualification.
Any unfinished cutover, wrong-root actions, lost newer edits/history, missing authoritative refresh, or permissive legacy/generic staging bypass blocks qualification; contract-only scaffolding is not a delivered resolver.
## Unresolved questions

- Phase 08 implementation closed with user approval (2026-10-21).
- Outstanding technical items formally handed off to Phase 09:
  1. Step 12 live-daemon multi-worktree smoke testing (delayed apply with newer typing, lost response, repeated operation stop, configured-editor terminal handoff/return).
  2. Inherited Phase 07 items: W2/W3 extended browser test matrix, W5 app chrome z-order alignment, W6 Monaco view zones and hook consolidation.
  3. Platform qualification: Authenticated production web and Linux-native runtime evidence (Windows-native remains nonblocking / deferred).
