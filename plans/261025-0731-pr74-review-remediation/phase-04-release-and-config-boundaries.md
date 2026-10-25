# Phase 04 — Release and configuration boundaries

## Context links
- [Overview](./plan.md); [triage F2/F4/F12](../reports/review-261025-0731-pr74.md); [runtime review](../reports/code-reviewer-261025-0731-pr74-runtime.md); [auth/filesystem review](../reports/code-reviewer-261025-0731-pr74-auth-fs.md).
- [Independent plan review](../reports/code-review-261025-1825-pr74-remediation-plan.md); [backend execution](../reports/tester-261025-0731-pr74-backend.md); [frontend execution](../reports/tester-261025-0731-pr74-frontend.md); [system architecture](../../docs/system-architecture.md); [deployment](../../docs/deployment-guide.md).
- Original phases 03/06/10/11 overlap publisher, protected configuration and qualification; original plan and historical release evidence remain untouched.

## Overview
Date: 2026-10-25. Priority: P1. Status: pending, 0%. Owners: publisher, Git-boundary and settings implementers have independent writable slices; final integration coordinator serializes docs/evidence after all thirteen repairs.

## Key Insights
- F2: Archive builder engine inclusion is optional; normal publisher/package-twice does not opt in. Existing stage helper already supports verified `--retrieve-pinned`; use that path rather than developer-local inputs.
- Diagnostic omitted-engine archive contained placeholder shell binaries and minimal HTML. It proves packaging branching, not real build compatibility, installed enablement failure or a published-release defect measurement.
- F4: Raw filesystem guards protect canonical config/aliases/containing directories, but Git worktree remove/discard bypass them. F4 is reachable even with semantics OFF because Git operations are core server endpoints. Protect actual mutation effects, not merely routes or all repositories containing config.
- F12: OFF teardown precedes final auth/persist; error can mean configured enabled but runtime safe-disabled. `staleTime` does not trigger an immediate refetch.
- Qualification boundaries and runtime engine injection (R3): `application-services.ts:42-71,212-229` dynamically stages and copies the semantic engine into the running container before server boot when `semanticEngine: true` is configured. The fixture's exact consumed path is `artifacts/semantic-qualification/staged-engine`. On a clean runner, this path must be provisioned via `node deploy/release/semantic-engine/stage-semantic-engine.mjs --output-dir artifacts/semantic-qualification/staged-engine --retrieve-pinned` and verified via `--verify-only`. Block on actual staging/runtime verification failure, not image contents alone. Extracted release qualification remains separate (running extracted compiled tarball on loopback with staged engine).
- Capture-evidence ownership and publication (R3): `capture-evidence.ts:198-309` writes `evidence.json`, viewport PNGs, and `review.md` directly into `packages/ui/e2e/semantic-navigation/`. Only the serialized integration task owns this output directory and runs with `E2E_CAPTURE=1`. Earlier tasks run with default/disabled capture (`E2E_CAPTURE=0`) to prevent out-of-scope artifact writes. Output `review.md` is `PENDING_HUMAN_REVIEW` and requires explicit human sign-off (`ACCEPTED`); automated tests never substitute for human review.

## Requirements
- F2: Clean publisher provisions existing pinned Node 24.16.0/TS 5.9.3/TSLS 6.0.2, verifies it and passes one explicit staged directory through both archive builds; current server-capable Linux asset gate requires essential engine payload/metadata and server roles.
- F4: Every reachable Git effect that can overwrite/delete/move the canonical config, its alias, or a containing directory is refused before mutation and before semantic-target invalidation. Deterministic failing-before evidence required on verified baseline `b031e6a` via disposable worktree. Unrelated Git reads/index/ref-only and unaffected workdir mutations remain available to ordinary users.
- F4 operational containment: Semantics OFF does not contain F4. Hold release; avoid worktree removal or discard operations in worktrees hosting canonical config; rollback target is verified base `45a51efe43ef6024dbd875d2498b456a7d4db110`. Document operational containment in `docs/deployment-guide.md`.
- F12: Mutation settlement, including rejected OFF, refreshes the captured owner/generation's status while preserving action error. Dedicated E2E spec assigned to `packages/ui/e2e/semantic-navigation/semantic-failed-off.spec.ts`.
- Final evidence covers all thirteen findings, actual compiled release inputs, exact pinned tuple and real web journeys. Only the serialized integration task runs with `E2E_CAPTURE=1` and owns capture output files; executable check inspects `evidence.json` for fresh `run_id`, matching `git_head` and `source_fingerprint`, and passing outcomes. No native/Android/hard-cgroup qualification expansion or unrelated service/auth changes.

