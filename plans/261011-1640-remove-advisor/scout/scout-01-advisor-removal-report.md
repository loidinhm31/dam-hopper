# Scout 01: DamHopper Advisor removal inventory

Date: 2026-10-11. Scout: AdvisorRemovalScout. Parent condensed terminal report; no implementation.
Baseline: `538da1d3`, reconciled after worktree fast-forward to `abba947c`.
Worktree: `/home/loidinh/WS/dam-hopper-ws/remove-advisor`.
Plan: `plans/261011-1640-remove-advisor`.
Validation: read-only inventory complete; no runtime checks run.
Counts below are source-summary estimates, not fresh filesystem counts.

## Architecture
Native vertical slice: `server/src/advisor/` → `server/src/api/advisor.rs` → router → `ApiClient.advisor`/REST transport → React provider/panel.
Workspace uses singleton host + mode-dependent slots coordinated by a placement context; Settings mounts a dedicated accordion.
Complete deletion, no stubs, disabled fallbacks, deprecated aliases or notices.

## Dedicated UI deletion candidates
- Entire `packages/ui/src/advisor/` (summary reports 36 files, ~9.9k LOC).
- `packages/ui/src/hooks/use-advisor.ts`, `use-advisor.test.tsx`.
- `packages/ui/src/lib/workspace-advisor-placement.ts`, `workspace-advisor-placement.test.ts`.
- `packages/ui/src/contexts/WorkspaceAdvisorContext.tsx`.
- `packages/ui/src/components/organisms/AdvisorPanelSlot.tsx`, `AdvisorPanelSlot.test.tsx`.
- `packages/ui/src/components/organisms/WorkspaceAdvisorHost.tsx`, `WorkspaceAdvisorHost.test.tsx`.
- `packages/ui/src/components/pages/settings-page/AdvisorSettingsSection.tsx`, `AdvisorSettingsSection.test.tsx`.
- `packages/ui/browser-tests/advisor-routing.browser.tsx`, `workspace-advisor.browser.tsx`.
- `packages/ui/vitest.advisor-routing.browser.config.ts`.
- Entire `packages/ui/e2e/advisor-model-dropdown-theme/`.

## Dedicated server/fixture deletion candidates
- Entire `server/src/advisor/`: error, evaluations, evaluation_comparison, history, history_scan, metrics, mod, models, policy, snapshots, status, types.
- `server/src/api/advisor.rs`.
- `server/examples/advisor_routing_browser_fixture.rs`.
- `server/tests/advisor_history_api.rs`, `advisor_policy_evaluations.rs`.
- Entire `__fixtures__/native-advisor/`: routing JSON, models, evaluations and synthetic histories.
- Scout suggested `scripts/test-native-advisor-parity.mjs` conditionally; parent glob found no matching parity/Advisor script. Do not invent a deletion.

## Shared UI edits
- `packages/ui/src/components/pages/SettingsPage.tsx:28,402-407`: import and Advisor accordion.
- `SettingsPage.test.tsx:107-109,379`: mock and title-list expectations.
- `WorkspacePage.tsx:32-38,268,277,317-323,429,480-496,1014,1032,1224`: imports, compact IDs, visibility hook, close state, shortcut routing; remove host/provider/slots throughout render tree.
- `WorkspacePage.test.tsx`, `WorkspacePageBlameReveal.test.tsx`: mocks and Advisor gating tests.
- `packages/ui/src/components/templates/TerminalWorkspaceShell.tsx:5,28,42-44,106-123`: slot import, advisorContent prop and panel branch; migrate every caller.
- `TerminalWorkspaceShell.test.tsx:50,64,77`: obsolete Advisor cases.
- `packages/ui/src/lib/ide-shell-layout.ts:138,173-180` and test: tool union and right-tool toggle.

## Shared transport edits
- `packages/ui/src/api/client.ts:7-50`: DTO imports/exports; delete entire advisor sub-client, not just first method.
- `packages/ui/src/api/ws-transport.ts`: delete all advisor:* REST mapping cases.
- `packages/ui/src/api/ws-transport.test.ts`: delete Advisor-only suites; retain unrelated transport contracts.
- Treat line numbers as navigation hints; latest origin/main inserted unrelated idle-suspend consent fields.

