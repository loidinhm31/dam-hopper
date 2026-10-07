# Phase 06 — Editor host integration and edge states

## Context links

- [Parent](./plan.md); [contracts](./contracts.md); [Phase04](./phase-04-monaco-annotation-gutter-and-context-menu.md); [Phase05](./phase-05-workspace-git-reveal-and-full-commit-details.md).
- [Workbench ownership](../../docs/architecture/workbench-files-editor-and-git.md); [verification matrix](./verification.md).
- Dependencies:03/04/05 complete and interfaces integrated.

## Overview

- Date: 2026-10-05. Priority: P2.
- Implementation status: pending. Review status: pending.
- Complete real Explorer→source editor→annotations→Workspace Git flow, including wrappers and hidden/unavailable surfaces.

## Key Insights

- EditorTabs currently derives active Git root from changed-file index. That cannot be the eligibility/root source for blame of clean files.
- Markdown/HTML Edit/Split mount Monaco; Preview mode may unmount it. Tab-owned toggle must survive without background requests.
- Shared UI covers web/native; no separate native blame implementation or Tauri IPC needed.
- Existing Android policy suppresses editor writes; blame mode must not re-enable input or lose view-state behavior.

## Requirements

- Every scoped normal/degraded source host receives original target, tab enabled state, source visibility and reveal callback.
- Clean file usable even without activeGitState. Server decides actual repository owner.
- Unsupported/no-history/disconnected/stale states explicit; no ambient/root/HEAD fallback.
- Tab change, source preview mode and layout switch preserve preference/dirty content but stop source work when inactive.
- Responsive annotations use actual editor-container width, including Markdown/HTML Split and narrow panes on wide viewports. Normal author/date and compact author-only both retain full hover/focus metadata.
- Focus/manual/relevant-event refresh is available in every supported source host; no feature-added periodic requests. Dirty bytes and source selection survive refresh.
- Edge-state behavior from contracts visible to consumers, not only API fixtures.

## Architecture

```text
WorkspacePage(current qualified target + layout + reveal handler)
 -> EditorTabs(active qualified tab + session toggle)
 -> MonacoHost OR MarkdownHost/HtmlHost(source-only context)
 -> useEditorGitBlame + annotation column
 -> source-validated reveal callback -> Workspace Git
```

- Keep behavior in shared components; web/native host wrappers remain thin.
- Original tab target wins over ambient current target. Unsupported surfaces do not create controller/network subscriptions.

## Related code files

Modify:

- `packages/ui/src/components/organisms/EditorTabs.tsx`: context/toggle/reveal plumbing, source eligibility/visibility independent of changed-file index.
- `packages/ui/src/components/organisms/MarkdownHost.tsx`, `HtmlHost.tsx`: forward annotation context to source pane, pause in Preview.
- `packages/ui/src/components/organisms/MonacoHost.tsx`: final prop/lifecycle integration from04.
- `packages/ui/src/components/pages/WorkspacePage.tsx`: all EditorTabs instances across IDE, terminal floating Explorer and compact variants.
- `packages/ui/src/stores/editor.ts`: final session lifecycle close/unavailable/hydration integration; no storage schema change.
- `packages/ui/src/components/organisms/EditorStatusBar.tsx`: only if needed for explicit unsupported/unavailable source affordance; no unrelated redesign.

Extend existing EditorTabs/Markdown/HTML/view-mode browser tests for observable remount/session behavior; existing diff/binary/large/media preview hosts intentionally unchanged apart from a necessary disabled explanation.

## Implementation Steps

