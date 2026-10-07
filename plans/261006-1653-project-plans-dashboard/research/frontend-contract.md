# Frontend integration contract

Planning only; no implementation/runtime verification. Revised after validation interview 2026-10-06. Folder-first, one selected plan supersedes automatic collection Board/Timeline, status filters and per-plan collection subscriptions. [Frozen contracts](../contracts.md) are authoritative.

## Repository evidence retained
- WorkflowContextSurface owns open/selection/mobile state, overview and manual actions; SQLite hierarchy remains separate.
- WorkflowContextDeck is inline, Escape-closeable, currently360px. Sheet is Dialog with35/90dvh and Projects/Plans/Execution segments.
- `WorkspacePage.tsx:2521–2592` supplies profile key and target/terminal callbacks. Preserve current integration, not a second workspace.
- `api/ownership.ts:5–25,66–75,117–123`: profileId/generation and normalized JSON-tuple target identity. `api/query-client.ts:5–10`: profileQueryKey includes generation.
- `api/connections.ts:135–155`: registry invalidation callbacks. Capture explicit owner/originating transport, never ambient active profile.
- `hooks/use-fs-subscription.ts:81–87,117–238`: existing FS subscribe/event/unsubscribe and ownership patterns, but explorer tree/Git/language cache side effects. Do not mount it for unused tree state.
- Actual watcher is NonRecursive; deeper filter still uses target root; subscriptions currently snapshot; receiver lag only warns. Existing WsTransport onFsOverflow dispatch/callback available. Narrow backend extensions required, not assumed existing recursive coverage.
- MarkdownPreview shares ReactMarkdown/GFM/Mermaid; current relative external-tab links need optional target-aware policy. Public content/className defaults must remain unchanged for existing callers.

## Revised surface
- Keep ribbon/open/focus/WorkspacePage callbacks; manual active-item/session summary unchanged. File reports never fake ItemDto/session behavior.
- Desktop expands existing Deck to min(70dvh,720px), minimum320px, independent scrolling. File plans / Manual tracking switch; manual content stays mounted while open to preserve drafts.
- Mobile keeps Projects/Plans/Execution. Shared dashboard inside Plans expands Sheet to90dvh; no new route/modal/iframe/root.
- File plans starts with immediate directory names, breadcrumbs, name filter and Refresh. No content/status reads before selection, no status/priority/tag filter over unloaded plans.
- Group selection browses that group; plan selection loads only that plan. Selected Overview/Timeline/Documents and Back to folders. No multi-plan comparison, load-all option or sibling prefetch.
- Overview exposes selected metadata, reported source/raw claims, known-completed/declared and unknown/conflict counts, diagnostics and freshness. Missing metadata not invented; directory identifier explicitly labelled.
- Missing/empty/truncated listing, auth/unsupported/read error and stale/degraded coverage are distinct. Manual/file failures remain panel-local; current overview-unavailable close behavior needs availability split.
- Key only file subtree by owner/target; retire selection lifetime on plan switch. Folder/tab/refresh changes never remount terminal/editor/workspace or reset manual drafts.

## Queries and lifetime
- API methods api.plans.folders(target,path) and api.plans.read(target,planPath) use existing owner-bound client/REST mapping; serialize project/worktree/relative paths only, no profileId or arbitrary root.
- Folder key: profileQueryKey(owner,'plan-folders',project,normalizedWorktreeOrNull,browsePath). Selected key adds 'plan'/planPath. Strict document key includes normalized path/read mode; never reuse plain read cache.
- Server owns parsing/status/date semantics; no browser parser or imported database identity.
- Reads/watchers enabled only for open surface, valid selected configured target and connected owner. No invented default project or previous-key placeholder data.
- Capture owner,target,browse/plan/document path and effect lifetime before async work. Query cancellation plus explicit lifetime fences prevent old plan replacing a newer selection even under same target/generation.
- Close/target/owner/selection invalidation detaches listeners, cancels queued work/queries and unsubscribes originating ids. Late subscribe completion immediately unsubscribes, never attaches to replacement lifetime.
- Last-good cache usable only for same owner/selection with visible refreshing/stale banner. Subscription handles never stored as reusable query data.