## Architecture
Publisher invokes existing `stage-semantic-engine.mjs` with explicit runner-workspace output and `--retrieve-pinned`; no dependency installation happens during this planning assignment. Future approved CI retrieval uses existing locked/ignore-scripts helper, verifies provenance, and gives `--semantic-engine-dir` to `package-twice`, which forwards exactly that directory twice. The builder must fail missing/invalid engine for the current server-capable Linux publishing path, rather than silently omit it. The asset gate requires node, TSLS CLI, TS tsserver/_tsserver/typescript payload and existing provenance/license/lock metadata with correct roles, modes and digests. Do not change Windows rules or silently impose a new policy on historical installer/rollback archives.

Git boundary reuses `is_protected_global_config_path` and current Git mutation coordination. First deliverable of the task is a comprehensive sink/effect matrix to identify all reachable paths (worktree remove, discard, checkout, conflict, stash, pull, cherry-pick) before code edits. Expand directory/pathspec effects safely and guard each changed/deleted/replaced path plus containing-directory removals; do not trust caller path strings or assume `safe_join` implies privilege protection. Tree-wide transitions compare affected old/new trees plus dirty/untracked collateral of force/stash behavior. If effects cannot be determined safely, reject that mutation with a clear protected-config reason, not all unrelated repo operations.

Validate within existing per-repo/workspace mutation boundary and immediately before commit/CLI dispatch; retain identity/parent checks in secure filesystem sinks. Worktree protection precedes `prepare_invalidate_target`. API-controlled changes are serialized through existing applicable locks; no claim of atomic immunity to a trusted local operator racing arbitrary external Git/rename processes. A sink lacking necessary effects or identity knowledge blocks its completion until corrected within declared files; do not certify route-only coverage. No new generic policy engine, blanket Admin Git RBAC or host-operator restrictions.

Deterministic failing-before and fixture methodology for F4:
- Verified baseline: `b031e6a40123d8c5169012e0b736ac8c4f1f6091` against merge-base `45a51efe43ef6024dbd875d2498b456a7d4db110`.
- Execution: use a disposable worktree at `b031e6a` with test overlay.
- Subprocess fixture: puts `XDG_CONFIG_HOME` in a registered linked worktree, auth DB and engine outside it.
- On baseline `b031e6a`: signed ordinary User force-removal of worktree or discard succeeds and mutates/removes canonical config. Record failing-before run artifact.
- Post-repair: run identical scenario passing with refusal before invalidation, config bytes and target admission preserved, and unrelated Git operations succeeding.

Settings hook keeps existing owner-qualified query keys and `retry: false`. Capture mutation owner/generation through variables/context so `onSettled` invalidates/refetches that exact key even when rendered selection changes mid-flight. Refetch active cached status on error; do not overwrite action error on refresh. Retired-owner results remain isolated. Dedicated E2E spec `packages/ui/e2e/semantic-navigation/semantic-failed-off.spec.ts` verifies this lifecycle without enabling capture.

## Related code files
Paths rooted at `/home/loidinh/WS/worktrees/dam-hopper-lsp-server-integration/`; future task ownership only.
- Modify `.github/workflows/release-linux.yml`, `deploy/release/build-release-archive.sh`, `deploy/release/check-release-assets.mjs`, `tests/deploy/linux-release-package-twice.sh`; create focused `tests/deploy/linux-release-semantic-engine.test.mjs`. Existing staging/provenance/manifest helpers are read-only inputs unless an owned change below is essential.
- Modify `server/src/api/git.rs`, `server/src/fs/secure_path.rs` and listed Git effect sinks; create isolated `server/tests/git_protected_config.rs`. Preserve unrelated Git semantics.
- Modify `packages/ui/src/api/queries.ts`, existing `queries.test.ts`, `SettingsSemanticNavigationSection.test.tsx`, and create `packages/ui/e2e/semantic-navigation/semantic-failed-off.spec.ts`.
- Future final docs and capture evidence updates: `docs/architecture/semantic-websocket-gateway.md`, `docs/semantic-lsp-protocol-guide.md`, `docs/deployment-guide.md`, `docs/project-roadmap.md`, `packages/ui/e2e/semantic-navigation/evidence.json`, `packages/ui/e2e/semantic-navigation/review.md`, and case screenshots.

