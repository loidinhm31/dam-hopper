# Phase 04 — Verification and testing

## Context links

- [Plan overview](./plan.md)
- [Phase 01 state contract](./phase-01-multi-profile-state-and-hooks.md)
- [Phase 02 component contract](./phase-02-fleet-deck-and-card-components.md)
- [Phase 03 integration contract](./phase-03-host-resource-popover-integration.md)
- [Repository testing guidance](../../AGENTS.md#testing-guidelines)
- [Existing Host Resources browser suite](../../packages/ui/browser-tests/host-resource-monitoring.browser.tsx)
- [Current architecture](../../docs/system-architecture.md#host-resource-monitoring-current-delivery-generic-remediation-deferred)

## Overview

- Date: 2026-09-20
- Priority: P2
- Plan status: Pending
- Implementation status: Not started
- Review status: Not started
- Effort: 4h
- Goal: prove watch scope, owner isolation, tiered polling, user flow, accessibility, and single-profile compatibility with focused durable tests.

## Key Insights

- Query-cache ownership/generation and polling cadence are observable contracts worth unit coverage; Tailwind class strings and helper wiring are not.
- Existing jsdom hook tests already model connection generation replacement. Reuse `QueryClientProvider`, fake timers, profile/connection listeners, and owner-key invalidation.
- Existing Chromium suite already proves popover focus trap, Escape restoration, 44px controls, safe areas, long text, contrast, and narrow/desktop layouts. Extend it; do not create a second browser harness.
- Multi-profile unit fixtures must use duplicate profile/host/incident identifiers to catch accidental joins by display data.
- Automated tests must never invoke real suspend, RTC, profile credentials, or remote hosts. Force-suspend remains mocked/fake only.

## Requirements

### Unit/hook coverage

- Automatic scope union: connected manual, connected auto-connect, disconnected auto-connect included; disconnected manual excluded.
- Profile order stable; zero profiles and storage/profile read failures explicit.
- Canonical owner/generation query keys; one query failure independent; stale delayed response rejected after generation change/removal/disconnect.
- 15s snapshot cadence only for connected watched rows; offline auto-connect row sends no request.
- `byProfile` unread aggregation with duplicate incident IDs; per-profile mark/reset leaves peers unchanged.
- Fleet summary severity/unavailable precedence, counts, empty state, and no metric averaging.
- Card finite/unavailable/last-known rendering and connected-only inspection semantics.
- Single configured profile and explicit owner retain current popover behavior.

### Component/browser coverage

- Fleet opens by default only for multiple configured profiles.
- Header Fleet/profile pills expose names/state/pressed semantics and switch views by pointer, Enter, and Space.
- Opening Fleet clears no unread buckets; inspecting A clears A only; B remains unread.
- Switching A -> B binds displayed host, pin mutation, idle-suspend, and force-sleep endpoint label to B.
- Only selected visible drilldown enables `useHostMetrics`; close/Fleet/disconnect disables it.
- Removal/disconnect/generation replacement while inspecting returns to Fleet without cross-profile content.
- Focus remains trapped across deck/drilldown, lands on persistent context after card activation, and returns to trigger on Escape/close.
- 320x700 and 1280x800 have no horizontal/page overflow, clipped cards, unreachable controls, or sub-44px targets.
- Long duplicate names/URLs/hostnames remain distinguishable and escaped.

### Preflight contract

Before adding tests, retain existing behavior-based assertions that defend current single-profile contracts. Delete only assertions made obsolete by approved multi-profile markup; replace them with user-observable semantics, not class/source-text checks. Use existing Vitest/jsdom/Chromium dependencies only.

## Architecture

### Test layers

```text
pure helpers
  -> scope/reason + fleet status/count precedence
hook + QueryClient
  -> subscriptions, useQueries keys, generations, cadence, partial failure
SSR/jsdom components
  -> card/deck semantics and single-profile compatibility
Chromium
  -> real keyboard/focus/layout/view switching
post-implementation review
  -> code vs owner/query/action invariants in system architecture
```

### Durable assertions

Prefer role/name/state assertions:

- `button` named `Fleet`, `aria-pressed` state.
- `button` named `Inspect host resources for …` only for connected entries.
- visible `Offline`, `Last known`, `Critical`, `2 unread` labels.
- dialog/heading relationships and focus target.
- invocation counts/owners over fake time.
- QueryClient data under `profileQueryKey(owner, "system", "resource-snapshot")`.

Avoid exact DOM snapshots, Tailwind classes, hook call order, internal array length without semantics, or source-text assertions.

## Related code files

| File | Action | Purpose |
|---|---|---|
| `packages/ui/src/hooks/use-multi-host-resources.test.tsx` | Create | Scope, `useQueries`, generation fencing, polling, partial failure, per-profile alert integration. |
| `packages/ui/src/lib/host-resource-state.test.ts` | Modify | Pure fleet summary/watch reason precedence and edge cases. |
| `packages/ui/src/hooks/use-host-resource-alert-presentation.test.tsx` | Modify | Duplicate IDs across profiles, per-profile acknowledgement/reset, bounded state compatibility. |
| `packages/ui/src/components/organisms/HostResourceFleetCard.test.tsx` | Create | Semantic rendering, finite values, offline/last-known, connected-only action. |
| `packages/ui/src/components/organisms/HostResourceFleetDeck.test.tsx` | Create | Order, empty/partial fleet, callback identity, duplicate labels. |
| `packages/ui/src/components/organisms/HostResourcePopover.test.tsx` | Modify | Fleet mode gate, aggregate trigger/read semantics, owner-bound drilldown, legacy behavior. |
| `packages/ui/browser-tests/host-resource-monitoring.browser.tsx` | Modify | Header/card navigation, focus, polling gates, profile switch/disconnect, mobile/desktop layout. |
| `docs/system-architecture.md` | Verify; modify only for intentional drift | Post-implementation architecture gate for Fleet Deck dataflow/polling tier. |

## Implementation Steps

1. Add pure table tests for watch reason and fleet summary: empty, sampling, healthy, stale, offline, refresh error, advisory, warning, critical, unread >99, and mixed partial failures.
2. Build `use-multi-host-resources.test.tsx` with two or three profiles, controllable profile/connection listeners, owner generations, bound API responses, fake timers, and a real QueryClient with retries disabled.
3. Prove scope union and order. Include connected `autoConnect=false`, offline `autoConnect=true`, offline `autoConnect=false`, duplicate URL/name, and profile removal.
4. Assert canonical cache keys for A/B and generation replacement. Resolve an old A promise after A generation changes; current A/B outputs and keys must remain correct.
5. Advance fake time through 15s intervals. Assert connected watched owners poll independently, one failure does not pause peers, offline rows never call API, and cleanup stops calls.
6. Feed same `incidentId` for A and B. Assert separate `byProfile` buckets, summed fleet count, A-only acknowledgement, B retention, and profile removal isolation.
7. Add card tests by role/name/text. Cover connected action, offline non-action, loading/error/stale, cached last-known, unsupported battery, zero as legitimate finite value, invalid/NaN omission, long escaped text, and duplicate labels.
8. Add deck tests for configured order, empty state, partial results, profile-ID callback, and absence of aggregate CPU/memory/disk claims.
9. Expand popover unit tests. Preserve current one-profile active-incident assertion. Add explicit-owner and one-configured-profile compatibility; multi fleet trigger, no-open acknowledgement, per-profile inspection, owner switch, and invalidated selection.
10. Extend the existing browser fixture to expose multiple profile/connection/query states. Keep transports and suspend mutation mocked; do not use real server or power management.
11. Add Chromium flow: open Fleet -> inspect A -> expand diagnostics -> Fleet -> inspect B -> close/Escape. Assert focus, pressed pills, headings, owner-specific host text, and trigger restoration.
12. Add polling proof at integration boundary: deck enables no 1s metrics; A drilldown enables A; switching to B disables A/enables B; Fleet/close/disconnect disables all. Prefer mock-call owner/enabled assertions plus fake time where browser timers are deterministic.
13. Re-run long-value, contrast, 44px, safe-area, and no-overflow checks with at least three cards at 320x700 and 1280x800. Confirm header pill region does not expand the page.
14. Verify security negatives: profile/host strings containing markup render literally; offline cards have no pin/suspend action; force-suspend receives only inspected owner and endpoint label.
15. Compare implementation to architecture sections for owner-qualified Host Resources and glance panel. Update `docs/system-architecture.md` only if the implemented Fleet Deck/polling dataflow adds durable architecture not already represented; otherwise record no drift.
16. Run only focused commands during feature work:
    - `pnpm --filter @dam-hopper/ui exec vitest run src/hooks/use-multi-host-resources.test.tsx src/hooks/use-host-resource-alert-presentation.test.tsx src/lib/host-resource-state.test.ts src/components/organisms/HostResourceFleetCard.test.tsx src/components/organisms/HostResourceFleetDeck.test.tsx src/components/organisms/HostResourcePopover.test.tsx`
    - `pnpm --filter @dam-hopper/ui exec vitest run --config vitest.browser.config.ts browser-tests/host-resource-monitoring.browser.tsx`
17. Leave formatter, lint, full UI suite, broad build, and project-wide `pnpm check` to the final integration owner after all phases land.

## Todo list

- [ ] Add pure scope/fleet summary tests.
- [ ] Add real QueryClient hook tests with fake profile/connection events.
- [ ] Prove isolated keys, stale-generation rejection, cadence, and cleanup.
- [ ] Prove duplicate incident isolation and per-profile acknowledgement.
- [ ] Add card/deck semantic and edge-case tests.
- [ ] Extend popover tests while retaining single-profile behavior proof.
- [ ] Extend Chromium flow, focus, target-size, contrast, and viewport checks.
- [ ] Verify no real host action and no offline action controls.
- [ ] Run focused unit and browser commands only.
- [ ] Complete post-implementation architecture comparison.

## Success Criteria

- Focused unit/component and Chromium commands pass.
- A plausible regression to ambient owner, generation-free key, fleet-wide acknowledgement, all-profile 1s polling, metric averaging, or offline action fails at least one durable test.
- One profile and explicit-owner surfaces keep their existing observable output/interaction.
- Multi-profile Fleet/Drilldown works with duplicate labels/IDs, partial failures, removal, disconnect, and owner replacement.
- Keyboard and pointer journeys succeed; focus never escapes or disappears; Escape/close restores trigger.
- Mobile/desktop layouts retain no horizontal/page overflow, readable non-color status, and 44px interactive targets.
- No test invokes real server suspend/RTC, credentials, network hosts, or profile persistence outside isolated fixtures.

## Risk Assessment

| Risk | Impact | Mitigation |
|---|---|---|
| Mocked query hooks hide cache bugs | False confidence | Use a real QueryClient/useQueries in hook tests; mock only transport/client boundary. |
| Fake timers conflict with React Query | Flaky cadence tests | Disable retries/GC surprises, advance inside `act`, flush microtasks after each step. |
| Browser harness grows brittle | Slow/noisy verification | Extend one existing fixture; assert roles/state/geometry, not class structure. |
| Single-profile regression masked by fleet fixtures | Existing users break | Dedicated one-profile and explicit-owner cases retained. |
| Real host action accidentally reachable | Dangerous test | Mock ForceSleep/API; assert offline action absence; never call real transport. |
| Dynamic relative age causes timing flake | Nondeterminism | Fix system time or assert qualified wording, not exact seconds unless clock controlled. |

## Security Considerations

- Use fake transports and fake suspend mutations only. Never call `systemctl`, RTC paths, `sudo`, production endpoints, or stored credentials.
- Assert untrusted markup-like profile/host strings remain escaped and are not links/HTML.
- Assert selected owner/generation reaches pin/suspend boundaries; no active-profile fallback.
- Ensure test failures/errors do not print bearer tokens or secrets; fixtures use synthetic non-secret values.
- Validate offline/cached rows expose no host mutation controls.

## Side-Effect Review Checklist

- [ ] Test setup restores fake timers, roots, QueryClient, profile/connection listeners, alert store, and browser viewport/safe-area variables.
- [ ] No shared localStorage/profile records leak between cases.
- [ ] No real network, SSE, suspend, RTC, or config mutation.
- [ ] Focus and open dialogs cleaned after each browser case.
- [ ] Targeted tests defend behavior, not implementation text/classes.
- [ ] Broad validation intentionally deferred to integration owner.

## Next steps

After focused proof, hand off to the integration owner for formatter/lint/full-suite/build gates and UI screenshots or recording. Reconcile only intentional architecture drift; do not add follow-up scope such as custom watch lists, fleet actions, sorting, persistence, or backend aggregation.

## Unresolved questions

None.