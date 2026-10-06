# Phase 02 — Native Read API and Containment

## Context links
- [Parent](./plan.md), [contracts sections 2–4,7](./contracts.md), [backend design](./research/backend-contract.md).
- Dependency: [Phase 01](./phase-01-source-parser-and-date-semantics.md) DTO/parser.
- [Filesystem/workbench architecture](../../docs/architecture/workbench-files-editor-and-git.md), [API auth](../../docs/api/authentication.md).

## Overview
- Date: 2026-10-06. Priority: P2. Estimate: 8h, not a commitment.
- Implementation status: Completed.
- Review status: Approved (Score: 9.5/10, Advisor: clean).
- Add protected immediate-folder browsing and single-selected-plan reads, plus narrow strict-document/directory-watch options to existing filesystem seams. No automatic collection status load; manual workflow/default IDE behavior remain independent.

## Key Insights
- Existing target resolver and sandbox handle configured roots and registered external worktrees. Never accept arbitrary scan roots.
- Existing generic reads separately detect/stat/reopen and permit large/uncapped ranges; UI truncation cannot establish a safe decisive snapshot.
- Existing FsSubsystem target subscriptions set watcher root to target root even for deeper filters. Because watchers are nonrecursive, extra filter-only subscriptions would still miss nested progress.
- Watch subscription acknowledgements currently snapshot unrelated trees, and receiver lag only logs. Avoid those allocations and silent stale coverage for this feature.

## Requirements
- Exact GET /api/plans/folders and GET /api/plans with required planPath; DTO/error/bounds/source/date contracts. No AppState service field, cache, second database or new auth policy.
- On-demand immediate names/marker metadata only; selected plan/progress full snapshots only. Explicit listing limits and missing/unreadable distinction; no recursive scan or sibling-content reads.
- Root/ancestor/file nofollow descriptor snapshots, same-handle metadata, nonregular/FIFO denial and current target revalidation.
- Strict `.md` detail reads within captured target, including evidence outside plans/. Existing general IDE reads remain unchanged by default.
- Actual-directory event-only subscriptions and existing overflow recovery vocabulary; no global recursive watch or unrelated explorer fix.
- Implement safe Unix/Windows code and preserve builds. Linux runtime proof here; Windows runtime explicitly unqualified until exercised there.

## Architecture
- Handler obtains `AppState.workspace_context_guard`, resolves typed target through `resolve_project_target`, and binds approved root identity. Copy config/target data before blocking I/O; revalidate before response.
- Synchronous bounded folder browser/selected reader in spawn_blocking produces exact DTOs; filesystem primitives stay crate-private and shared with strict detail reads. Parser runs only for selected plan/progress snapshots.
- API route belongs directly in protected router, not optional workflow route/service.
- watchOnly true branches to actual-directory subscription helper using shared FsWatcherManager/WatcherKey; false preserves current default target-root semantics and snapshot behavior.

## Related code files
Under `/home/loidinh/WS/dam-hopper/`:
- Create `server/src/plans/scan.rs` and `server/src/api/plans.rs`.
- Modify `server/src/plans/{mod,dto}.rs` only for scanner/API integration under one backend owner; Phase 01 owns parser baseline.
- Modify `server/src/api/{mod,router}.rs`: declare/mount authenticated GET /api/plans/folders and /api/plans.
- Modify `server/src/fs/secure_path.rs`: rooted bounded enumeration/snapshot primitives; reuse existing platform handle dependencies.
- Modify `server/src/fs/mod.rs`: narrowly add validated actual-directory subscription helper, preserving default tree subscriptions.
- Modify `server/src/api/fs.rs`: optional strict ReadParams mode and shared snapshot branch.
- Modify `server/src/api/ws_protocol.rs`: optional watchOnly/readMode fields with explicit wire names/defaults; preserve existing kind envelope and existing snake_case fields.
- Modify `server/src/api/ws.rs`: strict FsRead branch, watch-only directory registration/no snapshot and receiver-lag FsOverflow cleanup.
- Modify `server/src/api/error.rs`/`server/src/error.rs` only as required to map typed plans errors into existing envelope; no duplicated response convention.
- Create `server/tests/plans_api.rs`, extend `server/tests/ws_fs_subscribe.rs` and focused secure_path tests for observable security/event behavior.
- Intentionally unchanged `server/src/state.rs`, workspace resolver registry, workflow models/store/migrations and watcher recursion setting. Expand existing Windows feature flags only if required by handle operations.

