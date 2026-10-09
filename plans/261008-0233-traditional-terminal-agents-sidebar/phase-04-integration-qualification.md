# Phase 04 — Traditional display integration, application qualification and docs

## Context links
- [Overview/dependency and exclusive ownership matrices](plan.md), [frozen integration contract](contracts.md#phase-4-integration-behavior), [command overview](cmd-plan.md).
- True prerequisites: [phase 1 model](phase-01-roster-model.md), [phase 2 components](phase-02-navigator-components.md), [phase 3 Settings route](phase-03-agent-store-navigation.md). All complete before integration/verification.
- [Main contract](reports/02-planner-contract.md), [code evidence](reports/01-codebase-analysis.md), [risk review](reports/03-design-risk-review.md), [UX research](research/researcher-01-report.md), [harness research](research/researcher-02-report.md).
- Read-only APIs/patterns: `packages/ui/src/hooks/use-traditional-terminal-project-selection.ts`, `packages/ui/src/hooks/use-aggregated-terminal-sessions.ts`, `packages/ui/src/hooks/use-agent-status-connections.ts`, `packages/ui/src/api/connections.ts`, `packages/ui/src/api/server-config.ts`, `packages/ui/src/api/ownership.ts`, `packages/ui/src/stores/agent-status.ts`, `packages/ui/src/lib/traditional-terminal-projects.ts`, `packages/ui/src/components/organisms/MultiTerminalDisplay.tsx`, `packages/ui/src/components/ui/Dialog.tsx`, `packages/ui/src/components/pages/WorkspacePage.tsx`.
- Existing qualification tooling read-only: `packages/ui/package.json`, `packages/ui/vitest.browser.config.ts`, `packages/ui/playwright.config.ts`, `packages/ui/e2e/fixtures/application-fixture.ts`, `packages/ui/e2e/fixtures/application-services.ts`, `packages/ui/e2e/fixtures/capture-evidence.ts`, `packages/ui/e2e/fixtures/capture-policy.ts`, `packages/ui/e2e/privacy-heavy-blur/privacy-heavy-blur.spec.ts`, `docs/testing.md`, `docs/code-standards.md`.

## Parallelization Info
- Group B; hard dependencies on phase 1 builder, phase 2 component/props and phase 3 href/profile-denial behavior. Connected runtime/build qualification cannot occur independently.
- Sole integration owner; owns 14 exact paths, including every changed doc, browser fixture and application evidence artifact. No sibling should touch display glue, screenshots or these docs.
- Wait for complete slices, integrate, then one targeted verification pass. No planning checks; no mid-flight sibling builds/tests/lint/formatters.

## Overview
- Date: 2026-10-08. Priority: P2. Estimate: 6h.
- Description: Wire current roster/URL contracts into both navigator surfaces and prove exact session/owner behavior in browser and real app.
- Implementation status: pending, 0%. Review status: pending. Proposed only; no qualification performed during planning.

## Key Insights
- Existing display owns selected project, per-project terminal layout and both navigator instances. Workspace callbacks already suffice; no large WorkspacePage edit or second terminal host.
- Existing exact tab selection targets correct split pane through MultiTerminalDisplay. Group selection instead picks remembered terminal and is insufficient for agent activation.
- Selection hook forwards unknown IDs; stale callback must validate latest canonical terminal incarnation/membership before forwarding.
- Compact opener is outside Dialog Trigger; explicit restoration needed. Existing opener/add/shared close targets are below 44px; fix locally, not by changing global Dialog.
- Browser fixture mocks transport/compact state; useful for regression but not proof of real agent hooks/admission/generations. Actual managed harness smoke is mandatory separate evidence.

## Requirements
- Both desktop and compact navigator get full `agentRows`, `activeSessionId`, `onSelectAgent`, `agentSettingsHref`. Existing Projects/terminal counts/Git summary/layout remain intact.
- Status map + current registered profile metadata + connection generation/status subscribed reactively. Never render retired-ready data while status bridge catches up; no per-row API/store subscriptions or new polling.
- Agent action selects existing exact terminal in its project/nonfocused split pane, preserves PTY/buffer/layout/visible membership and closes compact sheet; status changes do not change order/focus.
- Section Settings link uses selected-project validated registered profile, including disconnected context; ambiguous owner -> chooser. No ambient profile/policy/install changes.
- Modal keyboard trap/Escape/close/group-arrow dismissal/agent Enter+Space/dismissal restores opener. All affected compact opener/add/Settings/row/close targets >=44px.
- Actual-app smoke covers real OMP/Codex/Claude integration through existing Agent Store; explicit Idle/Working/secondary Done semantics and native limited evidence, no backend/database/API changes.
- Publish truthful runtime report/full-viewport wide+compact captures + metadata/human review; update docs/changelog only with behavior/evidence actually implemented/exercised.

## Architecture
- Reuse `groups` typed as `TraditionalTerminalProjectGroup<DisplayTabEntry>[]`; subscribe to readonly profiles selector and registered profiles once in display.
- Existing aggregate pattern: `useSyncExternalStore(subscribeConnections, stableJsonSignature, stableSSRSignature)` where snapshot is tuples `[profileId,status,generation]`. Build indexed connection map once per computation; do not expose allocating `getAllConnectionSnapshots()` as external-store snapshot.
- Memoize builder over groups/status profiles/connection signature/profile labels; capture nowMs in computation. Server expiry/reconcile remains authoritative; guard hint on known-expired evidence without inventing client lease engine.
- Build selection map once, preserve latest committed roster and exact handler in a ref. Per-render handler captures offered row instance key; compare with latest member on invocation, reject stale removed/restarted key, then existing handleSelectTab + close sheet. Avoid per-row full-group scans for normal roster rendering.
- Compact `DialogContent.onCloseAutoFocus` restores connected opener ref and prevents default restoration; no xterm focus while modal open. Local direct-child close utility sets >=44px; reserve heading space. Keep default modal trap and Escape behavior.
- Keep all PTY render inside existing renderTerminalSurface/MultiTerminalDisplay; no new terminal mount, selection store, layout/storage keys or Runtime-mode edits.

## Related code files
- Modify `/home/loidinh/WS/dam-hopper/packages/ui/src/components/organisms/TraditionalTerminalProjectsDisplay.tsx` — exclusive reactive model/link/selection/compact glue.
- Modify `/home/loidinh/WS/dam-hopper/packages/ui/browser-tests/terminal-traditional-projects.browser.tsx` — browser behavioral integration matrix.
- Modify `/home/loidinh/WS/dam-hopper/packages/ui/browser-tests/terminal-traditional-projects.browser-fixture.tsx` — qualified metadata/status/connection fixture cases, local cleanup.
- Create/proposed `/home/loidinh/WS/dam-hopper/packages/ui/e2e/traditional-terminal-agents/traditional-terminal-agents.spec.ts` — actual shared app navigation/PTY/settings journey, no status-response mocking.
- Create/proposed `/home/loidinh/WS/dam-hopper/packages/ui/e2e/traditional-terminal-agents/evidence.json` — capture provenance/environment/dimensions/hashes.
- Create/proposed `/home/loidinh/WS/dam-hopper/packages/ui/e2e/traditional-terminal-agents/review.md` — explicit human visual decision and qualification limits.
- Create/proposed `/home/loidinh/WS/dam-hopper/packages/ui/e2e/traditional-terminal-agents/screenshot.png` — actual full wide application viewport.
- Create/proposed `/home/loidinh/WS/dam-hopper/packages/ui/e2e/traditional-terminal-agents/compact.png` — actual full compact application viewport with both sheet sections.
- Create/proposed `/home/loidinh/WS/dam-hopper/plans/261008-0233-traditional-terminal-agents-sidebar/reports/04-runtime-qualification.md` — actual commands/scenarios/outcomes/blockers/versions, <=150 lines.
- Modify `/home/loidinh/WS/dam-hopper/docs/system-architecture.md` — reconcile proposed section only after implementation; preserve not-qualified distinctions.
- Modify `/home/loidinh/WS/dam-hopper/docs/codebase-summary.md` — updated narrow UI/data flow, no invented inventory counts.
- Modify `/home/loidinh/WS/dam-hopper/docs/project-overview-pdr.md` — presentation acceptance/status scoped to exercised surfaces/platforms.
- Modify `/home/loidinh/WS/dam-hopper/docs/architecture/agent-status.md` — Traditional vocabulary/historical hint, Settings deep link and unchanged semantic/notification contract.
- Modify `/home/loidinh/WS/dam-hopper/docs/CHANGELOG.md` — dated user-visible delivery + exercised checks/limits.

## File Ownership
| Absolute path | Action | Exclusive owner |
|---|---|---|
| `/home/loidinh/WS/dam-hopper/packages/ui/src/components/organisms/TraditionalTerminalProjectsDisplay.tsx` | Modify | Phase 04 |
| `/home/loidinh/WS/dam-hopper/packages/ui/browser-tests/terminal-traditional-projects.browser.tsx` | Modify | Phase 04 |
| `/home/loidinh/WS/dam-hopper/packages/ui/browser-tests/terminal-traditional-projects.browser-fixture.tsx` | Modify | Phase 04 |
| `/home/loidinh/WS/dam-hopper/packages/ui/e2e/traditional-terminal-agents/traditional-terminal-agents.spec.ts` | Create/proposed | Phase 04 |
| `/home/loidinh/WS/dam-hopper/packages/ui/e2e/traditional-terminal-agents/evidence.json` | Create/proposed | Phase 04 |
| `/home/loidinh/WS/dam-hopper/packages/ui/e2e/traditional-terminal-agents/review.md` | Create/proposed | Phase 04 |
| `/home/loidinh/WS/dam-hopper/packages/ui/e2e/traditional-terminal-agents/screenshot.png` | Create/proposed | Phase 04 |
| `/home/loidinh/WS/dam-hopper/packages/ui/e2e/traditional-terminal-agents/compact.png` | Create/proposed | Phase 04 |
| `/home/loidinh/WS/dam-hopper/plans/261008-0233-traditional-terminal-agents-sidebar/reports/04-runtime-qualification.md` | Create/proposed | Phase 04 |
| `/home/loidinh/WS/dam-hopper/docs/system-architecture.md` | Modify after implementation | Phase 04 |
| `/home/loidinh/WS/dam-hopper/docs/codebase-summary.md` | Modify after implementation | Phase 04 |
| `/home/loidinh/WS/dam-hopper/docs/project-overview-pdr.md` | Modify after implementation | Phase 04 |
| `/home/loidinh/WS/dam-hopper/docs/architecture/agent-status.md` | Modify after implementation | Phase 04 |
| `/home/loidinh/WS/dam-hopper/docs/CHANGELOG.md` | Modify after implementation | Phase 04 |
No deletions/new shared fixtures/runner configs. Standard runner temporary outputs are not hand-authored deliverables; do not commit screenshots/traces outside the exact owned evidence paths.

## Implementation Steps
1. Consume completed slices only after all three are available. Integrator supplies frozen imports, no optional-behavior shim/new DTO. If shared contract needs correction, coordinate owner; do not edit sibling files unilaterally.
2. Add reactive status/profile/connection capture and memoized builder in display; validate current terminal identity and selected Settings owner. Status notifications/preferences remain untouched.
3. Supply props to desktop/compact navigator; add latest-member guarded exact-session handler + compact dismissal. Preserve current project/New terminal target and layout/buffer/PTY routing.
4. Add explicit compact opener restoration via forwarded onCloseAutoFocus and opener ref. Size all local compact controls >=44px, including shared close through scoped DialogContent direct-child utilities. Update sheet title/description to reflect Projects + Agents without changing project tab/panel semantics.
5. Extend existing browser fixture with concrete qualified refs/incarnations/current connection snapshots/status store baselines and cleanup. Existing shell-only project regressions remain. Wrap routing where Settings Link requires Router; fixtures do not impersonate actual CLI ingress.
6. Extend browser suite for cross-project exact agent vs remembered other tab, nonfocused split pane, compact row activation/dismissal/focus trap/restore, stale callback after removal/restart, row-focus stability under status changes, generation-only change readiness, disabled policy and duplicate-profile IDs.
7. Author actual-app E2E journey using existing authenticated application fixture/seeding and capture helpers, not mocked component/REST status responses. Assert real Projects+Agents sections, shell exclusion/empty Settings entry, profile URL/denial, project/split/terminal continuity via visible app controls. Do not fake private ingress/hook credentials merely to populate screenshots.
8. Qualify live supported harnesses in the actual shared app on isolated authenticated Linux server(s), using existing Agent Settings to explicitly verify/configure managed OMP/Codex/Claude. Supported CLIs/model credentials are environment prerequisites; current application image does not provision them automatically. Use existing integration installation/user actions, not backend/test-hook changes. Automated E2E without a real harness is only app-navigation coverage; the separate live-harness matrix below remains mandatory.
9. After complete integration, execute the narrow commands below once; no sibling check storm. Record observed failures/limitations and fix real owned-source defects without suppressing them. Any later recheck should target an actual correction, not re-confirm known failures.
10. Run actual-app matrix below, capture full application wide+compact in exact owned paths using existing capture/provenance helpers, inspect screenshots with human reviewer. Where automated fixture captures are empty-roster navigation evidence, final roster captures must additionally come from real managed harness app smoke, not fixture injection. Publish final hashes/environment matching the accepted captures.
11. Reconcile architecture against implementation; update five owned docs/changelog with explicit primary Idle/Working vs secondary turn-ended hint, profile/generation denial, native limitations, unchanged backend/notifications and exact exercised qualification. Keep pending/unqualified if any mandatory runtime/human gate remains blocked.
12. Remove author-created throwaway scaffolds; retain only focused permanent behavioral regressions. Publish <=150-line runtime report with commands/results, platform/provider versions, scenario evidence, notification/snapshot observations and remaining blockers/questions. Do not fabricate pass counts or mark complete solely from component mocks.

### Deferred verification commands (execute only after integration)
All paths relative to `packages/ui`; commands issued from repo root. Manifest scripts already exist; no config/tool additions.

```sh
pnpm --filter @dam-hopper/ui test src/lib/traditional-terminal-agents.test.ts src/lib/agent-store-navigation.test.ts src/components/molecules/traditional-terminal-agent-row.test.tsx src/components/organisms/TraditionalTerminalProjectsNavigator.test.tsx src/components/pages/AgentStorePage.test.tsx
pnpm --filter @dam-hopper/ui build
pnpm --filter @dam-hopper/ui exec vitest run --config vitest.browser.config.ts browser-tests/terminal-traditional-projects.browser.tsx
pnpm --filter @dam-hopper/ui test:e2e:typecheck
E2E_CAPTURE=1 pnpm --filter @dam-hopper/ui test:e2e e2e/traditional-terminal-agents/traditional-terminal-agents.spec.ts
```
The existing `test:browser` script chains two configs; direct package-local Vitest invocation uses its first existing config to run the exact changed suite without appending a filter only to the second command. Browser executable settings follow config; no guessed Chromium overrides. No broad backend suite/lint/formatter warranted by this pure UI cutover. Existing app fixture may build production images as its real-runtime prerequisite; this is phase-4 verification, never planning.

### Actual-app mandatory scenario matrix
| Scenario | Required user-visible evidence |
|---|---|
| Wide two-section layout | Projects retain all tabs/counts/Git summary; roster includes admitted supported harnesses with title/project/profile context; full viewport capture |
| Managed OMP working -> idle/ended | Primary Working then Idle; explicit lastOutcome ended/no turn yields secondary hint; next turn clears hint; no success claim |
| Real attention | OMP or qualified Claude approval/question/error shows Needs attention + reason; no automatic acknowledgment/policy changes |
| Native Codex + Claude | Both observed when admitted; source/limited coverage explained; native Stop/quiet reasoning/lease expiry becomes Unknown, never invented Idle/Done; settings inventory distinct |
| Notifications disabled | Status/roster/hint still update; no new toast/sound/browser alerts; previously-existing policy remains unchanged |
| Reconnect/silent snapshot | Known exact rows unavailable before new ready baseline; same-profile generation change reacts; ended snapshot may show historical hint silently; removed snapshot members pruned |
| Duplicate IDs across profiles | Isolated servers with same remote terminal ID; exact owner rows and click targets distinct; if true collision setup unavailable, record actual-app gate blocked rather than substitute names |
| Split/project selection | Other terminal remembered in target project; agent click still selects exact nonfocused split target; pane membership/layout/PTY identity/output buffer preserved |
| Compact keyboard/touch | Both sections reachable at compact width; >=44px opener/add/row/link/close; Tab/Shift+Tab trapped, Escape/close/project Arrow/agent Enter+Space dismiss and restore opener; full viewport sheet capture |
| Profile route denial | Selected B link reaches Settings B despite active A; explicit disconnected/removed/unknown/empty never uses A, no-owner asks choice; generation replacement re-resolves B before API work |
| Identity retirement | Close/restart removes old-instance eligibility; retained stale click cannot select replacement or unknown ID; no second terminal mount |

Use benign prompts/test projects and existing supported version qualifications (documented OMP 18.4.1, Codex 0.158.0, Claude Code 2.1.250; record actual versions exercised). No blanket claim for other platforms/versions/native desktop. True collision and lease/reconnect scenarios can use isolated deployment controls; do not change server protocol to make tests easier. Raw prompts/credentials/private endpoint URLs must not enter qualification report or captures.

## Todo list
- [ ] Integrate model, navigator and Settings href into both display surfaces.
- [ ] Guard exact-session activation, compact focus/dismissal and 44px local controls.
- [ ] Author browser fixture/regressions and actual-app E2E journey.
- [ ] Execute one post-integration targeted gate pass + mandatory live-harness smoke.
- [ ] Publish owned captures/provenance/human decision/runtime report; reconcile five docs/changelog.

## Success Criteria
- Phases 1–3 consumer interfaces integrated end to end, no partial OMP-only roster or owner fallback.
- Every mandatory scenario has observed actual-app result; browser fixture coverage explicitly separate. Targeted checks and screenshot human decision recorded, not inferred.
- New roster independent of notifications and silent snapshots never create alerts; Idle/Working/Done meaning preserved for all supported observed kinds.
- Exact existing terminal/project/split selection preserves PTY/buffer/layout; compact sheet accessibility proven, stable row focus and no second terminal mount.
- Documentation describes implemented behavior only after cutover and qualification; actual failed/unexercised gates remain pending/unqualified. Runtime prerequisites unavailable is a blocker, not task-success evidence.

## Conflict Prevention
- Own listed 14 paths only; phase 1/2/3 source/tests remain with their assigned owners. Integration corrections there routed to that owner before touching files.
- No WorkspacePage/terminal grouping/store/hooks/API/backend/db/shared Dialog/CSS edits; existing callbacks and local utilities suffice. Any genuinely required extra path needs reviewed ownership update before implementation, not silent scope expansion.
- Capture policy metadata/human review and report written once by integrator; do not let independent screenshots overwrite final accepted artifacts. Never rewrite research reports as runtime evidence.

## Risk Assessment
- Group fallback/optional incarnation/retained generation: strict builder plus current subscribed snapshot, negative identity/browser cases.
- Stale callback/session replacement: offered instance key vs latest committed membership gate before selection hook.
- Dialog focus or scroll regression: local opener restoration, actual trap/dismiss tests and full compact human review.
- Real CLI/credentials/colliding-ID environment missing: exact qualification blocker documented; no mock substituted for real gate or broader installed-version claim.
- Capture screenshots show no real agent or stale run: current hash/provenance/environment and human decision, match actual supported-harness app smoke.

## Security Considerations
- No private terminal content/commands/cwd/credentials/provider paths in status rows/report; benign visible test projects for captures. UI labels escaped normally.
- Capture explicit profile before link/API work, deny invalid before query mount; no global active-profile mutation/notification enable/install automatically.
- Do not loosen native Unix peer-credential/ancestry checks or expose private loopback reporter to browser tests. Authentication stays production-like; no --no-auth qualification shortcut.
- Feature is navigation/presentation, not authorization/task-success/platform-certification boundary.

## Next steps
- Review actual evidence and reconcile plan statuses only after mandatory gates; parent owns completion publication. No advice controller run initialized here.
- Unresolved product questions: fixed/collapsible sections, global/filter roster, `Done (turn ended)`/`Last turn ended` copy; safe defaults already specified. Environment question for execution: supported managed harness credentials/runtime and two isolated profiles needed for full qualification; unavailable prerequisites must be reported exactly.
