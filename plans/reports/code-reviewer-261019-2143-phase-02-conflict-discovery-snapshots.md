# Code Review — Phase 02 Conflict discovery and snapshots

Verdict: **CHANGES REQUESTED, score 5/10.** Phase 02 not accepted; keep Phase 03 mutation + release blocked until Critical/High fixed.

## Scope
- Server: `git/conflict.rs` (new, 1009 LOC), `git/types.rs`, `git/mod.rs`, `git/diff.rs` (`open_repo` pub(crate)), `git/tests.rs`, `error.rs`, `api/git_diff.rs`, `api/router.rs`, `tests/git_conflict_discovery_api.rs`.
- UI: `api/client.ts`, `api/ws-transport.ts`, `api/queries.ts`, `MergeConflictEditor.tsx` + test, `test-fixtures/git-squash.ts`.
- Plan: `plans/261019-1505-git-conflict-resolver/phase-02-conflict-discovery-and-snapshots.md`, `design-contract.md`.

## Validation run
| Command | Result |
|---|---|
| `cargo test --test git_conflict_discovery_api` | 6/6 pass |
| `cargo test --lib git::conflict` | 5/5 pass |
| `cargo clippy --all-targets` | 15+ warnings in `conflict.rs` (needless `&[0]` borrows, `too_many_arguments` 8/7, redundant guard `known == "lfs"`) |
| `npx tsc -p tsconfig.json --noEmit` (packages/ui) | clean |
| `npx eslint` on changed UI files | 3 warnings; `ConflictFile` unused import (queries.ts:38) is ours |
| Probe test (temp, deleted): `git2 get_attr_bytes` | `-diff` -> `"[internal]__FALSE__"`, `ident` -> `"[internal]__TRUE__"`, `-filter` -> `"[internal]__FALSE__"`, unspecified -> `None`, `filter=foo` -> `"foo"` |
| `cargo fmt --check` | repo-wide pre-existing drift (879 hunks); not used as signal |
Passing tests prove only the 6+5 asserted cases; no test for attributes, oversize/bounds, races (AC8), non-UTF-8 paths, linked worktree/nested root (AC1/AC9), unreadable-vs-missing, gitlink, traversal.

## Critical
1. **Breaks Windows CI build (`server_windows` job: `cargo test --no-run`, `cargo check --all-targets`).** `conflict.rs:243,706` import `std::os::unix::fs::MetadataExt` unguarded; `tests/git_conflict_discovery_api.rs:465,471,477` use `std::os::unix::fs::symlink` unguarded; tests also use `GIT_CONFIG_GLOBAL=/dev/null`. Rest of codebase gates unix APIs with `#[cfg(unix)]`. Fix: cfg-gate/`#[cfg(unix)]` the mode/mtime accessors with portable fallback (`meta.len()`, `modified()`), gate symlink test. Server compile is not waived by deferred Windows-native client qualification.
2. **Attribute interpretation wrong (conversion-policy gate unreliable).** `conflict.rs:179` compares ident to `b"set"/b"true"`; `:463-467` compares `diff` to `b"unset"/b"false"`; `:189-193` filter match. libgit2 returns sentinel strings for set/unset, so `-diff` binary hint never fires, `ident` is never `true` (ident-expanding files treated as plain text), `-filter` yields `filterQualified=false` only by accident. Fix: use `git2::AttrValue::from_bytes(...)` (`True/False/String/Unspecified`); add tests for each state. Also `text`/`-text`/`crlf` attrs and `core.autocrlf`/`core.eol`/`core.safecrlf` config are not inspected or fingerprinted although design-contract requires "effective conversion/config fingerprint".
3. **Bounds applied after materialization (AC11 / "enforce before allocation" violated).**
   - `conflict.rs:604-607`: `repo.find_blob` loads full blob, then size checked. 1 GB blob -> 1 GB read. Use `repo.odb()?.read_header(oid)` for size first; only load when under cap.
   - `:479` (summary): every page entry fully loads one blob for sniffing (<=500 full blobs/request). Spec step 3: summary must not read every blob. Use `read_header` size gate, then bounded read (`Odb::reader`) or skip sniff for oversize.
   - `:646-647`, `:766-767`: `split_lossless_line_tokens` builds full `Vec<String>` and only then checks `MAX_LINES`; 5 MB of `\n` allocates ~5M Strings per stage (x3 stages + worktree). Add early-abort limit param (count lines/long lines before allocating).
   - `:753`: `std::fs::read` after `meta.len()` check is unbounded if file grows; use `File::open(..).take(MAX+1)`.
   - `:778`: `is_dirty_vs_stages` re-`find_blob`s all three stages unbounded; compare via `Oid::hash_object` of disk bytes or size-gate first.