## Implementation Steps
1. Run LSP references before changing exported FS/protocol/types; map all existing constructors and client callsites. Freeze optional absent defaults and exact wire names, no whole-enum rename that breaks existing FS fields.
2. Add typed query decode rejecting duplicate/unknown fields. Resolve project/registered worktree using current server config and workspace guard; root identity is approved authority, not the supplied worktree pathname.
3. Implement pinned-root nofollow enumeration and same-descriptor regular snapshot. Unix uses openat/nofollow/nonblock and fstat; Windows uses native handles/reparse rejection and stable identity. Bound every probe/read and avoid allocations for excluded/unretained data. Reject unsupported security path explicitly rather than follow symlinks.
4. Browse requested immediate directory under fixed plans/ with contract entry/path/response bounds. Skip utility/hidden/symlink components; archive groups remain browsable. Probe only current directory's regular plan.md marker without byte reads; plan kind returns no child listing. Do not recursively scan, probe child statuses or reserve per-child watches.
5. Selected read requires planPath and regular plan.md membership. Read only selected plan/progress full snapshots, at most2 decisive reads/128KiB. A present unreadable/symlink progress opts into unknown, never fallback. Detect named-entry/in-place/config/root changes and return changed/target-conflict immediately; no retries or cross-file transaction claim.
6. Parse selected snapshots via Phase 01; bound retained output. Folder JSON may omit whole trailing names with listing.complete false/limit diagnostic. Selected JSON over2MiB rejects413, never drops phases. Return only current path ancestors/directory watchPaths, max33; unselected siblings remain unopened/unwatched.
7. Mount both authenticated GETs independent from optional WorkflowService. Reuse sanitized errors. Missing plans root gets missing folder response/root watch; missing nonroot/no-plan marker is404, omitted planPath400. Resolver failures never masquerade as empty results.
8. Add existing REST/WS FS read strict mode. Accept target-relative Markdown anywhere inside selected target, full-only 64KiB/noNUL UTF-8, descriptor metadata and revalidation; reject ranges/unsupported modes/nonregular/symlink/content changes. Preserve default generic IDE mode and successful transport shape.
9. Add optional watchOnly to FsSubTree. Validate actual watched directory and call new actual-directory helper; WatcherKey.root must be that directory. No recursive traversal. Return TreeSnapshot nodes:[] without tree_snapshot_sync. Default mode unchanged.
10. When event receiver lags or outbound queue overflows, send existing FsOverflow and release that subscription with current cleanup path. Client rebinds/rescans. Preserve path/from rename event semantics; no new envelope or plan-status event inference.
11. Add temporary-filesystem/Git-worktree cases for folder-only browsing and selected membership/source/limits. Browse more than200 sibling plans with an unselected unreadable/FIFO-containing folder without reading its documents; selected normal plan still works. Add deterministic descriptor races for outside symlink, root/ancestor/config replacement and prompt FIFO rejection; assert no outside bytes and unchanged bytes/mtime/ctime.
12. Exercise actual nonrecursive nested directory watch, atomic progress rename, absent-folder creation, watch-only mode with snapshot-unreadable directory contents and default subscription compatibility. Loss recovery has consumer-visible resubscription/read proof; do not test source text/field copies.
13. Integrate once, then Phase 05 runs focused and full gates. No mid-flight build/test/lint/formatter commands or real-project mutation during planning/implementation slices.

## Todo list
- [x] Rooted immediate enumeration/selected snapshot primitives and numeric limits.
- [x] Typed authenticated folder/selected handlers and error mapping.
- [x] Strict REST/WS document read mode.
- [x] Actual-directory watch-only branch and loss cleanup.
- [x] Temporary-filesystem/security/worktree/event regression cases.

