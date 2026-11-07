# Execution ownership and serialization

Planning only; no task-state hydration/claim, source change or execution authorization. Literal `allowed_files` in each phase's one durable task fence is the exhaustive writable allowlist. Paths outside it require reviewed plan revision BEFORE edits. Each task's create/modify/delete actions are in its stable-ID section; no directory shorthand grants extra writes. Root `/home/loidinh/WS/dam-hopper`.

## Schedule and single owners

| Group | Tasks / owner | Entry and handoff |
|---|---|---|
| G0 sequential | `freeze-shared-contracts` — ContractOwner | Related-plan exclusive handoff; complete DTOs/fixtures/intents/typed seams before branches. |
| G1 concurrent backend | `guarded-termination-domain` -> `guarded-termination-http` — BackendOwner | P01 complete; Rust manager/session/fleet exact predicates/tests then API DTO/routes. Exact cancellation marker and snapshot supplied before HTTP. |
| G1 concurrent client | `inventory-observation` -> `migrate-terminal-actions` — ClientOwner | P01 complete; additive compatibility types/exact observation then origin-aware safe service/ports/hooks only. |
| G1 concurrent Recipe | `recipe-source-target-capture` — RecipeOwner | P01 complete; Recipe-local seam/app/tests only. |
| G1 concurrent shell | `dismiss-shell-layers` and `canvas-placement-gestures` — ShellOwner | P01 complete; two disjoint allowlists, may run concurrently or serially within shell. |
| G2 sequential UI | `hub-and-close-ui` -> `review-authority-retirement` — SessionUiOwner | ALL G1 terminal; P03 mandatory. No overlap with other live branches. |
| G3 sequential integration | `integrate-qualified-session-routing` -> `integrate-close-input-retirement` — IntegrationOwner | ALL G1/G2 terminal, actual contracts inspected and shared file handoff accepted. |
| G4 sequential qualification | `author-integrated-qualification` -> `execute-integrated-qualification` — QualificationOwner -> `human-full-app-visual-review` — HumanReviewer | Every source writer terminal; one coherent real-app worker; actual human gate separate. |
| G5 sequential finalizer | `reconcile-docs-handoff` — DocsFinalizer | Runtime + human gate satisfied; one docs writer, coordinator alone state finalizer. |

No comparable-path overlap among incomparable tasks, including tests/fixtures/docs. Reuse of a file across sequential tasks is intentional owner transfer, not permission for concurrent writers. No source builds/tests/formatters mid-flight; one integrated qualification owner runs once after landing. A task result is not implementation approval or test pass.

## Shared-file transfer ledger
- `os/types.ts`, `os/intents.ts`, `components/organisms/MultiTerminalDisplay.tsx`: ContractOwner P01 type additions -> IntegrationOwner P07 full wiring. No Recipe/SessionUi concurrent edits.
- `pty/manager.rs`, `pty/session.rs`, `pty/fleet_state.rs`, `pty/tests.rs`: BackendOwner domain task only; fleet_state limited exact pending/creating read predicates, existing exact cancel reused. Runtime DeadSession completion marker retained, no SessionMeta/persistence authority fields. Domain snapshot/outcome ->same owner's API task defines terminal.rs flat DTO, both projections one snapshot/no extra query.
- `os/OsShell.tsx`, `os/shell-input-context.tsx`, `os/WindowList.tsx`: ShellOwner P06 input/dismissal -> IntegrationOwner P07 qualified routing/Close/input/retirement after shell terminal.
- `os/window-store.ts`, `os/WindowFrame.tsx`: ShellOwner P06 atomic mode/gesture/canvas -> IntegrationOwner P07 placement and explicit Close wiring. Frame/window-list Close never split between live session and shell owners.
- `os/OsResourceHost.tsx`, resource registry, TerminalsApp, persistence, keep-alive/TerminalPanel/input/replay: IntegrationOwner only, except P01 MountedSession type above. Stable runtime values must not remount on layout updates.
- `api/client.ts`, `api/ws-transport.ts`: ClientOwner P03 adds typed safe APIs/observation -> IntegrationOwner P07 removes old aliases AFTER P04 Monitor migration. No unsafe caller allowed at integrated cutover; temporary branch compatibility is not fallback.
- AgentHubApp: SessionUiOwner's Hub task -> same owner's Review task; no independent simultaneous writers.
- Browser tests: G1 Recipe and shell, G2 Hub/Review, G4 real-app specs are distinct literal files; no runner/fixture directory shared writer. P08 shared observation fixture created by qualification author only, then read by execution.
- Docs live files: DocsFinalizer only after P08. No other branch writes changelog/API/frontend/architecture prose. Existing reports/architecture contract evidence read-only during execution unless coordinated explicit spec revision.