## Implementation Steps
### ship-verified-release-engine — F2
1. Add clean-runner staging before package job; pass explicit runner-owned engine path through new package-twice option to both archive calls. Reuse existing verified retrieval; do not depend on developer HOME paths or add host runtime Node dependencies.
2. Enforce current publishing-path tuple presence and essential inventory, keeping server/both vs web-only role behavior and Windows checks unchanged. Negative fixtures delete node/CLI/TS/metadata or tamper digest/mode; asset/builder checks must fail, not just accept nonempty lib directories.
3. Add focused script/asset tests using disposable inputs; label placeholder tests packaging-only. With real compiled binaries/web and staged tuple, package twice and compare exact bytes/inventory; extract into disposable release root, verify tuple and perform authenticated admin ON + lazy navigation/OFF, no system service installation.
### guard-git-protected-config-effects — F4
4. Produce a sink/effect matrix as the first deliverable for all named Git paths (worktree remove, discard checkout, conflict write/delete, secondary checkout/stash/pull/cherry-pick). Add canonical object/alias/containing-directory rejection at final mutation boundaries before invalidation.
5. Establish deterministic failing-before evidence on baseline `b031e6a` worktree: signed ordinary User force-removal of config-containing worktree succeeds and deletes config. Record failing-before run artifact.
6. Verify identical scenario passing: refused with config bytes, target and semantic admission unchanged; unrelated worktree removal succeeds.
7. Track disposable config and attempt discard full/hunk, conflict write/delete and tree-wide effects that change it. Cover symlinked ancestor, hardlink alias, absent config creation, directory/pathspec expansion and changed identity under controlled API mutation. Unaffected-file, read, stage/unstage and ref-only positive controls still succeed. Keep all environment overrides fixture-local.
### refresh-failed-off-status — F12
8. Move success-only invalidation to captured-owner settlement and actively refetch current cached status without retrying mutation or swallowing its error.
9. Real QueryClient + component test: initial healthy GET → rejected OFF after backend safe-disable → fresh GET configured-on/runtime-off → visible mismatch and retained action error without focus/remount. Repeat with owner switch/retirement mid-flight; no sibling/replacement cache mutation.
10. Implement `packages/ui/e2e/semantic-navigation/semantic-failed-off.spec.ts` exercising full browser failed-OFF lifecycle and visible error presentation. Run without `E2E_CAPTURE=1` to keep capture writes exclusive to the integration coordinator.
### integrate-remediation-evidence — all findings
11. After every repair terminal, one coordinator updates relevant architecture/protocol/deployment/roadmap with actual final behavior, qualification limits, and operational containment guidance (release hold, draft export before reload, avoid config worktree operations).
12. Run scoped compile/tests once coherently. Provision and verify the fixture's exact path `artifacts/semantic-qualification/staged-engine` via `stage-semantic-engine.mjs --output-dir artifacts/semantic-qualification/staged-engine --retrieve-pinned` and `--verify-only` to ensure container runtime injection via `semanticEngine: true` succeeds. Block on actual staging/runtime verification failure.
13. Execute Playwright E2E journey with `E2E_CAPTURE=1` to publish fresh evidence: reload→edit→save, dirty undo/reconnect, cap re-entry, BOM/mixed-EOL selection, stage-two cancel, idle capacity and failed OFF.
14. Final capture-evidence outputs are written into `packages/ui/e2e/semantic-navigation/` (`evidence.json`, `review.md`, and viewport screenshots). Verify that `evidence.json` contains fresh `run_id`, matching `git_head` and `source_fingerprint`, and `functional_outcome: "passed"` / `cleanup_outcome: "passed"`. Note that `review.md` is `PENDING_HUMAN_REVIEW` and requires explicit human sign-off (`ACCEPTED`); it is never automated acceptance.
15. Execute extracted release qualification: extract compiled tarball into disposable directory, start on loopback with staged engine, execute authenticated admin ON, navigation query, and OFF.

