# Phase 04 Code Review — Release and Configuration Boundaries

## Score: 4/10 — CHANGES REQUIRED

## Summary
Scoped review complete; acceptance incomplete. F2 publisher wiring and F12 settlement invalidation improve the intended paths. F4 remains bypassable through multiple ordinary Git mutations. Current tests exercise narrow guards, not the promised effect boundary. Release hold must remain.

Read-only source review; no source or plan/task-state edits. Required code-review skill and published development rules read. Validation execution owned by Phase04Tester; results below are attributed, not independently rerun.

## Critical issues — MUST FIX

### C1 — F4: reachable worktree-changing sinks remain unguarded
- Evidence: `server/src/git/repository.rs:909-955,1060-1071`; `server/src/git/commit_file_ops.rs:291-340,427-467,506-530`; added protection in `repository.rs:1565-1576` only covers `ResetMode::Hard`.
- Failure/impact: pull's fast-forward path updates the ref then forcibly checks out HEAD without inspecting protected effects; CLI pull fallback also unguarded. Drop/revert and intermediate detached checkouts bypass the new cherry-pick guard. `reset --keep` can update clean tracked protected configuration without any guard. Ordinary authenticated users retain mutation paths to protected config; semantics OFF irrelevant.
- Correction: complete the promised sink/effect matrix, then guard every actual changed/deleted/replaced path before the first worktree/ref side effect; propagate protected refusals rather than falling through to a CLI fallback. Preserve unaffected workdir and index/ref-only operations.
- Confidence: high, direct source control-flow evidence; exploit scenarios not executed by reviewer.

### C2 — F4: added checkout/reset checks inspect the wrong effects and fail open
- Evidence: `server/src/git/repository.rs:1398-1419,1441-1453,1496-1507,1565-1576`.
- Failure/impact: `stash push --include-untracked` executes before protection, so a later refusal cannot preserve config. Force checkout and hard reset compare HEAD to target, omitting dirty/index/untracked collateral: resetting to HEAD produces an empty diff while discarding modified protected bytes. Creation/remote tracking checks use a not-yet-existing local branch; `unwrap_or_default()` turns inspection failure into permission to mutate. Root-only prefilter skips aliases/hardlinks when the canonical config is outside the repository. Non-NUL Git name output and `trim()` cannot safely represent quoted/whitespace filenames.
- Correction: resolve actual target OIDs; inspect tree transitions plus index/workdir/untracked effects under existing mutation coordination before stash or checkout. Guard aliases independent of root ancestry. Use raw/NUL-delimited paths; fail closed on inspection errors.
- Confidence: high. Example failure [INFERENCE]: tracked canonical config modified on disk, then `reset_to_commit(repo, HEAD, Hard)` restores it despite empty HEAD-to-HEAD diff.

### C3 — F4: literal caller-path checks do not protect expanded Git pathspec effects
- Evidence: `server/src/git/diff.rs:39-52,737-750`; `server/src/git/commit_file_ops.rs:25-32,91-108,232-252`.
- Failure/impact: validators allow wildcards. Guard checks literal `repo/*/config.toml`, while libgit2 checkout / `git diff -- <paths>` expands the pathspec and mutates matching `repo/dam-hopper/config.toml`. Selected patches may affect old/new rename paths beyond the supplied spelling. Core discard/cherry-pick bypass remains.
- Correction: enumerate affected paths/patch endpoints and guard each before applying, or enforce exact literal-file semantics consistently where the API promises files. Include wildcard/directory and rename regression cases, including unchanged controls.
- Confidence: high source evidence; wildcard exploit not executed by reviewer.

