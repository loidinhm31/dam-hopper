# Code Review — Phase 03 Safe resolution and staging (Cycle 2)

## Scope
- Plan: `plans/261019-1505-git-conflict-resolver/phase-03-safe-resolution-and-staging.md`
- Files: `server/src/git/conflict_resolve.rs` (new, 646 LOC), `server/src/git/mutation_coordination.rs` (new, 85), `server/src/git/{types,conflict,diff,mod,tests}.rs`, `server/src/api/git_diff.rs`, `server/tests/git_conflict_exact_staging.rs` (661), `server/tests/git_conflict_discovery_api.rs`.
- Focus: verify 6 cycle-1 critical fixes + security/perf/architecture/YAGNI-KISS-DRY.

## Score: 6.5 / 10

## Fix verification
| # | Fix | Verdict |
|---|-----|---------|
| 1 | Serde camelCase + unknown fields | PARTIAL. camelCase OK (probe: `outcomeUnknown`/`requiredRefresh`/`worktreeChangedStageFailed`/`worktreeWritten`; snake_case request rejected). `deny_unknown_fields` OK for request, `indexSide`; **NOT enforced for `{"type":"delete","extra":1}`** (probe returned `Ok`; serde unit variant in internally tagged enum ignores extras). |
| 2 | Mutation coordinator covers writers | **PARTIAL — critical gap remains** (C1). |
| 3 | Insecure publication + worktree gating | OK. Kind gating (symlink/dir/gitlink/unreadable), leaf `symlink_metadata`, ancestor escape check, tmp+rename, `index.lock` busy check before write. Residual: path-based (not fd-based) publication, in-root ancestor symlinks allowed (W5). |
| 4 | Exact oracle verification | OK for target path: re-open repo/index, stages 1-3 absent, stage0 OID+mode, raw disk bytes; delete checks index+disk. Gaps: no on-disk exec-bit check, no unrelated-entry preservation check (W4). |
| 5 | W3 conversion gating | OK for plan list (filter/ident/working-tree-encoding/non-default autocrlf → `Unsupported` before write). Gap: `text`/`eol` attrs and `core.eol` collected + fingerprinted but never gated (W2). |
| 6 | E2E regression tests calling `apply_conflict_resolution` | OK: reviewedText (+unrelated preserved), reviewedText empty/exec, indexSide binary, delete, delete/modify, stale (worktree edit), injected stage failure (read-only `.git`, text retained, no rollback), API resolve + legacy rejection, CUT1 mixed batch (service + API). Gaps: no apply-level Busy, W3, or symlink-ancestor tests (W6). |

## Critical issues
- **C1 — Coordinator covers only 5 sync writers; plan go/no-go "stop cutover on uncovered writers" fails.** `GLOBAL_MUTATION_COORDINATOR` is used only in `diff.rs` (`stage_files`, `unstage_files`, `discard_file`, `discard_hunk`, `commit_files`) and `apply_conflict_resolution`. Uncovered index/ref/worktree writers (grep-verified no coordination): `repository.rs` `checkout_branch`, `pull`, `cherry_pick`, `reset_to_commit`, `undo_last_commit`, `update_branch`, `create_branch`, `delete_branch`, `fetch`, `push`; `commit_file_ops.rs` `cherry_pick_commit_files`, `drop_commit_files`, `drop_commit`, `revert_commit`, `revert_commit_files`; `squash_commits`, `edit_commit_message`, `publish_leased_push`, `worktree::{add,remove,prune}`. Resolver is multi-step (publish file → index write → verify); `index.lock` is held only during the brief native write, so e.g. `checkout_branch` can interleave between worktree publish and index write. Also key = `repo.path()` → linked worktree gets `.git/worktrees/<n>`, so main/linked commits updating shared refs do not serialize (plan: "still share relevant ref scope"). Fix: write the actual-writer inventory (plan step 1), take `try_acquire_for_repo` (keyed on `repo.commondir()` for ref scope, plus per-gitdir for index) in every writer above or reject with Busy/Unavailable; add a test that a competing app writer (e.g. `checkout_branch`/`cherry_pick`) is rejected while a guard is held.