## Todo list
```evcrate-tasks
[
  {
    "id": "ship-verified-release-engine",
    "title": "Include verified pinned engine in normal Linux publisher (F2)",
    "blocked_by": [
      "record-remediation-architecture"
    ],
    "allowed_files": [
      ".github/workflows/release-linux.yml",
      "deploy/release/build-release-archive.sh",
      "deploy/release/check-release-assets.mjs",
      "tests/deploy/linux-release-package-twice.sh",
      "tests/deploy/linux-release-semantic-engine.test.mjs"
    ],
    "constraints": [
      "Use existing retrieve-pinned helper with explicit runner-owned path; same verified tuple goes to both builds.",
      "No Windows/historical rollback policy expansion; placeholder fixtures prove packaging logic only, real binaries required for qualification."
    ],
    "acceptance": [
      "Clean publisher packages required node/TSLS/TS/provenance/license payload with correct server roles, digest and permissions; missing/tampered essentials fail.",
      "Both archives are byte-identical from the same staged inputs; extracted real release supports authenticated ON, lazy navigation and OFF without host Node."
    ],
    "verification": [
      "Run node --test tests/deploy/linux-release-semantic-engine.test.mjs and planned real-input package/asset commands below.",
      "Record staged tuple verification, archive digest/inventory and disposable installed-root enable/navigation/OFF; do not claim independent staging reproducibility."
    ]
  },
  {
    "id": "guard-git-protected-config-effects",
    "title": "Enforce canonical config protection across Git mutation effects (F4)",
    "blocked_by": [
      "record-remediation-architecture"
    ],
    "allowed_files": [
      "server/src/api/git.rs",
      "server/src/fs/secure_path.rs",
      "server/src/git/worktree.rs",
      "server/src/git/cli_fallback.rs",
      "server/src/git/diff.rs",
      "server/src/git/repository.rs",
      "server/src/git/conflict_resolve.rs",
      "server/src/git/operation.rs",
      "server/tests/git_protected_config.rs"
    ],
    "constraints": [
      "First deliverable is a comprehensive sink/effect matrix covering worktree, discard, checkout, conflict, stash, pull, and cherry-pick paths before code changes.",
      "Execute deterministic failing-before check on verified baseline b031e6a using a disposable worktree with test overlay; record evidence before applying fix.",
      "Reuse canonical guard and existing mutation coordination; protect affected paths/aliases/containing removals at sinks, not blanket repo or Git RBAC.",
      "No live config/auth/service changes; use subprocess-local fixture environment and document trusted external-operator race limitation.",
      "Enforce operational containment: semantics OFF does not disable F4; specify release hold, avoid config worktree operations, and rollback target 45a51ef."
    ],
    "acceptance": [
      "Baseline b031e6a demonstrates deterministic canonical config removal/mutation in disposable worktree before repair.",
      "Signed User cannot remove config-containing worktree or restore/write/delete canonical config through discard, conflict or affected tree-wide Git operations.",
      "Config bytes and target admission remain unchanged on refusal; symlink/hardlink/directory/pathspec effects are covered while unrelated workdir/index/ref/read controls succeed."
    ],
    "verification": [
      "Run failing-before test on baseline b031e6a worktree and record artifact; run identical passing test after fix.",
      "Run cargo test --manifest-path server/Cargo.toml --test git_protected_config and cargo test --manifest-path server/Cargo.toml --test semantic_settings.",
      "Record sink/effect matrix and isolated authenticated API refusals/positive controls; guard-source presence alone is not enforcement evidence."
    ]
  },
  {
    "id": "refresh-failed-off-status",
    "title": "Refresh captured-owner settings status on failed OFF (F12)",
    "blocked_by": [
      "record-remediation-architecture"
    ],
    "allowed_files": [
      "packages/ui/src/api/queries.ts",
      "packages/ui/src/api/queries.test.ts",
      "packages/ui/src/components/organisms/SettingsSemanticNavigationSection.tsx",
      "packages/ui/src/components/organisms/SettingsSemanticNavigationSection.test.tsx",
      "packages/ui/e2e/semantic-navigation/semantic-failed-off.spec.ts"
    ],
    "constraints": [
      "Refresh mutation's captured owner/generation on settlement including failure; keep retry:false and visible action error.",
      "Do not change backend OFF ordering, auto-reenable runtime or invalidate ambient replacement owner.",
      "Run tests with default capture disabled (E2E_CAPTURE=0) to ensure only the integration task writes capture artifacts."
    ],
    "acceptance": [
      "Failed OFF automatically refetches and displays configured-on/runtime-off mismatch without focus/remount, retaining action error.",
      "Owner switch/retirement cannot publish to sibling/replacement generation; success behavior remains correct.",
      "Dedicated E2E spec semantic-failed-off.spec.ts passes browser-level failed-OFF lifecycle without writing capture outputs."
    ],
    "verification": [
      "Run pnpm --filter @dam-hopper/ui test src/api/queries.test.ts src/components/organisms/SettingsSemanticNavigationSection.test.tsx using real QueryClient lifecycle coverage.",
      "Run pnpm --filter @dam-hopper/ui exec playwright test e2e/semantic-navigation/semantic-failed-off.spec.ts; verify no automatic mutation retry and no capture file generation."
    ]
  },
  {
    "id": "integrate-remediation-evidence",
    "title": "Reconcile architecture and gather all thirteen regression gates",
    "blocked_by": [
      "recover-semantic-socket-loss",
      "retain-logical-navigation-cancellation",
      "evict-initialized-empty-sessions",
      "bound-semantic-upgrade-auth",
      "ship-verified-release-engine",
      "guard-git-protected-config-effects",
      "refresh-failed-off-status"
    ],
    "allowed_files": [
      "docs/architecture/semantic-websocket-gateway.md",
      "docs/semantic-lsp-protocol-guide.md",
      "docs/deployment-guide.md",
      "docs/project-roadmap.md",
      "packages/ui/e2e/semantic-navigation/evidence.json",
      "packages/ui/e2e/semantic-navigation/review.md",
      "packages/ui/e2e/semantic-navigation/"
    ],
    "constraints": [
      "One final integration/doc owner, no original-plan edits or parallel full-suite storms.",
      "Task exclusively owns publication of capture artifacts in packages/ui/e2e/semantic-navigation/; do not modify test specs or application source code under this task.",
      "Retain unchanged decoder/store/model/save representation and serialization; F7 coordinate-proof prerequisite must pass, not be waived by normalized hashes.",
      "Record operational containment guidance in docs/deployment-guide.md.",
      "Capture-evidence outputs in packages/ui/e2e/semantic-navigation/ require separate human sign-off; review.md is PENDING_HUMAN_REVIEW and never automated acceptance.",
      "Ensure fixture exact path artifacts/semantic-qualification/staged-engine is staged via --retrieve-pinned and verified via --verify-only before E2E; block on actual staging failure."
    ],
    "acceptance": [
      "Every F1-F13 invariant has scoped regression evidence plus applicable real Linux-server/web acceptance; exact failures/retries/skips and cleanup retained.",
      "Playwright E2E run produces updated evidence.json containing fresh run_id, matching git_head and source_fingerprint, and functional_outcome: passed.",
      "Semantic-only projection has pinned-source/fixture line-UTF16/edit proof and unchanged store/model/save controls; semantic digest is not raw-byte freshness.",
      "Docs describe actual representation/recovery/config/release behavior, default OFF and unqualified native/hard-control scope; independent review and user approval remain explicit."
    ],
    "verification": [
      "Run final compile, scoped suites and actual-web commands below after all implementation terminals; reconcile finding-to-test results including F7 prerequisite proof and EOL/BOM save controls.",
      "Inspect packages/ui/e2e/semantic-navigation/evidence.json to verify fresh run_id, matching git_head, source_fingerprint, and functional_outcome passed.",
      "Obtain independent remediation review; preserve separate human visual sign-off and do not infer product approval from plan schema checks."
    ]
  }
]
```
- [ ] <!-- evcrate-task:ship-verified-release-engine --> Ship verified publisher engine.
- [ ] <!-- evcrate-task:guard-git-protected-config-effects --> Guard Git config effects.
- [ ] <!-- evcrate-task:refresh-failed-off-status --> Refresh failed OFF status.
- [ ] <!-- evcrate-task:integrate-remediation-evidence --> Integrate evidence and documentation.

