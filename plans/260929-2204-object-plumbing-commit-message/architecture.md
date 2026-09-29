# Proposed architecture: object-only commit message editing

Status: Phase 01 implementation DONE (2026-09-30 00:44:16 +07:00); Phases 02–03 remain pending. This file remains the plan's design contract; the Phase 01 close-out records scoped test evidence and its remaining qualification boundary. Existing `docs/system-architecture.md` has user changes; update its Git section only after implementation proof.

## Decision and boundaries

Replace message editing's checkout/amend/rebase path with one object-only DAG rewrite for HEAD, root, linear and merged ancestry. Both pushed and unpushed commits use the same local operation. Publishing is a separate, explicit operation; editing never contacts a remote or pushes. This satisfies local edits offline and publication when the destination accepts history updates.

Do not change drop/revert/reset/cherry-pick policy. Do not rewrite other local branches, tags, notes, remote-tracking refs, or other remotes. No rebase fallback, automatic stash, automatic force retry, generic history-rewrite framework, or new dependency required.

## Local invariants

- Resolve project/worktree/root through current server boundaries. Capture named branch, original tip, target full OID; reject detached/unreachable/active-operation states and stale expected branch/tip.
- Dirty staged/unstaged/untracked state is allowed. Never use checkout, reset, index writes, status-driven refresh, merge, amend, or rebase in this operation.
- Traverse actual commit parents parent-first. Rewrite target and only its descendants reachable from captured tip. Keep other parent OIDs and parent ordering. Include all merge parents, not only first-parent history.
- Reuse each tree OID verbatim, including manual merge resolutions. Preserve author, committer and dates byte-for-byte, plus descendant messages and unrelated header blocks. Change only target message, mapped parent OIDs, and explicitly acknowledged invalidated signature material.
- Parse raw commit header blocks including continuations; use existing git2 object database to write commit objects. High-level commit construction alone cannot guarantee preservation of arbitrary headers. Descendant message bytes are never lossily decoded.
- Proposed target-message contract: submitted UTF-8 bytes with a final LF added only when absent; reject whitespace-only. Equality with the resulting payload is a no-op before signature removal. Reject a non-UTF-8 target encoding before mutation rather than silently reinterpreting it; unchanged descendants remain byte-preserved.
- Changed commits cannot retain valid original commit signatures. Discover affected signature headers before publication; require explicit consent to remove invalidated `gpgsig`/`gpgsig-sha256`. Preserve embedded mergetags only when their referenced parent stays unchanged; otherwise require removal consent. No impersonated re-signing.
- Reject incomplete/unsupported ancestry (shallow boundary needed by traversal, missing objects, replace/graft ambiguity) before moving refs. Surface reasons; no fallback to worktree mutation.
- Build all replacement objects before publishing. Verify new tip tree equals old tip tree. Publish only captured branch with expected-old-OID check and reflog entry. Retain HEAD symbolic target; do not redirect whatever HEAD points to at completion.
- Fence branch identity as well as branch OID using existing git2: `repo.transaction()`, `lock_ref("HEAD")`, `lock_ref(captured_branch)`, re-read raw symbolic HEAD and direct branch OID under locks, `set_target(captured_branch, new_tip, ...)`, then `commit()`. Update exactly one ref; locking HEAD is not a HEAD write. Parent qualified this with git2 0.19.0, including rejected symbolic-ref mutation, same-OID HEAD switch, stale branch and dirty bytes. Installed git2 multi-ref transactions are not all-or-nothing; do not add other writes. Git CLI `symref-verify HEAD` plus branch update was experimentally rejected for duplicate HEAD updates and is not the chosen implementation. Concurrent external worktree/index changes remain outside this operation's control.
- Return original/new target and tip OIDs, branch and rewritten count, no-op state and signature effects. Never claim a dirty tree became clean. CAS failure leaves branch unchanged; unreachable generated objects are harmless.

## Publish contract

- Keep normal Push fast-forward-only. Replace UI-accessible bare force behavior with a confirmed exact lease, sharing current git2 credential/progress/rejection handling.
- Before confirmation, resolve the actual push destination using existing push resolution and its effective push URL; obtain current advertised remote branch OID. Freeze repository/root, branch, source OID, remote identity/config, destination ref and expected remote OID for the request. Do not assume `origin`, matching branch names, or that cached `isPushed` proves current remote state.
- Confirmation shows destination and that this publishes the entire selected branch, including any other local commits. Absent/ambiguous destination returns an actionable state; no guessed ref or force fallback.
- Submit the frozen source and lease. Revalidate local source/branch/config; reject changes rather than silently republishing newer work. At libgit2 push negotiation, require exactly the intended ref update and expected remote-old/local-new OIDs, then let receive-pack enforce its ref update check.
- git2 0.19 callback names are counterintuitive: `PushUpdate.src()` is remote old OID and `dst()` is proposed new OID. Parent's standalone Rust probe verified those fields, fixed-OID refspec and matching/stale lease behavior against a real local bare remote; actual app/authenticated transports and post-negotiation races still require qualification.
- Background fetch and credential retries must not refresh the approved lease. Remote changes require fresh preview and user approval.
- Remote rejection/transport failure does not undo the completed local edit. Display local success and publication outcome separately; on uncertain network completion inspect advertised remote state before offering another attempt.
- Frontend state and requests retain existing profile/workspace/project/worktree/root ownership; stale callbacks cannot update another panel. No new durable receipt store is required for local message edits.

## Evidence and corrections

- Current rewrite: `server/src/git/commit_file_ops.rs:486-588`; dirty/pushed gates: `163-220`.
- Existing force push is unconditional `+refspec`: `server/src/git/repository.rs:629-647`.
- Existing conflict scenario uses a manually resolved merge: `server/src/git/tests.rs:1762-1797`. Rebase is NOT mathematically guaranteed to be a no-op merely because the intended change is metadata.
- [Disposable Git and git2 smoke](./reports/plumbing-smoke.md) proves object-level feasibility, installed git2 single-ref locking and local-bare negotiated lease behavior, not application/authenticated transport integration.
- Objects, refs and reflogs change on disk. No zero-filesystem-events claim; no benchmark or simplistic commit-depth complexity claim. Graph scan cost depends on traversed commits/edges; object writing depends on affected commit bytes, not checkout volume.
- [Git update-ref](https://git-scm.com/docs/git-update-ref) specifies expected-old checks; [Git push](https://git-scm.com/docs/git-push) specifies exact-ref/exact-OID lease semantics.

## Unresolved questions

No unresolved product questions. User confirmed on 2026-09-29: separate explicit publication, preserved committer metadata, signature removal only with consent, and unification of all Force Push controls. Production gates must qualify application locks, linked worktrees, late push races and authenticated transports; standalone probes do not establish those.
