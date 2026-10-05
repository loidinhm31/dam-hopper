# Phase 02 — Native blame and read-only Git API

## Context links

- [Parent plan](./plan.md); [contracts §§2–4](./contracts.md); [Phase 01](./phase-01-native-semantics-and-contract-proof.md); [backend research](./research/backend-native-blame.md).
- [Git API](../../docs/api/git.md), [code standards](../../docs/code-standards.md).
- Dependency: Phase 01 native semantics approved.

## Overview

- Date: 2026-10-05. Priority: P2.
- Implementation status: pending. Review status: pending.
- Deliver authenticated, bounded native-buffer blame and exact read-only commit details. No frontend work in this phase.

## Key Insights

- Route registration is `server/src/api/router.rs`, not `mod.rs`.
- Global `DefaultBodyLimit` is 10 MiB; blame alone needs 32 MiB JSON envelope while decoded source remains below 5 MiB.
- `safe_join` in `diff.rs` is private and only lexical; it is not sufficient symlink containment proof.
- Native cancellation is not guaranteed. Permit ownership must follow actual blocking work, not HTTP handler lifetime.
- Full commit read must work with detached HEAD and commits outside current branch. Do not loosen `get_commit_message` CAS eligibility.

## Requirements

- Implement `POST /api/git/{project}/blame`, `GET /api/git/{project}/commit/{hash}/details` with contracts' camelCase DTOs/errors.
- Reuse validated configured target/worktree and deepest owning root; root discovery independent of changed-file status.
- Decode/bound input before expensive native work; bind global admission across cloned `AppState`.
- No disk/index/ref writes, temp source files, source logs, user-prompts telemetry, or Git CLI blame.

## Architecture

```text
auth -> bounded JSON -> normalize/validate target/path
  -> try-acquire shared native permit (busy => 503)
  -> spawn_blocking: resolve repo + captured HEAD + native blame_buffer
  -> compact/deduplicated DTO + publication checks + bounded encoding
  -> protected JSON response
```

- Domain owns `GitBlameError` and work bounds; handlers own auth/body/extraction/response mapping.
- Keep permit in closure through completion, even when caller aborts. No queued permit futures.
- Commit details direct ODB reader is separate from branch-qualified editing APIs.

## Related code files

Modify existing:

| File | Change |
|---|---|
| `server/src/git/mod.rs` | Register/re-export new domain operations/types following current pattern. |
| `server/src/git/types.rs` | CamelCase DTOs; no change to existing log subject semantics. |
| `server/src/git/vcs_roots.rs` | Reuse validated root/path mapping; only extract shared logic if necessary. |
| `server/src/git/diff.rs` | Expose/reuse a narrow validated rename helper if needed; no broad diff refactor. |
| `server/src/git/commit_message_rewrite.rs` | Reuse/extract branch-independent raw-message parser only if needed; preserve mutation checks. |
| `server/src/state.rs` | Shared two-permit admission field and every constructor/test fixture initializer. |
| `server/src/api/git.rs` | Read-only exact commit-details handler. |
| `server/src/api/mod.rs`, `server/src/api/router.rs` | Register blame handler and feature-local body/auth layers. |
| `server/src/error.rs`, `server/src/api/error.rs` | Typed stable errors via existing mapping; no blanket string suppression. |

Create proposed:

- `server/src/git/blame.rs`: bounded native attribution, no generic plugin/service abstraction.
- `server/src/git/commit_details.rs`: exact read-only ODB commit metadata/full-message lookup.
- `server/src/api/git_blame.rs`: bounded input/extractor/handler.
- `server/tests/git_blame_api.rs`: real Git/filesystem HTTP behavior and edge/denial cases.
- Native regression tests colocated in blame module; use existing temp repo conventions.

No manifest, lockfile, DB schema or binary changes required.

## Implementation Steps

