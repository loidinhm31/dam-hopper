## Phase Implementation Report

### Executed Phase
- Phase: phase-01-backend-squash
- Plan: plans/261003-1213-git-squash-commits
- Status: implementation completed; runtime qualification reserved for integration owner.
- Ownership: server/ only, plus this expressly requested report. No plan/status/docs changes; no development-repository staging/commit/push. No historical evidence modified.

### Files Modified
Current file line counts, not diff sizes:
- `server/src/git/commit_message_rewrite.rs` — 1,205 lines. Shared stale-first mutation preflight, fail-closed ownership/history inspection, exact snapshot/message validation, affected closure/signature analysis, narrow tree/committer serializer overrides, operation-specific reflog, publication diagnostics/test-only failure boundary.
- `server/src/git/squash_commits.rs` — 236 lines, new. Exact linear-range validation, UTF-8/template checks, absorbed signature analysis, configured-current-committer synthesis, descendant mapping, topology/tree checks, locked CAS and typed results.
- `server/src/git/mod.rs` — 49 lines. New module/facade export.
- `server/src/git/types.rs` — 557 lines. Existing response fields documented; no DTO fields or blocker variants added.
- `server/src/git/tests.rs` — 3,806 lines. Real Git/ODB fixtures and backend regressions.
- `server/src/api/git.rs` — 994 lines. CamelCase request DTO and existing target/root-aware handler.
- `server/src/api/router.rs` — 875 lines. Additive POST in protected router.
- `server/tests/git_squash_api.rs` — 313 lines, new. Real Axum/auth/root/worktree request regressions.
- `server/tests/git_leased_publish_api.rs` — 496 lines. Pushed squash and leased bare-remote regressions.
- `plans/261003-1213-git-squash-commits/reports/backend-implementation.md` — this handoff.

### Tasks Completed
- [x] Read full overview, authoritative preflight, backend phase, repository guidance and relevant backend skill.
- [x] Exact-reference search fallback used because no language servers configured. Migrated all existing serializer and CAS helper callers; public message-edit facade unchanged.
- [x] Shared preflight/raw/closure/removal/CAS plumbing; message edit retains merge support and exact-message no-op branch.
- [x] Focused object-only squash covering root, HEAD and older ranges; dirty/pushed state is not a blocker.
- [x] Request-only validation before repository access; stale snapshot before selected-object lookup; signature/identity validation before ODB writes.
- [x] Authenticated project/worktree/root-aware POST endpoint using existing ownership/root resolution.
- [x] Added behavioral Git/API/bare-remote regression cases with independent topology/ref/tree/raw-byte/index/file oracles.
- [x] Sent settled request/result contract directly to SquashFrontendImpl.

### Settled DTO and Examples
`POST /api/git/{project}/squash`
```json
{"hashes":["<oldest full 40-hex OID>","<newest full 40-hex OID>"],"message":"final full message\n","expectedBranch":"refs/heads/main","expectedHeadOid":"<captured full tip OID>","allowSignatureRemoval":false,"worktreePath":"<registered live worktree, optional>","root":"modules/child"}
```
- Optional consent defaults false; worktree/root addressing keeps existing default semantics.
- Existing `GitActionResult` only: `hash`/`newTargetOid` synthesized squash; `oldTargetOid` newest selected; old/new head fields actual branch tips; `rewrittenCount = 1 + strict descendants`; `noOp = false`; signature flag includes absorbed selections.
- Malformed request => existing InvalidInput/HTTP 400 mapping. Runtime block => HTTP 200 `ok:false` with existing typed reason. Signature refusal gives `signature-consent-required` and explicit consent recommendation. Missing/invalid configured identity uses existing actionable Git error path.
- Publication uncertainty => `ok:false`, `blockedReason:publication-uncertain`, known original OIDs plus candidate/observed diagnostics; **no** `newTargetOid`/`newHeadOid`. No blind retry or success inference.
- Local squash never prepares or publishes remotely. Fresh same-scope lease remains separate explicit publication.

