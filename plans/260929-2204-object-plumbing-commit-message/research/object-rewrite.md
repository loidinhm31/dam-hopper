# Research: Object-level commit-message rewrite

**Date:** 2026-09-29  
**Verdict:** Feasible; replace the current checkout/amend/rebase path with a raw commit-object DAG rewrite and one compare-and-swap publication of the current local branch. Pushed status must not gate this *local* rewrite. It changes no remote ref; updating a remote is a separate, explicit force-with-lease operation.

## Current behavior and evidence

- `server/src/git/commit_file_ops.rs:163-221` preflights active Git operations, attached branch, clean worktree, target reachability, pushed status, and (when requested) root status. `edit_commit_message` calls it with `allow_root=true` but still rejects dirty/pushed targets (`:486-504`).
- HEAD is amended in place via `git commit --amend -m` (`:506-524`). For an older target, the code detaches at it, amends, checks out the branch, then runs `git rebase --rebase-merges --onto` (`:527-588`). This entails a checkout/rebase conflict and recovery path for a message-only change.
- `get_commit_message` converts raw message bytes with lossy UTF-8 (`:479-484`). Cargo already pins `git2 = "0.19"` (`server/Cargo.toml:113-115`); the module also invokes Git CLI (`commit_file_ops.rs:63-89`).
- Tests cover HEAD tree/author preservation and message newline (`server/src/git/tests.rs:1651-1675`), a linear older-target rewrite (`:1677-1700`), and current empty/dirty/pushed/detached/unreachable/active-operation rejections (`:1702-1760`). The merge test expects a rebase conflict (`:1762-1797`), not object-level merge preservation. `GitBlockReason` has no stale-ref/CAS result yet (`server/src/git/types.rs:205-242`).
- The earlier manual proof rewrote one selected commit plus one child with two `git commit-tree` invocations, then `git reset --soft`. It establishes that simple linear example only: hard-coded single-parent mapping, no general descendant/side/merge traversal, no raw metadata/header preservation guarantee, and no expected-old ref CAS or concurrent-HEAD protection. `-m` plus shell command substitution is text reconstruction, not arbitrary message-byte preservation. It changed only the local ref; it did not publish pushed history.
- The main agent's disposable-repository smoke is recorded at `plans/260929-2204-object-plumbing-commit-message/reports/plumbing-smoke.md`; it reports root/HEAD, side and merge topology (including ordered parents), dirty index/files, side-only descendants, no-op OIDs, and stale-CAS cases. This is supporting smoke evidence, not a substitute for permanent acceptance coverage.

## Construction choice

| Approach | Strength | Limitation for strict message-only rewrite |
|---|---|---|
| `git2::Repository::commit` | Accepts a tree, explicit ordered parent list, author and committer; can create an object without updating a ref when no ref name is supplied. | Re-serializes a normal commit; does not expose preservation of arbitrary raw headers/encoding/signature bytes. |
| `git commit-tree` | Official plumbing creates commits from a tree and any number of ordered `-p` parents; author/committer dates can be supplied through environment. | Still constructs a standard commit, not a byte-preserving header editor; launching once per rewritten node and manually supplying every field is less suitable for strict preservation. |
| **Recommended: git2 raw ODB + single-ref git2 transaction** | `Repository::odb().write(ObjectType::Commit, bytes)` stores an exact commit payload without moving refs. Patch raw commit headers/payload, build needed objects, then lock both worktree HEAD and branch in `repo.transaction()`, verify exact symbolic HEAD target and old branch tip under locks, and `set_target` only on the branch. | Requires careful raw-header policy and refusal on stale identity/tip; multi-write git2 transactions are not all-or-nothing, so perform exactly one ref write. |

The official `git-commit-tree` docs describe tree/parent-based construction; git2 0.19 documents `Odb::write` and `Transaction`. Parent's disposable git2 0.19.0 Rust smoke qualified the two-lock/one-write publication, rejecting external symbolic-HEAD switches and stale tips; this is not application-level proof. Git CLI `update-ref --stdin` HEAD `symref-verify` plus update of its branch referent failed as duplicate HEAD updates on installed Git 2.55, so that recipe is not recommended.

