# Phase 01 — Backend object-only squash

## Context links
- [Authoritative preflight](./preflight.md): user permits pushed commits; selected and rewritten-descendant merges rejected.
- [Backend scout](../reports/scout-261003-1213-squash-backend.md), [frontend scout](../reports/scout-261003-1213-squash-frontend.md). Preflight supersedes their open product questions.
- [Repository guidelines](../../AGENTS.md), [Git architecture](../../docs/system-architecture.md) (raw rewrite/CAS/lease discussion, lines 4342–4416 at discovery), [history scope](../../docs/architecture/git-history-search.md).
- Planning skill read from `~/.omp/agent/skills/planning/SKILL.md` and its design/output references. Local `.omp/skills/` and `docs/development-rules.md` absent on discovery; apply current `AGENTS.md` and existing backend conventions. Architecture/doc updates belong to the parent's documentation phase, not this planning assignment.

## Overview
- Date: 2026-10-03. Priority: P1 — destructive history/ref integrity. Status: implemented and verified; [qualification evidence](./reports/qualification.md).
- Deliver one authenticated, root-aware `POST /api/git/{project}/squash`, raw-object engine, and behavioral regressions. No CLI rebase/reset/amend; no index/worktree writes, implicit push, new dependencies, DB/config migration, backup ref, or controller initialization.
- Parent owns overview, advice lifecycle, integration and final validation. This phase defines implementation contracts only; no source changes or checks performed during planning.

## Key insights
- `commit_message_rewrite.rs:174-285` already implements snapshot, stale-first comparison, active-operation/worktree/history gates. Its helpers are **private**, not immediately reusable from a sibling module.
- `collect_parent_first` validates raw objects against libgit2; `plan_rewrite` computes affected descendants and signature removals. `rewrite_bytes` currently preserves tree and committer and assumes unchanged parent cardinality. Squash needs a narrow tree/committer override, not reuse of the edit operation itself.
- Using the **oldest selected raw object as template** avoids parent-cardinality changes: keep its zero/one predecessor; override tree with newest selected tree. Interior selected objects are absorbed rather than individually serialized.
- Existing edits support merges; squash does not. Restrict only selected/affected objects, not untouched ancestry before the selected range.
- `GitActionResult` already has enough target/tip/count metadata. Existing block reasons cover every required case; add neither fields nor enum variants.
- `repo.signature()` in `diff.rs:932-936` is the configured-current-identity precedent. Do not copy the oldest committer or fabricate a fallback identity.

## Requirements
### Public request and response
```text
POST /api/git/{project}/squash
{
  hashes: string[],              // >=2 exact commit OIDs, oldest -> newest
  message: string,               // final user-authored full UTF-8 message
  expectedBranch: string,        // full refs/heads/... name
  expectedHeadOid: string,       // exact captured branch tip
  allowSignatureRemoval?: bool, // default false
  worktreePath?: string,
  root?: string                 // existing root ID; default existing "." semantics
}
=> GitActionResult
```
- Request field is `hashes`; never sort by dates, reverse implicitly, infer a range from visible rows, or accept rev expressions/abbreviations. Validate exact full 40-hex OIDs supported by the existing git2 engine; compare duplicates as parsed OIDs, including mixed-case textual duplicates.
- Use `message.trim()` only to reject blank input. Preserve all original body/leading/trailing whitespace; append LF iff absent, retaining existing trailing LFs. Backend accepts final text, does not generate concatenation. Client reuses full `commitMessage` reads for every selected hash; all branch/head pairs must agree. Mutation does not trust those reads and revalidates independently.
- Success metadata, documented identically in Rust/client/API docs:

| Field | Squash meaning |
|---|---|
| `hash`, `newTargetOid` | Synthesized squash commit OID |
| `oldTargetOid` | **Newest selected** OID, `hashes[last]`, whose tree is replaced |
| `branch` | Captured full local branch ref |
| `oldHeadOid`, `newHeadOid` | Original and successfully installed branch tips |
| `rewrittenCount` | Replacement commit objects written: **1 squash + strict descendants**; not number of old selected objects |
| `noOp` | `false`; >=2 commits are collapsed even if final message equals an original message |
| `signaturesRemoved` | Any invalidated signature/mergetag removed from the rewritten branch history, including absorbed selected commits |