### Added Behavioral Cases
Git/ODB:
- HEAD and older ranges with two descendants; root-inclusive and full root-to-HEAD collapse; exact target/head/count/parent/tree semantics.
- Oldest author and raw timezone retained, configured current committer with execution-time bounds, Unicode/full whitespace/trailing newline preservation; absent LF appended once.
- Untouched merge predecessor accepted; non-UTF-8 strict descendant body, old committer/author/timezones, declared encoding and unknown headers retained as raw bytes.
- Dirty staged/unstaged/untracked files and index bytes unchanged; other branch/tag refs unchanged.
- Empty/single/duplicate/mixed-case duplicate/malformed/abbreviated hashes, blank message, invalid expected snapshot; reversed/gapped/unreachable selections; stale-before-nonexistent-target and same-tip/different-branch.
- Selected/descendant/side-history merge and octopus rejection before signature consent.
- Both signature keys independently on oldest, absorbed interior, absorbed newest and strict descendant; refusal has no ODB writes/ref movement; consent strips invalidated blocks while original objects retain signatures.
- Unchanged-predecessor mergetag retained; absorbed/remapped-parent mergetags require removal consent; non-parent/type-invalid mergetags and ambiguous mandatory headers rejected.
- Selected non-UTF-8 message/encoding rejection; detached/unborn/active-operation recovery; competing worktree ownership and successful selected linked-worktree mutation.
- Replace/grafts/shallow/missing-parent blocks, unreadable graft guard error; invalid local identity masks host-global identity and fails before ODB writes.
- Deterministic final CAS with independent tip advance and symbolic HEAD switch.
- Publication uncertainty: explicitly **fault injected** at the unit-test-only transaction commit boundary, after real ODB work and locks. Candidate diagnostics/no success OIDs verified; not claimed as a naturally reproduced filesystem transaction failure.
- Current-committer serializer timestamp and positive/negative/zero offset case.

API:
- Paired agreeing full-message GETs -> older/root POST -> raw Git oracle, response metadata, dirty/index/file invariance and stale replay.
- Two configured projects + selected registered worktree + nested initialized child root: only child branch changes; configured parent, linked parent branch, other project and sibling child unchanged.
- Foreign/unregistered/deleted targets, unknown project, aggregate/unknown/traversal/absolute/escaping roots and registered target replaced by symlink rejected without mutation.
- Auth-enabled missing/invalid bearer rejected before valid mutation.
- HTTP request validation, missing identity error, default-false consent for absorbed signed newest commit.

Bare remote/API:
- Pushed range squash leaves remote old tip; old pre-squash lease becomes stale-local; ordinary push remains non-fast-forward-rejected; fresh post-squash lease explicitly publishes exact new tip with unchanged tip tree.
- Independent remote writer after post-squash prepare => stale-remote, preserving both independent remote tip and local rewritten history.
- Post-squash lease fences later local advance, upstream change, URL change and replay against a different nested root.

### Tests Status
- Type/build check: **not run**, as instructed while writers active.
- Unit tests: **added, not run**; no coverage percentage claimed.
- API/integration tests: **added, not run**.
- Lint/format/smoke: **not run**. Integration owner owns all actual qualification.

### Recommended Commands (Unrun)
```bash
cargo test --manifest-path server/Cargo.toml --lib squash_commits
cargo test --manifest-path server/Cargo.toml --lib git::tests::edit_commit_message
cargo test --manifest-path server/Cargo.toml --test git_squash_api
cargo test --manifest-path server/Cargo.toml --test git_commit_message_api
cargo test --manifest-path server/Cargo.toml --test git_leased_publish_api
cargo test --manifest-path server/Cargo.toml --test workspace_targets
cargo test --manifest-path server/Cargo.toml --test project_worktree_lifecycle
cargo test --manifest-path server/Cargo.toml --test auth_no_auth
cargo check --manifest-path server/Cargo.toml
cargo clippy --manifest-path server/Cargo.toml --all-targets
cargo fmt --manifest-path server/Cargo.toml -- --check
```
Use the integration-owner's final formatting/build/lint policy once all writers settle; no successful command outcome is asserted here.

### Issues / Risks
- No ownership conflicts or contract deviations identified.
- Shared preflight now propagates worktree/ref/graft inspection failures and checks shallow state through fallible Git CLI inspection. Both edit and squash consume these guards; existing message-edit regressions are required qualification.
- ODB objects written before a failed final CAS may remain unreachable, intentionally. No rollback/index/worktree/ref cleanup writes.
- CAS fences symbolic HEAD and captured branch tip only; it cannot serialize unrelated external config/file writers.
- No runtime/compile/format success inferred from source edits. Parent must qualify integrated Rust/API/UI behavior and real smoke, then update docs/status and terminal review lifecycle.

### Next Steps
- Integration owner: run recommended checks and integrated feature smoke/review, update API/history/changelog docs and current plan statuses.
- Frontend contract is settled and compatible; no extra endpoint or response fields needed.

### Unresolved Questions
None.