## Proposed local rewrite contract

Current GET `/api/git/{project}/commit/{hash}/message` returns only `{message}`. The phase 01 plan enriches it to `{message, branch: full refs/heads name, headOid}` captured for the selected project/worktree/root and target; POST requires these as `expectedBranch`/`expectedHeadOid` with original `hash`. Target history may change after GET: POST rejects stale snapshot before target lookup, without silently remapping an old target OID. Phase 02 owns UI/publication; Phase 03 owns integrated qualification/docs.

1. Snapshot the current symbolic local branch, its exact tip OID, and the target. Reject stale expected branch/tip **before** target lookup (a previously edited target OID may no longer be reachable), then reject detached HEAD, missing/unreachable target, active merge/rebase/cherry-pick and unsupported history. Root commits are valid. Do **not** reject for pushed status or dirty index/worktree.
2. Define the rewrite set as the target plus every descendant of it that is reachable in the captured tip's full parent DAG. Visit parent-first. For each rewritten commit retain its exact tree OID and ordered full parent vector; substitute only parent OIDs already in the old→new map. This rewrites side lines and merge descendants even when the edited commit is a non-first parent; unaffected parents stay identical. Preserve every other commit's message bytes.
3. Rewrite only the current branch's reachable DAG. Do not move tags, remote-tracking refs, or other local branch refs. If another ref still names an old commit, it remains valid and unchanged.
4. The target gets the new UTF-8 message. Match the existing `-m` contract by adding a final LF only when absent; reject all-whitespace input. If the normalized new payload equals the existing raw payload, return a no-op with the original OID and no ref movement.
5. Preserve tree, author, committer (including timestamps/timezones), parent order, and all unrelated raw header blocks. On every changed commit, identify invalidated `gpgsig` and `gpgsig-sha256` blocks (including continuation lines); require explicit `allowSignatureRemoval=true` before removing any. Never claim replacement commits are signed. A `mergetag` embeds a signed tag for a particular merge parent: retain its complete raw block only if its referenced parent OID stays unchanged; if that parent is remapped, require the same explicit consent before removing the now-invalid mergetag. If a mergetag cannot be safely interpreted/matched to its parent, block rather than silently retain/drop it. UI text is UTF-8: reject edits of targets declaring non-UTF-8 `encoding` before writing objects rather than deleting that header or mislabeling the new bytes. Unchanged descendants (including non-UTF-8 messages/encoding headers) remain byte-preserved. `get_commit_message` currently decodes lossily, so targets with non-UTF-8 raw message bytes cannot safely round-trip via the current string UI; block edit before mutation unless the displayed source is provably UTF-8.
6. Never checkout/reset/rebase or alter index/worktree. Reusing every commit's tree and changing only the current branch ref leaves staged, unstaged, conflicted-file bytes, and untracked files untouched. Keep the active-operation guard because in-progress Git state expects a particular HEAD.
7. Publish only after all OIDs exist: `let mut tx = repo.transaction()?; tx.lock_ref("HEAD")?; tx.lock_ref(captured_branch)?;` re-read raw symbolic HEAD target and direct branch OID under locks; reject if either differs from capture. Call `tx.set_target(captured_branch, new_tip, None, "edit commit message")?; tx.commit()?` with no HEAD write. Parent's disposable git2 0.19.0 Rust smoke qualified this exact pattern; qualify linked-worktree behavior in application tests. On stale mismatch return typed `stale-ref` with branch unchanged; generated unreachable objects are harmless. No `reset --soft`, CLI symbolic verification plus referent update, or unconditional ref update.
8. A pushed target behaves identically locally: old remote refs/objects remain unchanged and the rewritten local branch is now non-fast-forward relative to the remote. Explain this to the user; do not auto-push. If publication is later requested, use a separate explicit force-with-lease operation against the captured upstream OID, not ordinary force.

## Boundaries and race handling

