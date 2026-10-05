# Phase 01 — Native semantics and contract proof

## Context links

- [Parent plan](./plan.md); [frozen contracts](./contracts.md); [backend research](./research/backend-native-blame.md).
- [Workbench architecture](../../docs/architecture/workbench-files-editor-and-git.md); [Git API](../../docs/api/git.md).
- Dependencies: none. This is the first **future implementation** phase, not work performed during plan creation.

## Overview

- Date: 2026-10-05. Priority: P2.
- Implementation status: complete. Review status: complete.
- Prove installed native APIs and difficult line/rename behavior before building endpoint/UI around assumptions.

## Key Insights

- Prior disposable probe used Git CLI, not git2. Documentation is not local native runtime proof.
- `git2 = 0.19`, Monaco `^0.55.1`; inspect actual resolved dependency versions at execution time.
- Existing `get_commit_message` requires a local branch and reachability. It is an edit snapshot reader, not arbitrary commit inspection.
- Libgit2 copy/move flags may be reserved/unimplemented. Never enable them and claim rename correctness.
- Git paths have three frames: configured project/worktree, owning VCS root, actual repository workdir. Nested project paths must not blame the wrong file.

## Requirements

- Freeze all DTOs, line-count rules, errors and admission policy from contracts before cross-module work.
- Prove in-memory attribution does not write disk/index/HEAD and does not depend on saved content.
- Decide exact CRLF/trailing-newline conversion and committed/staged rename handling with fixture evidence.
- No CLI fallback, new dependency, copy/move settings, or scope reduction.

## Architecture

```text
real temporary repository + explicit authors/times
  -> captured HEAD + native blame_file
  -> blame_buffer(current snapshot)
  -> normalized ranges / zero-OID classification
  -> compare exact expected OIDs, author offsets, line numbers
```

- Native work occurs and is fully dropped inside one blocking thread/closure; do not move `Blame` handles across tasks.
- Read-only commit details uses ODB exact lookup; mutation branch/tip validation remains untouched.

## Related code files

Read existing (repo-relative):

- `server/Cargo.toml`, `server/Cargo.lock`: installed git2/libgit2 versions.
- `server/src/git/vcs_roots.rs`: `resolve_git_path_root`, `resolve_git_request_root`.
- `server/src/git/diff.rs`: existing path/rename behavior, native diff helpers.
- `server/src/git/commit_message_rewrite.rs`: raw message parsing and mutation gates.
- `server/src/fs/sandbox.rs`, `server/src/api/fs.rs`: target/path containment patterns.
- `packages/ui/src/lib/file-tier.ts`: 1/5 MiB boundaries.
- `packages/ui/src/api/queries.ts`, `server/src/git/types.rs`: root query and per-root `status.lastCommit.hash`.

Proposed future throwaway: `server/examples/git_blame_probe.rs` only while running native proof. Do not retain it as a product surface. No application file created in this planning session.

## Implementation Steps

1. Confirm resolved git2/libgit2 version and inspect public installed API signatures; use LSP when configured. Read source/docs for native flags rather than inferring implemented behavior from Rust setter names.
2. Build deterministic repository fixture: two authors, distinct authored offsets, subject plus multiline body, three independently attributed lines. Capture exact OIDs and original disk/index/HEAD state.
3. Run native `blame_file(newest_commit=head)` followed by `blame_buffer` for insertion, replacement, deletion, undo-equivalent buffer and unchanged text. Observe final line numbers and zero-OID classification, not output length alone.
4. Repeat with empty string, one blank line, trailing newline/no trailing newline, CRLF, non-ASCII text and author names. Align native physical lines to Monaco display lines without attributing nonexistent terminal text to the last commit.
5. Commit a whole-file rename and assert retained line origins. Stage a later rename without committing; derive one unique old path using current HEAD→index diff, then verify old-path baseline + new-path buffer. Test ambiguity/new-file states explicitly.
6. Prove configured subdirectory projects, nested repository, linked worktree, detached HEAD and shallow history address correct OIDs/path frame. Distinguish an unborn HEAD from damaged/missing repository state.
7. Confirm plain exact `find_commit`/ODB read returns full body for detached/unmerged/old commits, whereas existing edit snapshot API correctly rejects ineligible branch scopes.
8. Pin actual conversion and renamed-path algorithm in contracts, noting any native discrepancy. If a required semantic remains unsolved, stop this gate with precise evidence; do not proceed with fake uncommitted fallback for a native error.
9. Confirm route body math and two-permit global admission design; root freshness reuses owner-bound discovery on focus/manual/relevant events, with no feature-added polling or new watcher. Native publication still rejects observed HEAD/root changes during work.
10. Run native probe (`cargo run --example git_blame_probe`, cwd `server`) and record stdout plus expected fixture state. Remove probe after evidence is recorded; retain behavioral native regressions for uncertain rename/line boundaries when implementing Phase 02.

