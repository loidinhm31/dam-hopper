---
title: Target-aware filesystem, WebSocket, and media
description: Route filesystem operations, watchers, WebSocket messages, uploads, encrypted writes, and media tickets through a validated project worktree target.
status: completed
priority: P2
effort: 8h
branch: feat/project-worktree-switching
tags: [worktree, filesystem, websocket, media, security]
created: 2026-08-17
---

# Phase 02 — Target-aware filesystem, WebSocket, and media

## Context links

- [Plan](./plan.md)
- [Phase 01](./phase-01-target-contract-and-resolution.md)
- [Backend research](./research/researcher-01-backend-target-security.md)
- [Architecture](../../docs/system-architecture.md#project-worktree-targets-planned)

## Overview

- Date: 2026-08-17
- Description: Route file operations, watchers, search, uploads, encrypted writes, and media tickets through a validated target root.
- Priority: P2
- Implementation status: completed
- Review status: completed
- Completion date: 2026-08-17

## Key Insights

- Expanding the approved root set must not weaken the existing traversal and symlink boundary.
- Watchers and tickets are long-lived resources, so target identity must be stored with them rather than inferred from current UI selection.
- Raw WebSocket file operations and REST endpoints must evolve together to avoid split behavior.
- Delayed writes are hardened against target replacement: on Unix/Linux, parent directories are reopened with `openat`/`O_NOFOLLOW`, target identity is checked by device/inode, and commits use directory-handle-anchored metadata checks and `renameat`.
- Windows uses the existing canonical/path-based fallback for delayed writes. Handle-anchored parity is explicitly accepted as out of scope for this phase; Windows path-race limitations are documented and do not block completion.

## Requirements

- Accept an optional worktree target on all filesystem REST and raw WebSocket messages.
- Validate relative paths against the resolved target root for reads, writes, search, replace, upload, and encrypted writes.
- Key subscriptions by project and target so multiple worktrees can be observed concurrently.
- Bind image/video tickets to the resolved target and reject cross-target replay.
- Preserve legacy root-only payload compatibility during migration.

## Architecture

`FsSubsystem` obtains a validated target descriptor from Phase 01, then applies existing sandbox rules beneath that canonical root. Protocol payloads carry the target reference, while internal watchers and tickets retain immutable resolved target identity. Selection changes do not mutate or revoke resources belonging to other valid targets.

## Related code files

- Modify: `/home/loidinh/WS/dam-hopper-ws/feat-project-worktree-switching/server/src/fs/sandbox.rs`
- Modify: `/home/loidinh/WS/dam-hopper-ws/feat-project-worktree-switching/server/src/fs/mod.rs`
- Modify: `/home/loidinh/WS/dam-hopper-ws/feat-project-worktree-switching/server/src/api/fs.rs`
- Modify: `/home/loidinh/WS/dam-hopper-ws/feat-project-worktree-switching/server/src/api/ws_protocol.rs`
- Modify: `/home/loidinh/WS/dam-hopper-ws/feat-project-worktree-switching/server/src/api/ws.rs`
- Modify: `/home/loidinh/WS/dam-hopper-ws/feat-project-worktree-switching/server/src/api/fs_image.rs`
- Modify: `/home/loidinh/WS/dam-hopper-ws/feat-project-worktree-switching/server/src/api/fs_video.rs`
- Modify: `/home/loidinh/WS/dam-hopper-ws/feat-project-worktree-switching/packages/ui/src/api/transport.ts`
- Modify: `/home/loidinh/WS/dam-hopper-ws/feat-project-worktree-switching/packages/ui/src/api/ws-transport.ts`
- Modify: `/home/loidinh/WS/dam-hopper-ws/feat-project-worktree-switching/packages/ui/src/api/client.ts`
- Modify: `/home/loidinh/WS/dam-hopper-ws/feat-project-worktree-switching/packages/ui/src/hooks/use-fs-subscription.ts`
- Modify: `/home/loidinh/WS/dam-hopper-ws/feat-project-worktree-switching/packages/ui/src/hooks/use-fs-ops.ts`
- Modify: `/home/loidinh/WS/dam-hopper-ws/feat-project-worktree-switching/packages/ui/src/hooks/use-fs-upload.ts`
- Modify: `/home/loidinh/WS/dam-hopper-ws/feat-project-worktree-switching/packages/ui/src/hooks/use-file-search.ts`
- Modify: `/home/loidinh/WS/dam-hopper-ws/feat-project-worktree-switching/packages/ui/src/hooks/use-search-panel-replace.ts`
- Modify: `/home/loidinh/WS/dam-hopper-ws/feat-project-worktree-switching/packages/ui/src/components/organisms/ImagePreview.tsx`
- Modify: `/home/loidinh/WS/dam-hopper-ws/feat-project-worktree-switching/packages/ui/src/components/organisms/VideoPreview.tsx`
- Modify: `/home/loidinh/WS/dam-hopper-ws/feat-project-worktree-switching/server/tests/fs_sandbox.rs`

## Implementation Steps

1. Extend sandbox validation APIs to accept a resolved target and retain the current canonical containment checks.
2. Add optional target fields to file REST parameters and every root-sensitive `ClientMsg`; update transport interfaces and serialization.
3. Partition watcher registrations and unsubscribe behavior by target identity.
4. Thread target references through file/search/replace/upload/encrypted-write hooks and preserve root defaults.
5. Store target identity in image/video ticket records and revalidate the same target during probe, stream, download, and revoke.
6. Add protocol compatibility, cross-target isolation, watcher concurrency, upload/write traversal, and ticket replay tests.

## Todo list

- [x] Make sandbox validation target-aware.
- [x] Update REST and raw WebSocket file contracts.
- [x] Partition watcher lifecycle by target.
- [x] Route every frontend file/search hook through its target.
- [x] Bind and test media tickets by target.

### Completion record

- [x] Sandbox, REST, raw WebSocket, watcher, upload, encrypted-write, search/replace, and image/video ticket paths resolve through the selected target.
- [x] Media tickets retain immutable target identity and reject cross-target replay.
- [x] Unix/Linux delayed-write commits include handle-anchored hardening for target replacement and symlink races.
- [x] Windows path-based delayed-write fallback limitation accepted as an explicit scope decision; no Windows handle-anchored implementation required for Phase 02.

## Success Criteria

- Identical relative paths in root and two worktrees return independent contents and events.
- Existing root-only clients continue to operate against the configured root.
- Traversal, symlink escape, upload, encrypted write, and cross-target ticket attempts are rejected.
- Switching targets does not tear down another target's active watcher or valid media ticket.

## Risk Assessment

- A missed raw protocol variant can create silent root fallback; use exhaustive match/compiler coverage plus contract tests.
- Watcher key changes may leak old subscriptions; test unsubscribe and reconnect explicitly.
- Media routes have browser cookie/ticket invariants that must remain intact.

## Validation and review results

Validation recorded in `plans/reports/qa-260817-1052-project-worktree-target-validation.md`:

- `cargo test --manifest-path server/Cargo.toml --lib` — 717 passed, 0 failed, 1 ignored.
- `cargo test --manifest-path server/Cargo.toml --test fs_sandbox --test ws_fs_subscribe --test fs_upload --test fs_write_streaming` — 34 passed, 0 failed.
- `pnpm --filter @dam-hopper/ui test` — 1,094 passed, 0 failed across 172 files.
- `pnpm --filter @dam-hopper/ui build` — passed.
- `cargo check --manifest-path server/Cargo.toml` — passed.
- `git diff --check` — passed.

Review outcome: 7.5/10, conditionally shippable for Unix/Linux. The implementation is complete for the accepted Unix/Linux hardening scope. Windows delayed-write path-based fallback remains a known limitation and is explicitly out of scope, not a release blocker for this phase.

## Security Considerations

- All target fields pass through the Phase 01 resolver before filesystem joins.
- Ticket records bind project, canonical target identity, relative path, purpose, session, and expiry.
- Do not log media tokens or encrypted content when adding diagnostics.

## Handoff

Phase 02 is complete; its validation and final review passed. The remaining
phases are recorded as completed in the root plan.