## Success Criteria
Planned only, from repository root; future tester supplies RELEASE_TAG and absolute disposable BIN_DIR, WEB_DIST, ENGINE_DIR, OUT_DIR, with real compiled inputs. No installs/probes run by this author.
- `node --test tests/deploy/linux-release-semantic-engine.test.mjs`
- `node deploy/release/semantic-engine/stage-semantic-engine.mjs --output-dir "$ENGINE_DIR" --retrieve-pinned` then `node deploy/release/semantic-engine/stage-semantic-engine.mjs --verify-only "$ENGINE_DIR"` in approved isolated CI/future qualification only.
- `pnpm release:package-twice --version "$RELEASE_TAG" --target-dir "$BIN_DIR" --web-dist "$WEB_DIST" --semantic-engine-dir "$ENGINE_DIR" --output-dir "$OUT_DIR"` then `pnpm release:check-assets --profile linux --tag "$RELEASE_TAG" --dir "$OUT_DIR"` (new option implemented by release task).
- Scoped Git/settings commands in fence; Phase 01 UI and Phase 02/03 Rust commands run once after all edits. Integration compile: `cargo check --manifest-path server/Cargo.toml --all-targets`; `pnpm --filter @dam-hopper/ui build`; `pnpm --filter @dam-hopper/ui test:e2e:typecheck`.
- Staged engine prerequisite for container E2E: `node deploy/release/semantic-engine/stage-semantic-engine.mjs --output-dir artifacts/semantic-qualification/staged-engine --retrieve-pinned` and `node deploy/release/semantic-engine/stage-semantic-engine.mjs --verify-only artifacts/semantic-qualification/staged-engine`.
- Actual-web: `E2E_CAPTURE=1 pnpm --filter @dam-hopper/ui exec playwright test e2e/semantic-navigation/semantic-navigation.spec.ts e2e/semantic-navigation/semantic-failed-off.spec.ts --project=chromium`. Confirm `evidence.json` contains fresh `run_id`, matching `git_head` and `source_fingerprint`, and `functional_outcome: "passed"`.
- Extracted release qualification: extract compiled tarball into disposable directory, start on loopback with staged engine, execute authenticated admin ON, navigation query, and OFF.