## Verification Evidence
40/40 tests passing across `plans_api.rs`, `ws_fs_subscribe.rs`, `secure_path.rs`, and `plans::tests`:
- `server/tests/plans_api.rs` (13 integration tests):
  - `test_plan_folders_missing_plans_root`: Missing plans/ root returns clean empty response with root watch path.
  - `test_plan_folders_browsing_and_exclusions`: Immediate browsing respects hidden/symlink/utility exclusions.
  - `test_plan_folders_plan_kind_no_children`: Plan kind folders omit child listings to avoid unnecessary recursion.
  - `test_plan_folders_group_browsing`: Subfolder group browsing correctly returns immediate child entries.
  - `test_plan_folders_not_found`: Non-existent folder paths return 404 cleanly.
  - `test_plan_folders_query_validation`: Query parameter bounds, required fields, and traversal validation.
  - `test_plan_folders_bulk_siblings_and_unreadable`: Browses 200+ siblings without reading documents; unreadable entries handled safely.
  - `test_selected_plan_read_happy_path`: End-to-end plan read with frontmatter, phases, and reconciled progress.
  - `test_selected_plan_read_absent_progress`: Graceful fallback when progress document is absent.
  - `test_selected_plan_read_symlink_progress`: Symlinked progress document safely rejected with unknown status.
  - `test_selected_plan_missing_plan_md_returns_404`: Folder without plan.md marker returns 404.
  - `test_selected_plan_query_validation`: Validates required planPath parameter and malformed query handling.
  - `test_strict_rest_fs_read_plan_document`: Strict REST read mode enforces regular file checks and size bounds.
- `server/tests/ws_fs_subscribe.rs` (2 WebSocket integration tests):
  - `test_ws_fs_read_strict_plan_document_mode`: WebSocket strict document read verifies bounds, descriptor reuse, and symlink rejection.
  - `test_ws_fs_subscribe_watch_only`: Watch-only subscription targets actual directory with empty initial snapshot.
- `server/src/fs/secure_path.rs` (7 unit tests):
  - `writes_through_directory_handles_and_checks_mtime`: Pinned directory descriptor write and mtime check.
  - `rejects_symlinked_parent_without_touching_outside`: Symlink parent path traversal rejected without descriptor leak.
  - `refuses_replaced_root_identity_before_commit`: Detects modified root identity before file commit.
  - `replace_regular_file_success_and_conflict`: Atomic regular file replacement with CAS content check.
  - `replace_regular_file_rejects_symlink_and_directory`: Replacement rejects non-regular files and symlinks.
  - `read_regular_file_bounded_limits_and_symlinks`: Bounded file read rejects symlinks and oversize inputs.
  - `read_regular_snapshot_and_probing`: Descriptor snapshot, file marker probing, and immediate directory reading.
- `server/src/plans/tests.rs` (18 parser & bounds unit tests):
  - 18/18 pure parser, DTO bounds, GFM table reconciliation, and diagnostic unit tests verified.

## Success Criteria
- A01, A05/A06 bounds, A08 server detail boundary, A09 watch capability, A11/A12 safe reads and A15/A16 on-demand/platform portions pass when exercised.
- File folders/selected plan remain readable without SQLite WorkflowService; all manual CRUD/notes/session behavior unchanged.
- General IDE reads/tree consumers keep existing default semantics; new strict/watch callers explicitly opt in.
- Only current navigation ancestors/selected directory are actually watched at their directories, not filter-only root events or every listed child.
- Unsafe/path-changed/oversize/nonregular content cannot become displayed decisive status or leak outside-target bytes.

## Risk Assessment
- Rooted enumeration/read platform differences: implement safe cross-platform handles; Linux runtime proof and preserved builds do not certify Windows runtime. Never pathname-only fallback.
- Enumeration races/atomic writer changes: diagnostic changed state, later watcher/user refresh; no retry-to-green loop.
- Large folders: immediate-name bounds and visible listing truncation; selected read cost independent of sibling count. No global recursive scan/inotify setup.
- Shared exported protocol changes: one backend integration owner and LSP callsite migration; optional fields are new capabilities, not deprecated shims.

## Security Considerations
- Standard protected API auth; no credentials/body/private absolute paths in URLs or logs.
- Rooted relative access rejects traversal, symlink/reparse, nonregular, ranges and stale target identity in strict mode.
- Dashboard content is data. No Markdown-driven shell/controller/run/permission action.
- Existing generic IDE APIs outside strict mode are not broadly redesigned in this feature.

## Next steps
- Phase 03 consumes exact folder/selected/strict-read/watch-only/loss contracts; Phase 05 proves actual app freshness and unchanged manual/default behavior.
- Unresolved questions: none requiring product input. Native handle semantics and adversarial races require implementation evidence.
