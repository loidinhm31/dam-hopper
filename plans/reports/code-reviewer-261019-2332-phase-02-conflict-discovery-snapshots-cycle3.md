# Phase 02 review — Cycle 3 (conflict discovery + snapshots)

Score: **7/10**. Verdict: cycle-1 criticals fixed; no confirmed security/data-loss critical. 4 gate-relevant warnings remain (W1-W4) — fix or explicitly waive before marking Phase 02 done.

## Cycle-3 fix verification
| # | Fix | Result |
|---|---|---|
| 1 | Non-UTF-8 path | Verified empirically (scratch test, removed): summary `unsupported` + reason; snapshot 200 `unsupported`, no disk read/attr lookup. `conflictId` len cap 4096 present. Dedicated test is bogus (W5). |
| 2 | Filter gating | `test_conflict_custom_filter_withholds_tokens` passes; tokens withheld base/ours/theirs/worktree. `ident` NOT gated (W3). |
| 3 | Windows paths | dunce used consistently; Prefix/RootDir rejected; MetadataExt cfg(unix)-guarded. Windows build still unverified (no mingw). |
| 4 | Pre-alloc bounds | `read_header` before `find_blob`; bounded tokenizer; `take(MAX+1)` worktree read. OK. |
| 5 | Gitlink/symlink stages | mode checked first. OK. |
| 6 | Cursor | stale/malformed -> 400; test passes. Residual: offset cursor (W6). |
| 7 | SnapshotInput | done; arg-count lint gone. |
| 8 | queries.ts import cleanup | `ConflictFile` removed; 2 remaining eslint warnings pre-existing. |

## Critical
None confirmed.