1. Add proposed DTOs/types from contracts; one-based start + lineCount, null commitIndex for uncommitted, full OIDs, echoed snapshot tokens and resolved root/path. Ensure exact names align TypeScript before merging parallel slices.
2. Add typed errors and code/status mapping. Preserve existing auth/target/non-Git codes. Sanitize error messages; do not include submitted content or raw native absolute paths.
3. Validate paths lexically **before** `resolve_git_path_root`. Reuse sandbox containment for existing paths; handle a valid open buffer whose file vanished with bounded validated parent/path and committed blob mode rather than arbitrary path access. Internal repository-relative translation must retain configured-project boundary.
4. Bound UTF-8 source bytes, baseline blob size/type and metadata. Reject binary/NUL payloads or unsupported modes explicitly. New/untracked/unborn and empty paths use honest documented result states, not generic catch-all fallback.
5. Implement captured-HEAD native blame and `blame_buffer`. Deduplicate commit metadata once per OID; build ordered ranges without copying code lines. Apply Phase 01 terminal-row/CRLF conversion.
6. Resolve staged rename using unique same-repository HEAD→index mapping; do not call a full large status/diff pipeline repeatedly if a narrow native delta suffices. Committed whole-file rename follows proven native behavior.
7. Add shared two-permit `Arc<Semaphore>` initialized once per AppState. Acquire with `try_acquire_owned` **before** scheduling expensive root discovery/blame. Keep its lifetime inside blocking closure; no waiting backlog.
8. Revalidate repository revision/root/target mapping after computation. Return stale-revision error on observed change; do not publish partial/wrong-root results. Use bounded serialized writer/accounting for 32 MiB response cap without duplicate entire serialization.
9. Add ordinary protected route with local 32 MiB body policy. Verify ordering of global `DefaultBodyLimit`, local `RequestBodyLimitLayer` and auth; unchanged routes must retain 10 MiB cap. Handle unknown/chunked Content-Length safely.
10. Implement exact full-OID commit reader. Read subject, original author time/offset, full message including body; reuse raw parser where exact message bytes matter. Rendered textual representation must not silently substitute subject-only history data. Missing/non-commit objects return 404.
11. Wire all AppState constructors/API callers/exports. If exported symbols change, use LSP references when available; otherwise exhaustive caller inventory before edits. No compatibility alias for new signature cutovers.
12. Add plausible consumer-visible regressions: insert/delete/undo/CRLF/trailing boundary, rename, unborn/new, nested root/worktree, detached arbitrary commit/body, traversal/symlink/auth/limits, stale publication and native permit held after dropped caller.
13. After combined backend edits settle, run `cargo test git_blame` and `cargo test --test git_blame_api` once, cwd `server`. For admission/cancel regression, deterministic synchronization around native work—not sleeps or timing-dependent assertions.
14. Smoke actual server on loopback with isolated temp project; POST dirty buffer, GET details, verify exact JSON attribution/body and unchanged disk/index/ref. Also exercise two occupied worker permits and third request's busy response. Use real auth or trusted loopback dev mode with production/Mongo safety environment absent; never expose publicly.

## Todo list

- [ ] DTOs/errors and project/root/path frames implemented.
- [ ] Native attribution/rename/empty/new behavior implemented.
- [ ] Global admission and cancellation-lifetime bounds enforced.
- [ ] Feature-local body cap verified without weakening other routes.
- [ ] Arbitrary exact commit/body reader implemented; edit-snapshot safety unchanged.
- [ ] Regression suite and actual HTTP smoke prove behavior/no writes.

## Success Criteria

- Dirty-buffer HTTP fixture returns expected retained/zero-OID-derived classifications and author offsets; disk/index/HEAD unchanged.
- Clean nested/worktree file routes to actual owner even without changed-file entry.
- Traversal, escaping symlink, binary, oversize and stale snapshot fail with documented codes.
- Detached/unmerged/old exact commit details return full body; existing commit rewrite tests remain valid.
- At most two native workers; dropped HTTP future cannot release a still-active native permit; no queue accumulation.
- JSON-expanded valid near-limit buffer accepted, decoded over-limit buffer rejected, unrelated body limits unchanged.

## Risk Assessment

- Native long-running history consumes a permit until completion: honest busy state, bounded pressure; no hard cancellation promise.
- Body layer ordering: HTTP boundary regression, not config inspection alone.
- Root resolution itself may block/scan: keep under admitted blocking work.
- Private helper extraction may widen diff scope: extract minimum reusable function, preserve callers and tests.

## Security Considerations

- Authentication and current target/worktree authorization precede Git work; profile ID not trusted server-side.
- No source payload `Debug`/trace logging; plain non-sensitive typed error response only.
- Blame of symlinks/submodules prohibited; sandbox containment rechecked for live targets.
- Read-only details does not unlock mutations; write APIs retain existing branch/tip/lease gates.

## Next steps

- Phase 03 typed transport/lifecycle; Phase 05 consumes exact commit-details endpoint.
- Record actual backend proof in implementation evidence; no green claim from this plan.
- Unresolved questions: none beyond Phase 01's required native evidence.