## Risk Assessment
Git CLI effects can be broader than changed tracked paths; first deliverable sink/effect matrix prevents omitted paths. Semantics OFF does NOT contain F4 or F1; operational containment requires release hold, draft preservation/export before reload/downgrade (no force-save), and rollback to verified unaffected base `45a51efe43ef6024dbd875d2498b456a7d4db110`. Publisher network retrieval fails the job on verification failure; never fall back to host Node or engine-less success. OFF failure is safe-disable, not rollback; refresh must not hide original failure.

## Security Considerations
Keep semantic default-OFF/fresh-admin settings control; ordinary users retain unrelated Git access. Staging network access is build-time only under existing pinned provenance; do not execute workspace plugins/install scripts. Only the disposable config under test is deliberately inside the destructive target; harness credentials, auth DB, engine and unrelated configuration stay outside it. Clean up all fixture material. Final reports must not contain tokens, private code buffers or credentials.

## Next steps
Parent owns final review synthesis, risk-gated plan review and optional prompt-mode interview/user approval. Only an explicitly approved implementation run may execute these tasks; no active-plan setter or task hydration in this review assignment.

## Unresolved questions
No unresolved product decision required for this proposal. Actual compiled-release qualification, complete Git effect enforcement evidence, full-app failed-OFF evidence, independent remediation review and implementation approval remain pending gates, not authoring blockers.