### C4 — F2: asset gate validates manifest claims, not the engine in the archive
- Evidence: `deploy/release/check-release-assets.mjs:227-386,1164-1230`; `tests/deploy/linux-release-semantic-engine.test.mjs:96-180,182-183,447-462`.
- Failure/impact: Linux check compares archive digest/size to its manifest but never matches tar members to inventory. The new passing fixture places **no engine in its archive**, fabricates engine inventory, and expects success. Tester reports that fixture passes. Essential entries except Node can also be directories; roles merely need to include `server` (so `web` projection remains possible); bundled provenance is not pinned by `transitivePayloadDigests`. Thus missing/tampered payload can pass the advertised gate.
- Correction: bounded archive-member inspection against manifest and pinned payload/metadata; require essential regular files, exact server-only roles and expected modes. Add positive real staged payload case plus physical archive deletion/type/bytes/role tampering. Keep synthetic fixtures explicitly packaging-only. Builder verification is valuable but does not establish the independent asset-gate contract.
- Confidence: high; passing fabricated-archive test reported by tester and source directly establishes omission.

### C5 — documentation/completion claims exceed implementation and evidence
- Evidence: `docs/architecture/semantic-websocket-gateway.md:581,584-586`; `docs/semantic-lsp-protocol-guide.md:529-530`; `docs/project-roadmap.md:9`; phase plan `:205-208` versus `:65-68,229`; `packages/ui/e2e/semantic-navigation/evidence.json:2-9`; `review.md:3-8`.
- Failure/impact: docs assert every reachable sink, revert/drop/squash protection and serialization; code above contradicts it. Integration task checked complete although capture remains dated 2026-10-24, predating remediation, and visual approval pending. Phase header still says pending/0% while overview says implemented/100%. No fresh compiled-tarball ON/navigation/OFF or container browser acceptance supplied. This is not an accepted end-to-end remediation.
- Correction: reconcile status to actual partial implementation/qualification, record omitted coverage and preserve hold; complete real gates and fresh capture before closing integration. Do not represent historical evidence or mocked browser transport as current backend qualification.
- Confidence: high. Plans intentionally left unchanged by reviewer under no-task-tracking assignment.

## Warnings — SHOULD FIX

### W1 — F4 helper now protects every descendant of the configuration directory
- `server/src/fs/secure_path.rs:1540-1554`: `path.starts_with(config_dir)` and symmetric canonical prefixes reject unrelated sibling files below that directory across existing raw FS sinks, not just protected objects or containing-directory removals.
- Impact: unnecessary regression for unrelated reads-independent writes/discards; contradicts effect-specific contract. Separate protected-object identity from destructive-container checks. Confidence high.

### W2 — F12 component regression supplies the refresh it claims to test
- `SettingsSemanticNavigationSection.lifecycle.test.tsx:129-132` explicitly calls `qc.refetchQueries`, so the original success-only invalidation implementation could still display the asserted mismatch. Owner-switch test covers successful settlement, not rejected OFF plus retirement. `semantic-failed-off.spec.ts:7-13,30-97` replaces all semantic GET/PATCH responses; useful UI transport test, not real failed-OFF supervisor evidence; browser runtime not executed.
- Correction: await automatic GET/UI update without manually refetching; assert one PATCH, captured-owner GET, no sibling writes, and error retention for failure with owner switch/retirement. Separately qualify real backend lifecycle. Confidence high.

### W3 — redundant refetch work after settlement
- `packages/ui/src/api/queries.ts:2405-2406`: `invalidateQueries` already refetches active queries; immediate default `refetchQueries` can cancel/restart the same GET and also refetch inactive queries.
- Correction: one exact-key `invalidateQueries({ queryKey: targetKey, exact: true, refetchType: 'active' })` (or one explicitly selected refetch policy), preserving mutation errors and `retry:false`. Confidence high API behavior; request duplication not measured here.

### W4 — current tuple policy leaks into historical migration validation
- `deploy/release/check-release-assets.mjs:348-355,374-384,1427,1689`: pinned-current digests/required essentials apply whenever any engine entry exists, even with `requireSemanticEngine=false`; migration/rollback source validators use this same function.
- Impact [INFERENCE]: valid historical tuples/partial historical inventories can become ineligible rollback/migration evidence, violating explicit no-historical-policy-expansion contract.
- Correction: scope current tuple rules to current publication; validate historical assets using their declared version/provenance policy. Add differing historical tuple control. Confidence high control flow, historical failure unexecuted.

