# Phase 04 — Host Popover UI and Confirmation Dialog

## Context Links

- [Parent plan](./plan.md)
- [Phase 03 REST contract](./phase-03-rest-api-force-suspend-endpoint.md)
- [Existing status/timing UI phase](../260824-0312-terminal-idle-suspend/phase-04-rest-websocket-ui-monitoring.md)
- [Host resource architecture](../../docs/system-architecture.md#server-authoritative-terminal-idle-suspend-architecture)
- [Code standards](../../docs/code-standards.md)
- [API reference](../../docs/api-reference.md#terminal-idle-suspend)

## Overview

- Date: 2026-09-06
- Priority: P1
- Status: Pending
- Effort: 8h
- Description: Add a Force Machine to Sleep action inside the Host Resource Popover and an accessible Radix confirmation dialog with authoritative active-session warning, indefinite default, optional timed wake, and no-retry mutation behavior.

## Key Insights

- `HostIdleSuspendStatus` already owns the protected status query and displays the exact fleet breakdown needed for the first confirmation view.
- `HostResourcePopover` is a custom modal/focus trap; `DialogContent` portals to `body`. Leaving both open causes outside-pointer/focus ownership conflicts and can unmount the child dialog.
- Close the popover before opening the Radix dialog, render the dialog outside the popover’s `open` conditional, and restore focus to the host-resource trigger after dialog close.
- The current popover says “Read-only monitoring and diagnosis,” and tests assert zero buttons. Those contracts must be intentionally updated rather than left misleading.
- The status snapshot can race after the dialog opens. A server `409` with newer counts must update the warning and require a second user activation with `force: true`.
- An indefinite request may disconnect the browser for an unbounded period. The mutation must never retry; a missing 202 is ambiguous and reconciles only through status/audit after wake.

## Requirements

### Functional

- Add typed client request/accepted/error mirrors and `api.system.forceSuspend(request)` mapped to the exact POST path.
- Add `useForceSuspend()` with `retry: false`; invalidate the existing idle-suspend status key on accepted response and relevant settled/conflict paths.
- Add a destructive “Force Machine to Sleep” button within `HostIdleSuspendStatus`/Host Resource Popover.
- Disable the button during `handedOff`, `handoffActive`, closing, disposal, or an in-progress force mutation. Do not treat automatic `enabled: false` alone as manual-action unavailability.
- Always open a confirmation dialog before POST. State plainly that the whole host/network will sleep and running work is paused, not killed.
- Show authoritative active count and breakdown (`live`, `creating`, `restarting`). Use “managed terminals/builds,” not “all host processes.”
- If active count is nonzero, render a prominent warning and send `force: true` only after that warning is explicitly confirmed.
- If initial count is zero, send `force: false`. If the server returns confirmation-required/fleet-changed with activity, keep the dialog open, replace counts, clear prior confirmation state, and require another click.
- Default every dialog opening to “Sleep indefinitely (no automatic wake)” and submit `wakeAfterSeconds: 0`.
- Offer “Wake automatically” with a labeled duration input. Use server-advertised nonzero bounds (`minWakeAfterSeconds..maxWakeAfterSeconds`), convert displayed minutes/seconds without rounding ambiguity, and submit exact seconds.
- During mutation, show a spinner and live-region text; disable close, mode, duration, cancel, and confirm controls to prevent duplicate requests.
- On accepted 202, show concise acceptance only if the browser remains connected; close/reset dialog. Never claim successful sleep/resume.
- Map auth, active-confirmation, handoff, capability, audit, validation, and network errors to actionable, non-sensitive messages. Preserve inputs on recoverable errors.

### Non-functional

- Use the existing Radix wrapper in `packages/ui/src/components/ui/Dialog.tsx`; retain labelled title/description, focus trap, Escape behavior, focus restoration, keyboard access, and 44 px touch targets.
- Use role/name/label selectors in browser tests. Avoid source-text or component-export-only tests.
- No optimistic status mutation and no automatic POST retry. REST status remains authoritative after reconnect/profile switch.
- Dialog state is ephemeral; do not persist indefinite/timed choice or mutate automatic idle timing.
- Keep profile-scoped transport/query behavior and existing `host:idleSuspendChanged` invalidation intact.
- Update popover language and tests to acknowledge one explicit authenticated control without implying resource-remediation actions were enabled.

## Architecture

```text
HostResourcePopover
  -> HostIdleSuspendStatus(status + onForceSleep)
  -> click closes popover, stores content-free snapshot, opens ForceSleepDialog
ForceSleepDialog
  -> default wake mode: indefinite => 0
  -> optional timed mode => validated seconds
  -> useForceSuspend({ wakeAfterSeconds, force: activeCount > 0 })
  -> 202: reset/close + invalidate status
  -> 409 active/fleet-changed: update counts, require a new explicit confirm
  -> other error: retain reviewed values, no retry
```

`HostResourcePopover` owns open/close handoff between its custom modal and the portalled Radix dialog. `ForceSleepDialog` owns only ephemeral form/error/pending state. `useForceSuspend` owns transport and cache invalidation. The server remains authoritative for actor, fleet, confirmation, and action admission.

## Preflight Contract

1. Protected status query has loaded; UI has a content-free fleet snapshot.
2. Action is not handed off, closing, disposing, or pending.
3. Popover closes without restoring competing focus; Radix dialog opens and takes focus.
4. Wake mode is exactly indefinite (`0`) or a valid advertised nonzero duration.
5. Active warning is visible before a force=true submission.
6. One explicit confirm sends one mutation. Pending state blocks every duplicate/close path.
7. Server conflicts reset confirmation and require a new user gesture.

## Related Code Files

| Path | Action | Purpose |
|---|---|---|
| `packages/ui/src/api/client.ts` | Modify | Add force request/accepted/error types and `api.system.forceSuspend` |
| `packages/ui/src/api/ws-transport.ts` | Modify | Map force invoke to POST REST endpoint |
| `packages/ui/src/api/ws-transport.test.ts` | Modify | Verify exact method/path/body and error propagation |
| `packages/ui/src/api/queries.ts` | Modify | Add `useForceSuspend`, no retry, and status invalidation |
| `packages/ui/src/components/organisms/ForceSleepDialog.tsx` | Create | Accessible destructive confirmation and wake-mode form |
| `packages/ui/src/components/organisms/ForceSleepDialog.test.tsx` | Create | Retain only valuable form/error transition tests not owned by browser coverage |
| `packages/ui/src/components/organisms/HostIdleSuspendStatus.tsx` | Modify | Add action button, disabled states, and callback snapshot |
| `packages/ui/src/components/organisms/HostIdleSuspendStatus.test.tsx` | Modify | Replace obsolete read-only assertion with observable action-state coverage |
| `packages/ui/src/components/organisms/HostResourcePopover.tsx` | Modify | Own popover-to-dialog handoff and correct header copy/focus restoration |
| `packages/ui/src/components/organisms/HostResourcePopover.test.tsx` | Modify | Update monitoring-only copy/interaction assumptions |
| `packages/ui/browser-tests/idle-suspend-settings-status.browser.tsx` | Modify | Cover force dialog behavior, no retry, focus, and status reconciliation |
| `packages/ui/browser-tests/host-resource-monitoring.browser.tsx` | Modify | Cover real popover/dialog portal interaction and responsive geometry |

## Implementation Steps

1. Mirror Phase 03 DTOs in `client.ts`; validate the closed accepted payload and structured fleet-conflict detail.
2. Add exact `ws-transport` POST mapping and transport tests. Do not add a WebSocket action command.
3. Add `useForceSuspend()` with `retry: false`; invalidate the status query without optimistic `HandedOff` claims.
4. Change `HostIdleSuspendStatus` to accept an action callback and render one destructive button. Compute disabled reason from authoritative status/pending state.
5. Lift dialog ownership into `HostResourcePopover`. On action, capture only fleet counts/generation, close the popover without its normal focus restore, then open the Radix dialog rendered outside the popover conditional.
6. Build `ForceSleepDialog`: destructive explanation, active-work warning, indefinite/timed radio group, labeled bounded duration, cancel, confirm, live regions, pending spinner, and error guidance.
7. Initialize/reset indefinite mode on every open. For timed mode, seed a valid value from current automatic wake setting or 600 seconds, clamped to advertised bounds; do not persist it.
8. Handle active/fleet-changed 409 by replacing the local snapshot and requiring a fresh confirm. Handle handoff as disabled guidance; auth errors defer to existing session flow; never retry.
9. Update popover wording and remove/replace obsolete “read-only/no buttons” tests that assert the old product contract.
10. Add browser tests for pointer and keyboard open/close, focus trap/restoration, active/no-active flows, race reconfirmation, bounds, spinner/duplicate prevention, 202, failure preservation, handedOff disablement, 320 px viewport, and no horizontal overflow.

## Todo List

- [ ] Add force-suspend client DTOs and API method
- [ ] Add POST transport mapping
- [ ] Add no-retry `useForceSuspend()`
- [ ] Add popover action and disabled-state semantics
- [ ] Implement popover-to-Radix modal handoff
- [ ] Implement indefinite-default/timed-wake dialog
- [ ] Implement authoritative active-count reconfirmation
- [ ] Add pending/error/live-region behavior
- [ ] Replace obsolete read-only UI assertions
- [ ] Add focused unit and real-browser coverage

## Success Criteria

- Logged-in users can reach one Force Machine to Sleep action from the Host Resource Popover; no action appears through a public/no-auth surface.
- Every request requires a visible confirmation dialog and exactly one explicit submit.
- Dialog opens in indefinite mode and submits zero unless the user selects/configures a valid timer.
- Active managed work displays exact content-free counts; a race to active state causes 409 and a mandatory second confirmation.
- `handedOff` and pending states block duplicate actions; mutation request count remains one per confirmation.
- Keyboard focus enters the Radix dialog, remains trapped, Escape/cancel work when not pending, and close restores focus to the host-resource trigger.
- Popover/dialog fit at 320 px width with 44 px controls, readable warnings, and no horizontal overflow.
- Network/auth/helper/audit failures never appear as sleep success and never auto-retry.

## Risk Assessment

| Risk | Impact | Mitigation |
|---|---|---|
| Nested portal closes/unmounts dialog | High | Parent owns modal handoff; close popover before opening portalled dialog |
| Stale zero count bypasses warning | Critical | Server 409 updates counts and requires a second gesture |
| Indefinite chosen accidentally | Critical | Explicit default label and destructive confirmation copy; never hidden sentinel |
| Duplicate POST during disconnect | Critical | Disable all controls while pending; mutation retry false |
| UI claims sleep succeeded on 202 | High | Wording says request accepted; status/audit own outcome |
| Automatic timing is overwritten | Critical | Ephemeral form sends only force endpoint; no timing mutation/persistence |

## Security Considerations

- Client-side logged-in/disabled checks are UX only; the server enforces every authority decision.
- Never render or log terminal IDs, commands, output, cwd, environment, token, cookie, actor, helper path, or raw helper error.
- Do not add confirmation state to localStorage/sessionStorage or URL state.
- Use the exact same-origin credentialed transport; no query-token or GET action fallback.
- Display that active count covers DamHopper-managed terminals/builds only, avoiding a false whole-host safety claim.

## Side-Effect Review Checklist

- [ ] Opening/cancelling the dialog sends no request.
- [ ] Every open resets to indefinite without changing Settings timing.
- [ ] Conflict requires a fresh click; no effect retries automatically.
- [ ] Popover resource sampling/alerts/pinned mount behavior stays unchanged.
- [ ] Existing status and Settings timing surfaces remain functional.
- [ ] Browser focus is owned by only one modal at a time.

## Next Steps

- Qualify cross-layer behavior and update operational/product docs in [Phase 05](./phase-05-integration-testing-and-docs.md).