1. Inventory all EditorTabs/MonacoHost/MarkdownHost/HtmlHost and workspace callbacks; use LSP references before changing exported props when available. Record intentional no-op contexts (merge/diff/media) rather than forwarding incomplete/fake targets.
2. Thread annotation context through each actual Explorer editor host. Target comes from active tab's immutable target; enabled state from session tab flag. Do not require `activeGitState` or a dirty file to enable blame.
3. Connect committed-row reveal callback to Phase05 WorkspacePage ensure-open handler. Recheck current owner/tab model snapshot before constructing request; server root/hash from latest response.
4. Define `sourceActive` from selected tab + visible workspace/editor/source mode. Cancel debounce/request intents and retire results when panel closed, page hidden, tab inactive or Markdown/HTML Preview selected—even when mounted behind CSS. No periodic refresh timer exists.
5. Preserve enabled flag when changing Edit↔Split↔Preview or workspace layout within session. Refresh when source returns; do not reuse annotation result from disposed model/version.
6. Implement honest UI outcomes: untracked/new/unborn all uncommitted; empty has no committed row; non-repo/unavailable worktree/root shows explanation; stale resource binding blocks requests/reveal; busy/limit/native error states clear old authors and offer existing scoped Refresh.
7. Enforce unsupported tiers (diff/merge/binary/image/video/large) and rendered previews without hidden backend calls. If action is presented outside source, explain unsupported mode rather than failing silently. Do not add tree-menu entry point or large-file full reads.
8. Confirm staged/committed rename mapping and nested repository reveal path reconstruct correct project-relative historical diff. Existing marker click action still uses original file-diff semantics.
9. Verify clean unchanged file after in-app Git commit/checkout/history rewrite reblames without disk changes. Repeat external HEAD change with unchanged mtime: window focus/visibility restoration or Refresh Annotations discovers new attribution; continuous focus without events adds no requests/detection promise. Dirty buffer never overwritten.
10. Add consumer-visible wrapper/session tests: Preview pauses work, source remount restores enabled state, same path in worktree/profile isolated, close/reopen resets off, Android remains read-only, dirty stale tab recoverable. Exercise full/compact container transitions and enabled manual Refresh through Markdown/HTML Edit/Split, not just normal code.
11. Run targeted integrated source-host regressions after edits settle. Smoke actual full app with code/Markdown/HTML source, no-history file and nested/worktree case; inspect source state on return from Git panel in all available layouts.
12. Do not declare complete from mocked wrappers. Carry actual runtime evidence into07: full/compact/narrow-split captures, full metadata accessibility, usable marker/fold/code space, container resize without requests or cursor/scroll loss, focus/manual external refresh, and honest native-host limits.

## Todo list

- [ ] Clean file and original-target source context integrated everywhere in scope.
- [ ] Session toggle persists through source/layout remounts; inactive work stopped.
- [ ] Actual annotation→Workspace Git callback wired and owner-validated.
- [ ] Unsupported/no-history/empty/busy/stale/size states visible and honest.
- [ ] Markdown/HTML/source wrappers and Android/read-only state regressions pass.
- [ ] Responsive narrow-pane and focus/manual/relevant-event refresh behavior exercised across source hosts.
- [ ] Full app integrated smoke reaches commit body without losing dirty content.

## Success Criteria

- Open a clean text file from Explorer, enable blame and reveal exact commit; no changed-file record required.
- Markdown/HTML Edit and Split share responsive full/compact behavior and Refresh Annotations; Preview sends no feature requests and returns with enabled preference intact.
- Off/closed/inactive/hidden/unavailable sources produce no feature work or stale visible commit actions.
- Same-path two-profile/worktree tabs never share toggle/result/request ownership.
- Git markers retain primary-click diff behavior and unaffected colors; annotations do not collide with fold/line-number targets.
- Narrow panes on wide viewports compact by wrapper width, preserving full hover/focus metadata, marker/fold hit targets and dirty editor state; no feature-added periodic requests even when source stays focused.

## Risk Assessment

- Layout CSS keeps inactive host mounted: explicit active/visibility contract, not mount heuristics.
- Optional wrappers forget a prop: callsite inventory and real source-pane smoke.
- Unexpected repository edits during later execution: reread current files, adapt; do not overwrite user changes using plan line numbers.
- New request must remain feature-scope: no broad editor/transport refactor or preview rewrites.

## Security Considerations

- Dirty recoverable old-profile tabs must not request through replacement endpoint without existing resource-binding approval.
- No hidden source reads for preview/media/large file; no autosave when navigating.
- Cognito/input isolation and Android edit policy remain independent of blame visibility.

## Next steps

- Phase07 full qualification, evidence, documentation and readiness review.
- Unresolved questions: none for required scope; native-host runtime availability is a verification dependency, not authorization to omit shared integration.