## Todo list

- [x] Installed native API/version recorded.
- [x] Current-buffer and no-write proof recorded.
- [x] Line ending/display-row rules resolved.
- [x] Whole-file and staged rename mapping proven.
- [x] Nested project/root/worktree path frames proven.
- [x] Arbitrary commit read separated from edit-snapshot gates.
- [x] Contracts updated from evidence; no unresolved algorithm assumption carried into Phase 02.


## Completed Implementation Receipts

- **Native Probe**: Executed `server/examples/git_blame_probe.rs` against installed `git2 = 0.19` (`libgit2 1.8.1`). All 5 test suites passed (Deterministic blame, Line endings/CRLF, Renames, Path frames, ODB reads).
- **Empty Buffer**: Verified libgit2 rejects zero-length buffer with `GenericError: invalid argument: 'buffer && buffer_len'`; codified server short-circuit (`status: "empty"`, `ranges: []`, `commits: []`, `bufferLineCount: 1`).
- **CRLF & Line Endings**: Proven raw CRLF diffs against Git LF blobs producing false uncommitted lines; confirmed LF normalization strips `\r` for clean attribution matching committed blobs.
- **Display Rows**: Validated trailing newline omission modifies terminal line in Git diff; mapped Monaco display-row partition with explicit uncommitted terminal range (`commitIndex: null`).
- **Renames**: Proven libgit2 tracks committed renames back to origin path (`"original.txt"`); staged renames resolved via `diff_tree_to_index` + `DiffFindOptions::renames(true)`.
- **Arbitrary ODB Reads**: Verified `repo.find_commit(oid)` reads detached/arbitrary commits directly from ODB with full multiline body and signatures, fully decoupled from mutation CAS.
- **Zero-Write Immutability**: Verified `git status` clean, refs/index/working tree byte-identical before and after native operations; throwaway probe cleanly removed.
## Success Criteria

- Native output exactly matches fixture OIDs/authors/timezones on retained lines; changed lines use zero OID.
- Repository refs/index/file bytes identical before/after read-only proof.
- CRLF/trailing display row and rename behavior documented with executable fixture evidence.
- No use of unimplemented copy flags as supposed support; no CLI fallback.
- Reviewers can implement Phase 02 without inventing wire or attribution semantics.

## Risk Assessment

- Native rename/line-ending mismatch: earliest gate; resolve before API construction.
- Whole-repo history may be slow: measure representative text files; bound concurrency rather than claiming cancellable libgit2.
- Directory/path-frame confusion: same relative filenames in nested fixtures with different authors make errors visible.

## Security Considerations

- Fixtures use temporary repositories and synthetic identities; no production credentials or unsaved source in reports.
- No relaxed path/branch checks in live code for experiments.
- Do not mutate repository ownership/global Git config to make a probe pass.

## Next steps

- Phase 01 completed and verified. Unblocked Phase 02: Native blame and read-only Git API endpoints.
- Unresolved questions: None. Native runtime semantics proven via fixture probe.
