# Phase 02 — Projects/Agents navigator and agent row

## Context links
- [Overview/exclusive ownership](plan.md), [frozen component contracts](contracts.md#phase-2-component-interfaces), [main contract](reports/02-planner-contract.md).
- [UX research](research/researcher-01-report.md), [code evidence](reports/01-codebase-analysis.md), [risk review M1/M2](reports/03-design-risk-review.md).
- Read-only sources: `packages/ui/src/lib/traditional-terminal-projects.ts`, `packages/ui/src/components/atoms/ProfileBadge.tsx`, `packages/ui/src/components/atoms/AgentStatusBadge.tsx`, `packages/ui/src/components/organisms/TraditionalTerminalProjectsDisplay.tsx`, `packages/ui/src/components/organisms/TerminalTabBar.tsx`, `packages/ui/src/index.css`.
- Standards: `docs/code-standards.md`, `docs/codebase-summary.md`, `docs/system-architecture.md`, `docs/project-overview-pdr.md`.

## Parallelization Info
- Group A; independent authoring with phases 1/3. Use frozen row type as type-only import; do not wait for runtime builder to design/render the component.
- Owns 4 exact paths. Display glue and compact Dialog remain exclusively phase 4; route policy exclusively phase 3.
- Local render fixtures only; no global shared fixtures or query/store edits. Tests authored, not run until phase 4 integration.

## Overview
- Date: 2026-10-08. Priority: P2. Estimate: 4h.
- Description: Add distinct Agents section while preserving full existing Projects navigation and accessible interactions.
- Implementation status: authored, validated, user-approved; controller completion pending (NOT DONE). Review status: cycle 2 terminal reviewer 9/10 approved, canonical advice ADVICE_READY, user approved.

## Delivered Implementation & APIs
- Extended organism `TraditionalTerminalProjectsNavigator` (`packages/ui/src/components/organisms/TraditionalTerminalProjectsNavigator.tsx`):
  - Preserves existing Projects roving tablist, counts, git summaries, profile badges, and `onNewTerminal`.
  - Added optional frozen props: `agentRows?: readonly TraditionalTerminalAgentRowModel[]`, `activeSessionId?: string | null`, `onSelectAgent?: (sessionId: string) => void`, `agentSettingsHref?: string`.
  - Distinct bounded Agents section: `<section aria-labelledby={agentsHeadingId}>`, `Agent Settings` Link with >=44px touch target (`min-h-11 min-w-11`), `<fieldset disabled={!onSelectAgent}>`, `ul aria-label="Observed agents in open terminals"`, mapped rows with key `row.key`, active indicator `row.sessionId === activeSessionId`, and explanatory empty state when zero rows.
- Delivered molecule `TraditionalTerminalAgentRow` (`packages/ui/src/components/molecules/traditional-terminal-agent-row.tsx`):
  - Exports `TraditionalTerminalAgentRowProps` and `TraditionalTerminalAgentRow`.
  - Single accessible button with `aria-label` detailing harness, title, project, server profile, status, reason; `aria-describedby` referencing sr-only explanation with source, coverage hint, and outcome explanation ("Last turn ended; task success has not been verified."); `aria-current="true"` on active.
  - Accessible hook coverage explanation: sr-only and title tooltip explicitly convey limited hook coverage ("Hook observation (limited coverage; quiet reasoning and long waits become Unknown)").
  - Compact touch sizing: >=44px (`min-h-11 min-w-11`, `min-h-12` when touchOptimized).
  - Status presentation with Lucide icons (Activity, Circle, CircleAlert, CircleHelp, Unplug, TriangleAlert, Ban); visually secondary outcome hint without success check.

## Scoped Validation & Verification Links
- Scoped actual validation links: [Batch A Validation Report — Actual validation](reports/07-batch-a-validation.md#actual-validation) and [Post-correction evidence](reports/07-batch-a-validation.md#post-correction-evidence).
- Test evidence: 11 tests in `TraditionalTerminalProjectsNavigator.test.tsx` and 4 focused behavioral tests in `traditional-terminal-agent-row.test.tsx` (15 tests total) passing; verified in full UI suite (326/326 files, 2694/2694 tests pass, UI build exit 0). No synthetic fake keyboard clicks.
- Actual browser smoke: Isolated component smoke in fresh Vite UI verified native Enter and Space activation once with exact qualified session ID; compact row measured 350 × 121.4 px, Settings link 116.8 × 44 px; Projects-first / Agents-second layout confirmed at wide and compact viewports.
- Scoped qualification limits: Component interactions and isolated smoke verified; compact sheet focus restoration, live ingress, and integrated application qualification remain phase 4-owned.

## Key Insights
- Herdr supplies conceptual roster/navigation inspiration only. Its done/unseen acknowledgment, screen parsing, rollups, summaries and audio are NOT DamHopper requirements.
- Projects' roving tablist controls existing project panels; agent rows are exact terminal actions, not project tabs.
- Existing shared badge has Running label and its own subscriptions; new row should render frozen generation-safe presentation directly, without changing the shared badge or rejoining via weaker hooks.
- Navigator is reused in compact sheet and desktop; screen-specific integration/focus restoration belongs to phase 4.

## Requirements
- Preserve current `TraditionalTerminalProjectsNavigator` export/props; add exact optional `agentRows`, `activeSessionId`, `onSelectAgent`, `agentSettingsHref` from contracts. Phase 4 supplies these explicitly to both instances.
- Existing Projects first, complete membership/counts/Git summary/profile context and New terminal action untouched semantically. Visible second Agents section, flat current order, no status-driven sort/filter/collapse.
- Reusable `TraditionalTerminalAgentRow` with exact props/export in proposed kebab-case molecule file. Render model supplied by caller; no API/status-store/connection subscription or navigation policy.
- All observed OMP/Codex/Claude, unavailable/unknown states, source/reason context and strictly secondary Done hint supplied by model. No task success copy or seen behavior.
- Explanatory empty state and Agent Settings link even with zero observed rows. No installed inventory rows, generic agent registration or launch action.
- Accessible text/icons, bounded scrolling/truncation, stable row keys/focus and >=44px compact controls including New terminal/link; status changes must not steal focus.

## Architecture
- Existing nav becomes flex container with labeled Projects and Agents sections; retain project button IDs/aria-controls/roving keys and controlled project selected state.
- Both lists are `min-h-0` overflow regions, headers/actions reachable within available height. Resize width remains supplied externally; do not create another resize/storage mechanism.
- Agents `ul`/`li` ordinary buttons; each action emits exact qualified `sessionId`. `aria-current="true"` marks active terminal; never assign tab role or project-panel control relation to agent button.
- Row uses `row.key` (qualified instance tuple) for React identity, human labels for title/harness/project/profile, and frozen presentation for semantic/availability/reason/hint. Source explanation remains available to assistive technologies/tooltips; no internal status IDs/commands/native paths.
- No nested actions in row; single section settings Link supplied by caller href. React Router Link resolves in existing routing context, not a whole app reload. Missing selection callback disables row action during isolated additive authoring; no fake click behavior.
- Native hook limited-coverage hint stays explainable. Done is visually secondary to Idle with no success-check icon/green success claim. Use existing theme tokens, focus-visible styles and min-h/min-w 44px touch targets.

## Related code files
- Modify `/home/loidinh/WS/dam-hopper/packages/ui/src/components/organisms/TraditionalTerminalProjectsNavigator.tsx` — preserve Projects, add Agents rendering/action props.
- Modify `/home/loidinh/WS/dam-hopper/packages/ui/src/components/organisms/TraditionalTerminalProjectsNavigator.test.tsx` — navigator behavior, settings action and project regressions.
- Create/proposed `/home/loidinh/WS/dam-hopper/packages/ui/src/components/molecules/traditional-terminal-agent-row.tsx` — reusable presentational row.
- Create/proposed `/home/loidinh/WS/dam-hopper/packages/ui/src/components/molecules/traditional-terminal-agent-row.test.tsx` — accessible row behavior and update stability.
- Parent-owned applied correction: deleted `packages/ui/src/filename-conventions.test.ts`, an incidental filesystem spelling assertion with no consumer behavior that rejected the frozen kebab-case row path. Deletion applied and validated by parent under accepted correction action (run 8f7a871c-e7f2-4ede-b024-b8aaf0dca977), preserving frozen kebab-case molecule path without fake keyboard tests or API renaming.

## File Ownership
| Absolute path | Action | Exclusive owner |
|---|---|---|
| `/home/loidinh/WS/dam-hopper/packages/ui/src/components/organisms/TraditionalTerminalProjectsNavigator.tsx` | Modify | Phase 02 |
| `/home/loidinh/WS/dam-hopper/packages/ui/src/components/organisms/TraditionalTerminalProjectsNavigator.test.tsx` | Modify | Phase 02 |
| `/home/loidinh/WS/dam-hopper/packages/ui/src/components/molecules/traditional-terminal-agent-row.tsx` | Create/proposed | Phase 02 |
| `/home/loidinh/WS/dam-hopper/packages/ui/src/components/molecules/traditional-terminal-agent-row.test.tsx` | Create/proposed | Phase 02 |
Parent executed the approved filename-test deletion noted above under correction action. No shared CSS/component/store modifications. Existing source paths verified in evidence; kebab-case molecule paths implemented.

## Implementation Steps
1. Add optional frozen props/default empty rows to existing navigator without touching display callsites. Import model type with alias `TraditionalTerminalAgentRowModel` where necessary to avoid value/type-name collision with component.
2. Implement molecule with named export and one real button; callback exact sessionId, active aria-current, full context accessible name, supplied primary/reason/source/coverage/hint. No own status interpretation/joins or success/unseen state.
3. Split navigator render into bounded Projects-first and Agents-second sections. Keep existing project tab IDs/Git summary queries/counts/profile badge and Arrow/Home/End behavior; preserve project role relationships.
4. Map agent rows in input order using instance key; section link uses supplied href only. Render explanatory empty state with supported harness names/Settings link without implying installations or absence on unopened terminals.
5. Apply >=44px compact row/link/New terminal targets locally. Preserve resize width and dark-theme tokens; leave compact opener/Dialog close sizing to integrator.
6. Extend navigator tests with MemoryRouter when Link used. Exercise full project membership/counts/Git summary/onNewTerminal and existing project keyboard semantics plus distinct agent button list and exact qualified callback/active marker.
7. Add row behavior tests: click/Enter/Space emit once to supplied session; context supports duplicate titles in different project/profile; unavailable/Unknown supplied presentation retained; blocked reason and hook explanation accessible; Idle+hint remains secondary/no success claim.
8. Rerender rows with changed status, same identity; focused button/order remain. Empty roster still exposes Settings href; optional missing callback cannot accidentally act. Test user-visible behavior, not Tailwind strings, DOM nesting snapshots or incidental wording.
9. Remove obsolete incidental text assertions affected by vocabulary only; replace only where real behavioral requirement exists. No broad test rewrite or visual screenshot baseline in this phase.
10. Deliver complete 4-path slice for phase 4. No tests/build/lint/formatters during authoring; browser/integration evidence belongs to phase 4.

## Todo list
- [x] Implement reusable accessible row against frozen presentation model.
- [x] Add bounded second section and supplied Settings Link, retain Projects semantics.
- [x] Author project/navigation/row interaction and focus-stability cases.
- [x] Hand off all owned files with unchanged consumer signatures.

## Success Criteria
- Project tabs retain every terminal and their existing semantics; agent row actions are a separate accessible list.
- Every row shows enough title/harness/project/profile/status/reason/source information to distinguish mixed-profile sessions without internal/private identifiers.
- Working/Idle/Needs attention/Unknown/availability visibly distinct; supplied Done remains secondary explicit turn-ended fact, not verified success.
- Status updates preserve order/focus; empty state provides profile-qualified/chooser Settings href from caller. Compact controls owned here >=44px.
- Tests demonstrate plausible user behavior; phase 4 later certifies actual sheet focus, layout and session navigation.

## Conflict Prevention
- Never edit `TraditionalTerminalProjectsDisplay.tsx`, phase 1 builder/tests, Agent Store route/helper, browser fixtures, docs or global Dialog/CSS.
- Consume frozen shape; do not add per-row store subscriptions, signature adapters, shared UI badge changes or generic roster framework.
- No duplicate terminal render/mount; navigator does not own PTY or selection state.

## Risk Assessment
- Projects lose space in constrained sidebar: bounded independent scrolling, verify real wide/compact later; no guessed fixed panel heights.
- Agent buttons treated as project tabs: distinct list/button semantics and callbacks.
- Multiple similarly named sessions: project/profile + full terminal title retained accessibly.
- Chatty status announcements/focus drift: no aggressive aria-live, stable keys and no sorting.

## Security Considerations
- Labels React-escaped; no HTML injection, transcript/command/native-path read or logging.
- Settings href received from validated integrator, not rebuilt from display label. Row action receives qualified session only; final membership/identity check belongs to phase 4.
- No notification acknowledgment, settings mutation, install or auto-connect action.

## Next steps
- Phase 4 plugs complete model/route consumers into both navigator instances and qualifies sheet/PTY/split behavior.
- Optional unresolved product preferences: fixed vs collapsible sections, global vs project-filtered roster, turn-ended wording. Current defaults remain fixed/global/Done (turn ended); no technical blocker.