- Removed commit count is `hashes.length - 1`; descendant count is `rewrittenCount - 1`. Frozen caller selection already supplies range/cardinality; no redundant response array/count/map. `newTargetOid != newHeadOid` for non-HEAD ranges; they are equal when range ends at HEAD.
- Follow existing HTTP split: `AppError::InvalidInput` for malformed request/cardinality/duplicate hashes/blank message/bad expected snapshot syntax; `ApiError::from_app` handles its HTTP mapping. Runtime eligibility blocks return HTTP 200 with `ok:false`, existing kebab-case `blockedReason`, actionable message/recommendation, and recovery where applicable. Missing committer identity returns the existing clear Git error path, not a new block type.

### Rewrite invariants
- Checked-out attached local branch only; selected chain reachable from captured HEAD. Oldest may be a root. Every later selected commit has exactly one parent equal to preceding selected OID.
- Selected commits and every affected descendant have <=1 parent; merges/octopus merges blocked. Untouched predecessor/earlier ancestry may contain merges.
- Synthesized object: newest selected tree; oldest selected predecessor or no parent; oldest selected **author header byte-for-byte**, including timestamp/timezone; **current repository committer** from `repo.signature()` at execution, including current timestamp/timezone; final normalized message.
- Descendants: original trees, author/committer/timezones, message bytes, encoding and unrelated raw headers unchanged; sole parent remapped. Do not UTF-8-decode/re-encode descendant messages.
- New tip tree equals original tip tree before publishing. Index bytes and tracked/staged/unstaged/untracked file contents unchanged; dirty/pushed status not a blocker. Other local branches, tags, remote refs, and original objects remain untouched.

## Architecture
### Focused module + one shared safety implementation
- **Create intentionally** `server/src/git/squash_commits.rs` for public operation and small squash-specific planner; this path is proposed new, not a discovered existing file. Register in `git/mod.rs`, export `squash_commits` at the existing Git facade. Rust snake_case follows `AGENTS.md`.
- Keep shared raw plumbing in existing `commit_message_rewrite.rs`; expose only needed helpers/types/fields with `pub(super)` to the `git` parent/siblings, not public API. No wholesale move/rename of the existing public edit module and no duplicate safety preflight/parser/CAS implementation.
- Extract the existing async mutation preflight (snapshot/stale/gates) into one sibling-visible helper, used by **both** edit and squash. Parameters are path + expected branch/head; operation wrapper attaches appropriate target hash and converts typed failures to `GitActionResult`. Preserve active-operation recovery. Keep request syntax validation and message normalization shared where practical.
- Extract parent-first affected-closure calculation and signature/mergetag analysis from `plan_rewrite` into focused shared helpers. Edit retains its exact-message no-op behavior; squash calls closure/removal helpers for the oldest selected anchor without inheriting edit's no-op rule.
- Extend existing `rewrite_bytes` narrowly with optional tree and complete committer-header overrides; edit passes none, squash template passes newest tree/current committer, descendants pass none. Its parent serializer still emits exactly the original zero/one parents for squash objects. No second serializer or generic rewrite framework.
- Shared types needing sibling access: `CapturedBranch`, `RewriteFailure`, `CommitNode`, `RawCommit`/header blocks as actually required. Access only needed fields; do not export `RewritePlan` merely to reuse its no-op/removal wrapper.
- Parameterize `publish_checked_ref`'s reflog message (`"edit commit message"` / `"squash commits"`), retaining two-lock/one-ref semantics. Update every private-helper caller when its signature changes.
- Do not transplant Drop's root/dirty/pushed guards. Existing edit merge and metadata behavior must remain unchanged.