## Warnings
**W1 (High, AC6/AC7) Read errors collapse to HTTP 5xx/4xx instead of descriptors.** Reproduced with scratch tests:
- Worktree file mode 000 -> snapshot `500 IO error: Permission denied` (`File::open ... map_err(AppError::Io)?`, conflict.rs ~L945). Should be `WorktreeKind::Unreadable`.
- Worktree final component dangling symlink (the exact state in `test_conflict_symlink_marked_unsupported`; summary says Unsupported) -> snapshot `500 No such file` because `verify_safe_worktree_path` does `dunce::canonicalize(&current)?` on a symlink. Unsupported entries should stay reachable (plan AC) and report `WorktreeKind::Symlink`. Escaping-symlink final component -> 400 instead of Symlink descriptor.
- Index path starting with `\` (valid on Linux): summary `bothModified`, snapshot `400 invalid path` (`rel.starts_with('\\')`). Summary/detail disagree.
- `read_header`/`find_blob` errors -> `AppError::Git` for whole snapshot; `StageKind::ReadError` and `WorktreeKind::Gitlink` never produced (dead enum variants).
Fix: handle final component/`File::open`/blob errors per-descriptor; for Unsupported entries skip `verify_safe_worktree_path` failures into Symlink/Unreadable descriptors; reject backslash only on Windows (`cfg!(windows)`) or mark Unsupported in summary.

**W2 (High, AC8) Attributes outside before/after coherence check.** `StateFingerprint` = HEAD + operation + full-index hash + worktree mtime/size. `inspect_effective_attributes` runs once, after reads, and is not compared across the window; `.gitattributes`/config change mid-read is undetected (plan gate: "fails if fingerprint omits mutation-relevant input"). Also content hash is computed once; after-state compares mtime+size only (same-size same-mtime-granularity edit undetected on coarse-mtime FS). Fix: capture attrs before and after (include in `StateFingerprint`), re-hash worktree bytes (or re-stat + hash) after read; hash symlink target.

**W3 (High, gate) Conversion policy incomplete.** Only `eol`, `working-tree-encoding`, `ident`, `filter` inspected. Missing `text`/`crlf`/`binary`/`diff`/`merge`, `core.autocrlf`, `core.eol`, `core.safecrlf`. `ident=true` file (`$Id$`) still returns `bothModified` with tokens (verified empirically); `working-tree-encoding` set is not gated either (worktree only "works" because NUL sniff trips for UTF-16). Design says unknown conversions -> unsupported before write; define supported set in Phase 01 doc and gate `ident`/`encoding`/non-default autocrlf accordingly.

**W4 (Med-High) Snapshot DTO omits contract fields.** Plan Req: "stages 1/2/3, worktree descriptor, **roles, limits**, conversion policy, token". DTO has no `roles`, `limits`, `operation`, `targetRevision`; ours/theirs labelled unconditionally. Phase 03/04 will need them; adding later = another coordinated wire change.

**W5 (Med) Misleading test.** `test_conflict_non_utf8_path_marked_unsupported` only round-trips `encode/decode_conflict_id`; never creates a non-UTF-8 path or hits summary/snapshot. The "tested" claim in fix #1 is unsupported by that test. Behavior itself is correct (verified ad hoc). Symlink test covers summary only, not snapshot (would have caught W1).

**W6 (Med) Offset paging can still skip entries.** Cursor binds HEAD + offset; during merge/rebase HEAD constant while entries get resolved -> shifted offset silently drops conflicts. Bind to last raw path/hash of unmerged set.

**W7 (Med) Legacy not retired (clean-cutover rule).** `diff.rs::get_conflicts`, `read_blob_utf8`, `resolve_conflict`, Rust `ConflictFile` (types.rs, re-exported in mod.rs), UI `ConflictFile` (client.ts:2443) remain. `resolve_conflict` now has no caller; `get_conflicts` only used by one test (`git/tests.rs:1409`). Plan says delete after callers migrate.

**W8 (Med, perf) Full-index fingerprint O(index) x2 per detail**, includes per-entry mtime/size: `git status` stat-refresh in another process yields spurious 409 `REFRESH_REQUIRED`; `index.iter()` clones every entry (alloc/entry). Open design question #2 — restrict to unmerged entries + HEAD/operation unless contract requires whole-index.

**W9 (Low-Med) Dead/incorrect classification.** `rename_mismatch` is unreachable: libgit2 conflict iterator groups by path, so our/their paths always equal (contract's "separate stage paths" cannot be expressed through `index.conflicts()`; use raw `index.iter()` stage walk if rename ambiguity matters). `our && !their` labelled `DeleteModify` even without ancestor (add/delete state). Classification block duplicated verbatim in summary and snapshot (DRY) -> one `classify(&IndexConflict)` helper.

**W10 (Low) Id length cap vs path length.** hex doubles bytes: paths >~2046 bytes (legal; PATH_MAX 4096) are listed in summary but snapshot returns 400 "conflictId exceeds".

**W11 (Low) Zero-OID stage -> `Text` with empty tokens** (fabricates empty text); should be Unsupported/ReadError.

**W12 (Low) UI** (`MergeConflictEditor.tsx`): `textTokens?.join("") ?? ""` renders missing/binary/unsupported/oversize as empty; entry looked up in page 1 only; no `root` passed; result pane still from `useGitFileDiff`; `useGitResolve` hits a fail-closed endpoint. Acceptable only if Phase 05 explicitly owns it (record in plan). Phase not independently releasable (as planned).

**W13 (Low) TOCTOU:** `File::open` follows symlink swapped after `symlink_metadata`/ancestor check (local attacker); FIFO swap could block a blocking-pool thread. Use `O_NOFOLLOW|O_NONBLOCK` on unix or open-then-fstat.

## Suggestions
- DRY: ~8 identical `StageDescriptor{..}` literals in `build_stage` and 3x duplicated bound checks in tokenizer -> helper `desc(kind, tokens)`, `check_and_push`; `build_stage` as fn. Non-UTF-8 early-return literal duplicates empty-DTO construction; factor `unsupported_snapshot()`.
- Non-UTF-8 unsupported snapshot loses real stage oid/mode (all zeroed) — still read stage metadata (no disk read needed).
- `matches_any_stage` re-`find_blob`s up to 3 blobs already loaded in `build_stage`; keep digests/bytes from first load.
- `compute_snapshot_version` hashes variable-length fields without length-delimiting (path/oid concatenation); prefix lengths. Minor.
- `canonical_worktree` uses raw `repo.workdir()` (trailing slash, uncanonicalized): `dunce::canonicalize` for stable identity.
- Windows fallback `mode = 0o100644` fabricates mode; use 0/Option.
- `get_active_operation`: `ApplyMailbox*` -> "rebase" mislabels `git am`.
- Clippy (conflict.rs, 11 sites): needless `&[..]` in `hasher.update` (358,367-372,384-385), `manual_unwrap_or_default` (37), `matches!` (554). Repo has hundreds of pre-existing warnings; `cargo fmt` not enforced repo-wide.
- UI: type `EffectiveAttributes.eol` as `string`.

## Positives
Opaque hex conflictId lossless round-trip; ODB `read_header` pre-checks; lossless bounded tokenizer with early abort; mode check before `find_blob`; non-UTF-8 handled in both routes without disk access; custom-filter gating withholds all tokens incl. worktree; before/after index re-read -> 409 `REFRESH_REQUIRED`; cursor validated up front; protected routes reuse registered-target + root resolution; blocking git in `spawn_blocking`; cfg-guarded unix-only code; dunce for Windows canonicalization.

## Reviewed files
server: `src/git/conflict.rs` (1310 LOC), `src/git/types.rs`, `src/git/mod.rs`, `src/git/diff.rs`, `src/git/tests.rs`, `src/error.rs`, `src/api/git_diff.rs`, `src/api/router.rs`, `tests/git_conflict_discovery_api.rs` (584).
ui: `api/client.ts`, `api/queries.ts`, `api/ws-transport.ts`, `MergeConflictEditor.tsx` + test, `test-fixtures/git-squash.ts`.
plan: `phase-02-conflict-discovery-and-snapshots.md`, `design-contract.md`.

## Validation
| Command | Result |
|---|---|
| `cargo test --test git_conflict_discovery_api` (server) | 9/9 pass |
| `cargo test --lib git::conflict` | 6/6 pass |
| `cargo test --lib git::` | 200/200 pass |
| `cargo clippy --all-targets` | no errors; ~11 style warnings in conflict.rs + 1 in test file (repo has many pre-existing) |
| Scratch integration tests (created, run, deleted; tree clean) | confirmed W1 (000-perm file 500; dangling symlink 500; `\`-prefixed path 400), non-UTF-8 OK, `ident` not gated |
| `npx tsc -p tsconfig.json --noEmit` (packages/ui) | clean |
| `npx eslint` changed UI files | 0 errors, 3 pre-existing warnings |
| `npx vitest run MergeConflictEditor.test.tsx` | 2/2 pass |
| Windows `cargo check --target x86_64-pc-windows-gnu` | NOT RUN (no mingw gcc for libgit2-sys); cfg gating reviewed by reading only |

## Recommended actions (priority)
1. W1: per-descriptor read errors; Unsupported entries never 5xx; backslash rule. Add snapshot test for dangling symlink + unreadable file.
2. W2/W3: attrs+config into before/after fingerprint; re-hash worktree; gate `ident`/encoding; document supported conversions.
3. W4: decide roles/limits/operation fields now (or document as Phase 03/04-owned).
4. W5: real non-UTF-8 repo test (summary + snapshot).
5. W7: delete legacy `get_conflicts`/`read_blob_utf8`/`resolve_conflict`/`ConflictFile` (Rust + UI) and the test that uses them.
6. W6/W8: stable paging key; narrow fingerprint (needs design decision).

## Unresolved questions
1. Supported conversion set per Phase 01: is `ident` / `working-tree-encoding` / `core.autocrlf` intended supported or Unsupported? Docs grep finds no statement.
2. Whole-index stat fingerprint required by contract, or unmerged entries + HEAD/operation enough?
3. Are `roles`/`limits`/`operation` expected in the Phase 02 snapshot DTO or Phase 03/04?
4. Should Unsupported conflicts (symlink/gitlink) still return full-descriptor detail (plan: "remain reachable")?
5. Windows server: compile-only acceptable? CI windows job available to verify?
6. Does UI state-collapse fix belong solely to Phase 05?
