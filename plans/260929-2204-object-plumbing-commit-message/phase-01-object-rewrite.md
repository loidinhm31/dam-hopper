# Phase 01 — Local object-only commit-message rewrite

## Context Links

- [Authoritative architecture](./architecture.md) (proposed contract); [object-rewrite research](./research/object-rewrite.md); [disposable Git plumbing smoke](./reports/plumbing-smoke.md).
- git2 0.19 [raw ODB write](https://docs.rs/git2/0.19.0/git2/struct.Odb.html#method.write) and [transaction API](https://docs.rs/git2/0.19.0/git2/struct.Transaction.html). Git CLI [update-ref](https://git-scm.com/docs/git-update-ref) documents ref CAS, but its HEAD symbolic verify plus referent update is **not** the chosen publication algorithm.
- Existing entrypoints: `server/src/git/commit_file_ops.rs:479-589`, `server/src/api/git.rs:689-725`; existing results `server/src/git/types.rs:205-280`; existing edit tests `server/src/git/tests.rs:1651-1797`.

## Overview

**Priority P1 · DONE (2026-09-30 00:44:16 +07:00) · 100%.** Replaced message editing's amend/checkout/rebase path with a local object-only graph rewrite. HEAD, root, older, side-parent, merge/octopus and pushed commits use the same operation. Dirty state stays untouched; this phase never publishes a remote ref. Phase 02 consumes the request/result contract below for UI and explicit publication; Phase 03 handles integrated qualification/docs. See the evidence boundary under [Success Criteria](#success-criteria).

## Key Insights

- Existing `preflight_history_rewrite` rejects dirty/pushed commits and is shared by other destructive actions. Do **not** relax it globally; create message-edit-specific eligibility. `drop_commit`, reset, revert and cherry-pick policies remain unchanged.
- `git2::Repository::commit` and `git commit-tree` reserialize headers. Read raw object bytes, patch header blocks, write with `repo.odb().write(ObjectType::Commit, &bytes)`; preserve trees, identity/date bytes, headers and untouched descendant message bytes.
- Existing merge test asserts a rebase conflict on a manually resolved merge. Replace that assertion for message edits with successful preservation of the merge tree and ordered parents; keep unrelated rebase tests intact. Disposable CLI smoke established feasibility, not Rust/app integration or signature handling.
- Git refs/objects/reflogs **do** change on disk; app mutex cannot freeze external Git/index/worktree processes. No zero-filesystem-events, global atomicity, depth-only runtime bound, or benchmark claim. Scan depends on reachable nodes/edges; writing depends on rewritten object bytes.

## Requirements

### Request and response wire contract (Phase 02 integration)

Existing route `POST /api/git/{project}/commit/{hash}/message` (`server/src/api/router.rs:231-232`). `:hash` is **original target full OID**. JSON camelCase request:

The paired GET on the same route and `{worktreePath?, root?}` query returns a selected-worktree snapshot **bound to the URL target hash**: `{message: string, branch: string, headOid: string}`; branch is the full `refs/heads/...` symbolic target and headOid its exact tip at read time. In `server/src/api/git.rs` serialize `head_oid` as `headOid` (`#[serde(rename_all = "camelCase")]`). Resolve project/worktree/root with the same existing server boundaries; take a consistent HEAD/branch pair (lock both with a read-only git2 transaction, re-read identity/tip under locks, then drop without committing) and verify target reachable from that captured tip. Refuse invalid UTF-8 target messages rather than presenting lossy text; detached/unborn HEAD or a changed pair during capture returns actionable error. Phase 02 stores this GET snapshot and sends `expectedBranch=branch`, `expectedHeadOid=headOid` with the original target hash to POST; no separate branch guess/status-derived OID. Changes between GET and POST fail stale-ref.

```ts
{
  message: string;                   // UTF-8; whitespace-only invalid; append one LF iff missing
  expectedBranch: string;            // full `refs/heads/<name>` from selected worktree snapshot
  expectedHeadOid: string;           // full exact branch-tip OID from same snapshot
  allowSignatureRemoval?: boolean;   // omitted = false; true only after explicit consent
  worktreePath?: string | null;       // existing project/worktree selector
  root?: string | null;               // existing VCS root selector
}
```

`expectedBranch` and `expectedHeadOid` REQUIRED, nonempty, precise; malformed OIDs/ref names are invalid input. An already rewritten/old target hash with stale branch snapshot returns **stale-ref**, not a misleading ‘commit missing’; never silently select another commit or recalculate the expected tip. Preserve `resolve_target_path` + `resolve_git_request_root` authority in API. No remote fields or upstream prerequisite.

Keep `GitActionResult` for existing callers; add edit-only optional Rust fields with `#[serde(rename_all = "camelCase")]` and `skip_serializing_if = "Option::is_none"`, populated on successful edits:

```ts
{
  ok: true; hash: string; branch: string;        // hash = NEW TARGET OID; branch = full ref
  oldTargetOid: string; newTargetOid: string;
  oldHeadOid: string; newHeadOid: string;
  rewrittenCount: number; noOp: boolean; signaturesRemoved: boolean;
  // existing optional fields may remain for unrelated operations;
  // edit MUST NOT set dirty:false, conflict:true or rebase recovery
}
```

`signaturesRemoved=true` if **any** invalidated `gpgsig`, `gpgsig-sha256`, or affected `mergetag` block is removed, false otherwise. No-op: both OID pairs equal, `hash=target`, `rewrittenCount=0`, `noOp=true`, `signaturesRemoved=false`, no object/ref/reflog write. Successful change: `rewrittenCount` counts changed commits (including target); `noOp=false`. Add exactly these `GitBlockReason` kebab-case discriminants: `stale-ref`, `unsupported-history`, `invalid-commit-metadata`, `signature-consent-required`, `publication-uncertain`. A failed `tx.commit()` gets `publication-uncertain` **even after re-reading refs**: include observed HEAD/branch OIDs in diagnostics, never claim a definite outcome or auto-retry. Lock acquisition errors return `AppError::Git` with actionable lock cause; no unsupported-Git-CLI reason for the chosen git2 operation. Blocked result: `ok:false`, `blockedReason`, actionable `message`/`recommendation`, no success-only OIDs or fake `dirty`/`recovery`. Keep existing `DetachedHead`, `UnreachableCommit`, `ActiveOperation` for their true cases. Invalid input remains `AppError::InvalidInput`; malformed history is a typed block. Distinguish expected branch/tip mismatch **first** from target reachability.

### Invariants

1. Resolve branch as symbolic HEAD (`refs/heads/...`) in selected worktree, capture branch tip, require matching `expectedBranch`/`expectedHeadOid`, reject detached/unborn HEAD, active Git operation and target not reachable from captured tip; root target allowed. Pushed status and staged, unstaged, untracked files never gate edit.
2. Parent-first traverse **all parents**, including sides of merges, to determine target and descendant closure reachable from captured tip. Reject missing objects, malformed graph, required shallow boundary, and effective replace/graft ambiguity before writing anything. Other refs, notes, tags, remote-tracking refs and remotes never move.
3. New target message exact UTF-8 request bytes plus LF only when absent; reject whitespace-only. Compare against **raw** target payload before signature removal: exact equality returns no-op. Reject target non-UTF-8 `encoding` or invalid UTF-8 target message rather than lossy UI round-trip or silent `encoding` deletion; unchanged descendants preserve all message and encoding bytes.
4. Every rewritten commit retains original tree OID, author/committer/date raw bytes, original full parent ordering, descendant message bytes and unrelated header blocks. Change target message; substitute mapped parent OID bytes only. An octopus merge maps whichever subset of parents changed.
5. Changed commit signatures cannot remain valid. Pre-scan complete rewrite closure for both `gpgsig` and `gpgsig-sha256` including multiline continuations; `mergetag` block is retained iff its embedded `object <OID>` matches an unchanged merge parent; changed referenced parent requires removal. If any removal required and `allowSignatureRemoval` absent/false, block **before writing** with explicit consent requirement. If true, remove exactly invalidated blocks, never sign by impersonation. Malformed/ambiguous mergetag fails closed.
6. Create every replacement commit object, validate resulting head tree equals captured tip tree, then publish exactly captured branch using git2's two-lock/one-ref-write transaction described below. No checkout, reset, rebase, amend, merge, stash, index write, status-driven refresh or auto-push. On stale HEAD/branch under locks, generated objects may be unreachable but branch remains unchanged. On uncertain commit failure re-read refs; do not claim success or unchanged branch without evidence.

## Architecture

### Ownership and helper boundaries

`server/src/git/commit_message_rewrite.rs` (new private module) owns raw parser/serializer, graph walk, policy, object construction and checked branch publication; no generic history-rewrite framework. Define the public Rust boundary and private helpers **as below**; private `enum RewriteFailure { Block(GitBlockReason, String), Error(AppError) }` maps typed refusals to `GitActionResult` and propagates Git/I/O faults. No new wire error envelope:

```rust
pub struct CommitMessageSnapshot { pub message: String, pub branch: String, pub head_oid: String }
pub fn get_commit_message(project_path: &Path, hash: &str) -> Result<CommitMessageSnapshot, AppError>;
pub async fn edit_commit_message(
    project_path: &Path, hash: &str, message: &str,
    expected_branch: &str, expected_head_oid: &str,
    allow_signature_removal: bool,
) -> Result<GitActionResult, AppError>;
fn snapshot_branch(repo: &git2::Repository) -> Result<CapturedBranch, RewriteFailure>; // lock HEAD+branch, re-read under both, then drop unchanged transaction
fn collect_parent_first<'odb>(
    repo: &git2::Repository, odb: &'odb git2::Odb<'_>, tip: git2::Oid,
) -> Result<Vec<CommitNode<'odb>>, RewriteFailure>;
fn parse_raw_commit(raw: &[u8]) -> Result<RawCommit<'_>, RewriteFailure>;
fn plan_rewrite(
    nodes: &[CommitNode<'_>], target: git2::Oid, normalized_message: Vec<u8>,
) -> Result<RewritePlan, RewriteFailure>;
fn required_removals(plan: &RewritePlan) -> bool;
fn rewrite_bytes(
    node: &CommitNode<'_>, mapped_parents: &[git2::Oid],
    new_message: Option<&[u8]>, removable_header_indices: &[usize],
) -> Result<Vec<u8>, RewriteFailure>;
fn publish_checked_ref(
    repo: &git2::Repository, captured: &CapturedBranch, new_tip: git2::Oid,
) -> Result<(), RewriteFailure>;
```

`CapturedBranch { branch: String, old_tip: git2::Oid }`; `CommitNode<'odb>` holds original OID, tree OID, ordered parent OIDs and `git2::OdbObject<'odb>` so raw bytes need not be copied just for parsing. `RawCommit<'a>` stores header-block byte ranges and `&'a [u8]` message; `RewritePlan` stores `affected_set: HashSet<Oid>`, normalized target bytes and per-commit removable header indices. `RewriteFailure::Block` maps to edit result; `RewriteFailure::Error(AppError)` propagates. Each helper owns its named part; only `publish_checked_ref` mutates refs. Keep transaction lifetime within synchronous helper (git2 transaction is not `Send`).

`commit_file_ops.rs` keeps file-operation and other-destructive-action preflight unchanged; move only `get_commit_message`/`edit_commit_message` responsibility to focused module, delete their old amend/rebase implementation and imports made unused. `mod.rs` registers/exports new module; API `git.rs` validates new request and passes exact values; `types.rs` adds edit-only outcome fields/reasons without repurposing `dirty`; `tests.rs` exercises real temp repos. Do not add dependencies.

### Deterministic graph plan and raw bytes

```text
captured = snapshot symbolic HEAD + full refs/heads name + branch OID
if mismatch expectedBranch/expectedHeadOid: stale-ref (before target lookup)
if operation active / detached / unsupported history: block
nodes = iterative DFS from captured tip following all parent OIDs
  mark visiting/visited; reject cycles, missing object, wrong object type,
  invalid raw tree/parent header or required shallow boundary
  append each node on DFS exit -> parent-first order; ensure target in nodes
validate target declared encoding UTF-8 (or absent) and target raw message UTF-8
normalize incoming message once; if identical to target raw payload: no-op
affected_set = empty set; removable_headers = empty map
for node in nodes (parent-first):
  affected = node.oid == target || any(original parent OID in affected_set)
  if !affected: continue
  affected_set.insert(node.oid)            // BEFORE visiting its descendants
  inspect raw blocks for BOTH signature types and mergetags
  for each mergetag: associated original parent is changed iff parent in affected_set
  record invalidated header-block indices for this node in removable_headers
if invalidated blocks && !consent: block BEFORE ODB writes
changed_map = empty map
for node in nodes (parent-first) with node.oid in affected_set:
  mapped_parents = ordered node.parents.map(p => changed_map.get(p).unwrap_or(p))
  emit raw payload with original header block order; update mapped parent
  lines; retain unchanged header blocks verbatim; remove approved blocks;
  target message = normalized bytes, descendant message = original bytes
  new_oid = odb.write(Commit, payload); changed_map[node.oid] = new_oid
verify new tip object's tree equals captured tip's tree
publish checked ref; return old/new target and tip, rewritten count/effects
```

Parse the raw header up to the **first** `\n\n`; split into logical blocks: first header line `key SP value LF`, zero or more following continuation lines prefixed by ASCII space. Reject orphan continuation, missing mandatory tree/author/committer, invalid or duplicate structural `tree`, malformed `parent`, bad header/body separator, referenced OID of wrong type; preserve unknown blocks byte-for-byte and in position. For tree/parent compare with libgit2's parsed tree/parent vector (length and order); verify all embedded object IDs using repo OID format, not hardcoded SHA-1 length. On a mapped `parent`, replace only the OID token in that block, preserve line structure. On target new message retain `encoding UTF-8` if declared; reject declared non-UTF-8 or invalid UTF-8 target bytes before writing. Do not decode descendant messages or reconstruct signatures/dates.

Extract each `mergetag` continuation payload exactly; strip one continuation-space per line to inspect embedded tag headers `object <OID>` and `type commit` before the tag's blank separator. Require the referenced commit OID to correspond to exactly one original parent position of this merge. Keep the **entire original raw mergetag block** iff mapped parent OID at that position equals original; changed parent: include block in consent/removal list. If type/OID/parent association cannot be verified, reject malformed metadata, not conditional retention. Test multiple mergetags and signature variants; don't conflate signed tag material with commit-level signatures or claim cryptographic verification.

### Checked publication: exact git2 transaction

Parent's disposable git2 0.19.0 Rust smoke **already qualified** this two-lock/one-write protocol for normal publication, external symbolic-ref mutation blocked while locked, same-OID HEAD switch rejected, stale branch tip rejected and dirty bytes preserved; it is not production application proof. Implement with repository opened for the **selected worktree** (`HEAD` is per worktree):

```rust
let mut tx = repo.transaction()?;
tx.lock_ref("HEAD")?;
tx.lock_ref(captured_branch)?; // fully-qualified refs/heads/<name>
let head = repo.find_reference("HEAD")?;
if head.symbolic_target() != Some(captured_branch) {
    return stale_ref(); // dropping tx releases both locks; no ref write
}
let branch = repo.find_reference(captured_branch)?;
if branch.target() != Some(captured_old_tip) {
    return stale_ref();
}
tx.set_target(captured_branch, new_tip, None, "edit commit message")?;
tx.commit()?;
// Exactly one ref updated. HEAD remains symbolic; inspect final refs/reflog.
```

Do not write `HEAD` or another ref through the transaction: git2 multi-write transactions are not all-or-nothing. Do not use CLI `update-ref --stdin` `symref-verify HEAD` plus referent `update`: Git 2.55 rejected that naive combination as duplicate HEAD updates. On lock or stale mismatch return actionable error; if commit returns uncertain I/O, inspect branch and symbolic HEAD before reporting, never assert no branch movement without proof. Verify expected reflog entry and linked-worktree HEAD lock behavior through application acceptance; if that qualification fails, stop and reconcile parent architecture, no ref-only CAS fallback. No fabricated Git minimum-version requirement.

## Related Code Files

| Path | Action | Exact scope |
|---|---|---|
| `server/src/git/commit_message_rewrite.rs` | Create | Focused DAG/raw commit/ODB/checked-ref implementation; moved message retrieval/edit API. |
| `server/src/git/commit_file_ops.rs` | Modify | Remove old `get_commit_message` and `edit_commit_message` + dead imports; leave shared destructive preflight and other actions alone. |
| `server/src/git/mod.rs` | Modify | Register/export focused module functions; no old alias. |
| `server/src/git/types.rs` | Modify | Typed block reasons and optional edit result OIDs/count/effects; adapt all `GitActionResult` constructors to compile, without assigning edit-only fields elsewhere. |
| `server/src/git/tests.rs` | Modify | Migrate every changed `get_commit_message` call to `result.message`, replace old dirty/pushed/rebase-conflict assertions, add scenario fixtures below. |
| `server/src/api/git.rs` | Modify | Paired GET returns `{message,branch,headOid}` for same selected target/scope; POST body requires expected fields/optional consent, retains project/worktree/root resolution, passes snapshot to engine and returns enriched result. |
| `docs/system-architecture.md` | Phase 03 documentation only | Update Git section after implementation without overwriting existing user changes; no edits in this planning-only task. |

## Implementation Steps

1. **01A — Qualify chosen publication in application.** Implemented the two-lock/one-write `repo.transaction()` sequence, symbolic-HEAD/branch rechecks, and single branch-ref update. Targeted tests exercise core ref fencing and linked-worktree behavior; the cycle-2 tester report does not establish a started-server selected-worktree race, edit reflog result, lock/permission failure, or uncertain `tx.commit()` outcome. Carry those application-level cases into Phase 03 qualification; never fall back to branch-only CAS or CLI `symref-verify` plus referent update.
2. **01B — Define wire types and eligibility.** Add required expected branch/head to API body and engine call; consent default false; resolve selected worktree/root via existing route. Detect stale expected branch/head before checking whether original target OID exists/reachable. Keep existing active-operation guard and detached rejection, remove only edit-specific dirty/pushed gates. Validate OIDs/ref forms, inspect replace/graft visibility and necessary shallow completeness, and avoid blanket rejection solely because `is_shallow` if full required graph available.
3. **01C — Collect/parse/plan.** Implement iterative parent-first DFS and raw block parser with libgit2/tree/parent cross-check. Validate entire reachable ancestry so no missing parent gets mistaken for root. Detect affected closure and exact raw no-op; precompute signature and mergetag impact before ODB writes. Fail closed on unparseable structural or embedded signed-tag metadata.
4. **01D — Construct/publish.** Produce raw payloads of affected nodes in dependency order with original trees and metadata; use `git2::Odb::write` without updating refs. Verify old/new tip trees match. Recheck app-owned eligibility and worktree mapping; run specified two-lock/one-write git2 transaction, then inspect branch/HEAD/reflog. No reset/rebase/recovery path. If returned outcome uncertain, inspect refs and return explicit uncertainty rather than fabricating failure or success.
5. **01E — Migrate scoped tests and hand off.** Migrate all Rust `get_commit_message` callers/tests to `CommitMessageSnapshot.message` so the changed public function compiles; change GET API serialization to emit `branch`/`headOid`. Exercise paired GET/POST and engine path in isolated real filesystem Git repos; assert response contract, refs/object bytes, index/files, no-op/ref/reflog behavior and error precedence. Delete legacy conflict and clean/pushed edit expectations. Phase 02 consumes GET branch/head snapshot, sends it to POST with original hash, and implements UI plus explicit publication; Phase 03 owns integrated qualification/docs including preserving existing `docs/system-architecture.md` user content. Existing source behavior and disposable pre-change smoke supply baseline; do not schedule a post-cutover old-path reproduction.

## Todo List

- [x] Implement the qualified git2 HEAD/branch locks, stale checks, and single branch write (01A); broader selected-worktree race, reflog, lock/error, and uncertain-commit qualification remains explicit in Phase 03.
- [x] Add request/result types, stale input ordering and edit-only preflight (01B).
- [x] Build full parent DAG/raw header parser and impact preflight (01C).
- [x] Write objects and publish qualified checked ref without worktree/index mutation (01D).
- [x] Migrate `get_commit_message` public callsites/tests, replace obsolete edit assertions, run targeted real-filesystem engine tests and paired in-process GET/POST API integration; hand snapshot contract to Phase 02 (01E).

## Success Criteria

All scenarios run on disposable **real filesystem** repositories through Rust engine/API, not mocked Git outputs:

| Fixture / action | Required observation |
|---|---|
| GET selected target snapshot then POST on same project/worktree/root | GET JSON `{message,branch,headOid}` matches target OID reachable from captured tip; POST with exact pair succeeds, intervening HEAD/branch change returns `stale-ref`; invalid UTF-8 target GET never returns lossy replacement text. |
| HEAD edit and pushed HEAD edit | Exactly one rewritten commit; `hash=newTargetOid=newHeadOid`; tree/author/committer/date bytes unchanged; remote refs never touched, ordinary push not invoked. |
| Root + linear descendants | Root has zero parents; each affected child has rewritten parent; child raw message, tree, metadata and unknown header blocks preserved; `rewrittenCount` exact. |
| Merge with manually resolved conflicting tree; side-only/non-first parent; octopus | Merge tree unchanged, ordered parent vector correct, other parent OIDs same; only target descendants rebuilt, unrelated side/local refs remain unchanged; no rebase conflict/recovery. |
| Staged + unstaged + untracked dirty state | Index bytes/entries, tracked and untracked bytes and status unchanged before/after; successful object rewrite; no `dirty:false`. |
| Exact normalized-message no-op, including signed commit | Old/new target/head pairs equal; count 0; no consent requested, no ODB write, no reflog/ref update. |
| Commit with `gpgsig`, `gpgsig-sha256`, and merge mergetag | Without consent block before object write; with consent remove invalidated blocks and report `signaturesRemoved:true`; mergetag of unchanged parent retained byte-for-byte; malformed tag rejected. |
| UTF-8 target/legacy non-UTF-8 declared target and descendant | UTF-8 target updated without dropping valid encoding header; non-UTF-8 target/invalid original bytes rejected; non-UTF-8 untouched descendant message/encoding bytes preserved. |
| Target hash from already rewritten branch + stale expected tip | `stale-ref`, not generic unreachable/unknown target; no branch movement. |
| Detached/unborn HEAD, unreachable target, active operation | Typed block; no writes or branch movement; other destructive actions' existing guards unchanged. |
| Missing/shallow parent, replace/graft ambiguity, malformed headers | Actionable typed refusal before writes, never treating missing parent as root. |
| Linked worktree, external switch or tip advance between snapshot/publish | Correct selected worktree HEAD identity; unsupported concurrent checkout cannot be claimed serialized; stale switch/tip aborts checked transaction without moving captured branch. |
| Ref lock/I/O failure or failed git2 checked publication | Report failure/uncertainty accurately; no CLI symbolic-verify/ref-only-CAS or rebase fallback; generated unreachable objects harmless. |

**Close-out boundary:** Phase 01 is DONE for implementation and scoped backend/API validation, not for every row above as an independently qualified acceptance result. The cycle-2 tester report records **17/17 targeted tests passing**, while noting that the started-server smoke with a registered project and selected `worktreePath`/`root` was not run. It also lists unverified publication-time same-OID HEAD/tip races, lock/permission and uncertain-commit failures, successful edit reflog behavior, exact raw metadata/unknown-header preservation, invalid-UTF-8 GET, signed no-op/no-write, invalidated/malformed mergetag behavior, unchanged non-UTF-8 descendants, and missing/shallow-parent rejection. Carry these specific cases into Phase 03's integrated qualification; do not report the complete matrix as passed.

After Phase 01 code lands, **integration owner only** runs exactly once against settled shared changes (not while other agents edit):

```sh
cargo fmt --manifest-path server/Cargo.toml --check
cargo test --manifest-path server/Cargo.toml git::tests::edit_commit_message -- --nocapture
cargo check --manifest-path server/Cargo.toml
```

Then start the actual server with a disposable **registered project**, perform paired GET `/api/git/{project}/commit/{hash}/message?worktreePath=...&root=...` and POST to the same route with `message`, GET's `branch`/`headOid` as required expected fields, matching `worktreePath`/`root`, and original `{hash}`; observe JSON result and Git branch/object/index/worktree bytes. Repeat POST with stale head and verify `stale-ref` before target lookup. Also compare ordered parent OIDs, trees, stage/index/file snapshots, branch/reflog and unchanged remote OID. App/no-op cannot guarantee no external concurrent ref/file mutation; do not claim a global atomic filesystem snapshot. Backend Phase 01 gate does **not** require frontend build before Phase 02 migrates its GET/POST consumer; final end-to-end gates after Phase 02/03 do.

## Risk Assessment

- **Transaction fence:** The disposable git2 probe and focused engine tests establish core two-lock/one-write behavior. Selected-worktree application races, edit reflog, lock/permission failures and uncertain commit outcomes remain Phase 03 qualification gates. Never add a second ref write (git2 multi-write is not all-or-nothing).
- **Header loss/signature invalidity:** parsing continuation blocks and signed merge tags demands byte fixtures and positive/negative consent tests; fail closed on ambiguity.
- **Worktree races:** app lock only serializes app requests; git2 locks protect chosen HEAD identity/branch tip during single ref write; external index/worktree writers remain outside lock; no stronger external serialization claim.
- **OID assumptions:** use repo OID representations, validate Git hash format capability; reject unsupported repo format if unable to serialize/verify, not truncate SHA-256 OIDs.
- **Scale:** graph walk and raw ODB writes incur reachable DAG/bytes costs; avoid redundant scans/allocations and unbounded recursion; no fabricated performance benchmark.

## Security Considerations

- API uses existing project/worktree/root authorization resolution; never trust client `expectedBranch` as filesystem path. Validate full branch ref and OIDs; compare branch against resolved worktree symbolic HEAD before and under git2 locks. Reject newline/NUL/control characters in ref input; constrain selected branch to `refs/heads/*`.
- Consent is explicit per edit request; do not default signed-history stripping, leak credentials, forge a signature, auto-push, or expand edit into arbitrary ref rewrite.
- Malformed commit/tag input fails closed; raw object bytes remain local; only generated unreachable objects possible on checked-ref failure.

## Next Steps

**Phase 01 DONE (2026-09-30 00:44:16 +07:00; 100%).** Targeted validation passed **17/17** (16 engine scenarios plus one in-process GET/POST API test); `cargo check` and focused rustfmt passed, and Cycle 2 review approved **9.8/10**. This is not full acceptance-matrix or release qualification: the actual-server selected-project/worktree/root smoke and the outstanding scenarios listed above remain for Phase 03. Phase 02 owns UI and explicit publication: GET supplies branch/head for POST stale fencing, signature consent follows disclosure, and result OID pairs display local success separately from publication.

## Unresolved Questions

No unresolved product questions. Technical qualification remains open: actual-server selected-project/worktree/root smoke; selected-worktree/ref race, reflog, lock/error outcomes; raw metadata, UTF-8 and signature/mergetag cases; and remaining DAG-boundary behavior. The cycle-2 tester report is the source for gaps; Phase 03 must close them without weakening the two-lock/one-write guarantee or using a CLI fallback.