## High
4. **Read failure collapsed into "missing".** `:695-704` `Err(_) => Missing` for any `symlink_metadata` error (EACCES etc.); phase step 6 forbids this. Only `ErrorKind::NotFound` -> Missing; else `Unreadable`. `StageKind::ReadError` / `WorktreeKind::Gitlink` are declared but never produced; blob/IO errors turn the whole snapshot into HTTP 500 instead of a classified descriptor (contract + AC6/AC7).
5. **Gitlink (submodule) conflicts 500.** Summary marks Unsupported, but snapshot (`:604`) does `find_blob` on a commit OID -> error. Worktree reported as `Directory`. Branch on stage mode before blob read; emit Unsupported descriptor + `WorktreeKind::Gitlink`.
6. **Snapshot carries no classification.** `ConflictSnapshot` has no `status`/`unsupportedReason`; symlink-mode stage content is returned as `Text` tokens (link target), `filter_qualified=false` text still ships tokens. Writable clients can't tell eligibility; apply same classification as summary and withhold tokens for unqualified entries.
7. **Pagination unsafe.** `:357-370` cursor = `v1:{HEAD}:{offset}`; any malformed/mismatched cursor silently resets to offset 0 (client can loop forever), offset shifts when an entry is resolved between pages -> entries silently skipped (violates "never lose entries"). Return 409 `REFRESH_REQUIRED`/400 on bad cursor; page by last raw path (index is path-sorted) + index fingerprint.
8. **Non-UTF-8 paths.** `:403,559` lossy `display_path` is then used for disk join (`verify_safe_worktree_path`), `get_attr_bytes`, stage `path`, snapshot `path`. Wrong file may be inspected/attributes mismatched; entry not marked Unsupported (contract: escaped safe label, no mutating path guessed). Mark Unsupported when raw path is not valid UTF-8; use raw bytes (`OsStr`) for disk/attr.
9. **Mixed-state UI.** `MergeConflictEditor.tsx:182-185,170`: sources from snapshot but result content from separate `useGitFileDiff` (can mix repo states, bypasses snapshot bounds/eligibility); `textTokens?.join("") ?? ""` renders missing/binary/unsupported/oversize as empty text (the exact collapse the phase forbids); lookup by `path` only in first page (truncated entries unreachable); no `root` passed to either hook. Gate on `StageKind`/`worktree.kind`, use snapshot worktree tokens, carry `conflictId`+root.
10. **`lfs` allowlisted** (`:191`) with no evidence that effective LFS filter config is qualified. Phase 01 decision needed (see questions).