### Exact validation and mutation order
1. **Router auth**, then resolve configured `project` + registered live `worktreePath` via `resolve_target_path`; re-discover/validate `root` using `resolve_git_request_root`. No repository access through untrusted absolute paths/aggregate roots.
2. Validate request-only values: >=2 hashes, full OID syntax and normalized uniqueness, nonblank message, valid full local expected branch name, exact expected head OID. Normalize final message once.
3. Open repository; snapshot symbolic HEAD and direct local branch target under existing HEAD+branch transaction locks. Detached/unborn => `DetachedHead`. Release read-snapshot locks as today.
4. Compare captured branch and tip to expected values **before any selected-object lookup or graph planning**; mismatch => `StaleRef`. Same tip on a different branch is stale too.
5. Existing mutation safety gates in order: active operation (`ActiveOperation` + recovery); branch checked out by another linked worktree (`CheckedOutBranch`); replace refs/grafts/shallow (`UnsupportedHistory`). Share these gates with edit, no copied checklist. Inability to inspect a guard must propagate an error rather than establish safety: notably do not carry `list_worktrees(...).unwrap_or_default()` into the shared ownership proof.
6. In one `spawn_blocking` raw-object job, reopen captured repository and collect captured HEAD's parent-first DAG with existing parser/cross-check/cycle/missing-object protections. Preserve their typed errors. Index OIDs to nodes once; selected OID absent from captured graph => `UnreachableCommit`.
7. Reject selected parent-count >1; verify every next selected sole parent equals previous OID. Wrong order/gaps/branch-side combinations => `UnsupportedHistory` with explicit consecutive-oldest-first explanation. Compute descendant closure seeded by oldest selected; reject **any** affected merge before writes, including merge descendants outside the selection. Prove captured HEAD belongs to closure; with all affected nodes single-parent, this is the selected chain plus one linear suffix to HEAD.
8. Validate every selected message/declared encoding as UTF-8 using the same policy as full-message reads. Non-UTF-8 selected source => `UnsupportedHistory`. Validate the oldest template has one unambiguous author and committer block for synthesis; ambiguous/malformed mandatory metadata => `InvalidCommitMetadata`. Retain existing raw validation for descendants and unrelated headers; no transcoding.
9. Analyze signature/mergetag removals over **all selected plus all descendants**, including selected objects not serialized. Malformed mergetag/type/non-parent target => `InvalidCommitMetadata`. Required removal without `allowSignatureRemoval` => `SignatureConsentRequired`, before any ODB write.
10. Resolve `repo.signature()` once; on absent/invalid identity use the existing wording `git user not configured (set user.name and user.email): ...`, **before any ODB/ref/index/worktree mutation**. Repository/global Git configuration precedence is libgit2's existing behavior; no new config, environment identity fallback, signing subprocess or auto-signing.
11. Serialize/write the one squash object, then each strict descendant parent-first. Verify reconstructed target topology/tree and final tip-tree invariant. Only then invoke shared locked ref CAS and form success metadata.

### Raw metadata and mapping policy
- Oldest raw object is template. Replace `tree` and `committer`, keep its zero/one parent and raw `author`; replace body. Retain its UTF-8 encoding declaration and unrelated headers verbatim. Metadata unique to absorbed later selections is not merged into the synthetic object; those original objects remain in ODB/other refs.
- Serialize current committer as Git `name <email> seconds ±HHMM` using `Signature` bytes/time; obtain signed offset from `when().offset_minutes()`, not a fixed timezone or hard-coded author date. Preserve valid bytes and prevent accidental repeated committer headers; do not rely on a display formatter without its timestamp contract.
- All `gpgsig` / `gpgsig-sha256` blocks on affected objects are invalidated. Require consent even when signature belongs only to an interior selected object that will be absorbed. Strip from emitted objects; `signaturesRemoved=true` also covers affected signed objects absorbed from branch history. Existing original objects/signatures are not physically deleted.
- Parse each affected `mergetag`; require referenced object to be an original parent. Preserve template mergetag pointing to unchanged predecessor verbatim. Remove/require consent if its referenced parent is selected/rewritten; this includes absorbed selections and descendant parent remaps. Do not blanket-delete unchanged-parent mergetags. No invalidated cryptographic block survives in emitted history.
- Construct `old -> new` mapping: every selected OID maps to the **same** new squash OID, but write only one replacement. For each remaining affected node, replace sole parent using that mapping, emit original tree/metadata/message minus consented removals, add old descendant -> new descendant. Count ODB writes separately from map size.
- Example: `P-A-B-C-D-E(HEAD)` selecting `[B,C]` => `P-A-S-D'-E'`; `S.tree=C.tree`, `S.parent=A`, `S.author=B.author`, `S.committer=current`, `oldTarget=C`, `newTarget=S`, `oldHead=E`, `newHead=E'`, `rewrittenCount=3`. Root `[A,B]` => `S-C'-...` with zero parents. Selection ending at HEAD => HEAD becomes `S`.

