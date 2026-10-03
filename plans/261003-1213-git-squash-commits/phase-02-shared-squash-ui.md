# Phase 02 — Shared squash selection, dialog and both Git surfaces

## Context links
- [Overview](./plan.md), [authoritative preflight](./preflight.md), [backend phase](./phase-01-backend-squash.md), [integrated qualification](./phase-03-qualification-finalization.md).
- [Frontend scout](../reports/scout-261003-1213-squash-frontend.md), [backend scout](../reports/scout-261003-1213-squash-backend.md).
- [Shared frontend conventions](../../docs/frontend-components.md#shared-git-history-view-search-plan-phase-04), [Git components](../../docs/frontend-components/terminal-and-ide.md#git-workspace-panel), [history ownership/search](../../docs/architecture/git-history-search.md), [repository rules](../../AGENTS.md).
- [Existing browser focus regression](../../packages/ui/browser-tests/git-history-dialog.browser.tsx), [prior runtime qualification guidance](../261001-2003-git-history-search-persistence/phase-07-qualification-documentation.md).

## Overview
Date: 2026-10-03. Priority: P2. Status: implemented and verified; [qualification evidence](./reports/qualification.md). Backend wire/error semantics integrated.

This file is implementation contract/design only. No source implementation, runtime validation or docs changes performed during planning. This invocation supplies UI-design involvement in planning; **implementation owner must still involve a UI designer during frontend implementation and visual/accessibility review**. cmd-code owns implementation; parent runs integrated checks after writers finish. Phase 03 owns actual qualification, docs/changelog and approval.

## Key insights
- Current `GitLogTree` separates a single detail-selected row from context-menu actions; multi-selection must add an independent checkbox channel, not replace normal click/Enter/Space detail selection.
- Log `message` is subject-only. Existing `commitMessage` returns full UTF-8 text plus branch/head snapshot; read every selected hash coherently before enabling squash.
- History is a DAG; displayed order, dates, matching-row adjacency and graph lanes do not prove a chain. Validate direct `parents` relationships. The scout's suggested unfiltered-only restriction is **superseded**: allow genuinely parent-contiguous selection on filtered pages too.
- `effectiveScopeKey` currently contains branch **preference**, not the resolved checked-out branch while following active. Add a squash-specific scope boundary including resolved/active canonical refs, query/page and availability; otherwise external checkout can retain stale selection.
- Existing leased-push hook has scope and operation-generation fencing. Its scope string does not include transport generation; ensure a stale prepared preview cannot remain actionable after reconnect, not merely that old network completion is ignored.
- Standalone `BulkGitOperations` owns an independent push root. Squash publication must use the history target/root, never that bulk selector or the project-root Local Changes sidebar.
- Discovery found neither `docs/design-guidelines.md` nor `docs/development-rules.md`. Use AGENTS, existing frontend docs, Radix components and theme; do not create a standalone guide. Local design searches were run in required product/style/typography/color order after reading `ui-ux-pro-max`, followed by `aesthetic`, `frontend-design`, `ui-styling`. Results support restrained developer-tool hierarchy, functional warning colors and legibility; recommendations are not permission to replace existing JetBrains Mono/theme or import fonts/assets.

## Requirements
1. Select >=2 distinct commits, wholly on the currently loaded page (200-row bound). Require available, resolved active local branch. No bulk, remote-view, detached/unborn or cross-page selection. Pushed commits remain eligible.
2. Derive oldest-to-newest order from parent hashes, not row positions. Reject selected merges/gaps/disconnected or branching selections locally with visible reason. Server validates ancestry/reachability, CAS and merges among all rewritten descendants, including unloaded/filtered-out history.
3. Selection/draft/consent/publication offer are transient. Clear on profile/project/worktree/root/branch/preference/connection-generation/availability/query/page changes; do not persist them in history store. No stale completion can update another scope or reopen a closed dialog.
4. Separate full-message batch load, editable final message and local mutation from separately confirmed publication. Preserve UTF-8 bodies and user edits; message must be nonempty after trim-for-validation only, and end with LF.
5. Keep index/working tree/remote unchanged by squash; warnings explain selected and descendant OID changes, oldest selected author/current repository committer, and local-only operation. Never demand a clean worktree or prohibit pushed selection.
6. Preserve existing edit/drop/reset/normal-push contracts, typed Git errors/recovery and uncertainty. No new dependencies, assets, signature detection heuristics, auto-push, blind retry, prepare-squash endpoint or new WebSocket protocol.

## Architecture

### Data flow and module boundaries
`useGitHistoryView` transient hash selection + parent-chain derivation → controlled `GitHistoryToolbar` count/action and `GitLogTree` checkboxes → `useGitHistoryActions` delegates focused squash lifecycle to new `use-git-squash.ts` → owner-bound full-message reads and `useGitSquash` mutation → REST mapping → local ODB rewrite. Success clears obsolete details/selection and exposes a same-scope publication receipt → existing leased prepare/preview/confirm flow.

Keep one shared implementation for both hosts. `GitLogTree` and toolbar remain controlled/presentational; no direct API/store access. A focused new dialog/hook/helper avoids growing the existing ~1,050-line action file with another full state machine. The action facade keeps shared status-banner conventions and resets; discover all consumers and migrate both, with no obsolete alternate squash state.

### API and refresh contract
- Add `SquashCommitsInput`: `hashes: string[]` ordered oldest-to-newest, `message`, `expectedBranch`, `expectedHeadOid`, optional `allowSignatureRemoval`.
- Add typed `ApiClient.git.squash(target, input, root?)` in **both** factory implementation and exported interface. Invoke internal `git:squash` transport key with `toWireTarget(target)`, input, root. Client ownership is connection-bound; browser `profileId` never becomes a server body field.
- Map `git:squash` in `ws-transport.ts` to additive authenticated `POST /api/git/{encoded project}/squash`, JSON `{ hashes, message, expectedBranch, expectedHeadOid, allowSignatureRemoval?, worktreePath?, root? }`. This is REST despite transport filename; no WS server handler/event is implied.
- Add `useGitSquash(target, root?)` in `queries.ts`, following normalization/owner binding and target-unavailable error handling. Explicitly `retry: false`; freeze the invocation's target/root/owner before asynchronous work.
- Return existing `GitActionResult`, no new result DTO fields/reasons. Success `hash`/`newTargetOid` = synthesized squash OID; `oldTargetOid` = newest selected/tree endpoint (`hashes[last]`); old/new HEAD fields are actual tip pair. `rewrittenCount` = **1 synthesized object + strict descendants**, not selected count or number removed. Removed commits = frozen `hashes.length - 1`; do not derive it from `rewrittenCount`.
- Preserve existing typed InvalidInput/UnsupportedHistory/UnreachableCommit/stale-ref errors and `signature-consent-required`/`publication-uncertain` handling; do not invent additional `blockedReason` variants. Display backend recommendation/recovery faithfully.
- On `ok`, reuse `invalidateGitBranchOperation` for branch/status/projects/all history variants/diffs/conflicts/fs-tree/editor reconciliation, plus `invalidateGitHistoryDetails(qc, capturedTarget, capturedRoot)` **without a hash** because descendants also change. Broader existing invalidation is acceptable; never invent unowned cache keys. Invalidate/inspect the captured target on uncertain result too; do not turn uncertainty into success/retry-safe failure. Background refresh failure after a proven mutation must not reclassify it as safe to submit again.

### Selection and scope contract
- View exposes `squashSelectedHashes`, toggle/clear callbacks, derived selection `{ count, orderedHashes, entries, valid, disabledReason }` and `squashScopeKey`. Keep detail `selectedCommit` independent.
- Pure helper takes current loaded entries and selected hash membership. Reject unknown/duplicate input, <2 entries and any selected entry with >1 parent. For each selected entry, link its sole selected parent if present; require exactly one oldest endpoint and one newest endpoint, no selected-parent forks. Traverse the chain using hashes; visit every selected node exactly once, return oldest-first. Oldest may have zero parents (root) or one predecessor outside selection. Missing intermediate hash makes disconnected selection invalid; never fetch/auto-select hidden intermediates. Use O(page + selection) maps/sets, no timestamp sorting or graph-layout computation.
- Example: filtered visible `C(parents=[B]), A(parents=[P])` is invalid even if adjacent. `C(parents=[B]), B(parents=[A])` is valid even if interleaved with unrelated matches or displayed in another order. Filters are not a blanket prohibition; page-boundary selection cannot be expanded implicitly.
- Squash scope combines existing effective scope, resolved view canonical ref, checked-out canonical ref, draft search text, applied query, page/offset and availability. Including actual branch fixes follow-active checkout; including draft search clears selection immediately during debounce/IME rather than leaving the old query actionable. Existing single-detail selection/search semantics need not be broadened.
- Follow existing synchronous scope-owned reset pattern; gate render and callbacks immediately, not solely a post-render reset effect. Increment operation token on cancel/reset/reopen/unmount; compare captured scope, owner generation and token before accepting full-message/mutation/publication completion. Scope can change away and back: old token must still fail.
- Successful page refresh reconciles selected hashes against the current loaded page and reruns chain checking. If selected entries disappear, clear selection and invalidate any open preparation; never keep hidden checkboxes. A changed head may still leave old hashes visible: CAS stays authoritative.
- Require successful root/branch discovery and exact canonical active-local-ref match for actionable squash; do not rely only on current hook's permissive `isViewingActiveBranch` during unresolved discovery or a display-name comparison. Nonactive view retains details/context-menu browsing and explanatory existing notice.

### Interaction and visual design

**History:** add a narrow leading selection cell in graph **and** list rows, outside the graph lane coordinates. Header text/screen-reader label: “Select commits for squash”; no Select All or implicit shift-range feature. Checkbox label: “Select {short OID}: {subject} for squash”, native checked/disabled state. Native checkbox reuses existing signature-consent convention (no checkbox dependency). Checkbox/label click and Space do not bubble to detail selection; guard row keyboard handler to act only when the row itself is the event target. Preserve row click, row Enter/Space and right-click/context-menu details behavior. Checked membership is shown by checkbox, not repurposed single-detail highlight or color alone.

**Toolbar:** extend the shared controlled toolbar with squash count/reason/actions, rendered in both graph/list presentations above the scrolling rows. Active resolved branch: “0 selected” + disabled “Squash commits”; with selection: “N selected” + “Clear selection” + “Squash N commits”. Visible help says “Select at least two parent-contiguous commits on this page.” Invalid selections remain editable with a specific visible reason; use `aria-describedby`, not tooltip-only copy. Nonactive/unavailable state shows reason and no actionable selection. Count updates use one polite status region, not an announcement on every row rerender. Action is never hidden behind hover/right-click.

**Dialog wireframe (one column):**
1. Title “Squash N commits”; scope summary profile/project, worktree when selected, root, checked-out branch.
2. Oldest → newest abbreviated OIDs and count; overflow-safe full OID access. Mention descendants are also rewritten; do not invent an affected count from a partial page.
3. Permanent caution: “Creates one local commit and rewrites later commit IDs. Files, index and remote stay unchanged.” Add author/committer rule concisely.
4. When any selected entry `isPushed`, prominent “Includes commits already pushed upstream. Collaborators may need to reconcile history. Publishing is a separate leased confirmation.” Always retain generic “If this history is shared…” caution; `isPushed` is local tracking knowledge, not live remote truth.
5. Visible label “Combined commit message” + resizable multiline textarea, helper “Full messages, oldest first. Edit the final message.” Loading/error area; signature consent area when server requests it.
6. Footer “Cancel” (secondary/ghost) and danger “Squash locally” (pending “Squashing…”). Default generated draft is valid without edits; do **not** reuse edit-message's unchanged-text prohibition.

**Layout/accessibility:** reuse Dialog/Button/theme tokens (`--color-surface`, `--color-background`, `--color-text`, `--color-border`, `--color-primary`, `--color-warning`, `--color-danger`) and JetBrains Mono. No palette/font replacement. Body/helper copy ~12–14px with 1.5 line height; message field ~14px. Use primary text for critical instructions if muted contrast insufficient. Meet WCAG AA contrast (normal text 4.5:1, focus/control boundaries 3:1), visible focus and text+icon warning hierarchy. Dialog ~560px desktop, existing `dialog-viewport-fit`/safe areas narrow; scroll body, reachable footer, no page-wide horizontal overflow. Wrap long labels, scope and messages, retain details layout. At 320px+, stack footer/actions; on compact/coarse pointer give new checkbox label and buttons >=44px hit targets. Increasing actual compact row height must also adjust graph `ROW_HEIGHT`/SVG geometry so lanes do not become misaligned; desktop dense rows may remain 28px. No decorative motion; disable added transition/spinner motion under reduced-motion while preserving textual pending feedback.

### Full-message and operation lifecycle
1. Opening freezes qualified target, root, resolved active branch, owner/generation, scope/token and a copied oldest-first hash array. Selection controls are read-only while dialog is open. No mutation until coherent reads complete.
2. Resolve one bound client once, then `Promise.all(hashes.map(hash => client.git.commitMessage(capturedTarget, hash, capturedRoot)))`. Fresh reads per dialog, not independently cached stale snapshots. Reject the whole batch on any failure; do not enable a partial draft. Every response must have identical branch/head and branch equal captured active canonical branch. A mismatch shows “History changed while loading messages. Refresh and select again”; no silent merge of snapshots or automatic retry. Backend validates head/branch/chain again at mutation time.
3. Compose complete messages unchanged, oldest-first, inserting a blank-line boundary: between entries insert `\n` if previous message ends with LF, otherwise `\n\n`; then ensure final LF using existing `normalizeCommitMessage`. Example `a\n`, `b\n` → `a\n\nb\n`. Preserve existing body/trailing whitespace; do not trim messages to compose them or replace bodies with row subjects. Existing extra trailing blank lines remain, rather than silently stripping user content.
4. Freeze coherent `{ expectedBranch, expectedHeadOid }` and initialize draft **once per opening**. Background refetch, consent/error change or rerender must not overwrite edited text. Submit validates `draft.trim().length > 0` only, sends full normalized draft and frozen hashes/snapshot; first request omits/false consent.
5. On `signature-consent-required`, retain draft/snapshot/selection, explain removal covers **selected commits and every rewritten descendant**. Show unchecked “Allow removal of invalidated signatures”; retry only after explicit check + submit. Consent belongs to this frozen request, resets on scope/selection/reopen, never persisted or inferred from pushed status. Keep warning, error and consent simultaneously visible. Signature consent is a recoverable blocked state, not a fatal error that permanently disables submit.
6. Loading: non-destructive initial focus on dialog title/loading region, polite “Loading full commit messages…”; textarea disabled. When ready focus textarea only if user has not moved focus elsewhere. Read failure: focus/announce actionable inline error, allow Cancel and deliberate retry of the **entire** batch in unchanged scope; no fallback subject draft.
7. Ready: Escape/Cancel/X close without mutation, retain checkboxes so user can adjust/reopen, discard draft/consent. Restore focus to launching toolbar action. Mutation pending: freeze draft/consent, disable duplicate submit/Cancel/X, guard Escape/outside-click/`onOpenChange` dismissal, announce local operation. Current DialogContent always renders X: add a narrow optional `closeDisabled` prop defaulting false if needed, used only here; do not silently change all dialog consumers. Scope navigation/unmount still clears/fences UI, not cancels or rolls back an already submitted backend rewrite.
8. Known backend rejection/error: retain edited draft, announce/focus inline error summary with recommendation, restore usable controls. Signature block allows explicit consent retry; stale/unsupported/active-operation failures are not auto-retried. Stale snapshot requires close/refresh/reselect; preserve draft in open dialog for copying until explicit close. Post-CAS `publication-uncertain` or ambiguous transport outcome: no success claim or enabled resubmit; offer inspection/refresh, never retry blindly.
9. Proven success: close dialog, clear all obsolete hash/detail selection (including rewritten descendants), reset consent/frozen request, invalidate captured scope consumers. Announce “Squashed N commits locally. Remote unchanged.” Show new target/head metadata where useful, do not confuse squash OID with tip. Focus a stable toolbar container/action fallback, not a deleted row/disabled launcher. Radix close-auto-focus override must fall back safely when initiator is gone; restore outside input/pointer lock, no manual global unlock hacks.

### Separate same-scope publication
- After success render “Publish rewritten branch” beside scoped success notice. Receipt is transient `{ capturedTarget, root, ownerGeneration, branch, newHeadOid }`; not an authorization token/durable server receipt. Reset on scope changes and superseding rewrite. No automatic prepare/push; first click prepares a new lease **after** squash.
- Focused squash hook owns a dedicated invocation of existing `useLeasedGitPush` for the same target/root; both hosts render existing GitForcePushDialog and PassphraseDialog for this flow. Existing Workspace force-push and GitPage BulkGitOperations remain independent; do not synchronize/widen bulk root as a workaround. Never open squash editor and publication confirmation simultaneously.
- Extend leased hook only where needed: optional expected source `{ branch, sourceOid: receipt.newHeadOid }`, checked against ready prepare result **before** storing its frozen snapshot/enabling Publish. Mismatch blocks as changed local source, requires inspecting current history; do not publish an unrelated new tip under this success offer. Include expected source and owner transport generation in scope/reset fencing; preserve ordinary hook consumers without expected-source constraint.
- Confirmation uses current prepare preview: exact profile/project/worktree/root, branch, destination, expected remote OID and rewritten source OID; explicit separate “Publish Branch” danger button. Prepare never publishes; backend exact-OID lease revalidates local/remote/upstream on confirm.
- Cancel returns to scoped success notice, changes neither local nor remote refs. Close/prepare/publish completions are fenced by captured scope/token/generation. Stale remote/local/config invalidates lease; Refresh Lease requires another inspected preview/confirmation. `unknown` remains uncertainty, no automatic/repeated publish; Refresh Lease inspects advertisement, not proof a prior send failed. Focus returns to surviving publication launcher/toolbar after closing; existing passphrase cancellation behavior remains authoritative.

## Related code files
Exact existing files discovered by glob/grep and read in this session; new paths below are explicit proposals, not claims of existing files.

| Existing path | Change/responsibility |
|---|---|
| `packages/ui/src/api/client.ts` | Input type, factory + ApiClient interface method, existing result fields |
| `packages/ui/src/api/queries.ts` | Owner-bound squash mutation, shared invalidation/detail prefixes |
| `packages/ui/src/api/ws-transport.ts` | REST mapper, no WebSocket protocol addition |
| `packages/ui/src/api/ownership.ts` | Reuse normalized qualified target/wire projection; intentionally unchanged |
| `packages/ui/src/hooks/use-git-history-view.ts` | Independent transient hashes, chain result, full squash scope/resets/reconciliation |
| `packages/ui/src/components/organisms/GitLogTree.tsx` | Native controlled checkboxes, row/keyboard/context-menu preservation, compact graph geometry |
| `packages/ui/src/components/molecules/GitHistoryToolbar.tsx` | Controlled count, clear/squash actions, visible disabled reason |
| `packages/ui/src/components/organisms/GitHistoryActions.tsx` | Delegate squash state/handlers/status through existing action facade; reuse normalization/status helpers |
| `packages/ui/src/components/organisms/WorkspaceGitPanel.tsx` | Shared selection/action/dialog wiring, current root, clear obsolete details, stable focus |
| `packages/ui/src/components/pages/GitPage.tsx` | Same integration for exactly one available target; history publication independent of bulk root |
| `packages/ui/src/hooks/use-leased-git-push.ts` | Expected-source/transport-generation fencing only where missing |
| `packages/ui/src/components/organisms/GitForcePushDialog.tsx` | Reuse prepared lease preview/confirmation and uncertainty UX; contextual scope label only if needed |
| `packages/ui/src/components/ui/Dialog.tsx` | Optional disabled-close affordance for pending squash, preserve default consumers |
| `packages/ui/src/components/atoms/Button.tsx`, `packages/ui/src/index.css` | Reuse variants/theme/viewport fit; avoid unrelated changes |
| `packages/ui/src/components/organisms/GitLogTree.test.tsx`, `GitHistoryActions.test.ts`, `WorkspaceGitPanel.test.ts` | Extend true selection/action behavior; do not add mocked prop-forwarding tests |
| `packages/ui/src/components/pages/GitPage.test.tsx`, `packages/ui/src/hooks/use-git-history-view.test.tsx` | Real controller/surface transitions and unavailable/scope guards |
| `packages/ui/src/hooks/use-leased-git-push.test.tsx`, `packages/ui/src/api/queries.test.ts`, `packages/ui/src/api/ws-transport.test.ts` | Mutation invalidation, leased safety and actual transport boundary regressions |
| `packages/ui/browser-tests/git-history-dialog.browser.tsx`, `packages/ui/vitest.browser.config.ts`, `packages/ui/package.json` | Existing Chromium/focus harness and commands; browser mode is component coverage |

Proposed focused new files: `packages/ui/src/lib/git-squash-selection.ts` (+ `.test.ts`), `packages/ui/src/hooks/use-git-squash.ts` (+ `.test.tsx`), `packages/ui/src/components/organisms/GitSquashDialog.tsx` (+ `.test.tsx`), `packages/ui/browser-tests/git-squash-dialog.browser.tsx` if browser-only cases merit a focused suite. Discover parent-directory/module exports before creating; use existing modules if equally cohesive. No throwaway implementation scaffold.

Docs references intentionally unchanged here; Phase 03 updates `docs/api-reference.md`, `docs/architecture/git-history-search.md`, `docs/frontend-components/terminal-and-ide.md`, `docs/CHANGELOG.md` after observed qualification.

## Implementation Steps
1. UI designer reviews this contract against current frontend docs/theme and both real host layouts. Discover affected declarations/callers/tests, including both existing `useGitHistoryActions` callers (Workspace panel and Git page). Lock API/metadata semantics to Phase 01; no new server DTO reasons/fields.
2. Add client input/method in factory/interface, REST mapper and owner-bound no-retry query mutation; reuse wire target projection and invalidation. Preserve edit/normal push. Add transport-boundary regression with complete multiline input and qualified worktree/root.
3. Implement pure parent-chain helper and shared view selection/scope/reset/reconciliation. Keep detail state independent; require resolved active local canonical branch. Include follow-active external checkout, reconnect and query/page fences.
4. Add accessible checkbox channel to both row presentations; preserve row event semantics. Extend controlled toolbar count/action/reason; use same model on both hosts, filtered parent-contiguous chains included. Implement compact hit areas with matching graph geometry.
5. Implement focused squash hook/dialog. Delegate through existing action facade with required history-scope input; migrate both consumers together. Freeze inputs and bound owner, perform fresh Promise.all full-message reads, initialize combined draft once, validate/normalize without body loss. Implement consent, known/stale/uncertain errors and pending dismissal/focus contract.
6. Integrate panel/page selection/count/dialog/status and on-success detail/hash clearing. Keep availability and canonical branch gates; page multi/empty/offline modes must not call squash. Preserve details/file-diff routing and project-root Local Changes behavior.
7. Implement transient success receipt and dedicated same-history-target/root leased publication. Reuse existing force-push/passphrase dialog and no-blind-retry semantics; add expected-source + transport-generation fencing where missing. Never route via page bulk root.
8. Add behavior regressions below; convert affected obsolete forwarding/wording tests rather than repinning implementation details. Do not mock the selection/action hooks to prove their own integration. Controlled API responses/deferred promises may exercise browser races; assertions must show user-visible behavior and resulting request/state, not merely mocked callback calls.
9. Parent runs focused tests/typecheck/browser after integration, then Phase 03 actual loopback server + Chromium qualification and docs/review. No build/lint/tests/formatters or Git mutation during this planning task.

## Todo list
- [x] Add typed REST client/mapper/query mutation and captured-scope invalidation.
- [x] Add independent parent-validated page selection and complete reset fences.
- [x] Deliver accessible graph/list checkboxes, shared action/count and combined-message dialog.
- [x] Integrate both actual surfaces, consent/error/focus and obsolete-detail clearing.
- [x] Add same-history-root separate leased publication and stale-source/generation guards.
- [x] Add behavior/browser regressions; hand integrated changes to Phase 03 qualification.

## Success Criteria

### Permanent behavior tests
| Case | Observable acceptance |
|---|---|
| Chain correctness | Oldest-first topology from scrambled/interleaved rows; root chain valid; one/gap/disconnected/fork/selected-merge/unknown hashes invalid; timestamps/visible adjacency cannot bypass validation |
| Filtered pages | Real parent-contiguous matching entries selectable/squashable; adjacent matches missing ancestor blocked; no hidden expansion; page change clears all hashes |
| Detail coexistence | Checkbox click/Space only changes membership; ordinary row click/Enter/Space and context menu still open correct details; same graph/list behavior |
| Toolbar + availability | Count/clear/action/reason visible and accessible in both hosts; no active squash off active canonical branch, unresolved root/branch, empty/multi/unavailable page target |
| Message fidelity | Bodies, Unicode/Vietnamese diacritics, whitespace and trailers retained oldest-first; missing-LF and existing-LF boundaries correct; unchanged default allowed; blank-only disallowed |
| Coherent read | Every selected hash read in frozen root/owner; one failure/mismatching branch or head blocks entire draft; stale Promise.all completion ignored; deliberate whole-batch read retry works |
| Draft/consent | Rerenders/errors/refetch do not overwrite edits; signature block preserves draft and requires explicit consent for all affected objects; no consent leakage across openings/scopes |
| Pending/cancel/errors | One submit, no pending dismissal/repeat; ready/read-error cancel has no mutation; known rejection visible; stale/uncertain outcomes not retry-safe success; focus restored without modal lock |
| Scope races | Target/profile/worktree/root/canonical branch, follow-active checkout, generation, search draft/applied query, page/availability resets; away-and-back old completion cannot reopen or clear new state |
| Refresh/success | Removed selected rows clear preparation; success clears old details even if a descendant was detail-selected, updates history and invalidates all root details/editor consumers |
| Publication routing | Git page history root differs from bulk root: only history root changes remotely; success alone leaves remote unchanged; prepare has no publish; expected-source mismatch prevents confirmation |
| Lease fencing | Local/remote/config drift and reconnect/closed/superseded receipt invalidate preview; cancel leaves refs; `unknown` never blind retry; fresh preview requires explicit confirmation |
| Transport boundary | Real client/transport path emits encoded REST URL/full JSON + worktree/root to bound owner, not WS or profile field; response/error exercised with consumers, not mocked invocation echo |

Use pure helper tests for topology and rendered real components/controller with API-bound fixtures for state tests. For focus/actual input, extend existing Vitest Browser Mode Chromium harness (existing synthetic rewrite harness is **not** full-stack proof). No source-file text assertions, copied implementation constants/field lists or tests solely asserting one mock forwards another mock. Assertions about actual rendered roles/checked/disabled/focus and actual transport requests are behavior evidence.

Planned focused commands for the integration parent, not run during planning:
```sh
pnpm --filter @dam-hopper/ui test src/components/organisms/GitLogTree.test.tsx src/components/organisms/GitHistoryActions.test.ts src/components/organisms/WorkspaceGitPanel.test.ts src/components/pages/GitPage.test.tsx src/hooks/use-git-history-view.test.tsx src/hooks/use-leased-git-push.test.tsx src/api/queries.test.ts src/api/ws-transport.test.ts
pnpm --filter @dam-hopper/ui test:browser browser-tests/git-history-dialog.browser.tsx
pnpm --filter @dam-hopper/ui build
```
Also run each actual new helper/hook/dialog/browser test path created above; never claim old-suite filters cover new files. UI `build` is TypeScript check, not web asset build. Phase 03 separately owns actual web build/broad gates.

### Chromium real-surface validation guidance
Phase 03 uses isolated loopback Axum + actual Vite web app and disposable registered repositories/bare remote. Discover current CLI/config/runtime routing before launching; no real user repo, no overwritten local config or port. No response mocks in this journey.
1. Workspace IDE dock, terminal floating panel and compact Git: select true chain, open details independently, see count, read/edit multiline oldest-first draft and perform local squash. Observe actual REST hashes/message/root/snapshot and Git CLI old/new local OIDs, count, message, final tree/index/dirty-worktree preservation. Confirm no remote movement before publication.
2. Standalone Git page with exactly one qualified available target: repeat older range with linear descendants and nested root. Set bulk root intentionally different; local squash and later publication must still use history root. Include root-inclusive range, pushed warning and a signed fixture triggering explicit consent. Confirm selected/rewritten-descendant merge rejection has intelligible explanation and no ref move.
3. Filter real history to two parent-contiguous matches: allow selection/squash in list. Filter two nonconsecutive matches: block despite visible adjacency. Change query/page/root/branch and reconnect while read/prepare is pending; no stale action leaks. Nonactive branch and multi/unavailable projects remain fail-closed.
4. Choose Publish rewritten branch after pushed squash, inspect destination/expected remote/source OIDs, cancel once, then explicitly confirm fresh prepared lease. Independently check bare remote OID/tree. Separate fixture advances remote from another clone after prepare: stale rejection must preserve advanced remote. Advance local HEAD/reconnect after prepare: old confirmation unavailable/stale; no wrong-source publication.
5. Capture screenshots at 320px+, 768px and >=1024px, keyboard-only checkbox/message/consent/Cancel/publish flow, focus after successful removed rows, Escape/X/pending behavior, pointer/input restoration in terminal mode, long UTF-8 scope/message wrapping and reduced motion. Measure contrast rather than claim it from theme names. Record actual commands/network/OID observations and screenshots in plan evidence; report unavailable native/browser scenarios as limits, not passing evidence.

## Risk Assessment
- **False topology from filtering:** chain helper uses parents only, no inferred gaps; hidden descendant merges remain server authority. Explain backend blockers without adding blanket filter prohibition.
- **Mixed snapshots/body loss:** fresh concurrent reads + all-response equality + frozen CAS; never concatenate row subjects or replace edited draft after consent/refetch.
- **Wrong-owner/root publication:** capture qualified target/root/generation and receipt source; independent dedicated history flow, no bulk fallback. Existing operation generation is not enough to retain preview across transport reconnect.
- **Modal/input lock:** checkbox nested keyboard bubbling, pending X, deleted initiator and sequential dialogs need real Chromium tests; preserve Radix compose-refs patch/shared overlay handling, no global body-style workaround.
- **Unknown completion:** post-CAS/backend or network uncertainty can mean mutation happened; inspect/invalidate, forbid blind resubmit/publication. Pending UI dismissal does not cancel Git.
- **Partial-page warnings/accessibility:** tracking `isPushed` is not live remote/signature evidence; always caution shared history, request signatures from server consent mechanism. Compact row hit area changes must keep graph geometry aligned. No unverified contrast/native qualification claims.

## Security Considerations
Existing authentication/target/root authorization remains authoritative. Never project `profileId` into server JSON, derive target from project name alone, log full messages/credentials or persist message drafts/consent/lease receipts. React text rendering only; commit content is untrusted, never HTML or shell interpolation. Keep UI selection bounded loaded page; no uncontrolled full-history fetch. Cancel/reset fences hide stale UI but cannot promise rollback. All destructive validation uses disposable repos/local bare remote and loopback-only no-auth fixture server; no automatic development commit/push.

## Next steps
Implement this full contract with frontend UI-designer involvement, integrate Phase 01 API, then hand to Phase 03 for coordinated checks, real-surface qualification, review/approval and docs/changelog. No new setup/config/dependencies needed.

## Unresolved questions
None. Internal component/helper details may be refined against current code without broadening scope, weakening filtered selection, changing API semantics or omitting either surface.