## Navigation-scoped live updates
- use-project-plans composes current folder/selected queries with existing FS seam, not explorer cache or new event vocabulary/socket/store.
- Watch target root and existing requested ancestors/current directory, max33; at most one selected evidence parent. Never register all listed child directories or read unselected statuses.
- watchOnly:true uses validated actual directory as nonrecursive root and nodes:[] ack; backend skips snapshot. Default FS consumers unchanged.
- Attach root -> browse/read current selection -> attach returned navigation paths -> authoritative refetch -> reconcile. Add before remove; concurrency8, churn passes3 then explicit unsettled/degraded coverage.
- Ancestor create/delete/rename/replacement recreates affected descendant handles even if pathname unchanged. Root observes initially missing plans creation. Both rename sides matter.
- Events invalidate current listing/selected/document queries only as relevant. Event bursts coalesce; no status patching, periodic collection polling or sibling content prefetch.
- Overflow disposes affected handle, refetches/rebinds current navigation. Focus/open/reconnect/Refresh recover using same captured scope. Failed coverage never claims live success.
- Back clears selected lifetime and returns originating folder focus, opening no other plan. Reconnect rebuilds owner generation; original transport handles cleaned only through original transport.

## Read-only renderer and selected timeline
- Plan/Progress tabs preserve snapshot/current distinction. Absent/unreadable/oversize/changed progress explicit; captured Pending never masquerades as current.
- Strict existing FS mode reads full64KiB UTF-8/noNUL regular Markdown anywhere inside captured target, including docs/UI review evidence outside plans. No symlink/range/writable fallback.
- Optional MarkdownPreview link/image policy preserves all other callers. Reuse GFM/Mermaid, no cloned renderer/theme/full reader.
- Relative Markdown resolves against source within captured target; reject escape/absolute/NUL/malformed encoding/unsafe schemes. Fragments scroll to local heading IDs. No target switch/editor/PTY action. External http/https uses noopener/noreferrer; issue URL only when known, branch text only.
- Local images always accessible alt/source notices. No relative browser URL, new image ticket/media integration or unsupported-file download fallback.
- Timeline shows only selected explicit planned outline/actual solid ranges with textual source/precision/legend. Creation/start/end milestones or Undated state retained; no mtime/effort bar or phase schedule.
- Calendar day strings never timezone shifted; instants declare display timezone. Open actual requires explicit nonfuture start/in-progress/no end, labelled Now/Today.

## Proposed files and future qualification
- Create api/project-plans-types.ts, api/project-plans-queries.ts, hooks/use-project-plans.ts; modify client.ts/ws-transport.ts narrowly for folders/read/strict/watchOnly.
- Create organisms/ProjectPlansDashboard.tsx, ProjectPlanFolderBrowser.tsx, ProjectPlanTimeline.tsx, ProjectPlanDocument.tsx. No ProjectPlansBoard; selected Overview inline unless real complexity justifies splitting.
- Modify WorkflowContextSurface/Deck/Sheet for shared content/availability/layout; optional MarkdownPreview policy and ribbon intent only. WorkspacePage/ownership/query-client/explorer hook/manual mutations unchanged.
- Future behavioral cases: same-target delayed plan result, owner/worktree isolation, watch loss/replacement, absent root, safe Markdown/Mermaid/image notices, manual draft/session preservation. More than200 folders browse without decisive reads; one selection only.
- Actual app desktop1440x900/mobile390x844/narrow320 proof, atomic selected-progress update and human-reviewed fresh captures required; component mocks/builds do not certify app behavior.
- Implement safe cross-platform code and preserve host builds; runtime proof Linux here. Windows runtime explicitly unqualified until exercised there.
- No command/test/build run in this research. Existing Vitest/browser/Playwright fixtures and commands used later per Phase05; product questions resolved, runtime prerequisites not assumed.
