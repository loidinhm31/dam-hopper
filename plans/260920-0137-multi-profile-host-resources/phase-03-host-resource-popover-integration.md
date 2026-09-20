# Phase 03 — Host Resource popover integration

## Context links

- [Plan overview](./plan.md)
- [Phase 01 state hook](./phase-01-multi-profile-state-and-hooks.md)
- [Phase 02 fleet components](./phase-02-fleet-deck-and-card-components.md)
- [Current popover](../../packages/ui/src/components/organisms/HostResourcePopover.tsx)
- [Current glance/diagnosis architecture](../../docs/system-architecture.md#host-resource-glance-panel-current-ui)
- [Phase 04 verification](./phase-04-verification-and-testing.md)

## Overview

- Date: 2026-09-20
- Priority: P2
- Plan status: Pending
- Implementation status: Not started
- Review status: Not started
- Effort: 6h
- Goal: make the current popover a Fleet Deck by default for multi-profile users, then reuse the exact current host view as an owner-bound drilldown.

## Key Insights

- `HostResourcePopover` already owns dialog focus, outside-click/Escape behavior, alert acknowledgement, current drilldown queries, storage pin mutation, idle-suspend status, and force-suspend handoff. Preserve one owner of these behaviors.
- Multi-profile mode must be explicit: no `owner` prop and more than one configured profile. An explicit owner always means focused legacy drilldown.
- Opening a fleet overview is not acknowledgement of every server. Mark one profile read only when the user enters its drilldown.
- Current `endpointLabel` uses active profile metadata; multi-profile drilldown must instead use the inspected entry to avoid mislabelled destructive confirmation.
- Only the connected inspected profile gets 1s `useHostMetrics`. Fleet view uses Phase 01 snapshots and starts no high-frequency query.
- Closing multi-profile popover returns to Fleet next time and stops drilldown-only observers. Single-profile open/close behavior remains unchanged.

## Requirements

### Mode selection

- Legacy/single mode when `owner` prop is supplied or configured profile count is `<= 1`.
- Fleet mode when no explicit owner and configured profile count is `> 1`, even if only one/zero profile currently matches automatic watch scope.
- Fleet initially opens on deck. A connected card/profile pill selects a drilldown by profile ID.
- If inspected profile is removed, leaves watch scope, disconnects, or changes to a non-current owner, return to Fleet and close any pending force-sleep handoff.

### Header pills and toggle

- Add a compact labelled toolbar under the title in fleet mode.
- First pill: `Fleet`, with `aria-pressed=true` when deck visible; activates deck without closing dialog.
- One pill per watched profile, keyed by profile ID. Include full accessible profile name and visible connection/status cue. Connected pills select/switch drilldown; non-connected pills remain status text or clearly unavailable controls.
- Keep configured order and horizontal wrapping/scroll behavior inside panel width; never reorder by alert severity.
- Summary text/pills expose watched, connected, attention, and unread counts without color-only meaning.

### Drilldown

- Reuse the existing status header, host identity, glance, idle-suspend, diagnostic disclosure, storage pinning, and force-suspend components.
- Bind every hook/mutation/action to the selected current `ConnectionRef`.
- Preserve current 15s snapshot, 30s alert-history, and 1s compatibility-metrics intervals for the selected host only.
- Keep diagnosis disclosure local to the inspected profile; reset it when profile changes to avoid carrying open detail context across hosts.
- Pin updates affect only selected profile's Global UiConfig.
- Force-suspend confirmation captures selected owner and selected profile name/URL, never active/settings fallback.

### Single-profile compatibility

Preserve exact current trigger label/badge, opening acknowledgement, title/body, query enablement, diagnosis state, focus trap, pin behavior, idle-suspend/force-suspend handoff, and explicit `owner` semantics when fleet mode is off.

### Preflight contract

Before editing, snapshot current single-profile DOM/behavior tests. Refactor only enough to select Fleet versus one shared drilldown body. Do not duplicate the drilldown JSX into separate fleet/single branches and do not create a second popover/dialog.

## Architecture

### Local state

```ts
type HostResourceView =
  | { kind: "fleet" }
  | { kind: "profile"; profileId: string };
```

State may be represented by `inspectedProfileId: string | null`; semantics must match the union. Do not persist it.

### Owner resolution

```text
explicit owner OR configured profile count <= 1
  -> existing owner > Settings target > active profile fallback

multi-profile + selected connected fleet entry
  -> exact entry.owner only

multi-profile + Fleet view
  -> no detail owner, no detail-only polling/action
```

Never fall from a removed/disconnected selected profile to Settings/active profile. Return to Fleet instead.

### Polling tiers

| Surface | Profiles | Cadence | Owner |
|---|---:|---:|---|
| Fleet snapshot watch | all watched + connected | 15s | Phase 01 `useQueries` key per owner/generation |
| Alert history | selected drilldown only; legacy single unchanged | 30s | selected/legacy owner |
| Compatibility metrics | visible connected drilldown only | 1s | selected/legacy owner |
| Global config/pin | selected drilldown only where hook supports enablement; legacy single unchanged | existing | selected/legacy owner |
| Idle suspend | rendered selected drilldown only | existing | selected/legacy owner |

A selected deep snapshot may have both the fleet observer and detail observer on the same canonical key. TanStack Query deduplicates the request; do not invent a second key.

### Trigger aggregation

- Single mode: retain current `resolveHostResourceStatus` and source label logic.
- Fleet mode: use Phase 01 summary presentation/unread total.
- Trigger accessible name states scope, e.g. `Host resources: 2 of 3 watched hosts connected; 1 needs attention; 2 unread`.
- Opening Fleet does not call global `markRead`. Entering profile drilldown calls `markRead(profileId)` once; other profiles retain unread state.

### Focus behavior

- Existing trigger-to-dialog focus remains.
- Fleet card activation moves focus to the persistent selected profile pill or drilldown heading after render, not document body.
- `Fleet` pill remains mounted in both views, so returning to deck preserves focus.
- Escape closes dialog and restores trigger. Tab trap includes header pills, close button, disclosure, pin and sleep controls.
- No automatic focus movement on background snapshot/status updates.

## Related code files

| File | Action | Purpose |
|---|---|---|
| `packages/ui/src/components/organisms/HostResourcePopover.tsx` | Modify | Mode/view state, aggregate trigger, header pills, Fleet Deck, selected-owner drilldown, focus/read transitions. |
| `packages/ui/src/hooks/use-multi-host-resources.ts` | Consume | Fleet entries/summary and configured count. |
| `packages/ui/src/components/organisms/HostResourceFleetDeck.tsx` | Consume | Fleet overview body. |
| `packages/ui/src/components/organisms/HostResourceFleetCard.tsx` | Indirect consume | Card interaction through deck. |
| `packages/ui/src/hooks/use-host-resource-alert-presentation.ts` | Consume existing store/action | Per-profile acknowledgement; no new store. |
| `packages/ui/src/components/organisms/HostResourceGlance.tsx` | Reuse unchanged | Selected-host glance. |
| `packages/ui/src/components/organisms/HostResourceDiagnosis.tsx` | Reuse unchanged | Selected-host details and pin controls. |
| `packages/ui/src/components/organisms/HostIdleSuspendStatus.tsx` | Reuse unchanged | Selected-host status/action. |
| `packages/ui/src/components/organisms/ForceSleepDialog.tsx` | Reuse unchanged | Existing captured intent/revision confirmation. |
| `packages/ui/src/components/organisms/TopNavUtilityStrip.tsx` | Verify only | Existing single popover mount remains sufficient. |

## Implementation Steps

1. Call `useMultiHostResources({ enabled: true })` at popover level so top-nav trigger can represent fleet status while closed.
2. Compute `fleetMode = owner === undefined && configuredProfileCount > 1`. Keep existing owner fallback in a clearly named legacy branch only.
3. Add non-persisted `inspectedProfileId`. Resolve it against current fleet entries on every render; derive a detail owner only if entry is currently connected.
4. Add an effect that returns to Fleet when selected entry disappears/disconnects/changes owner validity. Reset diagnosis and force-sleep state; never retarget.
5. Gate detail hooks. In fleet view, disable snapshot/history/metrics requests owned by current popover detail. In selected view, bind to selected owner. In legacy mode, retain current enabled flags.
6. Ensure only `useHostMetrics(open && detailConnected, detailOwner)` starts 1s polling. Closing multi popover clears selected profile and therefore disables detail-only observers.
7. Derive trigger status/label from fleet summary only in fleet mode. Keep current exact single-profile path otherwise.
8. Change trigger click: legacy open marks the one profile read as today; fleet open shows deck without acknowledgement.
9. Add the header view toolbar/pills beneath existing title copy. `Fleet` toggles deck; connected profile pills select/switch profile and mark only that profile read.
10. Render `HostResourceFleetDeck` in Fleet view. Its card callback uses the same profile-selection function as header pills.
11. Move current status/hostname/glance/idle-suspend/diagnostic JSX behind the shared drilldown branch instead of copying it. In selected mode, source hostname/sample/status from selected detail query/cached canonical key.
12. Reset `diagnosisOpen` on profile switch. Keep the disclosure label, `aria-expanded`, and controlled region unchanged.
13. Bind `useGlobalConfig`, `useUpdateUiConfig`, snapshot/history/metrics, `HostIdleSuspendStatus`, and `ForceSleepDialog` to `detailOwner`. Never use active/settings fallback after fleet selection.
14. Build force-sleep `endpointLabel` from selected `entry.profile.name` and `.url`; legacy mode retains its existing profile label resolution.
15. Keep unavailable cards non-actionable. If a profile disconnects during force-sleep confirmation, existing stale-owner protection remains final authority and the popover returns to Fleet after dialog closes.
16. Preserve outside click, Escape, Tab containment, panel sizing/safe areas, close focus restoration, and one dialog ID. Add focus restoration for card-to-drilldown and Fleet toggle.
17. Avoid `aria-live` on frequently polling card content. Use stable labels and announce only user-initiated view changes through focus/heading context.

## Todo list

- [ ] Add fleet-versus-legacy mode gate.
- [ ] Add non-persisted Fleet/profile view selection.
- [ ] Add accessible Fleet and profile header pills.
- [ ] Use fleet summary for multi-profile trigger/badge.
- [ ] Render deck and reuse one owner-bound drilldown body.
- [ ] Gate 1s metrics to visible connected drilldown.
- [ ] Mark read only for inspected profile.
- [ ] Reset safely on disconnect/removal/generation change.
- [ ] Bind pin/suspend/force-sleep labels and actions to inspected owner.
- [ ] Preserve legacy one-profile DOM, focus, labels, and behavior.

## Success Criteria

- With one configured profile or explicit `owner`, behavior is observably unchanged.
- With multiple configured profiles, opening the trigger shows Fleet first and no profile's unread count is cleared.
- Fleet/profile pills and connected cards switch views by pointer, Enter, and Space; focus remains inside dialog.
- Only the inspected connected profile performs 1s metrics polling; all watched connected profiles retain 15s snapshot monitoring.
- Switching A -> B changes every detail query, pin mutation, idle-suspend view, and force-sleep label to B without ambient fallback.
- Disconnect/remove/replace of B returns to Fleet; no late B data/action appears under another profile.
- Closing/reopening multi-profile popover returns to Fleet and restores trigger focus on close.

## Risk Assessment

| Risk | Impact | Mitigation |
|---|---|---|
| Conditional hook branching | React hook-order bugs | Call hooks unconditionally; vary `enabled` and owner inputs with explicit mode derivation. |
| Selected owner falls back ambiently | Wrong server read/action | No detail owner in Fleet; exact selected owner in drilldown; return to Fleet on invalidation. |
| Duplicate snapshot observers | Extra requests | Same canonical key; rely on TanStack dedupe; test request cadence. |
| Fleet open clears all unread | Lost operator signal | No acknowledgement on fleet open; per-profile mark on inspection. |
| Active profile labels selected action | Misleading destructive dialog | Endpoint label from inspected fleet entry. |
| Focus lost on card unmount | Keyboard trap escape/confusion | Move focus to persistent selected pill/heading after user selection. |
| Large profile count crowds header | Overflow | Wrapping/contained horizontal region, full accessible names, popover owns vertical scroll. |

## Security Considerations

- Selected `ConnectionRef` must bind all reads and mutations; profile ID alone is insufficient after generation replacement.
- Keep existing force-suspend actor, origin, fleet, revision, request-ID, and no-auto-retry protections intact.
- Never enable sleep/pin controls for offline/cached-only entries.
- Do not expose tokens, auth usernames, boot IDs, process details, mount paths, or raw errors in header pills.
- Profile/endpoint/host strings remain escaped text. Do not construct clickable URLs.
- Fleet aggregation is presentation only and never authorizes or fans out a mutation.

## Side-Effect Review Checklist

- [ ] Fleet open performs reads only and marks no profile read.
- [ ] Profile inspection marks only that profile read.
- [ ] Profile switch resets local diagnosis/action context; it does not change active/Settings profile.
- [ ] Pin and force-sleep remain single-owner actions with existing confirmation/fencing.
- [ ] Closing stops high-frequency metrics and removes listeners through normal hook cleanup.
- [ ] No connect/disconnect, auto-connect preference, profile order, or persisted selection change.
- [ ] No duplicate dialog, focus trap, high-frequency interval, or query-key family.

## Next steps

Phase 04 locks the owner/polling/read/focus contracts with targeted unit/component tests and Chromium interaction/layout checks, then compares implementation to `docs/system-architecture.md` and updates only intentional design drift.

## Unresolved questions

None.