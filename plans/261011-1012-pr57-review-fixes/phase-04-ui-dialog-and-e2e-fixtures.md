# Phase 04 — UI dialog and E2E fixtures

## Context links
- [Overview](plan.md); [Phase 01 cancellation/timer behavior](phase-01-coordinator-admission-and-cooldown.md); [Phase 03 real public presence](phase-03-websocket-presence-and-backpressure.md).
- [Original consent/API contract](../261010-1746-host-resources-auto-sleep/contracts.md#consent-lifecycle--immediate-first-valid-decision-wins).
- [UI status guidance](../../docs/idle-suspend-status-ui.md); [testing tiers](../../docs/testing.md); [WebSocket/API](../../docs/api/idle-suspend.md).

## Overview
- Date: 2026-10-11. Priority: P2. Estimated effort: 4h.
- Implementation: complete. Review: complete. Validation: passed.
- Issues: **9** cancelled request retaining a historical approve decision renders Approved; **10** application fixture never selects agent-free and browser spec asserts nonexistent DOM/incorrect dialog role while conditionally skipping navigation.

## Key Insights
- Dialog summary (`HostSleepConsentDialog.tsx:62–71`) checks `effectiveDecision === approve` before lifecycle cancelled/expired. Server may legitimately keep the accepted decision while later revoking authorization.
- Hook already prefers authoritative nonpending `consent.state` (`use-host-sleep-consent.ts:227–231`); fix presentation precedence, not server decision history or first-answer rules.
- Fixture service accepts auth options only (`application-services.ts:17–25`) and calls `createSeedTree()` without options (`112`). Seed TOML (`application-data.ts:118–129`) has no `[server.idle_suspend]`, so the spec cannot assume agent-free `clientPresence` fields.
- `HostSleepConsentHost` is always mounted in React but returns `null` without an active item (`HostSleepConsentHost.tsx:15–17`). There is no `data-testid=host-sleep-consent-host` DOM root.
- Dialog uses shared Radix `Dialog`, not an `alertdialog` with a custom sleep-consent ID. Existing spec's absence query can pass without testing the actual dialog.
- Spec navigation at `46–73` is conditional. Screenshot-only checkpoints do not prove presence, request handling, multi-user consent or hardware sleep.

## Requirements
### Functional
- Cancelled/expired/denied lifecycle drives settled banner even when decision field contains prior approve/deny; accepted decision is history, not current authorization.
- Preserve active approval/final-check and genuinely handed-off wording; no postapproval dismiss action sends a contrary decision.
- Fixture opts in to real startup `agent-free` config with fixed 10,800s quiet and valid wake value; default fixture behavior remains unchanged for unrelated suites.
- E2E asserts actual authoritative status and public socket presence through mandatory intended surfaces, with accessible real selectors and no fabricated host DOM contract.
- Test name/report matches measured scope: configured policy/status/presence/layout, not consent decisions or physical suspend unless actually exercised.
### Non-functional
- Keep owner/generation/request isolation, Cognito suppression, no automatic decision retries, countdown and accessibility patterns.
- Use existing seed builder, auth seed, service isolation and capture tooling. No test-only production route, clock override, shortened quiet period or fake backend response.
- Tests remain deterministic, bounded and safe on ordinary CI containers.

## Architecture
### State-first summary projection
Use a local switch on `item.effectiveState` inside the existing component; no new hook/store/summary abstraction for one expression.

| Effective state | Historical decision | Presentation |
|---|---|---|
| cancelled | any, including approve | Request cancelled — Automatic sleep check reset |
| expired | any | Request expired unanswered — Automatic sleep deferred for 3 hours |
| denied | any | Decision settled: Denied — Automatic sleep deferred for 3 hours |
| approved | approve / accepted local decision | Existing Approved waiting-for-final-check text; actual handed-off state uses existing cannot-cancel text |
| pending | null / in-flight | Existing pending/countdown/buttons; no settled success banner |

Do not clear the server `decision` just to make the summary work. Current hook's `isSettled` determines actions; terminal state remains nonactionable. If a helper is used at all, keep it colocated and pure. Keep source of handed-off authority in existing server phase/state rather than invent a local handoff flag.

### Typed startup fixture option
Add narrow `idleSuspendPolicy?: "agent-free"` to existing service and seed configurations, forwarding it from `startApplicationServices` into `createSeedTree`. No raw TOML/string/CLI override API.

- Omitted option preserves exact existing seed configuration and other journeys' legacy expectations.
- Opt-in generates one canonical TOML block **before** copying/seeding/starting server:

```toml
[server.idle_suspend]
enabled = true
automatic_policy = "agent-free"
quiet_period_seconds = 10800
wake_after_seconds = 600
```

- Serialize only this closed typed option; no user-supplied arbitrary TOML insertion. Keep helper enrollment absent and container unprivileged; existing unavailable helper behavior must remain fail-closed.
- Include the block in original `tomlContent` and `seedDigest`, not a later mutation that misrepresents captured configuration.
- Preserve SQLite seeding/auth backend selection and dedicated MFA key permissions. No environment leakage or no-auth downgrade.

### Truthful application journey
The repaired spec selects `{ authBackend: "sqlite", idleSuspendPolicy: "agent-free" }` before service startup and checks:
1. Authenticated status: version 1, enabled, automaticPolicy agent-free, quietPeriodSeconds 10800, valid nonnull agentFree/clientPresence, legacy activity absent/null as specified.
2. Real socket count eventually positive after authenticated page connects, using `expect.poll` around real GET. Connection count is membership, not proof of approval; account for exact known pages without guessing a fixed zero at startup.
3. Workspace/IDE, Traditional Terminal and required nonworkspace route navigation all occur through asserted visible controls. Missing controls fail rather than silently skip; assert each destination actually mounted.
4. Presence remains available/positive through route changes; Host Resources trigger (`aria-label` prefix `Host resources:`) opens real status surface showing Agent-Free policy and scope notice.
5. Query real consent dialog via `getByRole("dialog", { name: "Automatic Host Sleep Request" })`; no active request means absent. Do not assert a DOM node for an inactive React host or add a permanent wrapper solely to satisfy the test.
6. Capture desktop/narrow/compact full viewport through existing evidence helper, with assertions of intended UI readiness before each checkpoint instead of `waitForTimeout(300)`.

This bounded production journey does not wait three hours or fabricate pending consent. Rename its title/description to configured agent-free status and multi-surface presence. Actual request transitions/decision/approval cancellation are covered by deterministic backend and focused UI tests. Existing always-mounted host integration is covered by source mount plus focused component tests; absence of dialog alone must not be reported as full application consent qualification.

## Related code files
| Action | File and researched lines | Purpose |
|---|---|---|
| Modify | `packages/ui/src/components/organisms/HostSleepConsentDialog.tsx:54–71` | Authoritative lifecycle-first summary |
| Modify | `packages/ui/src/components/organisms/HostSleepConsentHost.test.tsx:250–291,480–590` | Pending → approved → cancelled/expired regression and no extra POST |
| Reference / intentionally unchanged | `packages/ui/src/hooks/use-host-sleep-consent.ts:204–231,340–425` | Existing authoritative state precedence and settled dismiss behavior |
| Reference / intentionally unchanged | `packages/ui/src/components/organisms/HostSleepConsentHost.tsx:10–29`, `packages/ui/src/embed/dam-hopper-app.tsx:371–373` | Actual conditional DOM / stable shared React mount |
| Modify | `packages/ui/e2e/fixtures/application-services.ts:17–25,111–112,216–253` | Typed startup policy option forwarded before server start |
| Modify | `packages/ui/e2e/fixtures/application-data.ts:20–27,118–129` | Generate agent-free TOML and correct seed digest |
| Modify | `packages/ui/e2e/fixtures/application-services.spec.ts:27–63,110–151` | Opt-in policy/auth/readback probe, retain default isolation behavior |
| Modify | `packages/ui/e2e/host-auto-sleep/host-auto-sleep.spec.ts:11–99` | Configure correct policy, remove nonexistent selectors/conditional skips, assert real status/presence |
| Reference / intentionally unchanged | `packages/ui/src/components/organisms/HostResourcePopover.tsx:282–329,528–531` | Existing accessible resources trigger and status surface |
| Reference / intentionally unchanged | `packages/ui/src/components/ui/Dialog.tsx`, `packages/ui/playwright.config.ts:30–44`, `packages/ui/e2e/fixtures/capture-evidence.ts` | Real dialog role, one-worker/probe routing and established evidence capture |
| Modify | `docs/idle-suspend-status-ui.md`, `docs/testing.md`, `docs/CHANGELOG.md` | Lifecycle precedence, fixture option, truthful tier-specific evidence scope |

No new production component, route or permanent host wrapper. No deleted files. Regenerate only requested scenario evidence through normal capture tooling; never hand-edit screenshot results or manufacture human review.

## Implementation Steps
1. Replace decision-first ternary with state-first summary using current enums. Preserve exact existing approved/denied/expired/cancelled texts and handed-off wording; keep component changes local.
2. Extend existing HostSleepConsentHost test profile/status helper. First settle approve, then publish same request ID/revision with `state: cancelled`, `decision: approve`, blocked/deferred agentFree phase. Assert cancelled text, no Approved waiting banner and no extra decision POST on dismissal.
3. Cover expired/denied authoritative states, genuine approved/finalCheck/handedOff, owner-generation replacement and Cognito nonanswering. Reuse existing hook tests; no separate invented state machine.
4. Add narrow opt-in service/seed configuration. Build the complete TOML once before seed digest generation and copy; preserve default omission behavior and authenticated SQLite setup.
5. Add actual fixture probe asserting TOML readback and protected status match requested agent-free policy, fixed timing and nullable-field contract. Also assert unrelated default fixture remains unchanged.
6. Repair spec configuration, role/name locators and mandatory navigation. Assert server presence after initial connection and every surface change; replace unconditional sleeps with meaningful ready/status polling.
7. Open real Host Resources before evidence capture; prove policy/scope status and layout rather than only primary navigation. Rename journey to its actual measured coverage.
8. Run actual app and fixture probe only after backend lands, with existing Playwright one-worker profile and no hardware privileges. Update docs/changelog with actual measured qualification and limitations.

## Todo list
- [x] Render settled summary from lifecycle state before decision history.
- [x] Cover approve → cancelled/expired and no-extra-POST behavior.
- [x] Forward typed agent-free policy into canonical seed TOML/digest.
- [x] Repair E2E policy/status/presence assertions and real accessible selectors.
- [x] Make navigation/checkpoints mandatory and reports honest about exercised scope.

## Success Criteria
| Regression | Required observable result |
|---|---|
| `effectiveState=cancelled`, `effectiveDecision=approve` | Cancelled banner; no Approved/final-check banner; actions disabled/settled |
| Pending approval succeeds, later authoritative GET cancels same request | UI transitions to cancellation; closing does not POST deny/approve |
| Expired or denied lifecycle with historical decision | Correct terminal-state text; no false approval |
| Actual approved/finalCheck/handedOff | Existing truthful waiting/cannot-cancel wording retained |
| Default service config | Other suites retain original startup policy and seed behavior |
| Agent-free opt-in with SQLite | Readback TOML and protected status match enabled agent-free / 10800 / 600; no MongoDB container, no no-auth |
| Real page socket / route switches | Eventually available positive connection count through verified destinations; no conditional navigation pass |
| Inactive consent host | Actual dialog absent; no assertion of nonexistent host root or alertdialog ID |
| Host Resources desktop/narrow/compact | Real policy/scope UI visible and usable; full viewport evidence captured via existing tooling when enabled |
| Isolation/disposal | Owned containers/network/home disposed; no privileged helper/host suspend attempted |

Main-agent commands after integrated edits:
- `pnpm --filter @dam-hopper/ui test -- src/components/organisms/HostSleepConsentHost.test.tsx`
- `pnpm --filter @dam-hopper/ui build`
- `pnpm --filter @dam-hopper/ui test:e2e:typecheck`
- `pnpm --filter @dam-hopper/ui test:e2e:probes` (isolated container engine required)
- `pnpm --filter @dam-hopper/ui test:e2e -- host-auto-sleep/host-auto-sleep.spec.ts`

Planner runs none. CI capture stays controlled by existing E2E_CAPTURE policy; actual visual human review is a separate approval gate, not implied by test success.

## Risk Assessment
- **Optimistic history:** local approve survives in hook while authoritative lifecycle changes. State-first projection must win without weakening legitimate immediate accepted decision display.
- **Global fixture regression:** enabling agent-free by default changes unrelated specs. Keep explicit opt-in and test omitted-option behavior.
- **False E2E certainty:** a production container has no real enrolled suspend helper and cannot safely fast-forward `std::time::Instant`. Assert genuine status/presence only; do not add timer bypass endpoints or label a passive test full consent journey.
- **Navigation flakiness:** source component accessible roles/names are canonical. Fail on missing controls; assert surfaces, use expected polling, avoid optional branches and timing sleeps.
- **Evidence mismatch:** mutate fixture config before digest/copy/start; regenerate captures from actual app, not edited JSON/images.

## Security Considerations
- HTTP accepted approve is not completed physical suspend. Cancelled lifecycle must not promise an active authorization or cancellation of a genuinely committed helper request.
- Keep receipt/capability in exact transport memory; never inject capabilities into test snapshot/evidence files or persistent browser storage.
- Use real authenticated SQLite sessions, dedicated owner-only MFA key, isolated home/network. Do not expose host helper/systemd sockets or add privileged container flags.
- Fixture option is closed/typed; no arbitrary shell argument or TOML text injection. No status response mocks in production application journey.

## Next steps
Parent runs integrated Rust/UI/application gates once, obtains focused review and records each of the ten issue results. Publish truthful current docs/changelog; preserve historical feature evidence rather than rewriting it as proof of these fixes.

## Unresolved questions
None blocking. Full production pending-consent/decision journey and physical suspend require separately provisioned safe deployment qualification; this fixture repair does not claim them.