- **Branch switch/ref race:** lock both symbolic HEAD and captured branch via git2 transaction, re-read HEAD symbolic target and branch OID under locks, write only branch. Parent's git2 0.19.0 Rust smoke observed external `git symbolic-ref HEAD other` blocked while HEAD locked and same-OID switch rejected, and stale branch rejected. App lock coordinates app-owned operations only; external index/worktree mutations are not serialized.
- **Linked worktrees:** refs and objects are shared, but each linked worktree has its own HEAD/index/files. Check `git worktree list --porcelain` or existing worktree APIs and refuse if selected branch is checked out elsewhere; recheck before publication. Qualify that transaction's `HEAD` lock refers to the selected worktree rather than shared/common HEAD. External checkout/index processes remain outside app control after release; no global locking claim.
- **git2 transactions:** chosen two locks guard one branch write; git2 multi-write ref transactions are not all-or-nothing. Do not add a second write, including a HEAD update.
- **Shallow, replace refs, grafts:** refuse when traversal encounters missing/shallow boundary or when replace/graft ambiguity affects the visible history; verify relevant ancestry before writing. A blanket shallow-repository rejection may be unnecessarily broad if the complete reachable DAG is locally available. Supporting ambiguous/missing graph semantics later requires explicit design, not a rebase fallback.
- **Hashes:** use repository OIDs/width from git2; never assume 40-character SHA-1 strings when serializing parent lines.

## Acceptance matrix

| Case | Expected result |
|---|---|
| HEAD target, unpushed or pushed | One replacement commit; same tree/author/committer; local branch CAS succeeds; no remote change. |
| Root target | Succeed with no parents on replacement root; rewrite all reachable descendants. |
| Older linear target | Rewrite target through tip; all trees and descendant messages unchanged. |
| Side child and merge/octopus descendants | Rewrite every selected DAG node once; preserve parent count/order; replace only mapped parent positions; no rebase conflict path. |
| Dirty staged + unstaged + untracked state | Succeed; compare index and worktree bytes/status before/after; no stash/checkout/reset. |
| Message no-op | Same OID; no object/ref update. |
| Missing/unreachable target, detached HEAD, active operation | Block before publication; no branch movement. |
| Concurrent tip change or HEAD branch switch | CAS/HEAD verification rejects; branch stays at concurrent value; return typed stale-ref result. |
| Target branch checked out in another linked worktree | Block before publication. |
| Shallow boundary needed by traversal, replace/grafts ambiguity, malformed raw commit, non-UTF-8 target encoding/message, unacknowledged invalidated signature or mergetag | Fail closed with actionable reason before moving branch; never fall back to rebase. |
| Other local refs/remote refs point to old commits | Leave them unchanged; disclose divergence/publish requirement. |

## Official references

- Git `commit-tree`: https://git-scm.com/docs/git-commit-tree
- Git `update-ref` documentation (CLI compare-and-swap reference, **not** chosen HEAD/branch combined recipe): https://git-scm.com/docs/git-update-ref
- Git worktrees: https://git-scm.com/docs/git-worktree
- Replace refs and graft conversion: https://git-scm.com/docs/git-replace
- Shallow clone semantics: https://git-scm.com/docs/git-clone#Documentation/git-clone.txt---depthltdepthgt
- git2 0.19 `Repository`: https://docs.rs/git2/0.19.0/git2/struct.Repository.html
- git2 0.19 raw object database `Odb::write`: https://docs.rs/git2/0.19.0/git2/struct.Odb.html#method.write

## Qualification gates remaining

- Parent's disposable git2 0.19.0 Rust smoke qualified HEAD+branch lock, identity/tip re-read and one branch write including stale switch/tip. Verify linked worktrees, reflog and error/uncertainty outcomes through the production Rust entrypoint; Git CLI `symref-verify HEAD` with referent update is not a fallback. Do not invent a minimum Git version.
- Construct real signed commits (`gpgsig` and `gpgsig-sha256`) and merges with `mergetag`; verify embedded `type commit`/`object <OID>` parent association, affected-block detection, consent rejection/removal, and byte-preservation for unchanged referenced parents. This checks structural association, not cryptographic validity.
- Exercise raw UTF-8/non-UTF-8 target and descendant commits, missing/shallow ancestry, replace/grafts, linked worktrees and stale refs using the Rust application entrypoint. Disposable CLI smoke did not cover these cases.
