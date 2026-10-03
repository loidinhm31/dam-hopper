# Phase 02 frontend implementation

## Handoff
Implementation source and permanent behavior coverage added. Builds, tests, formatters, lint, browser execution and real-server smoke **not run**, per integration-owner assignment. No development-repository stage/commit/push, dependencies, docs, historical plans or sealed evidence changed. Parent owns integrated qualification, documentation and final statuses.

Backend contract unchanged: oldest-first full hashes, full message and expected canonical branch/head; existing GitActionResult only. Local squash never prepares or publishes automatically. Publication uses a separate history-owned exact-OID leased flow.

## Exact changed paths

### API
- `packages/ui/src/api/client.ts`
- `packages/ui/src/api/queries.ts`
- `packages/ui/src/api/ws-transport.ts`
- `packages/ui/src/api/ws-transport.test.ts`

### State / pure behavior
- `packages/ui/src/hooks/use-git-history-view.ts`
- `packages/ui/src/hooks/use-leased-git-push.ts`
- `packages/ui/src/hooks/use-leased-git-push.test.tsx`
- `packages/ui/src/hooks/use-git-squash.ts` — new
- `packages/ui/src/hooks/use-git-squash.test.tsx` — new
- `packages/ui/src/lib/git-squash-selection.ts` — new
- `packages/ui/src/lib/git-squash-selection.test.ts` — new

### Shared UI / hosts
- `packages/ui/src/components/molecules/GitHistoryToolbar.tsx`
- `packages/ui/src/components/organisms/GitLogTree.tsx`
- `packages/ui/src/components/organisms/GitLogTree.test.tsx`
- `packages/ui/src/components/organisms/GitHistoryActions.tsx`
- `packages/ui/src/components/organisms/GitSquashDialog.tsx` — new
- `packages/ui/src/components/organisms/GitSquashFlow.tsx` — new
- `packages/ui/src/components/organisms/GitForcePushDialog.tsx`
- `packages/ui/src/components/organisms/WorkspaceGitPanel.tsx`
- `packages/ui/src/components/organisms/WorkspaceGitPanel.test.ts`
- `packages/ui/src/components/pages/GitPage.tsx`
- `packages/ui/src/components/pages/GitPage.test.tsx`
- `packages/ui/src/components/pages/GitPage.squash.test.tsx` — new
- `packages/ui/src/components/ui/Dialog.tsx`

### Fixtures / browser coverage
- `packages/ui/src/test-fixtures/git-squash.ts` — new
- `packages/ui/browser-tests/git-squash-dialog.browser.tsx` — new
- `packages/ui/browser-tests/project-worktree-target.browser.tsx`

This report is the only implementation-phase Markdown write.

## Implemented behavior
- Owner-bound typed `git.squash` client and encoded authenticated REST mapper; no WebSocket protocol addition or browser profile field in server JSON. Query mutation explicitly disables retry, captures invocation routing and invalidates branch/editor/history consumers plus all root-qualified details. Refresh failures cannot reclassify a submitted rewrite as retry-safe.
- Transient independent page selection, O(page + selection) parent-chain derivation, oldest-first ordering, root-inclusive chains and filtered true chains. Duplicate/unknown/gapped/forked/merge/cyclic selections fail closed with visible reasons; no hidden ancestor expansion.
- Action gate requires connected qualified profile, successful root/branch discovery and exact active-local canonical ref. Scope includes owner generation, target/worktree/root, branch preference plus resolved/checked-out canonical refs, draft/applied query, page and availability.
- Native 44px leading checkbox cells outside graph coordinates, sticky Log offset, consistent 44px SVG geometry. Checkbox clicks/Space do not select details; ordinary row keyboard/click/context menu retained. Presentation memo includes graph/list mode so switching back from cached filtered rows cannot leave graph rows empty.
- Dedicated hook/dialog loads fresh complete messages through one bound client, rejects mixed branch/head batches, composes unchanged UTF-8 bodies oldest-first and normalizes only terminal LF. Draft initialized once per opening; validation trims only to reject blank content.
- Separate loading/read-error/ready/pending/known-blocked/uncertain states; deliberate full-batch read retry, signature consent covering selected commits plus every rewritten descendant, draft retention, frozen pending controls/dismissal, no duplicate submit or blind uncertain retry.
- Success clears every obsolete detail/hash selection and exposes scoped metadata distinguishing squash OID from branch-tip OID. Receipt captures successful target/root/owner generation/branch/source. Separate prepare/inspect/confirm publication uses this exact history root, independent of Git-page bulk root and Local Changes sidebar.
- Leased prepare validates expected source before confirmation; generation/expected-source/scope fencing resets old previews. Approved snapshot consumed synchronously before publish to prevent repeated clicks; only known SSH cancellation restores it. Unknown remains non-retryable without fresh inspection/confirmation.
- Focus returns to valid launchers or surviving toolbar after normal close/success; scope resets suppress stale editor/publication focus restoration. Compact history/details stack instead of clipping controls; scrollable squash body, reachable footer, full-OID access, long-label wrapping and reduced-motion modifiers.

