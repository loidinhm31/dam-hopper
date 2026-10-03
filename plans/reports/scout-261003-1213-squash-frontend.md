# Frontend scout: consecutive Git squash

## Summary

No squash UI, client method, REST mapper case, query hook, or server squash operation was found. Both Git surfaces already share `GitLogTree`, `useGitHistoryView`, and `useGitHistoryActions`; extend these patterns rather than duplicate surface behavior. The current log DTO is insufficient for full-message composition, and pushed-history publication must retain the existing leased confirmation flow.

## Current UI and scope fences

- `packages/ui/src/components/organisms/GitLogTree.tsx` renders one row per supplied log entry in graph or list mode. Rows select one `selectedHash`; right-click opens `HistoryContextMenu` with existing single-commit actions. `GitLogEntry` exposes `parents` and `isPushed`; there is no multi-commit selection.
- `packages/ui/src/hooks/use-git-history-view.ts` owns one `selectedCommit`, root/branch/search/page state, and an `effectiveScopeKey` containing profile, project, worktree, root, branch preference, and connection generation. Scope/query/page changes clear single-commit selection. This shared view is the natural home for transient squash selection and its resets.
- Rewrite callbacks are supplied only when `historyView.isViewingActiveBranch` in `WorkspaceGitPanel.tsx` and `GitPage.tsx`. Preserve that gate: the selected history branch can be a non-active branch, while existing copy says rewrite actions stay on the active branch.
- `GitPage.tsx` shows history only for exactly one available selected project. Empty/all, multi-project, and unavailable selections do not expose history; unavailable targets fail closed. `docs/architecture/git-history-search.md` documents persisted qualified project selection and Workspace-focus independence.
- Rows can be a DAG, not a linear list; filtered history uses list mode and may omit ancestors. Current page size is 200. A safe UI must validate direct ancestry from `parents`, not infer consecutiveness from adjacent visible rows. Smallest safe scope: active, unfiltered branch; selected chain wholly visible on the current page; clear it on filter/page/root/branch/target/generation changes.

## Full message, rewrite, and API gaps

- `GitLogEntry.message` is subject-only; this is explicit in `docs/architecture/git-history-search.md`. Do not build the combined textarea from row messages.
- `client.git.commitMessage` (`packages/ui/src/api/client.ts`) and `useGitCommitMessage` (`packages/ui/src/api/queries.ts`) retrieve a full UTF-8 message plus branch and `headOid` for one hash. `ws-transport.ts` maps it to `GET /api/git/{project}/commit/{hash}/message`. No batch-message endpoint exists.
- Existing `GitEditCommitMessageDialog` in `GitHistoryActions.tsx` has a full-message textarea, loading/error/saving states, nonempty/changed checks, trailing-newline normalization, and signature-removal consent. The action hook freezes message/branch/head/scope and submits expected branch + head OID. Reuse the dialog conventions, but squash needs a distinct full combined-message draft and coherent snapshot for every selected commit.
- `getDropCommitMenuState` disables Drop for pushed commits; `getEditCommitMessageMenuState` allows pushed commits. A squash action must not inherit Drop’s pushed restriction. Show an explicit shared-history warning if any selected entry is pushed; keep backend validation authoritative.
- No squash entry was found in `client.ts`, `queries.ts`, `ws-transport.ts`, or the server Git routes. A real implementation needs a typed client method, profile-bound query mutation, REST transport mapping, and backend endpoint/contract. Follow existing rewrite CAS shape: capture branch/head and reject stale or changed ancestry, with root/worktree and selected hash order bound to the request.

## Leased publication, ownership, and refresh

- `useLeasedGitPush` (`packages/ui/src/hooks/use-leased-git-push.ts`) binds to the resolved profile owner and target/root scope; generation fencing ignores stale prepare/publish completions. `GitForcePushDialog` requires prepare, displays destination + expected remote OID + source OID, then asks an explicit Publish Branch confirmation. Stale/unknown results are not blindly retried.
- `WorkspaceGitPanel` creates that hook with `historyView.rootId`. On the standalone page, `BulkGitOperations` owns a separate `selectedRootId` and leased-push hook, independent of `historyView.rootId`; a squash publication affordance must bind to the history action target/root or synchronize these roots. Do not publish a different VCS root accidentally.
- Query mutations resolve owner from the qualified target. `invalidateGitBranchOperation` refreshes branch/status/projects/log/diff/conflicts/tree and editor tabs; `gitHistoryQueryPrefixes` / `invalidateGitHistoryDetails` provide root-qualified commit detail invalidation. Squash rewrites descendants too, so invalidate the relevant history and old commit details; clear stale detail/selected-row state and refresh after success.
- `packages/ui/src/api/ownership.ts` explicitly projects profile-qualified targets to server `{project, worktreePath?}` while the bound client owns connection identity. Keep profile/worktree/root in every view/action/push scope; never derive server target from project name alone.