### Ref CAS and uncertainty
- Reuse `publish_checked_ref`: lock `HEAD` and captured full branch; re-read symbolic HEAD and old tip; only set that branch target and commit transaction. Snapshot locks do not span ODB computation; competing branch switch/tip writer => `StaleRef`, never overwrite its change.
- Before CAS, stale/validation/consent/identity/ODB/invariant failures cannot move refs. ODB writes preceding failed final CAS may leave harmless unreachable objects; no rollback, reset, backup branch, recovery journal, or automatic retry.
- Transaction commit failure remains `PublicationUncertain` with observed HEAD/branch. Do not infer success from an observation or overwrite later writers. Include known original OIDs and candidate target/tip in uncertainty diagnostics, while **omitting success-only `newTargetOid` / `newHeadOid`**; candidate is not a confirmed published result. No invented conflict/recovery state. UI refreshes/reconciles before further action.
- CAS fences branch/tip, not arbitrary external working-tree/config edits; promise engine leaves files/index alone, not cross-process serialization beyond Git's existing locks.
- Remote publication stays separate and unchanged: prepare a fresh existing lease **after** squash for the same project/worktree/root, preview, explicitly confirm publish. Old pre-squash snapshot must fail stale-local; local/upstream/URL/root/remote changes must not be overwritten. Unknown publish outcomes remain unknown; no blind retry.

## Related code files
Paths below discovered through `read`/`grep`/`glob`; two new paths explicitly marked creation.

| Action | File | Focus |
|---|---|---|
| Modify | `server/src/git/commit_message_rewrite.rs` | Shared preflight/closure/removal helpers; narrow raw overrides; sibling visibility; operation reflog label |
| Create | `server/src/git/squash_commits.rs` | Squash-specific range planning, identity, ODB replacement and result |
| Modify | `server/src/git/mod.rs` | Module registration + public operation export |
| Inspect/document semantics; normally unchanged | `server/src/git/types.rs` | Existing `GitActionResult` / `GitBlockReason` suffice; doc comments only if useful |
| Modify | `server/src/api/git.rs` | `SquashCommitsBody`, authenticated target/root-aware handler |
| Modify | `server/src/api/router.rs` | POST route in existing `protected` group (`require_auth`, currently lines 467-471) |
| Modify | `server/src/git/tests.rs` | Real repository `squash_commits_*` tests using existing fixtures/oracles |
| Create | `server/tests/git_squash_api.rs` | Real Axum route/JSON/auth/worktree/root integration; mirrors commit-message API fixture |
| Modify | `server/tests/git_leased_publish_api.rs` | Pushed squash -> fresh lease publication and no-overwrite regressions |
| Reuse/reference; change only if required | `server/src/git/{diff.rs,vcs_roots.rs,leased_push.rs}`, `server/src/api/error.rs` | Signature, ownership and publication conventions; no new engine/publication behavior |
| Reuse/reference | `server/tests/{git_commit_message_api.rs,auth_no_auth.rs,workspace_targets.rs,project_worktree_lifecycle.rs}` | Existing fixtures and ownership/auth test patterns |

## Implementation steps
1. **References before changes:** use Rust LSP find-references when available on changed existing exported symbols and helper callsites; include facade re-exports and tests. Startup `xd://lsp` status reports no language servers configured, so use precise repository reference searches as the fallback and migrate every caller. Do not expand public surface to avoid migration.
2. Extract shared preflight/closure/signature-analysis helpers and visibility in the existing rewrite module; preserve edit's no-op, merge support and metadata semantics. Add only narrow tree/committer serializer overrides and reflog-label parameter; migrate all callers. Keep guard inspection fail-closed.
3. Implement new squash operation in dependency order above. Raw bytes/ODB only; use borrowed ODB objects, one OID index, affected/removal map and replacement payloads. No repeated ancestor query per selection, no whole-message cloning per descendant, no graph/date sorting, no persistent state.
4. Add `SquashCommitsBody` with serde camelCase, default-false consent, ordered `hashes` and required expected snapshot. Handler resolves target/root with existing helpers and calls engine. Register additive POST route beside existing commit-history REST mutations; no WebSocket opcode/progress addition.
5. Add focused **behavioral tests**, independently observing Git topology/tree/messages/ref/index/files. Use current real temp-repo and in-process Axum patterns; do not use source-text tests or mocks that only assert argument forwarding.
6. Supply API/result/block examples to parent/frontend owners. Parent's later doc phase updates API reference/changelog/history architecture; do not change those files as this planner. Executor/main runs the checks below once after integrated implementation, records actual results and reports failures without automatic destructive retry.