## Warnings (Medium)
- `verify_safe_worktree_path` (`:94-126`): fail-open on `canonicalize` Err (`if let Ok`); final-component escaping symlink aborts whole snapshot with 400 instead of reporting `WorktreeKind::Symlink`; only `ParentDir` rejected (Windows `C:x` prefix would make `base.join` discard base); returns `base.join(rel)` (TOCTOU between check and read, no `O_NOFOLLOW`). Prefer all-`Normal` component check, `Err` => reject, check parents only.
- Coherence checks weak: `capture_state_fingerprint` uses mtime seconds (not ns) + size; `compute_snapshot_version` ignores `worktree_mtime_secs/size` fields it captured (dead data); symlink target not hashed; no content hash when worktree > cap.
- `compute_full_index_fingerprint` hashes per-entry stat (mtime/size) of whole index twice per detail: O(index) cost, and unrelated `git status` stat-refresh/`git add` invalidates the snapshot/drafts (spurious 409). Hash only what contract needs (stage entries + unmerged set + HEAD/operation) — confirm intent with design owner.
- Zero-OID stage (`:592-602`) reported as `Text` with empty tokens: fabricated empty text. Should be Unsupported/ReadError.
- `get_active_operation`: `ApplyMailbox*` mapped to `"rebase"` (am != rebase); duplicates `repository.rs` recovery logic? (check Phase 04 plan before extending).
- `conflictId` has no length cap (hex decode of arbitrary query); add max length at route.
- Status mapping `our_present && !their_present` => `DeleteModify` even with no ancestor (impossible/unsupported combo labelled delete/modify); naming direction (ours-modified/theirs-deleted called DeleteModify) must be confirmed against UI labels and Phase 04 role labelling.
- Dead/legacy code not retired though phase says delete: `git/diff.rs::get_conflicts`, `read_blob_utf8`, `ConflictFile` (Rust `types.rs:423`, still exported in `mod.rs:45`, only used by `git/tests.rs:1409`), UI `ConflictFile` in `client.ts:2443`, unused import `queries.ts:38`. Legacy resolve route still registered but fail-closed (good); `resolve_conflict` now unreachable from API — decide in Phase 03.
- UI `EffectiveAttributes.eol` typed `"lf"|"crlf"|"native"` but server sends arbitrary string.
- Existing editor "Resolve" now always receives 400 `LEGACY_PAYLOAD_REJECTED`: intended per plan, but UI shows no dedicated state; acceptable only while phases 02-05 are unreleased.
- Tests: add negative/race/bounds fixtures per phase todo #5; current suite asserts happy paths only. `git_try`/`git` helpers use `/dev/null`.

## Suggestions (Low)
- Fix clippy: drop `&` in `hasher.update(&[0])`; replace 8-arg `compute_snapshot_version` with a struct; `Some("lfs")` pattern.
- Pass pre-computed `canonical_root` instead of `canonical_worktree = canonical_root.clone()` (two identical fields => no real worktree identity; contract wants linked-worktree vs repo root distinct, use `repo.workdir()` / `repo.path()`/commondir).
- Replace `summary` triple `get_attr_bytes` + sniff with one helper shared with detail path (DRY: stage-builder duplicates StageDescriptor construction 7x; helper `desc(kind, tokens)`).
- Remove unused `use crate::git::types::ConflictStages` alias confusion? (fine) / document that `ConflictStages` is exported through types.
- Add `max line` check counting only content, not EOL, for consistency.

## Positives
- Opaque hex `conflictId` of raw path bytes, lossless round-trip tested; lossless token invariant (`concat == input`) tested incl. lone CR.
- Absent vs zero-byte stages distinguished in descriptor shape; base stage optional.
- Routes sit behind existing protected router + `resolve_target_path`/`resolve_git_request_root`; no parallel root authority; blocking git work in `spawn_blocking`.
- Fail-closed legacy resolve with stable error code; `AppError` 409/400 mapping consistent.
- Before/after index re-read (`index.read(true)`) with `ConflictStateChanged` mapping; SHA-256 snapshotVersion covers stage OID/mode/path, content hash, operation, HEAD.
- Pagination uses clamped limit; summary skips blobs for obviously unsupported symlink/gitlink.
- Android input suppression test retained; `tsc` clean.

## Plan status
Phase 02 todo (all 5) remain **unchecked**: items 1-2 partly done, 3 partly (attr/config gaps), 4 not done (bounds after allocation), 5 not done. Review status: changes requested.

## Unresolved questions
1. Is `filter=lfs` intentionally qualified by Phase 01 decision? Where is that recorded?
2. Does Phase 01 define snapshot token as full-index stat fingerprint (current) or only unmerged/stage entries? Stat-noise from background `git status` makes the former brittle.
3. `DeleteModify` / `ModifyDelete` direction: which side is "ours" in rebase vs merge (Phase 04 labels)?
4. Should oversized stages/worktree appear as Unsupported with `byteSize` only (current) or explicit `limitExceeded` reason for handoff UI?
5. Windows server support for conflict worktree inspection: need real implementation (no mtime/mode) or compile-only stub?
