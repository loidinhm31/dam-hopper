# Phase 05 — Verification and Quality Gates

## Context Links

- [Plan/preflight/side effects](./plan.md); [current progress](./progress.md); [Phase 01](./phase-01-server-policy-update.md); [Phase 02](./phase-02-server-harness-model-discovery.md); [Phase 03](./phase-03-frontend-transport-data-provider.md); [Phase 04](./phase-04-frontend-ui-inline-card-editor.md).
- Existing [API integration harness](../../server/tests/advisor_policy_evaluations.rs), [auth cases](../../server/tests/advisor_history_api.rs), [panel tests](../../packages/ui/src/advisor/AdvisorPanel.test.tsx), [transport tests](../../packages/ui/src/api/ws-transport.test.ts), [Browser Mode config](../../packages/ui/vitest.browser.config.ts).
- Current [root scripts](../../package.json), [UI scripts](../../packages/ui/package.json), [native architecture](../../docs/architecture/native-advisor.md), [configuration](../../docs/configuration/advisor.md), [scout evidence](../reports/scout-261003-1822-advisor-routing-model-selector.md).

## Overview

- Date: 2026-10-03. Priority: P2. Status: pending; captured statuses historical. Effort: 6h.
- Main integration owner executes verification **once after all implementation changes land**. Phase writers author tests but do not run concurrent builds/tests/linters/formatters.
- This plan authoring assignment does not execute or claim any feature tests, builds, typecheck, lint, live model protocol, or completion receipt.

## Key Insights

- Existing Rust integration tests use real temp files, `AdvisorService::new(Some(home))`, `build_router`, authenticated mock user/session, and `tower::ServiceExt::oneshot`; no MongoDB/installed harness dependency needed.
- Existing jsdom tests use React `createRoot`/`act`; native provider tests exercise abort/error conversion; transport tests stub `fetch` and inspect exact REST request mapping.
- Browser coverage is **Vitest Browser Mode using Playwright-backed Chromium**, not a preexisting full-stack E2E framework. Mocked browser interaction results are not authenticated real-server qualification.
- Root `pnpm dev:server` uses `--no-auth`; it cannot qualify protected Advisor endpoints. Never weaken `require_admin` or add production test-auth endpoints to make smoke tests work.
- Use pnpm 10; preserve Radix compose-refs patch. `pnpm format` rewrites the whole repository: use targeted formatter paths instead.

## Requirements

1. Add unit, authenticated API integration, provider/transport, component, browser interaction, and targeted cross-layer routing tests; retain existing read/history/evaluation regressions.
2. Qualify actual policy file mutation against real temporary filesystem, not a mocked persistence function. Independently prove dynamic catalog parsing and fallback semantics for each backend using deterministic fake runner fixtures.
3. Test cross-layer editor -> native provider -> real REST mapping -> authenticated Axum policy handler -> temp disk -> returned/live summary -> fresh read/restart behavior.
4. Exercise admin/non-admin/unauthenticated/no-auth/disabled/current-role downgrade and size/credential/path safety boundaries before recording acceptance.
5. Execute typecheck, ESLint, Rust formatting and focused tests after landing; broader affected suites once. Separate unrelated existing failures with exact evidence; never rerun user-reported failures just to confirm them.
6. Reconcile architecture/API/component/configuration/changelog docs with actual landed behavior. No documentation that implies fallback models were live-discovered or test fixtures represent production qualification.
7. Parent owns advice receipts/progress publication; captured baseline files remain unchanged. Completion requires passing specified gates and authoritative reconciliation, not plan checkbox edits.

## Architecture

Four test layers, one shared wire contract:

- **Rust domain:** temp HOME, real bounded/no-follow files, injected I/O/rename failure hooks limited to tests, deterministic model parser/runner inputs.
- **Rust API:** real `build_router` auth middleware/service/filesystem, initial current read -> PATCH -> independent reread -> new `AdvisorService`/router with same HOME. Assert actual disk bytes/hash and unchanged runtime parameters.
- **UI unit/integration:** pure validation + card draft behavior + panel sequence/owner fences + native provider cancellation + exact channel-to-REST mapping.
- **Vitest Browser Mode cross-layer fixture:** focused `advisor-routing.browser.tsx` mounts real panel/provider/client against loopback-only Axum test fixture. Fixture creates/injects its own temp HOME and mock authenticated test sessions, uses production routing/domain code, and exposes deterministic model-runner results. No production bypass, database, inference, or user's HOME mutation.