### Important outcome/reconciliation decision
Loaded-row loss invalidates **unsubmitted** preparation. It does not fence a same-scope already-submitted pending/uncertain outcome: invalidation can remove selected rows before mutateAsync returns, otherwise swallowing a proven success receipt. Pending remains frozen; uncertainty retains read-only draft/inspection and cannot submit. Scope/navigation/generation change still fences all UI. Parent informed of this decision.

## Added behavioral cases — unrun
- Scrambled/interleaved topology, root chain, single/duplicate/unknown/gap/disconnected/fork/merge/cycle and duplicate-page rejection.
- LF and no-LF message boundaries, Vietnamese text, bodies, trailers and existing whitespace/blank lines.
- Actual graph/list checkbox, row Enter/Space and context-menu detail coexistence.
- Real shared controller/dialog/client/REST responses: frozen worktree/root/hash order; descendant-detail invalidation and clearing; no automatic prepare/publish.
- Consent block preserves edits, requires explicit check, sends normalized complete draft, and does not leak into another opening.
- Mismatching branch/head batch, failed batch, deliberate whole-batch retry, cancel without mutation and away/back stale completion.
- Blank-only draft rejection; duplicate submit; pending Cancel/X/Escape; typed stale HTTP rejection versus transport/post-CAS uncertainty.
- Target/profile/worktree/root/branch/generation/page/availability fences; immediate draft-query reset; follow-active checkout; refreshed row loss.
- Same-scope row loss during submission retains success/uncertain outcome rather than losing the receipt.
- Actual Workspace panel flow and filtered-chain action; actual standalone Git page flow with intentionally different history/bulk roots, plus empty/multi/unavailable selection.
- Expected publication source mismatch, transport-generation preview invalidation and no repeated publish after unknown.
- Chromium component cases: real Workspace controller in terminal floating panel, checkbox Space, editable/cancel focus, pending dismissal, removed-row success focus, publication cancel focus, restored outside pointer/keyboard input, 320px Unicode/consent layout, graph/list detail coexistence and reconnect/late-read focus isolation.
- Real client + WsTransport request boundary checks encoded project/full JSON/bound owner and typed signature blocker; no mock-to-mock invocation echo assertions.

Obsolete Workspace mocked-forwarding tests replaced with real controller/component behavior. Existing Git-page unrelated fixtures migrated and incidental mocked callback wiring assertions removed. Project-worktree browser fixture migrated without treating its unrelated mocked squash controls as feature evidence.

## Design involvement
`SquashUiDesign` reviewed current source twice. Concrete findings incorporated: nested event isolation; checkbox/SVG geometry and sticky offset; compact detail layout; pending-close guards; scrollable body/footer; 44px disclosures/publication controls; scope-safe focus; reduced motion. No designer runtime or measured-contrast claim.

Used current frontend/history docs, shared Radix Dialog/Button, semantic theme tokens and JetBrains Mono. Required local design searches ran in product/style/typography/color order; no new palette/fonts/assets or standalone design guideline created.

## Recommended integration commands — all unrun here
```sh
pnpm --filter @dam-hopper/ui test src/lib/git-squash-selection.test.ts src/hooks/use-git-squash.test.tsx src/hooks/use-git-history-view.test.tsx src/hooks/use-leased-git-push.test.tsx src/components/organisms/GitLogTree.test.tsx src/components/organisms/GitHistoryActions.test.ts src/components/organisms/WorkspaceGitPanel.test.ts src/components/pages/GitPage.test.tsx src/components/pages/GitPage.squash.test.tsx src/api/queries.test.ts src/api/ws-transport.test.ts
pnpm --filter @dam-hopper/ui test:browser browser-tests/git-squash-dialog.browser.tsx browser-tests/git-history-dialog.browser.tsx browser-tests/project-worktree-target.browser.tsx
pnpm --filter @dam-hopper/ui build
```
Then parent-owned broader gates and isolated real Axum + Vite + disposable Git/bare-remote Chromium journeys from Phase 03. UI build is TypeScript checking, not web asset build.

## Risks / qualification limits
- All new and affected tests remain unexecuted; integration must run them once writers finish and resolve observed failures.
- HTTP/browser fixtures are component/transport behavior coverage, not real Git or full-stack proof. Real local/remote OID/tree/index/worktree/signature/leased-publication preservation remains Phase 03 responsibility.
- Actual 320/768/1024 layouts, compact panel allocation, keyboard/focus/modal-lock behavior, reduced-motion rendering, native scenarios and contrast ratios require parent observation. Token reuse is not a measured WCAG claim.
- Scoped receipt exists only after proven success with backend newHeadOid. No fallback guesses a source on an incomplete/uncertain response.
- Cancel/scope reset fences presentation only; it cannot cancel or roll back an already submitted server rewrite.

## Unresolved questions
None. Backend DTO/rewrite metadata contract agreed with `SquashBackendImpl`; integrated verification intentionally belongs to parent.