## Callsite disposition

| Existing/action surface | Exact owner/task | Disposition and reason |
|---|---|---|
| Monitor confirm kill (`SystemMonitorApp.tsx`) | `hub-and-close-ui` | Capture exact aggregate target+live/restartPending origin; shared 202 requested vs200 cancelled/loss proof; exact focus intent. |
| `use-ports.ts` kill + PortsPanel confirmation | `migrate-terminal-actions` | Safe End takes full target+origin; numeric port join only positive-safe lossless equality to exact inventory, unsafe unavailable. Tunnels untouched. |
| terminal-manager handleKillTerminal | `migrate-terminal-actions` | Guarded explicit captured target only; currently no production importer found, no legacy shell resurrection. |
| durable remove helper CloseTab/free remove | `migrate-terminal-actions` | Presentation Close only; remove dead durable helper/export, no kill+evict. |
| helper calls profile delete/rename/custom-command rename | `migrate-terminal-actions` | Config cleanup is not End consent; remove implicit destruction loops, preserve live background sessions/history. |
| Frame X, WindowList close, pane/window tabs, explicit keyboard Close | `integrate-close-input-retirement` | One Close provider captured target; pure store close remains presentation primitive. ShellOwner only prepares frame/list UX before this serialized wiring. |
| Programmatic cleanup, desktop deletion/move, minimize/unmount | `integrate-close-input-retirement` | Must remain presentation/layout only; never routed to End. |
| API kill/remove members + transport mappings | ClientOwner add safe contract, `integrate-close-input-retirement` final deletion | No unsafe web aliases/shims remain; server DELETE retained for unrelated clients. |
| Terminal:create fallback in existing-only TerminalsApp | `integrate-qualified-session-routing` | Remove adoption fallback; fresh explicit launch stays distinct and owner-fenced. |
| Hub Open beside/Review producer | `hub-and-close-ui`, `review-authority-retirement` | New frozen exact placement/full Review tuples. P07 consumer never ambient-rebinds. |
| OsShell terminal/review handlers and deep links | `integrate-qualified-session-routing` | Exact runtime route for captured actions; incomplete Review links rejected; raw focus remains discovery-only/no auto-create/destructive authority. |
| WorkflowPlansApp/LaunchReview raw terminal focus | Intentionally unchanged producer | Locator navigation only, no captured runtime authority or mutation. P07 handler resolves fresh qualified inventory and cannot auto-create; no executor repair. |
| Traditional terminal agent builders/tests | Intentionally unchanged | Remain agent-only navigator helpers; new Hub joins full inventory at Hub seam, no broad classification rewrite. |
| Unmounted TerminalTreeView/TerminalTabBar and old adapter tooltips | Intentionally unchanged | Scoped caller search finds no production useTerminalManager importer. No reachable destructive mutation; do not resurrect legacy shells or make unrelated UI rewrites. Newly found reachable callers require exact ownership revision. |
| SessionChangesPanel/query helpers | `review-authority-retirement` | OS exact string inventory/agent/Status equality, root/epoch/baseline/close scope; unsafe numeric agent proof unavailable, no producer rewrite. Other metadata lookup preserved. |
| Hidden Review lifetime | `integrate-close-input-retirement` | Root guard across all windows, no visibility-dependent purge, late-result rejection; ordinary close scoped to tuple. |
| Recipe source/capture/confirmation | `recipe-source-target-capture` | Pure local context projection and UI, RecipeV1 preserved. |
| Recipe schema/persistence/LaunchReview/executor/launch records | Intentionally unchanged | No persisted addition needed, full execution/F1 not in scope; regression tests do not certify limitations fixed. |
| PTY fleet_state exact predicates | `guarded-termination-domain` | Minimum read-only exact pending/creating predicates and narrow tests; exact cancel already exists. Split admission from publication in manager, no fleet scheduler rewrite. |
| Supervisor asynchronous target-validation failure | `guarded-termination-domain` | Fence all pre-reservation failure mutations/persistence/workflow effects on still-active exact uncancelled restart ownership; gate FinalExit on accepted transition. Same owned manager/tests, no additional parallel writer; post-reservation fencing remains distinct. |
| host_actions capabilities / AgentStatus / SessionChanges producers | Intentionally unchanged | Capability belongs original terminal inventory; exact inventory does not repair unsafe numeric downstream identities. Refuse joins, do not broaden protocols. |
| Full exact target / numeric replay boundary | `integrate-qualified-session-routing` -> `integrate-close-input-retirement` | Captured string survives hosts/claims; panel then helper enforce safe exact-equal numeric proof, otherwise unavailable/input disabled; no coercion/producer expansion. |
| Server legacy DELETE / Android / unrelated clients | Intentionally unchanged | Compatibility retained, explicitly not guarded by this web cutover. |
| READMEs/auth/deployment/package manifests/lockfile | Intentionally unchanged | No new dependency/version/release/auth workflow; existing commands and map remain valid. |