### Focused Git and API test contract
- **Topology + metadata:** >=2 selected ending at HEAD; older range with >=2 descendants; root-inclusive range; full root-to-HEAD collapse; untouched merge predecessor allowed. Assert `rev-list --parents`/raw ODB trees, commit count drops by `n-1`, exact predecessor/root parent count, oldest author/date/timezone, configured current committer and current time bounds, descendant raw author/committer/unknown headers/messages retained. Assert count/target/head semantics with non-HEAD target distinct from tip. Final text retains Unicode/body/leading whitespace/trailing newlines; missing terminal LF appended once. Use `git cat-file commit` or raw bytes, **not** the existing trim-based `git_output` helper for message fidelity assertions.
- **Dirty/offline/pushed:** staged + unstaged + untracked changes, selected pushed commits, other branches/tags pointing to old history. Snapshot index file bytes/content and all file bytes, branch refs, original/remote OIDs before call; assert only active local branch changes. No network/upstream required for squash; no new CLI-created rebase state.
- **Request/range failures:** empty/single/duplicate/mixed-case duplicate/malformed/abbreviated OIDs, blank message, invalid expected branch/head syntax; reversed/noncontiguous/unreachable selection; selected merge; descendant merge/octopus; reachable side branch ending in merge. Assert correct HTTP-vs-typed-block behavior and no ref/index/file changes. Stale branch/head with syntactically valid nonexistent selected hashes must return stale first; same OID on changed branch also stale.
- **Safety regressions:** detached/unborn, active operation with recovery, branch also checked out in linked worktree, valid mutation inside selected linked worktree, replace/grafts/shallow/missing parent/malformed metadata, selected non-UTF-8 message/encoding. Missing identity returns actionable Git error and no ODB/ref/index/file mutation; isolate test Git configuration so host globals cannot satisfy identity accidentally.
- **Signature coverage:** raw signed fixtures using both signature keys on oldest, **absorbed interior/newest**, and strict descendants independently; refusal changes no refs/writes, consent emits no invalidated signatures and accurate flag. Valid unchanged-predecessor mergetag retained; selected-parent/descendant-parent mergetag removal requires consent; invalid target/type block. Signed merges still hit linear-history block before consent. Raw fixture policy follows existing `edit_commit_message_signatures_and_mergetag_consent` and `edit_commit_message_gpgsig_sha256_and_mergetag_retention`.
- **Final CAS:** real-repo helper tests capture, independently advance ref or switch HEAD, then attempt publication; deterministic `StaleRef`, unchanged competing ref. Do not depend on sleeps to hit the write window. Cover uncertainty result mapping with a real-repo transaction failure if reproducible; otherwise a narrowly test-only commit-failure seam at the transaction boundary, explicitly reported as fault injection, never production bypass. Verify `PublicationUncertain` is not success and does not claim candidate tips installed.
- **API consumer-visible:** `git_squash_api` sends real JSON through `build_router`; paired GETs -> POST -> Git oracle, root and non-HEAD response semantics, consent default false, stale request, missing-identity error, no implicit remote publication. Auth-enabled missing/invalid credentials => unauthorized **before** valid request changes anything; existing `auth_no_auth::test_normal_auth_protects_routes` supplies pattern. No-auth fixtures are not authentication proof.
- **Root/owner integration:** two configured projects; explicit registered worktree plus nested initialized root; only addressed child branch changes, configured parent/other root/worktree branch remains unchanged. GET snapshots use same worktree/root as POST. Unknown project, another project's/unregistered/deleted worktree, `root:"*"`, unknown/traversal/absolute/escaping-symlink root all reject with existing error semantics and no mutation. Follow `workspace_targets::{resolver_rejects_arbitrary_and_foreign_paths,resolver_rejects_a_registered_path_replaced_by_a_symlink}` and `vcs_root_resolution_rejects_aggregate_unknown_and_escaping_roots`; API must exercise integration, not only resolver unit tests. Server owns project/worktree authorization; profile identity remains client-owned, never a trusted body actor.
- **Leased-publish regression (existing bare-remote API target):** push original chain, squash locally, verify bare remote old tip; pre-squash lease => stale-local; fresh post-squash prepare captures exact new source/old remote, explicit publish updates only destination with unchanged tip tree. In a separate fixture advance remote after post-squash prepare; stale-remote must preserve independent remote tip and local rewritten history. Cover local advance, upstream/URL change, and different-root snapshot replay after preparation through existing checks; ordinary `/api/git/push` stays fast-forward-only, `force:true` remains rejected. Do not weaken negotiation or invent squash-specific publish path.

