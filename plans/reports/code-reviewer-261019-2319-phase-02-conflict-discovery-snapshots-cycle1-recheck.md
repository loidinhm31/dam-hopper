# Code Review (re-check after fixes) — Phase 02 Conflict discovery and snapshots

Verdict: **CHANGES REQUESTED, 6/10** (was 5/10). All 8 claimed fixes verified in code. Two gate-level gaps from prior review remain (non-UTF-8 path, snapshot eligibility); plan todos stay unchecked.

## Fix verification
| # | Claim | Result |
|---|---|---|
| 1 | Windows compile | `MetadataExt` now inside `#[cfg(unix)]` block (conflict.rs:840-846); symlink test `#[cfg(unix)]` (tests:460). Static only: `cargo check --target x86_64-pc-windows-gnu` not runnable (no `x86_64-w64-mingw32-gcc` for libgit2-sys). `/dev/null` GIT_CONFIG_GLOBAL remains but has precedent in `git_conflict_exact_staging.rs`/`operation_metadata.rs`. |
| 2 | Attrs | `AttrValue::from_string` used for eol/encoding/ident/filter/diff. `lfs` allowlist removed -> only unspecified/`-filter`/empty qualified (resolves old #10). OK. |
| 3 | Pre-alloc bounds | `odb.read_header` before `find_blob` (stage); summary sniff only if header size <= 8000; tokenizer aborts at limit; worktree `take(MAX+1)`; dirty-check size-gated. OK. |
| 4 | Gitlink/symlink | mode checked before blob read -> `Unsupported`, no `find_blob` on commit OID. OK. |
| 5 | Cursor | `v1:{HEAD}:{offset}` validated, stale/malformed -> 400 (`InvalidInput`). Test `test_conflict_stale_cursor_rejected`. OK (see W3). |
| 6 | SnapshotInput | Done; clippy arg-count gone. |
| 7 | Path safety | Prefix/RootDir/ParentDir/non-relative rejected. OK. |
| 8 | UI imports | `ConflictFile` import removed from queries.ts. Remaining eslint warnings (`PublishPreview`, `PublishResult`) pre-existing at HEAD. |

## Critical (acceptance-gate blockers, not fixed)
1. **Non-UTF-8 path -> wrong target.** `conflict.rs:474,652,685`: `from_utf8_lossy` string used for `verify_safe_worktree_path` (disk join), `get_attr`, stage `path`, snapshot `path`, and `conflict_path` in version hash. Lossy `U+FFFD` path may point to a different/nonexistent file than the raw index entry; entry not marked Unsupported (contract: safe label, no guessed mutating path). Fix: if `std::str::from_utf8(raw)` fails -> summary `Unsupported` ("non-UTF-8 path"), snapshot returns Unsupported descriptors without disk read/attrs; keep raw bytes (`OsStr::from_bytes` on unix) otherwise.
2. **Snapshot has no eligibility classification.** `ConflictSnapshot` (types.rs) lacks `status`/`unsupportedReason`; `filter_qualified=false` or `ident=true` files still return `textTokens` for stages + worktree (no gating at `conflict.rs:~940`), so writable clients can receive unqualified-conversion text as "safe". Phase gate: "fails if any unknown read presented as safe text". Fix: reuse summary classification in detail; withhold tokens when `!filter_qualified` (or surface `writable=false` + reason).

## Warnings
1. **UI still collapses states (old #9).** `MergeConflictEditor.tsx:183-184`: `textTokens?.join("") ?? ""` renders missing/binary/unsupported/oversize as empty text; lookup in first page only (`conflicts.entries.find`, no paging); no `root` passed to `useGitConflicts`/`useGitConflictFile`; result pane still from separate `useGitFileDiff` (mixed state). Acceptable only if Phase 05 owns it explicitly; record that in plan.
2. **Coherence token weak.** `capture_state_fingerprint` compares worktree mtime *seconds* + size only; same-second same-size edit during read is undetected. `StateFingerprint.worktree_mtime_secs/size` not part of `snapshot_version` (dead data). Cheap fix: re-hash worktree bytes (or compare content hash) after read; hash symlink target; use mtime ns.
3. **Offset paging still skips entries.** Cursor binds HEAD only; during rebase/merge HEAD is stable while entries get resolved between pages -> offset shifts, entries silently lost. Bind to a hash of unmerged path set, or page by last raw path.
4. **Index fingerprint includes per-entry stat (mtime/size) of whole index** (`compute_full_index_fingerprint`, hashed twice/detail): O(index), spurious `REFRESH_REQUIRED` on unrelated `git status` refresh. Restrict to unmerged entries + HEAD/operation unless design contract says otherwise.
5. **Read errors still fatal.** `read_header`/`find_blob` errors and `File::open` errors return HTTP 500/Io for whole snapshot; `StageKind::ReadError` and `WorktreeKind::Gitlink` never produced. Map to descriptors.
6. **Path safety residuals** (`verify_safe_worktree_path`): mixes `dunce::canonicalize` (base) and `std::fs::canonicalize` (target) -> on Windows verbatim `\\?\` prefix makes `starts_with` false (spurious reject for any symlink/junction ancestor); final-component symlink escaping root aborts with 400 rather than reporting `WorktreeKind::Symlink`; `canonicalize` Err on a symlink -> propagated (fail-closed OK); TOCTOU: `File::open` follows symlink swapped after check (local-attacker, low).
7. `conflictId` has no length cap at route (hex-decode of arbitrary query).
8. Windows fallback `mode = 0o100644` fabricates mode (compile-only stub); document or use `0`/Option.
9. `get_active_operation`: `ApplyMailbox*` -> `"rebase"`; status `our_present && !their_present` labelled `DeleteModify` even with no ancestor (impossible combo); direction naming vs Phase 04 labels unconfirmed.
10. Zero-OID stage (`:704`) -> `Text` with empty tokens (fabricated empty text); should be Unsupported/ReadError.
11. Legacy not retired: `diff.rs::get_conflicts` (831), `read_blob_utf8` (884), `resolve_conflict` (901), Rust `ConflictFile` (types.rs, exported in mod.rs), UI `ConflictFile` (client.ts:2443). Phase says delete after consumers migrate.
12. Test gaps: no tests for attributes (`-diff`, `-filter`, `ident`, `filter=lfs`), oversize/line-limit via API, race/changed-during-read (AC8), non-UTF-8 path, gitlink, linked worktree/nested root (AC1/AC9), unreadable-vs-missing, traversal.

## Suggestions
- DRY: 8 near-identical `StageDescriptor{..}` literals in `build_stage` and 3x duplicated bound checks in tokenizer -> small helper (`desc(kind, tokens)`, `check_and_push`). KISS: closure `build_stage` could be a fn.
- Clippy (11 sites in conflict.rs/tests): `hasher.update(&[..])` needless borrows (358,367-372,384-385), `manual_unwrap_or_default` (37), `matches!` on extension (546). `cargo fmt` not enforced repo-wide.
- `canonical_worktree` uses raw `repo.workdir()` (uncanonicalized, trailing slash); canonicalize for stable identity.
- Type `EffectiveAttributes.eol` as string on UI (server sends arbitrary).
- Cap summary page's per-entry work further if `MAX_SUMMARY_LIMIT=500` ODB reads matters (currently <=8KB each; fine).

## Positives
Opaque hex conflictId with lossless round-trip; bounded ODB header checks; lossless tokenizer with early abort; gitlink/symlink short-circuit; fail-closed legacy resolve; cursor now rejects stale/malformed; before/after index re-read -> 409 `REFRESH_REQUIRED`; protected routes reuse registered-target + root resolution; blocking git in `spawn_blocking`.

## Reviewed files
server: `src/git/conflict.rs` (1165 LOC), `src/git/types.rs`, `src/git/mod.rs`, `src/git/diff.rs`, `src/git/tests.rs`, `src/error.rs`, `src/api/git_diff.rs`, `src/api/router.rs`, `tests/git_conflict_discovery_api.rs` (514).
ui: `api/client.ts`, `api/queries.ts`, `api/ws-transport.ts`, `MergeConflictEditor.tsx` + test, `test-fixtures/git-squash.ts`.
plan: `phase-02-conflict-discovery-and-snapshots.md`.

## Validation
| Command | Result |
|---|---|
| `cargo test --test git_conflict_discovery_api` (server) | 7/7 pass |
| `cargo test --lib git::` | 200/200 pass |
| `cargo clippy --all-targets` | builds; 11 warning sites in conflict.rs/tests (style only, no errors) |
| `cargo check --target x86_64-pc-windows-gnu --all-targets` | NOT RUN: toolchain target installed but mingw gcc missing (libgit2-sys cc-rs failure); cfg-gating verified by grep only |
| `npx tsc -p tsconfig.json --noEmit` (packages/ui) | clean |
| `npx eslint` on changed UI files | 0 errors, 2 pre-existing warnings |
| `npx vitest run MergeConflictEditor.test.tsx` | 2/2 pass |

## Plan status
Phase 02 todos remain unchecked: items 1,2 mostly done (blocked by Critical 1), 3 partial (W2/W4), 4 done for bounds, 5 not done (W12). Keep Phase 03 mutation and release blocked until Critical 1-2 fixed.

## Unresolved questions
1. Is `filter=lfs` intentionally unqualified now (removed from allowlist)? Confirm vs Phase 01 decision.
2. Design owner: should `snapshotVersion`/full index fingerprint cover whole-index stat data or only unmerged entries + HEAD/operation?
3. Which side is "ours" for rebase vs merge (DeleteModify/ModifyDelete naming, Phase 04)?
4. Non-UTF-8 paths: Unsupported-only in Phase 02 (recommended) or raw-byte support?
5. Windows server: compile-only stub acceptable for conflict worktree inspection, and is there a CI-capable way to verify (windows job) since local cross-check impossible?
6. Does UI cutover (W1) belong to Phase 05 only?
