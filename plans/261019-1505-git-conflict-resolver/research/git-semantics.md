# Git semantics — documentary research

Status: upstream documentation research; no live qualification run in this task. Parent synthesis corrects unsafe command recipes. Direction: [brainstorm](../../reports/brainstorm-261019-1326-git-conflict-resolver.md).

Current planning authority: [validated decisions](../plan.md#validation-summary) and [operation contract](../design-contract.md#operation-lifecycle) supersede earlier hypothetical message-input alternatives; historical upstream research is not runtime qualification.

## Primary sources

- [git-checkout](https://git-scm.com/docs/git-checkout): index-side checkout, stages, rebase ours/theirs inversion.
- [git-add](https://git-scm.com/docs/git-add), [gitattributes](https://git-scm.com/docs/gitattributes): index staging and worktree/blob conversion.
- [git-merge](https://git-scm.com/docs/git-merge), [git-rebase](https://git-scm.com/docs/git-rebase), [git-cherry-pick](https://git-scm.com/docs/git-cherry-pick), [git-revert](https://git-scm.com/docs/git-revert): operation-specific recovery semantics.
- [git-worktree](https://git-scm.com/docs/git-worktree): worktree/private Git metadata vs shared repository state.

## Required semantic boundary

- Reviewed text represents the reviewed **worktree representation**, not an assumed canonical blob. Stage through qualified Git conversion and verify actual stage 0 and current worktree after mutation.
- Selected index side must preserve selected stage OID/mode exactly and materialize its qualified checkout-compatible representation. `checkout --ours/--theirs` followed by `add` is only a candidate: filters need not round-trip, so it does not by itself guarantee exact selected OID. Raw blob extraction alone is not checkout-compatible under all attributes.
- Delete removes intended worktree path and unmerged index entries without recreating a deliberately missing side. Missing stage and empty blob are distinct. Stage 1 means operation-specific base, not always an ordinary merge-base; revert needs different labels.
- Modes 100644/100755 require deliberate preservation/choice; 120000 symlink and 160000 gitlink need visible unsupported handoff. Complex renames/path forms likewise remain visible. Binary whole-side selection is in scope; binary merging is not.
- Support qualified standard text/EOL conversions. Unknown custom filters, working-tree encodings and unsupported representations fail before write with explanation, not lossy conversion. Detect attributes without executing unknown filter code during discovery. No filter/config installation or mutation.

## Preconditions and application mutation scope

- Reuse server project/worktree/nested-root validation. Bind snapshot to normalized actual repository/index identity, operation/HEAD metadata, relevant stage OIDs/path bytes/modes, attributes policy and worktree content/type. Client profile/generation are client routing fences, not server-authoritative Git state or authentication.
- Read coherently with before/after fingerprints and reject changed-during-read; immutable DTOs alone are insufficient. Content hashes, not mtime alone.
- Serialize relevant application mutations by actual worktree/index identity; operation/ref changes may require common-repository scope with fixed acquisition order. Linked worktrees share refs/objects but not index/HEAD/operation files.
- Git's native index/ref locking and an application lock do not prevent external filesystem writers. Never hold a manually acquired `index.lock` while invoking a Git child that needs it. Stage entries for unrelated files must survive.
- Partial outcome: worktree updated/deleted but stage failed is not success and not an untouched failure. Report phase facts, preserve draft, refetch and require review before new action. No blind rollback or mutation replay after lost response/timeouts.
- Index-lock contention can test a rejection **before** writing. To prove write-success/stage-failure, deliberately inject failure at the later staging boundary; do not assume a preexisting lock always exercises that branch. `git add` does not ordinarily run commit hooks; hooks belong to operation continuation tests.

## Operation lifecycle

- Authoritative status for merge/rebase/cherry-pick/revert must work for terminal-started operations; generic index conflicts without an operation remain resolvable without Continue/Abort.
- Detect rebase and sequencer variants from worktree-specific Git metadata. `rebase-apply` alone does not distinguish rebase from `git am`; unsupported/ambiguous states remain explicit. Sequencer can outlive a single CHERRY_PICK_HEAD/REVERT_HEAD marker.
- Fixed allowlist: `git merge|rebase|cherry-pick|revert --continue` and matching `--abort`, selected on server from fresh state. No client shell text, operation initiation, automatic skip or broad reset/clean.
- Zero unmerged entries is necessary, not proof of completion. Outcomes include completed, still stopped, another conflict, hook/signing/editor/input prerequisite, failed, and state unknown until refresh.
- Noninteractive subprocess policy needs closed/piped stdin, bounded concurrently drained diagnostics, deadline/cancellation/process cleanup and truthful post-run refresh. Exact values/process strategy require qualification; `GIT_TERMINAL_PROMPT=0` alone does not bound hooks/pinentry.
- Never disable hooks/signing, silently set `GIT_EDITOR=true`, or mutate repository/global config. Required commit-message editing hands off to Git's configured editor in the exact owning repository/worktree terminal; no resolver message form/adapter, handler interactive editor or automatic PTY injection. Preserve dirty drafts/history; refresh authoritative operation/full-index/worktree after every attempted command and terminal return. Handoff is neither completion nor guaranteed zero-write; failed refresh stays unknown/no replay, stale recovery needs fresh explicit import/review. Cached signing may succeed; do not predeclare all signing unavailable.
- Empty commits/interactive todo/exec states get clear terminal handoff; no new Skip feature is required by this plan. Abort confirmation names potential loss of resolution work and dirty drafts.

## Pending executable qualification

1. Genuine conflicts for all four operations; inspect stages and role labels; resolve/stage; continue; abort. Multi-commit sequencer, repeated rebase stop, unsupported `git am`.
2. Binary exact stage OID/mode plus checkout-compatible bytes; text CRLF/LF/final-newline/BOM/attributes round trips; unsupported conversion rejects before write.
3. Linked worktrees, nested roots, unrelated staged file, target changes, symlink/traversal/path forms, SHA-256 repository support boundary.
4. Stale source/worktree/operation/attributes rejection; concurrent application mutation; external-writer race limitations; controlled post-write stage failure and no unsafe rollback.
5. Failing real hook, required editor, available/unavailable signing, empty-commit stop, hung child and lost response; verify Git state rather than only HTTP response.

## Unresolved technical gates

- Exact supported attributes/encoding/platform matrix and selected-side materialization algorithm.
- Operation-state discriminators, safe editor-required detection and bounded process lifecycle on applicable supported server OSes remain unproven. The message-input choice is settled; separately Pending/nonblocking Windows-native client qualification does not waive backend safety.
- Actual lock scope, coherent snapshot validation and partial-outcome recovery evidence.