## Cross-plan arbitration
Read-only related plans from intake: `plans/261101-1738-ai-dev-os-redesign/plan.md` (shared shell/docs + historic AC8/F1/H1/H2), `plans/261103-1608-workspace-file-tree-project-marks/plan.md` (client/OS/server/docs), `plans/261103-2016-user-concerns-resolution/plan.md` (server/UI/settings/docs, float preference). Coordinator must acquire actual file handoff before execution; no requirement to finish whole other plans, no status-based safety assumption and no edits here. Prior `261104-1358` blocker report preserved, not a resumable canonical plan.

## Exhaustive task index
The linked phase JSON owns exact lists; the following literal task references identify all writable scopes without directory aliases.

- `freeze-shared-contracts` — [phase-01-shared-contracts.md](phase-01-shared-contracts.md#task-freeze-shared-contracts) — 5 literal writable entries.
- `guarded-termination-domain` — [phase-02-backend-guard.md](phase-02-backend-guard.md#task-guarded-termination-domain) — 4 literal writable entries.
- `guarded-termination-http` — [phase-02-backend-guard.md](phase-02-backend-guard.md#task-guarded-termination-http) — 3 literal writable entries.
- `inventory-observation` — [phase-03-client-observation-actions.md](phase-03-client-observation-actions.md#task-inventory-observation) — 8 literal writable entries.
- `migrate-terminal-actions` — [phase-03-client-observation-actions.md](phase-03-client-observation-actions.md#task-migrate-terminal-actions) — 7 literal writable entries.
- `hub-and-close-ui` — [phase-04-session-hub-review-ui.md](phase-04-session-hub-review-ui.md#task-hub-and-close-ui) — 8 literal writable entries.
- `review-authority-retirement` — [phase-04-session-hub-review-ui.md](phase-04-session-hub-review-ui.md#task-review-authority-retirement) — 7 literal writable entries.
- `recipe-source-target-capture` — [phase-05-recipe-capture.md](phase-05-recipe-capture.md#task-recipe-source-target-capture) — 7 literal writable entries.
- `dismiss-shell-layers` — [phase-06-shell-interactions.md](phase-06-shell-interactions.md#task-dismiss-shell-layers) — 12 literal writable entries.
- `canvas-placement-gestures` — [phase-06-shell-interactions.md](phase-06-shell-interactions.md#task-canvas-placement-gestures) — 6 literal writable entries.
- `integrate-qualified-session-routing` — [phase-07-sequential-integration.md](phase-07-sequential-integration.md#task-integrate-qualified-session-routing) — 18 literal writable entries.
- `integrate-close-input-retirement` — [phase-07-sequential-integration.md](phase-07-sequential-integration.md#task-integrate-close-input-retirement) — 16 literal writable entries.
- `author-integrated-qualification` — [phase-08-integrated-qualification.md](phase-08-integrated-qualification.md#task-author-integrated-qualification) — 5 literal writable entries.
- `execute-integrated-qualification` — [phase-08-integrated-qualification.md](phase-08-integrated-qualification.md#task-execute-integrated-qualification) — generated evidence scopes in P08.
- `human-full-app-visual-review` — [phase-08-integrated-qualification.md](phase-08-integrated-qualification.md#task-human-full-app-visual-review) — 1 literal writable entry.
- `reconcile-docs-handoff` — [phase-09-documentation-handoff.md](phase-09-documentation-handoff.md#task-reconcile-docs-handoff) — 7 literal writable entries.

Heading links use phase task sections for navigation; durable identity is literal task ID, not rendered heading slug. Generated `packages/ui/test-results` and `packages/ui/.e2e-staging` are P08 runner-output-only ownership, never broad source permission. Every other allowed entry is a literal file. P08 captures use four new case folders, each with one dedicated capture-test/evidence-session owner and a complete retained state/size/zoom matrix; predecessor artifacts remain unchanged. No task-state/evidence artifacts are created during planning.

## Blockers and escalation
Additional file, changed shared signature, unfinished dependency, unexpected related-plan writer, severe review finding or missing runtime prerequisite -> stop affected task, report precise gap to coordinator; revise contract/allowlists/dependencies before resuming. No worker silently expands scope or marks pass. External current-repo changes belong to user; adapt through handoff, never destructive reset. Main coordinator owns independent review/final validation, hydration if later authorized and final runtime acceptance reconciliation.