## Minimal shared UI shape

1. Add hash selection to `useGitHistoryView`; reset it with existing scope, applied-query, and pagination resets.
2. Extend `GitLogTree` with accessible per-row selection callbacks and selected hashes, without changing row click/keyboard detail selection or context-menu behavior. Offer a count + Squash action on both surfaces only for active-branch, valid consecutive selection.
3. Add a scoped squash state/handler and dialog alongside `useGitHistoryActions` in `GitHistoryActions.tsx`; include selected hashes, full combined message, pushed-history warning, pending/errors, and signature-consent handling. Enforce ancestry and stale-head rules in the backend too.
4. Keep rewrite local and publication explicit. After success, offer the existing leased prepare/preview/confirm path for the same owner/worktree/root; never silently push. Existing top-level Force Push buttons are separate from history actions.

## Guidance and validation paths (not run)

- Relevant guidance: `docs/frontend-components.md` shared Git-history section; `docs/architecture/git-history-search.md`; `docs/frontend-components/terminal-and-ide.md`. These define ownership/controller/component patterns, not a squash visual spec. No repository UI skill or dedicated squash design guide was found. Use existing `Dialog`, `Button`, `ContextMenu`, theme CSS variables, and Radix focus patterns.
- Unit coverage to extend: `GitLogTree.test.tsx`, `GitHistoryActions.test.ts`, `WorkspaceGitPanel.test.ts`, `GitPage.test.tsx`, `use-git-history-view.test.tsx`, `use-leased-git-push.test.tsx`, `queries.test.ts`, `ws-transport.test.ts`.
- Existing Chromium harness: `packages/ui/browser-tests/git-history-dialog.browser.tsx` exercises real menu/dialog focus handoff and restored application input, but its mutation is synthetic and single-commit. Runner is `pnpm --filter @dam-hopper/ui test:browser`; focused example: `pnpm --filter @dam-hopper/ui test:browser browser-tests/git-history-dialog.browser.tsx`. This is component browser coverage, not full-stack E2E.
- Unit command: `pnpm --filter @dam-hopper/ui test src/components/organisms/GitLogTree.test.tsx src/components/organisms/GitHistoryActions.test.ts src/components/organisms/WorkspaceGitPanel.test.ts src/components/pages/GitPage.test.tsx src/hooks/use-git-history-view.test.tsx src/hooks/use-leased-git-push.test.tsx src/api/queries.test.ts src/api/ws-transport.test.ts`; UI typecheck/build: `pnpm --filter @dam-hopper/ui build`.
- Real-app path is documented in `plans/261001-2003-git-history-search-persistence/phase-07-qualification-documentation.md` and `plans/reports/qualification-261002-0245-git-history-qualification.md`: run web + isolated loopback Axum server against a disposable configured repo, and use Chromium. Root `pnpm dev` starts web; `pnpm dev:server` starts no-auth server on `0.0.0.0:4803`, so prefer the documented explicit loopback/isolated-config equivalent. Prior qualification covered history search/persistence, not destructive rewrite/publication; add a disposable-repo squash + leased-publish journey and assert HEAD/remote OIDs. No runtime checks were run for this scout.

## Remaining unknowns

- Backend squash contract is absent: exact selection order/chain and merge semantics, atomic rewrite behavior, expected-head concurrency, signature consequences/consent, response hashes/count, and blocked/error results need coordination.
- Product semantics remain unspecified for consecutive commits across merges, filtered history, or page boundaries, and for the order/separator/default text of a full combined message.
- Confirm whether successful squash should offer an in-dialog leased prepare action or leave publication to the existing Force Push control; either way the publication must remain explicit and use the history root.