Keep test infrastructure minimal/permanent: a Rust example `advisor_routing_browser_fixture` plus a small Browser Mode setup/config adapter. It must serve only localhost, create its own `TempDir`, never accept/modify arbitrary HOME, and exit/clean up on test teardown. Test bearer token supplied only to the test client; do not print/report real credentials. Production release binaries/router remain unchanged. Reuse existing harness construction patterns; do not duplicate routing/domain behavior.

## Related Code Files

| Action | Repository path | Change |
|---|---|---|
| Modify | `server/src/advisor/policy.rs`, `models.rs` test modules | Atomic/path/bounds/parser/cleanup unit cases |
| Modify | `server/tests/advisor_policy_evaluations.rs` | End-to-end authenticated route persistence/readback/restart/catalog cases |
| Modify | `server/tests/advisor_history_api.rs` | Parameterize existing auth/disabled tests for both new endpoints; preserve history lifecycle |
| Modify | `server/src/fs/secure_path.rs` tests | Checked-replacement no-follow/parent-swap/temp cleanup regressions |
| Modify | `packages/ui/src/advisor/native-advisor-provider.test.ts`, `AdvisorPanel.test.tsx`, existing reducer tests | Required methods, typed errors, cancel/owner/policy sequence races |
| Modify | `packages/ui/src/api/ws-transport.test.ts` | Two exact REST mappings/headers/signals, conflict/413 propagation |
| Create | `packages/ui/src/advisor/components/PolicySummaryCard.test.tsx`, `policy-routing-validation.test.ts` | Editor workflow and pure validation tests |
| Create | `packages/ui/browser-tests/advisor-routing.browser.tsx` | Focus, controls, four harnesses/custom input, cross-layer save against fixture |
| Create | `server/examples/advisor_routing_browser_fixture.rs` | Dedicated loopback temp-HOME/auth/model test fixture, production router/domain code |
| Create only as needed | `packages/ui/vitest.advisor-routing.browser.config.ts`, browser test setup under `packages/ui/browser-tests/` | Extend existing Browser Mode conventions, start/stop fixture safely, test-only endpoint/token injection |
| Modify | `docs/architecture/native-advisor.md`, `docs/configuration/advisor.md`, `docs/api-reference.md`, `docs/frontend-components.md`, `docs/CHANGELOG.md` | Narrow write/discovery/editor contract, limitations, ownership/security, tests and user journey |
| Create after checks, parent-owned | This plan's `reports/qualification.md`, immutable phase receipts | Actual command/status/evidence; not fabricated at planning time |
| Delete | Any feature-only throwaway probes | Permanent test fixture retained; no temporary diagnostic scripts or scaffolding |

## Implementation Steps

1. Integrate all source changes and migrate affected provider callsites/test doubles. Confirm single chosen PATCH/catalog contract and exact DTO casing; avoid testing alternate paths/shims.
2. Extend real Rust API harness before UI tests. Exercise authenticated current read, submit new primary/backup with expected revision, read actual file, compare untouched wait/history values, independently current-read, rebuild service/router with same temp HOME, and repeat read to prove persisted policy.
3. Add policy matrix and test-only fault injection. Do not mock std filesystem persistence away. Cover byte-size boundaries, credential recursion, custom identifiers, trim/control/producer bounds, stale SHA, concurrent same-revision saves, file/parent symlinks, non-regular target, inode/parent swap, old-file preservation, temp cleanup, and post-rename uncertainty.
4. Add four discovery fixtures/runners and assert exact commands/control frames, IDs, efforts, default suggestions, source/diagnostic. Prove empty/missing/unsafe/version/malformed/timeout/oversize fallback, pagination bounds, credential-rich init fields omitted, no prompt/inference/tool requests, and no surviving child on cleanup paths.
5. Extend existing auth tests to both new endpoints: ordinary admin Bearer/cookie succeeds; no auth/session, non-admin, `--no-auth`, disabled feature, revoked/role-downgraded account denies. Invalid backend/credentials/oversized body must not launch discovery or modify policy. Also cover valid policy + missing history directory: catalog/write remain usable, new routing capabilities remain advertised to enabled admin, and history source still reports unavailable.
6. Add UI suites: defaults preserved, noncatalog current model, custom input, backend-specific catalogs/efforts, duplicate triple live validation, different effort allowed, Save disabled/one submission, Cancel no write, failure/conflict retained draft, stale revision, loading/fallback notice, keyboard/focus, theme scope.
7. Add deferred-promise race tests: old read after save, backend A result after B selection, same request-ID supersession, provider cancel/destroy, owner/profile/generation change, disconnect/revocation, editor unmount. No old-owner draft/catalog/policy commit or success announcement may leak.
8. Add minimal permanent loopback fixture and focused Vitest Browser Mode cross-layer test. Real `NativeAdvisorProvider` and `ApiClient` must exercise REST; fake only model subprocess discovery and test auth data. Verify displayed returned revision/values, reopen/read persisted values, and fixture restart/readback. Capture actual UI save payload and filesystem result without exposing auth tokens in reports.
9. Main executes gates below sequentially after formatting; record exact command, exit code, scope, and relevant output. On an actionable failure, fix source/tests/docs then run only affected gates; do not race phase writers or label unrelated failure as feature success.
10. Qualify optional installed harness catalog paths read-only with the final implementation and isolated test environment. Help-only evidence remains distinct from actual model listing. No inference, `omp models refresh`, auth login/refresh, or user routing file overwrite. Unsupported local versions must visibly return tested fallback; no claim that their dynamic path was exercised.
11. Update docs after source behavior settles: PATCH request/result/error codes, fixed effective HOME, atomic/no-follow/16 KiB contract, runtime parameter preservation, model commands/protocols/fallback/custom labels, effort defaults as suggestions, owner fencing/cancellation uncertainty, inline interaction/accessibility.
12. Review side-effect checklist and output evidence; parent reconciles advice scope, publishes immutable receipts, updates uncaptured overview, and selects next incomplete scope only. Never mutate sealed plan phase status to DONE or invent controller identity.

