# PR #74 — CI failure diagnosis

## Executive summary

[PR #74](https://github.com/loidinhm31/dam-hopper/pull/74) is blocked by **four failed leaf jobs plus the consequential Quality Gate** in [PR Quality Gate run 40110073949, attempt 1](https://github.com/loidinhm31/dam-hopper/actions/runs/40110073949). Findings concern test portability and missing CI fixture provisioning, not an observed production LSP navigation failure.

Three underlying repair areas:

1. **P1 — Provision/discover the immutable semantic tuple in CI.** Linux Rust tests and application E2E both depend on developer-machine paths for hash-verified Node 24.16.0 / TypeScript 5.9.3 / typescript-language-server 6.0.2. Neither job provisions the required host fixture. E2E's floating Node 24 setup installed 24.21.0, but changing that version alone cannot repair fixed-path discovery.
2. **P1 — Compile-time gate a Unix-only Rust test.** Three unconditional Unix symlink calls prevent Windows test compilation.
3. **P1 — Update the browser regression's query-module mock.** The worktree browser suite omits the new `useSemanticSettings` export required by the real lazily loaded editor. Two tests fail with a module-linking error; the first also times out after a React render failure.

**Scope:** investigation/report only. No production, test, or workflow files changed. No local build/test/lint reruns or remote workflow reruns performed. Proposed repairs remain unvalidated.

## Evidence and revision scope

- PR head and local `HEAD`: `21a623cb4a9d18707ac8f10165ac13e42d4b5ab4`.
- CI actually checked out synthetic merge `9b79f55879c373b3947881d87695efe24cf4b877`: PR head merged into base `45a51efe43ef6024dbd875d2498b456a7d4db110`.
- GitHub compare API for PR head → tested merge returned `{"ahead_by":1,"behind_by":0,"files":[],"status":"ahead","total_commits":1}`. The synthetic merge adds a commit but no file changes; the inspected workflow/source files are identical between analyzed PR head and tested merge. Query: `gh api repos/loidinhm31/dam-hopper/compare/21a623cb4a9d18707ac8f10165ac13e42d4b5ab4...9b79f55879c373b3947881d87695efe24cf4b877`.
- Workflow: `.github/workflows/pr-quality-gate.yml`; event `pull_request`; branch `feat/lsp-server-integration-reassess`; created `2026-10-24T16:07:11Z`; completed failure. All timeline timestamps below UTC.
- `gh run list --repo loidinhm31/dam-hopper --branch feat/lsp-server-integration-reassess --limit 30 ...` returned this one run. `gh pr checks` attached all 14 current checks to it; no second failing workflow was listed for the PR.
- Source references below are local PR-head line numbers; compiler diagnostics match the same locations. Immutable [PR-head source tree](https://github.com/loidinhm31/dam-hopper/tree/21a623cb4a9d18707ac8f10165ac13e42d4b5ab4).

Commands exercised:

```sh
gh pr view 74 --repo loidinhm31/dam-hopper
gh pr checks 74 --repo loidinhm31/dam-hopper
gh run list --repo loidinhm31/dam-hopper --limit 30 --json databaseId,workflowName,event,headBranch,headSha,status,conclusion,createdAt,url
gh run list --repo loidinhm31/dam-hopper --branch feat/lsp-server-integration-reassess --limit 30 --json databaseId,workflowName,headSha,event,status,conclusion,createdAt,url
gh run view 40110073949 --repo loidinhm31/dam-hopper --json jobs,headSha,headBranch,event,createdAt,updatedAt,attempt,url
gh run view 40110073949 --repo loidinhm31/dam-hopper --log-failed
git rev-parse HEAD
```

`gh pr checks` exited 1 because checks failed; this was not an authentication/API failure. `--log-failed` returned full logs for failed jobs, labelled `UNKNOWN STEP`; structured job metadata supplies exact failed-step names below.

## Failed jobs and steps

| Job / source | Job ID | Exact failed step | Failure | Job duration |
| --- | --- | --- | --- | --- |
| [Rust server - Windows](https://github.com/loidinhm31/dam-hopper/actions/runs/40110073949/job/120919752940) | `120919752940` | #5 `Compile all server tests` | Rust `E0433`, 3 Unix API references; step exit 1 | 6m21s |
| [Chromium browser regressions](https://github.com/loidinhm31/dam-hopper/actions/runs/40110073949/job/120919753099) | `120919753099` | #7 `Run all UI browser tests` | 3 failed tests, 1 unhandled module error; exit 1 | 2m19s |
| [Rust server - Linux](https://github.com/loidinhm31/dam-hopper/actions/runs/40110073949/job/120919753107) | `120919753107` | #8 `Server tests` | 3 fixture-construction panics; exit 101 | 10m16s |
| [Application E2E journeys](https://github.com/loidinhm31/dam-hopper/actions/runs/40110073949/job/120919753182) | `120919753182` | #10 `Run application E2E tests` | 1 semantic qualification setup failure; exit 1 | 18m25s |
| [Quality Gate](https://github.com/loidinhm31/dam-hopper/actions/runs/40110073949/job/120924024500) | `120924024500` | #2 `Require every quality job` | Dependency aggregation rejects failure; exit 1 | 7s |

Other **9 checks passed**: lint/typecheck/frontend builds; JS tests for shared, browser-bridge, UI, native; native client Linux; native Windows SSH gate; Linux and Windows release contracts. Do not treat warnings in these jobs as failed checks.

## 1. Windows: Unix-only test compiled on every platform

### Observed failure

Command from `.github/workflows/pr-quality-gate.yml:195-196`:

```sh
cargo test --manifest-path server/Cargo.toml --no-run
```

Compiler output at `16:12:05–16:12:06`:

```text
error[E0433]: cannot find `unix` in `os`
 --> src\semantic\uri.rs:1072:18
1072 | std::os::unix::fs::symlink(&outside_file, &live_link).unwrap();

error[E0433]: cannot find `unix` in `os`
 --> src\semantic\uri.rs:1081:18
1081 | std::os::unix::fs::symlink(outside.path().join("nonexistent.ts"), &dangling_link).unwrap();

error[E0433]: cannot find `unix` in `os`
 --> src\semantic\uri.rs:1091:18
1091 | std::os::unix::fs::symlink(outside.path(), &dir_link).unwrap();

error: could not compile `dam-hopper-server` (lib test) due to 3 previous errors; 25 warnings emitted
```

### Exact mechanism

[server/src/semantic/uri.rs](https://github.com/loidinhm31/dam-hopper/blob/21a623cb4a9d18707ac8f10165ac13e42d4b5ab4/server/src/semantic/uri.rs#L1062-L1098):

- `:854-855`: test module has only `#[cfg(test)]`, not a Unix target restriction.
- `:1062-1063`: `test_reject_dangling_and_outside_symlinks` has only `#[test]`.
- `:1072,1081,1091`: file/dangling-file/directory symlink setup directly references `std::os::unix`.
- Windows excludes `std::os::unix` at compile time. `--no-run` still compiles unit tests, so the test fails before execution, independent of whether semantic navigation is enabled.

Later Windows-safe regressions and `cargo check --all-targets` did not execute after this step failed. Passing native-Windows tests concern a different Cargo package and do not qualify server test compilation.

### Recommendation

Add `#[cfg(unix)]` to this Unix-specific test, preserving Linux coverage for all three escape cases and keeping platform-independent URI tests enabled on Windows. This matches the feature's Linux qualification boundary without disabling the server Windows job. If Windows symlink behavior is intentionally brought into scope instead, use separate compile-time Windows helpers (`symlink_file` / `symlink_dir`) and account for runner symlink privileges. A runtime `cfg!(unix)` condition or `#[ignore]` does **not** prevent compilation of invalid platform APIs.

## 2. Linux Rust: packaged fixture unavailable on clean runner

### Observed failure

Command from `.github/workflows/pr-quality-gate.yml:182-183`:

```sh
cargo test --manifest-path server/Cargo.toml
```

`tests/semantic_resource_qualification.rs` ran 5 tests. At `16:17:27`, these failed:

| Test | Fixture call |
| --- | --- |
| `test_portable_only_degradation_and_application_admission_caps_with_packaged_tuple` | `server/tests/semantic_resource_qualification.rs:851` |
| `test_portable_sampled_tree_limit_enforcement_and_zero_orphan_reap` | `server/tests/semantic_resource_qualification.rs:962` |
| `test_deterministic_fixture_manifest_and_small_corpus_navigation_with_core_responsiveness` | `server/tests/semantic_resource_qualification.rs:1078` |

All panic at `server/tests/common/semantic_fixtures.rs:217:25`:

```text
PackagedToolchain requires verified offline Node 24.16.0 + TS 5.9.3 + TSLS 6.0.2 tuple:
"Pinned Node.js v24.16.0 matching SHA-256 b2959781cc5a74c357ffa02367efa8a0330cbb1c9cb347732fdfaaaca381cbcd not found in [\"/home/loidinh/.nvm/versions/node/v24.16.0/bin/node\", \"/opt/dam-hopper/lib/semantic-engine/node\"]"

test result: FAILED. 1 passed; 3 failed; 1 ignored; 0 measured; 0 filtered out; finished in 0.09s
```

Passing test: `test_hard_cgroup_detection_and_honest_capability_reporting`. Ignored test: `live_semantic_navigation_qualification`.

### Exact mechanism

[server/tests/common/semantic_fixtures.rs](https://github.com/loidinhm31/dam-hopper/blob/21a623cb4a9d18707ac8f10165ac13e42d4b5ab4/server/tests/common/semantic_fixtures.rs#L15-L40):

- `:15-18,26-40`: `resolve_pinned_node_bin()` searches exactly two fixed locations and verifies the binary SHA-256. No `PATH`, runner toolcache, environment override, or repository artifact location is searched.
- `:154-155`: `PackagedToolchain::try_new()` invokes that resolver first.
- `:216-217`: `new()` converts its error into the observed panic via `expect`.
- `.github/workflows/pr-quality-gate.yml:147-183`: Linux job installs Rust and starts MongoDB, but has no Node/pnpm setup, pinned semantic staging, or fixture-path configuration. Existing fixtures on the author's machine are not available to hosted CI.

The tests fail before launching the real tuple or exercising resource/navigation assertions. **Not evidence of cgroup, OOM, responsiveness, or LSP protocol failure.** Production Clippy and the changed-file formatting step passed according to job metadata; warnings are not this job's cause.

### Additional prerequisite exposed by source, not reached in logs

`semantic_fixtures.rs:20-23,156-174` also limits TS/TSLS lookup to `/tmp/dam-hopper-spike-tuple/node_modules` or `/opt/dam-hopper/lib/semantic-engine/tsls/node_modules`. Once Node discovery is repaired, these modules must also exist and match pinned hashes; otherwise the next error would be `Pinned TS 5.9.3 + TSLS 6.0.2 node_modules not found`. This is a **source-derived potential next blocker**, not an observed second panic.

### Recommendation

Provision the **whole verified tuple**, not merely a Node major version. Preferred repair:

1. Add Node and pnpm setup to the Linux job for build-time staging.
2. Use the existing stager's `--retrieve-pinned` capability to create a runner-owned fixture directory.
3. Add one explicit test-fixture location input to `semantic_fixtures.rs` (for example, proposed `DAM_HOPPER_TEST_SEMANTIC_ENGINE_DIR`), resolving both `node` and `tsls/node_modules` from that directory. Retain all digest/integrity checks. Wire that input in CI; remove author-specific path dependence.
4. Stage once before `cargo test`, never download independently in concurrently running Rust tests.

A minimal current-code alternative is to stage the tuple into the already recognized `/opt/dam-hopper/lib/semantic-engine` before tests, with appropriate directory ownership. Prefer the runner-owned explicit-path design for portability. Installing Node 24.16.0 on `PATH` alone will not satisfy the current resolver.

Cargo stopped at this integration-test binary. Later test binaries remain unqualified by this run; do not claim a complete Rust-suite pass after addressing only the three visible failures.

## 3. Application E2E: host staging is offline-only without provisioned payload

### Observed failure

Failed test:

```text
[chromium] › e2e/semantic-navigation/semantic-navigation.spec.ts:146:3
Phase 10: Linux Server + Actual Web Semantic Qualification
› Qualify Linux Server + Actual Web Application Semantic Navigation
```

At `16:25:36`:

```text
Error: Command failed: node /home/runner/work/dam-hopper/dam-hopper/deploy/release/semantic-engine/stage-semantic-engine.mjs --output-dir /home/runner/work/dam-hopper/dam-hopper/artifacts/semantic-qualification/staged-engine

Error: Could not locate pinned Node.js v24.16.0 matching SHA-256 b2959781cc5a74c357ffa02367efa8a0330cbb1c9cb347732fdfaaaca381cbcd
    at locateVerifiedNodeBinary (.../stage-semantic-engine.mjs:65:9)
    at stageSemanticEngine (.../stage-semantic-engine.mjs:131:22)

Node.js v24.21.0
1 failed
11 passed (2.6m)
```

Setup-node logs independently show `/opt/hostedtoolcache/node/24.21.0/x64` and `node: v24.21.0`. E2E typecheck and Docker image build passed; the image build took approximately 14m32s (`16:08:27–16:23:00`). The failure occurs in subsequent host-side fixture setup, not Docker build or application assertions.

### Exact mechanism

- `packages/ui/e2e/semantic-navigation/semantic-navigation.spec.ts:15-25`: opts into `semanticEngine: true`.
- `packages/ui/e2e/fixtures/application-services.ts:212-223`: requires a staged **host** payload before copying it into `/opt/dam-hopper/lib/semantic-engine` inside the test container.
- `application-services.ts:42-71`: verifies an existing `artifacts/semantic-qualification/staged-engine` cache, otherwise invokes the stager with only `--output-dir`.
- [deploy/release/semantic-engine/stage-semantic-engine.mjs:20-28,55-68](https://github.com/loidinhm31/dam-hopper/blob/21a623cb4a9d18707ac8f10165ac13e42d4b5ab4/deploy/release/semantic-engine/stage-semantic-engine.mjs#L20-L68): searches the same developer/install locations as the Rust fixture unless explicit inputs are supplied. It does not search `process.execPath` or `PATH`.
- Stager `:122-155`: `retrievePinned` defaults false; lookup errors are rethrown unless retrieval is enabled. The CLI already implements `--retrieve-pinned`, `--node-bin`, and `--node-modules-dir` at `:189-191`, but the fixture passes none.
- `.github/workflows/pr-quality-gate.yml:119-137`: installs floating `node-version: "24"`, then dependencies/images/E2E, with no semantic payload staging step.
- `deploy/release/semantic-engine/provenance.json:4-12,14-25`: intentionally pins the Linux x64 tuple and Node hash. Node 24.21.0 is the host script runtime, not a verified substitute for the required bundled binary.

**Root cause shared with Linux Rust:** the CI contract never provisions the immutable fixture its tests require. E2E additionally already has a retrieval implementation that its offline-only fixture invocation does not enable. Merely pinning setup-node to 24.16.0 leaves fixed-path discovery and pinned TS/TSLS modules unresolved.

### Recommendation

Pre-stage and verify the payload in the E2E job **before the expensive image build**, using the existing cache path the fixture recognizes:

```sh
node deploy/release/semantic-engine/stage-semantic-engine.mjs \
  --output-dir artifacts/semantic-qualification/staged-engine \
  --retrieve-pinned
node deploy/release/semantic-engine/stage-semantic-engine.mjs \
  --verify-only artifacts/semantic-qualification/staged-engine
```

The stager already retrieves Node from provenance, installs the dedicated frozen-lockfile TS/TSLS dependencies with scripts disabled, and checks hashes; reuse it rather than weakening provenance or changing digests to match a runner's latest Node. Build-time network retrieval should be explicit in CI; keep actual runtime qualification offline. If a semantic cache is added, key it by platform and provenance/lockfile content and verify restored content before reuse.

No application navigation checkpoint is qualified by the failing semantic test: setup fails before its body. [Uploaded failure report artifact](https://github.com/loidinhm31/dam-hopper/actions/runs/40110073949/artifacts/12566578375) is available from this run; the log excerpt already identifies the exact setup exception.

## 4. Chromium: stale full-module query mock breaks the real editor import

### Observed failures

Command: `pnpm --filter @dam-hopper/ui test:browser` (`pr-quality-gate.yml:104-105`). Suite: `browser-tests/project-worktree-target.browser.tsx`, `WorkspacePage project worktree target routing in Chromium`.

| Test | Observed error |
| --- | --- |
| `switches the real workspace page surfaces and terminal launch to one target` | `TimeoutError: locator.click: Timeout 14897ms exceeded.` at `:782:20`; waits for `getByRole('button', { name: /^▶ Worktrees$/ })` |
| `persists selected worktree across full page reload and reconciles after discovery` | `SyntaxError: The requested module '/src/api/queries.ts' does not provide an export named 'useSemanticSettings'` |
| `reconciles and demotes a deleted worktree to root when discovery confirms target unavailability upon reload` | Same missing-export `SyntaxError` |

Vitest also reports the same missing-export exception as **1 unhandled error**, originating while the first test ran. Summary: **1 file failed / 58 passed / 3 skipped; 3 tests failed / 332 passed / 5 skipped (340 total)**.

Timeline: first test logs a React component error at `16:08:25.431`; its locator times out near `16:08:40`; following tests fail in 12ms and 8ms. This is not evidence that navigation needs a larger timeout.

### Exact mechanism

- [packages/ui/browser-tests/project-worktree-target.browser.tsx:178-301](https://github.com/loidinhm31/dam-hopper/blob/21a623cb4a9d18707ac8f10165ac13e42d4b5ab4/packages/ui/browser-tests/project-worktree-target.browser.tsx#L178-L301): `vi.mock("@/api/queries.js", () => ({ ... }))` replaces the complete module. Its explicit export list omits `useSemanticSettings`.
- `packages/ui/src/api/queries.ts:2357-2367`: the real source **does export** `useSemanticSettings`; this is not a missing production export or TypeScript compiler error.
- `packages/ui/src/components/pages/WorkspacePage.tsx:200-204`: lazily imports the real `EditorTabs` module, which this test does not mock.
- `packages/ui/src/components/organisms/EditorTabs.tsx:46-51,154-157`: statically imports and calls the new hook. Native browser ESM linking rejects the mocked module's missing named export before the editor can render.
- Test `:759-767` mounts the real workspace; `WorkspacePage.tsx:2111-2124` places `workspace-project-info-panel` on a wrapper **outside** the lazy ProjectInfoPanel's Suspense boundary. Wrapper visibility at test `:779-781` does not prove the Worktrees button finished rendering.
- `packages/ui/src/components/atoms/CollapsibleSection.tsx:46-62` still renders the closed `▶` and `Worktrees` title; no source evidence of a renamed selector target.

**Confirmed:** stale mock causes the missing-export failures and unhandled error. **[INFERENCE]:** its asynchronous lazy-import rejection/React render failure explains the first test's missing-button timeout. Log timing and import chain strongly support this; no browser trace was replayed, so a separate timeout cause cannot be categorically excluded before repair.

### Recommendation

Add a semantic-settings export to the existing query mock, keeping unrelated semantic navigation disabled for this worktree-routing test. Reuse the repository's existing pattern in `packages/ui/src/components/organisms/EditorTabs.test.tsx:51-59`:

```ts
useSemanticSettings: () => ({
  data: undefined,
  isLoading: false,
  isError: false,
}),
```

This is legitimate fixture maintenance: preserve real worktree-routing assertions while supplying the new dependency. Do not add the export to production code again, mock away the entire workspace, suppress unhandled errors, or increase click timeouts as the primary fix. Recheck the original three tests after repairing the module contract; investigate remaining timeout separately only if it persists.

### Other browser diagnostics, not the reported failed tests

Logs also contain `Error: No QueryClient set, use QueryClientProvider to set one` from `<WorkspaceSwitcher>` in `server-settings-mfa-mobile.browser.tsx` and `login-devices.browser.tsx`, plus repeated React `act(...)` warnings. These are real logged diagnostics, but the final failed-test inventory names only the worktree suite; do not count them as additional failing checks or assert they are harmless. No separate repair for those passing-suite diagnostics was implemented or validated here.

## 5. Aggregate Quality Gate: expected propagation

At `16:25:44`:

```text
BROWSER_TESTS: failure
APPLICATION_E2E: failure
SERVER_LINUX: failure
SERVER_WINDOWS: failure
A required quality job finished with: failure
Process completed with exit code 1.
```

`.github/workflows/pr-quality-gate.yml:335-348` runs the gate with `if: always()` and requires all leaf jobs. `:363-377` exits on the first non-success result; browser failure is first in its iteration order after successful static/JS checks. **No independent gate defect.** Repair the four failed leaf jobs; retain the gate unchanged.

## Repair order and recommended validation — NOT EXECUTED

1. Compile-time Unix-test gating and browser mock repair are independent, small source changes.
2. Provision one complete verified semantic tuple per Linux job. Wire explicit Rust fixture discovery and pre-stage E2E's existing cache path. Preserve pins and assertions.
3. Validate focused checks, then full affected suites and a fresh PR workflow. Current failures can conceal subsequent failures; these commands are recommendations, not passing evidence.

```sh
# Windows runner
cargo test --manifest-path server/Cargo.toml --no-run
cargo check --manifest-path server/Cargo.toml --all-targets
# Also allow the workflow's existing Windows-safe regressions to run.

# Linux runner, after complete tuple provisioning/discovery
cargo test --manifest-path server/Cargo.toml --lib test_reject_dangling_and_outside_symlinks
cargo test --manifest-path server/Cargo.toml --test semantic_resource_qualification
cargo test --manifest-path server/Cargo.toml

# Browser dependency repair: original assertions, no timeout inflation
pnpm --filter @dam-hopper/ui test:browser browser-tests/project-worktree-target.browser.tsx
pnpm --filter @dam-hopper/ui test:browser

# E2E runner, after verified pre-staging and normal browser/image prerequisites
pnpm --filter @dam-hopper/ui test:e2e semantic-navigation/semantic-navigation.spec.ts
pnpm --filter @dam-hopper/ui test:e2e
```

Expected acceptance: Windows test compilation succeeds; all three worktree browser tests pass without an unhandled module error; the three Linux qualification tests construct and verify the real tuple and execute their assertions; semantic E2E reaches its real application checkpoints; full PR quality workflow succeeds. Do not replace these checks with skips, ignored tests, relaxed hashes, or a green aggregate-only result.

## Unresolved questions / evidence limits

- Whether any downstream Rust test binaries or semantic E2E assertions fail after provisioning is unknown: the current run stops before qualifying those surfaces.
- First browser timeout's precise DOM teardown is inferred, not trace-proven. Fix the confirmed missing export first; retain the timeout as unresolved only if the original test still fails.
- QueryClient diagnostics in passing browser suites merit separate fixture review if those suites claim to exercise the affected component paths; they are not the failed checks diagnosed here.