Existing regression targets to preserve: `git::tests::edit_commit_message*` (including root/non-HEAD, merge/octopus/side-parent, signatures, dirty/pushed, worktree, stale, malformed/missing/shallow tests), `git_commit_message_api`, `git_leased_publish_api`, `workspace_targets`, `auth_no_auth`. Existing leased test names include `test_api_leased_push_prepare_and_publish_flow`, `test_api_leased_push_stale_remote_rejected`, `test_api_leased_push_stale_local_rejected`, and `test_api_legacy_force_push_rejected`.

**Executor/main commands — not run during planning:**
```bash
cargo test --manifest-path server/Cargo.toml --lib git::tests::squash_commits
cargo test --manifest-path server/Cargo.toml --lib git::tests::edit_commit_message
cargo test --manifest-path server/Cargo.toml --test git_squash_api
cargo test --manifest-path server/Cargo.toml --test git_commit_message_api
cargo test --manifest-path server/Cargo.toml --test git_leased_publish_api
cargo test --manifest-path server/Cargo.toml --test workspace_targets
cargo test --manifest-path server/Cargo.toml --test auth_no_auth
```
Final integration owner also runs the repository's required Rust build/lint/format gates; do not launch competing checks mid-edit. Raw fault-injection checks supplement, never replace real Git/API qualification.

## Todo list
- [x] Reference inventory using available LSP or documented fallback; migrate every affected existing caller.
- [x] Shared safety/raw/CAS helpers and focused squash engine.
- [x] Additive protected, root-aware REST DTO/route.
- [x] Real Git/API/signature/ownership/lease regressions with independent oracles.
- [x] Hand off exact DTO/result semantics and observed validation evidence to parent.

## Success criteria
- Every supported HEAD/non-HEAD/root chain collapses to one correctly authored object and mapped descendants with invariant tip tree; correct target/head/count metadata.
- All invalid/stale/unsafe/signature-without-consent cases fail before ref move; missing identity before any writes; file/index/other refs/remotes unaffected by engine.
- Required selected/affected merges block, but pre-range merges and pushed/dirty state do not blanket-block.
- Existing message edit and leased publication behavior retained; exact lease prevents stale overwrite after squash. API authentication and root/worktree ownership enforced end-to-end.
- Executor supplies actual focused command outcomes; no claim that planning, mocks, or source inspection proves runtime correctness.

## Risk assessment
- **Wrong template author/tree or mapping count:** explicit oldest-template/newest-tree rule; count writes, not old->new map; topology/raw metadata tests.
- **Silent signature loss from absorbed commits:** precompute removals over full affected set before emitting one object; independent interior-only signed fixture.
- **Shared-helper regression:** LSP reference pass, minimally scoped visibility, keep edit merge/no-op policy separate, run existing suites.
- **Concurrent branch/HEAD writer:** final two-lock CAS; abandoned ODB objects acceptable. Uncertain transaction never reported as success or undone.
- **Root/config/publication confusion:** existing target/root resolver and lease identity; cross-root integration and destination/ref oracles. Never prepare publication on the wrong root or before squash.
- **Large ancestry:** current engine walks captured DAG; keep work in `spawn_blocking`, reuse borrowed bytes/indexing, no extra traversal/network query per hash. UI bounds selection to loaded page; do not introduce arbitrary server caps/new configuration in this phase.

## Security considerations
- Protected REST group/auth before mutation; no new permissions, WS route, actor fields, or broader worktree/path authorization.
- Never interpolate OIDs/messages into shell; ODB/libgit2 writes only. Existing read-only CLI guard calls receive structured args. Credentials stay in existing leased-push routes, not squash payloads/logs/results.
- Fail closed on malformed history, failed guard inspection, ref changes and invalid root identity; explicit signature-removal consent covers all affected history.
- No automatic remote force, rollback, reset, or retry after local/publication uncertainty. Preserve original objects and unrelated refs for ordinary Git recovery.

## Next steps
- Parent/frontend implementation consumes exact request/result contract; compose full-message draft from agreeing snapshots and offer separate same-scope lease flow.
- Continue remaining implementation/test/qualification/documentation phases; backend phase alone is not feature completion. Parent owns plan/progress/status/advice receipts and final execution evidence.

## Unresolved questions
None. Portable transaction-failure reproduction is an executor test-mechanism choice, not a product/API decision; document any injected uncertainty evidence honestly.