## Test Matrix / Success Criteria

| Area | Required cases | Observable pass evidence |
|---|---|---|
| Route persistence | Existing ready V2, all backends, custom provider-qualified models, nondefault wait/history, unrelated safe JSON values | Real disk route values/new SHA; same non-route values; independent read/restart agrees |
| Validation | Duplicate exact triple, same model/different effort, unknown backend, empty/control/overlong model/effort, whitespace, unknown/credential keys | Stable sanitized code; invalid request causes no write; UI duplicate feedback immediate |
| Concurrency | Two admins same revision, external byte change observed before rename, cancellation while blocking writer runs | One server success/one 409; observed external edit conflicts; no lock-release race or claimed rollback |
| Filesystem safety | File/HOME/.evcrate symlink, directory/FIFO, parent swap, source/output 16 KiB boundaries, temp/write/sync/rename failure | No redirected/torn write; original unchanged before commit; temp cleanup; accurate postcommit uncertainty |
| Authorization | Admin Bearer/cookie, guest/user, missing/revoked session, role downgrade, no-auth, Advisor disabled | Correct 401/403; no side effects/process launch for denied request |
| Discovery | Four successful adapter fixtures; absent/empty/unsafe/malformed/unsupported/timed out/truncated catalogs | Exact normalized ID/efforts; explicit fallback/source/diagnostic; no secrets or inference frames |
| UI | Inline Edit/Cancel/Save, four backends, custom model, effort options, conflict/error, reopen | Authoritative summary/revision; no canceled/double write; no editable wait/history |
| Lifecycle | Backend/owner/context/generation switch, stale read/catalog, destroy/revoke/unmount | No late result publication or old-owner data/input leakage |
| Browser | Real native client/provider against loopback fixture; keyboard/focus/compact/theme interaction | Browser DOM + authenticated route/disk/readback evidence; mock-only tests labeled separately |
| Regression | Existing policy statuses, history snapshots/filtering, evaluations, Settings/workspace ownership | Existing affected suites pass; no history refresh or settings mutation from route save |

## Commands — Main Runs After Landing

From repository root; these commands are planned, not executed here. Use pnpm 10 and current Rust toolchain. Targeted new file/example commands become runnable when the phase-authored files exist.

