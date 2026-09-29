# Object plumbing assessment smoke — 2026-09-29

## Scope

Disposable local Git repository plus bare remote; Python subprocess drove real Git commands. Temporary directories removed on completion. No application code, working tree, index, branches, or remotes in dam-hopper were modified by this smoke. This is a feasibility experiment, not a production implementation or application test.

## Procedure

1. Create root, diverging main/side commits, and conflicting merge; commit a manual resolution.
2. Push main to a disposable bare remote.
3. Stage a file change, modify that file again, and create an untracked file; capture raw index and file bytes.
4. Traverse commits parent-first. Reuse every tree and non-parent header; replace target message and mapped parent OIDs. Write commit objects with `git hash-object -t commit -w --stdin`.
5. Advance only `refs/heads/main` with `git update-ref <ref> <new> <expected-old>`.
6. Attempt ordinary push, then explicit `--force-with-lease=refs/heads/main:<expected>` push using a fixed source OID.
7. Independently advance remote; attempt another rewrite push with stale lease.
8. Exercise a side-only ancestor, identical-message root edit, and HEAD edit.

## Observed output

```text
PASS: pushed root + both merge parents rewritten; all four tree IDs, metadata, ordered parents, descendant messages, manual merge resolution preserved
PASS: staged index bytes, unstaged/untracked file bytes, and unrelated side branch preserved
PASS: stale local expected-OID ref update rejected without moving branch
PASS: ordinary push rejected rewrite; explicit expected-OID lease published rewritten branch
PASS: stale remote lease rejected; independent remote advance preserved
PASS: side-only ancestor rewrites only side+merge; root no-op retains OIDs; HEAD edit rewrites one commit
```

## Ref publication qualification

Initial proposed CLI transaction failed on Git 2.55.0:

```text
start
option no-deref
symref-verify HEAD refs/heads/main
update refs/heads/main <new> <old>
prepare
commit
fatal: prepare: multiple updates for 'HEAD' (including one via its referent 'refs/heads/main') are not allowed
```

Changing command order or replacing verification with same-target `symref-update` did not resolve it. Do not give this sequence to an implementation agent.

Qualified replacement: temporary Rust crate with `git2 = "=0.19.0"`, `cargo run --offline`, and real Git-created repository:

1. `repo.transaction()`.
2. `tx.lock_ref("HEAD")`, then `tx.lock_ref(captured_branch)`.
3. Read raw symbolic HEAD; require captured branch. Read direct branch target; require captured old OID.
4. Attempt external `git symbolic-ref HEAD refs/heads/other` while locks held: rejected.
5. `tx.set_target(captured_branch, new_oid, None, "reword qualification")`.
6. `tx.commit()`; only the branch is written. No second ref write.

Observed:

```text
PASS: locked HEAD+branch rechecked; external symbolic-ref blocked; single branch write committed
PASS: committed target and symbolic HEAD observed through Git CLI
PASS: git2 HEAD+branch lock publication preserves raw dirty index and worktree/untracked bytes
PASS: changed symbolic HEAD with same OID rejected before branch update
PASS: stale branch OID rejected before branch update
```

Temporary crate, build output and repository removed. This validates the installed libgit2 single-branch path, not multi-ref atomicity or all external checkout behaviors.

## libgit2 leased push qualification

Second temporary Rust crate with `git2 = "=0.19.0"` compiled/run via `cargo run --offline`. Real local repository and bare remote, fixed full-OID source refspec `+<newOid>:refs/heads/main`, existing libgit2 API `RemoteCallbacks::push_negotiation`.

- Callback asserted exactly one update and destination `refs/heads/main`; compared `src()` to expected **remote old** and `dst()` to proposed **local new**.
- Published initial root, then non-fast-forward rewritten root with matching exact lease.
- Independently created/advanced the bare remote branch; attempted another rewrite with the now-stale old OID.

```text
PASS: git2 fixed-OID non-fast-forward refspec + exact-old negotiation lease published rewritten history
PASS: git2 stale remote lease rejected and independent remote commit preserved
```

Observed remote ref independently through git2 matched expected replacement/independent advance after each case. Temporary crate, build output and repositories removed. This establishes installed callback OID ordering, fixed-OID refspec support and stale-preview protection over local bare transport. Does NOT qualify app callbacks, SSH credentials, late transport loss or post-negotiation receive-pack races.

## Limits

- Unsigned UTF-8 commits only; signed/encoding/header policies need implementation qualification.
- No authenticated SSH/HTTPS transport, live browser, application Rust function, linked-worktree race, post-negotiation receive-pack race, or crash injection executed. Standalone Rust git2 local ref and local-bare push-negotiation probes were executed as recorded above.
- The smoke preserves raw committer metadata. Earlier manual session commands instead regenerated committer dates; those commands are not the replacement specification.
- Object and ref files change under Git storage. No claim of zero filesystem events or measured performance improvement.

## Unresolved questions

None for this feasibility experiment. Production qualification belongs to the implementation plan.