## Shared server edits
- `server/src/lib.rs:1`, `server/src/api/mod.rs:1`: module declarations.
- `server/src/api/router.rs:31,565-608`: route imports/group/mount.
- `server/src/state.rs`: service, lock, constructors and with_advisor_service.
- `server/src/config/schema.rs`: ServerConfig field/default/validate; AdvisorConfig.
- `server/src/config/mod.rs:27`: type export.
- `server/src/config/parser.rs:461-465`: serialization.
- `server/src/config/replacement.rs:20-24`: obsolete replacement guard.
- `server/src/config/tests.rs`: literals and dedicated roundtrip/protected replacement tests.
- `server/Cargo.toml`: prune dependencies ONLY after proving no remaining consumer.

## Documentation inventory from scout
Delete `docs/configuration/advisor.md`, `docs/architecture/native-advisor.md`.
Remove feature content/links from `README.md`, `docs/api-reference.md`, `docs/code-standards.md`, `docs/codebase-summary.md`, `docs/system-architecture.md`.
Mixed `docs/api/advisor-and-workflow.md` retains Workflow content; parent confirmed actual lines 43-72.
Scout identified repository guidance `AGENTS.md` as affected; context is preloaded, do not search for other guidance files.

## Parent supplement: newly verified omissions
- `packages/ui/package.json:9,21-22`: specialized browser runner and public ./advisor exports.
- `packages/ui/e2e/counsel-evaluations-responsive/` exists, is an Advisor journey; delete all scenario artifacts.
- Shared `packages/ui/e2e/fixtures/application-data.ts:43-47,79-88,103-133,160`: policy seeds, directories, canonical fixtures and TOML advisor section.
- `application-readiness.ts:41-49` and `application-services.spec.ts:45-49,140-145`: safety checks depend on Advisor status. Preserve isolation using surviving real behavior, not a no-op.
- `application-services.ts:306-309`: readPolicyFile helper; remove every actual consumer/interface.
- Mixed SQLite authentication journey is referenced in `docs/testing.md:152`; preserve auth qualification and remove Advisor dependency.
- Docs additionally affected: `docs/README.md`, `docs/configuration-guide.md`, `docs/configuration/index.md`, `docs/deployment-guide.md`, `docs/frontend-components.md`, `docs/frontend-components/workbench.md`, `docs/project-roadmap.md`, `docs/project-overview-pdr.md`, `docs/testing.md`, `docs/linux-systemd.md`, `docs/archive/retired-plugin-platform.md`, `docs/CHANGELOG.md`.
- `docs/linux-systemd.md:499-575`: keep unrelated plugin cleanup/safety contracts, remove Advisor endpoint instructions and feature prose.
- `docs/CHANGELOG.md`: user requested ALL feature docs removal, including historical feature entries/passages; preserve unrelated release facts and external advisor mentoring references. Scout's default history-preservation suggestion does not override user scope.
- `ServerConfig` and `DamHopperConfigRaw` derives have no deny_unknown_fields (`schema.rs:647-649,746-755`); use ordinary unknown-key handling, no special Advisor compatibility field or shim. Verify startup/write behavior during implementation.
- `docs/api/advisor-and-workflow.md:43-72` is live workflow content; rename to `docs/api/workflow.md`, update all inbound links, delete Advisor sections.

## Exclusive ownership recommendation
1. Presentation + hooks/context/layout/shortcuts + associated UI tests.
2. Client/transport + package scripts/exports + shared test fixtures/config and scenario removal.
3. Rust service/routes/config/state + Rust tests/examples + server manifest.
4. Docs/guidance only, all mixed docs and renamed workflow page.
5. Integration validation after 1-4; reports only, never modify another owner's files.
Assign __fixtures__/native-advisor to exactly one owner, preferably 2. Wait to delete/use fixtures until all writers settle; no mid-flight checks.

## Protected boundaries
- Host-resource `Advisory` severity label is NOT the feature; preserve.
- `deploy/remove-plugin-platform.sh` path protections for external advisor-history must remain.
- External OMP/Evcrate harness tools and user ~/.evcrate history/policy are not DamHopper feature code.
- Protected historical plans/reports/sealed records remain immutable; new removal plan reports are audit artifacts, not active feature documentation.
- Preserve latest idle-suspend client-presence/consent paths and all workflow/auth/Plan dashboard/PTY behavior.

## Remaining verification for planner
Resolve concrete keyboard shortcut/persisted layout catalogs and mixed E2E consumer interfaces before final ownership lists.
Verify fixture file inventory before deletion; no speculative scripts or dependency removal.
No product-scope question remains; optional interview may confirm historical-doc/data defaults.