```bash
# Formatting, targeted only; do not use repository-wide pnpm format.
cargo fmt --manifest-path server/Cargo.toml --check
pnpm exec prettier --check packages/ui/src/advisor packages/ui/src/api/client.ts packages/ui/src/api/ws-transport.ts packages/ui/src/api/ws-transport.test.ts packages/ui/browser-tests/advisor-routing.browser.tsx

# Rust focused units and authenticated integration; run sequentially.
cargo test --manifest-path server/Cargo.toml advisor::policy
cargo test --manifest-path server/Cargo.toml advisor::models
cargo test --manifest-path server/Cargo.toml fs::secure_path
cargo test --manifest-path server/Cargo.toml --test advisor_policy_evaluations
cargo test --manifest-path server/Cargo.toml --test advisor_history_api

# UI types, focused tests, interaction suite, lint.
pnpm --filter @dam-hopper/ui exec tsc --noEmit -p tsconfig.json
pnpm --filter @dam-hopper/ui test src/advisor src/api/ws-transport.test.ts
pnpm --filter @dam-hopper/ui test:browser browser-tests/advisor-routing.browser.tsx
pnpm --filter @dam-hopper/ui test:browser browser-tests/workspace-advisor.browser.tsx
pnpm lint

# Focused cross-layer Browser Mode config owns fixture lifecycle.
cargo build --manifest-path server/Cargo.toml --example advisor_routing_browser_fixture
pnpm --filter @dam-hopper/ui exec vitest run --config vitest.advisor-routing.browser.config.ts browser-tests/advisor-routing.browser.tsx

# Final affected-package/server regression gates, once.
pnpm --filter @dam-hopper/ui test
cargo test --manifest-path server/Cargo.toml
pnpm build
```

- Standard `test:browser` interaction run may use deterministic HTTP fixtures; dedicated config invokes real loopback server fixture. Tests must declare their mode explicitly; never call mock HTTP evidence full-stack qualification.
- Cross-layer config must provide browser server/proxy CORS/session details using existing test transport patterns, wait for explicit loopback readiness, record actual chosen URL, and stop/reap fixture in teardown even on failures.
- If formatting required, use `cargo fmt --manifest-path server/Cargo.toml` and targeted `pnpm exec prettier --write <changed paths>` before final check run; retain no unrelated formatting diff.
- `pnpm check` includes native packaging and may be appropriate only if parent requires broad release qualification; do not make Android/native toolchain absence an unexplained routing blocker.
- Live production-style manual check requires a real validated admin session on a disposable test server whose effective HOME is confirmed; never use root `dev:server --no-auth` or user's actual policy. Verify Edit Routing, fallback/custom input, duplicate feedback, save/reopen/restart, and read-only wait/history. Reports contain sanitized observations only.

## Todo List

- [x] Domain/API auth/persistence/path/failure/catalog matrices authored and exercised.
- [x] Provider/transport/card/panel/validation/lifecycle tests authored and exercised.
- [x] Vitest Browser Mode keyboard/layout and real loopback cross-layer routing gate pass.
- [x] Typecheck, targeted format, ESLint, affected suites and build evidence recorded.
- [x] Docs/changelog and side-effect checklist reconcile with landed code.
- [ ] Parent authoritative receipts/progress publication; no sealed-artifact rewrite.
## Risk Assessment

- **Misleading test claims:** distinguish synthetic fixture, mocked HTTP, real authenticated loopback domain, installed harness discovery, and production evidence in every report.
- **Accidental HOME overwrite:** fixtures own isolated temp HOME via injected `AdvisorService`; never rely solely on `HOME` env because `resolve_effective_home()` may consult host service-user configuration.
- **Heavy/unstable external CLIs:** deterministic unit/API gates do not require installed binaries/auth/network; separately qualify bounded discovery. Fallback is correct degraded behavior, not proof of dynamic runtime compatibility.
- **Too broad verification/refactor:** focus feature tests and affected suites, no release-manager/platform requalification unless touched. Shared safe-path extension requires its existing tests.
- **Stale advice status:** authoritative completion before parent progress publication; captured pending statuses are historical and preserved.

## Security Considerations

- Loopback-only fixture/example is test tooling, not production unauthenticated endpoint. Use test-only users/tokens/temp files, no real credential outputs, sessions, or routing policy.
- Sentinel tests must prove no shell credential helper/hook/extension/MCP tool executes during listing/init; unsafe discovered behavior requires fallback, never safety relaxation.
- Auth and rejection cases assert zero mutation/launch. Verify response/log redaction with credential-rich synthetic input; do not seed real secrets into fixtures.

## Next Steps

Parent reviews actual gate output and side effects, resolves all actionable failures, publishes qualification report and phase receipts, then updates `progress.md` outside captured scope. Hand off feature only with all named acceptance criteria established; otherwise report exact failed gate/missing evidence, not a completed feature.

## Unresolved Questions

None requiring user input. Session active-plan persistence needs parent's `EVCRATE_SESSION_ID`; installed CLI isolation/protocol results are implementation gates, not fabricated planning results.