## Warnings
- W1 `ResolveAction::Delete` unit variant accepts unknown fields (serde limitation). Make it `Delete {}` (struct variant) so `deny_unknown_fields` applies; add test.
- W2 `text`/`eol` attributes and `core.eol` are not gated in apply (`snapshot.effective_attributes.text/eol/core_eol` unused). Explicit `text`/`eol=crlf` + CRLF reviewed text stages a CRLF blob that `git add` would normalize → possible phantom modified status. Gate `text` set/true or `eol` set (non-auto) as Unsupported, or document why out of scope.
- W3 `IndexSide` does not gate selected stage kind beyond `Missing`: `Unsupported` (oversize `> MAX_STAGE_BYTES`, non-blob) proceeds; blob loaded with `content().to_vec()` (unbounded memory + redundant copy). Reject `StageKind::Unsupported|ReadError` explicitly; use `blob.content()` borrow instead of `to_vec()`. `file_size: len() as u32` truncates >4 GiB.
- W4 Oracle does not verify unrelated entries unchanged (AC5) nor on-disk exec bit. Compare pre/post index entries minus target path (cheap) and, on unix, `mode & 0o111`.
- W5 Ancestor check (step 5) duplicates `verify_safe_worktree_path` (already called) and only rejects escaping symlinks; in-root symlink ancestor (`a -> b`, path `a/f`) still writes through to `b/f` while index records `a/f`. Reject any symlink ancestor; delete the duplicate loop. `create_dir_all` in `safe_atomic_write` is an unchecked TOCTOU window after the check; `fs::write` for tmp uses non-`create_new`.
- W6 Test gaps: apply-level Busy (`index.lock` present → zero write), W3 gating (`ident`, `working-tree-encoding`, `core.autocrlf=true`) via `apply_conflict_resolution`, symlink ancestor, IndexSide stage/side mismatch. Stage-failure test relies on `chmod 0555 .git`; passes only for non-root users (root bypasses → false failure in root CI). Prefer pre-creating `index.lock` after Busy check is bypassed, or skip when `euid==0`.
- W7 DTO `ConflictFile` (`types.rs:423`) now unused — W7 retirement incomplete; delete it. UI `ws-transport.ts` `git:resolve` still sends legacy `{path, content}` → fails closed (400) until Phase 05; acceptable per plan but build is unreleasable until then.
- W8 `stage_files` preflight matches exact index paths only; a selected directory/pathspec containing an unmerged entry, or non-normalized (`./a`, `a//b`) paths, bypass CUT1. Normalize components or check prefix match for directory selections.
- W9 File size rule (<200 LOC, modularize): `conflict_resolve.rs` 646 LOC, tests 661 LOC. Three near-identical ~60-line oracle blocks (lines 346-409, 494-556, 597-641) + three index-write closures → extract `verify_stage0(repo_root, path, expect: Option<(Oid,u32)>)` and `stage_entry(...)`; target ≈ 250 LOC.

## Suggestions
- `try_acquire` calls `dunce::canonicalize` under the mutex; canonicalize before locking.
- `ResolveAction::IndexSide` carries redundant `side` + `stage` (mismatch is rejected) — keep one if contract still unfrozen (YAGNI).
- `core.autocrlf` match: treat `no/off/0` as false (git bool) to avoid needless Unsupported.
- Reuse `ResolveOutcome::Busy` mapping for `stage_files` instead of `AppError::Unavailable` if UI needs uniform outcome (otherwise fine).
- Clippy: 12 `needless_borrows_for_generic_args` warnings in `conflict.rs` (lines 293-294, 437-458, 635) and `types.rs:10`; no errors.

## Positive
- Fail-closed legacy payload handling; strict typed request; no `git add .`/reset/clean; no rollback or replay; truthful phase outcomes (`worktreeChangedStageFailed`, `outcomeUnknown`) with retained text.
- Preconditions bind index fingerprint + snapshot_version (target revision, operation, attributes fingerprint, worktree content hash).
- Guard is RAII, `try_acquire` non-blocking → no self-deadlock; no manual `index.lock` ownership.
- Real-state assertions in tests (index stages, bytes, unrelated entries).

## Validation
- `cargo test --manifest-path server/Cargo.toml --test git_conflict_exact_staging --test git_conflict_discovery_api` → 10/10 + 11/11 pass.
- `cargo test --lib git::` → 203 passed, 0 failed.
- `cargo clippy --all-targets`: warnings only (none errors); `cargo fmt --check` fails repo-wide (pre-existing, many unrelated files; changed test/api files also unformatted).
- Throwaway serde probe (removed) confirmed W1.

## Plan status
Phase 03 NOT complete. Todo 1 (coordinate actual writers) unmet; todos 2–6 implemented, pending W1–W9 hardening. Next: close C1, then W1–W3, W5, W8; re-review cycle 3.

## Unresolved questions
1. Is `text`/`eol` attribute gating in scope for W3 or deferred (plan lists ident/encoding/autocrlf only)?
2. Should shared-ref coordination key on `commondir` (cross-worktree) or is native ref locking accepted for linked worktrees?
3. Is root-run CI expected (affects `.git` 0555 injection test)?