## Suggestions — NICE TO HAVE
- After effect-boundary repairs, centralize the repeated protected-config refusal construction using existing domain error conventions; avoid introducing a policy framework.
- Remove unused exported `UpdateSemanticSettingsMutation` / redundant `mutationOwner` context member unless a consumer needs them; captured exact query key is sufficient for settlement.

## Positive observations
- Publisher stages pinned tools once and forwards the same explicit directory to both archives; no host runtime fallback added.
- Builder verifies supplied and copied engine; diagnostic engine omission explicit.
- Worktree refusal precedes semantic invalidation on covered active/stale route cases.
- F12 keeps `retry:false`, owner-qualified keys and mutation error visibility.
- Deployment runbook retains release hold, draft preservation, rollback target and honest native/resource qualification limits.

## Reviewed files
All 23 assigned files (relevant sections/diffs):
- `.github/workflows/release-linux.yml`
- `deploy/release/{build-release-archive.sh,check-release-assets.mjs}`
- `tests/deploy/{linux-release-package-twice.sh,linux-release-semantic-engine.test.mjs}`
- `server/src/api/git.rs`; `server/src/fs/secure_path.rs`
- `server/src/git/{diff.rs,conflict_resolve.rs,commit_file_ops.rs,repository.rs}`
- `server/tests/git_protected_config.rs`
- `plans/reports/baseline-b031e6a-f4-failing-before.md`
- `packages/ui/src/api/{queries.ts,queries.test.ts}`
- `packages/ui/src/components/organisms/SettingsSemanticNavigationSection.lifecycle.test.tsx`
- `packages/ui/e2e/semantic-navigation/semantic-failed-off.spec.ts`
- `docs/{deployment-guide.md,semantic-lsp-protocol-guide.md,project-roadmap.md}`
- `docs/architecture/semantic-websocket-gateway.md`
- `plans/261025-0731-pr74-review-remediation/{phase-04-release-and-config-boundaries.md,plan.md}`
Supporting evidence: README, PDR, standards, pinned staging/provenance, Git CLI fallback, capture evidence/review. Approximately 2,000 relevant implementation/test lines plus docs/plan evidence inspected; not a full-repository audit.

## Validation commands/results
Reviewer ran only read-only `git diff --stat && git status --short` and scoped `git diff` for change discovery, not verification. No independent compile/test/lint rerun.

Phase04Tester terminal report (`agent://Phase04Tester`) reports all six executed commands exit 0:
1. `node --test tests/deploy/linux-release-semantic-engine.test.mjs` — 10/10.
2. `bash tests/deploy/linux-release-clean-install.sh` — synthetic role-projection journey; server/web/both.
3. `cargo test --manifest-path server/Cargo.toml --test git_protected_config` — 3/3.
4. `pnpm --filter @dam-hopper/ui test src/api/queries.test.ts src/components/organisms/SettingsSemanticNavigationSection.test.tsx src/components/organisms/SettingsSemanticNavigationSection.lifecycle.test.tsx` — 21/21.
5. `pnpm --filter @dam-hopper/ui test:e2e:typecheck` — zero errors; not browser execution.
6. `cargo check --manifest-path server/Cargo.toml --all-targets` — zero diagnostics.

34 framework tests reported passing; no retries. No lint/coverage percentage supplied. Not exercised in this review: actual pinned retrieval, real-input package-twice/asset check, extracted-release authenticated ON/navigation/OFF, browser runtime/capture, broad Git effect/alias/pathspec matrix. Baseline report records two successful defect reproductions but does not retain the overlaid test source/hash needed to replay its exact assertions independently.

## Unresolved questions
- Where is the required comprehensive Git sink/effect matrix? No matching F4 artifact found in the scoped reports; current tests cover only three narrow scenarios.
- Real compiled-release/browser acceptance and fresh capture remain open evidence gates, not grounds for production approval.
