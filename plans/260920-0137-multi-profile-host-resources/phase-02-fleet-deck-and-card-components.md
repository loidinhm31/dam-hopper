# Phase 02 — Fleet deck and card components

## Context links

- [Plan overview](./plan.md)
- [Phase 01 view model](./phase-01-multi-profile-state-and-hooks.md)
- [Current Host Resource glance contract](../../docs/system-architecture.md#host-resource-glance-panel-current-ui)
- [Current popover component](../../packages/ui/src/components/organisms/HostResourcePopover.tsx)
- [Current status projection](../../packages/ui/src/lib/host-resource-state.ts)
- [Phase 03 integration](./phase-03-host-resource-popover-integration.md)

## Overview

- Date: 2026-09-20
- Priority: P2
- Plan status: Pending
- Implementation status: Not started
- Review status: Not started
- Effort: 4h
- Goal: render a scan-first Fleet Deck with small, accessible profile cards and no additional data ownership.

## Key Insights

- The popover is only 26rem wide. One-column cards preserve long profile/host labels, 44px targets, and mobile behavior better than a cramped dashboard grid.
- Fleet cards summarize ownership/availability first. They must not imply comparable aggregate CPU/disk values when only the inspected host receives compatibility metrics.
- Deep snapshots can safely show memory used, battery, resource severity, host identity, and age. CPU/storage stay in drilldown.
- Offline auto-connect rows are watch intent, not live telemetry. A cached snapshot may be shown only as explicitly last known.
- The card must have one interaction target. Avoid nested buttons, links, or controls that break semantics and focus.

## Requirements

### `HostResourceFleetCard`

- Display full profile name in accessible text, connection status, auto-connect/watch reason, current resource status, unread count, host/OS when known, and sample age.
- Optionally show deep-memory used percentage and battery capacity/status via existing finite-value helpers. Omit unavailable values; never substitute zero.
- Connected cards expose one 44px-minimum inspection button. Non-connected cards remain readable non-interactive articles and explain why drilldown is unavailable.
- Use visible wording/icons in addition to color for critical, warning, unavailable, stale, loading, and healthy states.
- Render endpoint/profile/host strings as text with safe wrapping. Do not make endpoint a navigation link.

### `HostResourceFleetDeck`

- Render watched entries in configured order with a semantic heading/list.
- Own only layout and card composition. It receives `entries` and `onInspect(profileId)`; it never reads stores, APIs, queries, or connection modules.
- Provide clear empty state for “No connected or auto-connect profiles to watch.”
- Preserve partial results: loading/error/offline cards coexist with healthy cards.
- Do not render totals that average or sum host metrics.

### Preflight contract

Confirm the Phase 01 entry includes all card data. If a card would need to import a query/store, extend the Phase 01 projection instead. Reuse `resolveHostResourceMemory`, battery formatters, `StatusIcon` visual grammar where practical, CSS variables, and existing Tailwind patterns. Add no design-system dependency.

## Architecture

```text
useMultiHostResources
  -> MultiHostResourceEntry[]
  -> HostResourceFleetDeck (layout + empty state)
  -> HostResourceFleetCard (pure profile summary)
  -> onInspect(profileId) only for a current connected owner
```

Suggested props:

```ts
export interface HostResourceFleetCardProps {
  entry: MultiHostResourceEntry;
  selected?: boolean;
  onInspect: (profileId: string) => void;
}

export interface HostResourceFleetDeckProps {
  entries: MultiHostResourceEntry[];
  onInspect: (profileId: string) => void;
}
```

The card root is an `<article>` inside a deck `<ul>`/`<li>` or labelled region. For connected rows, use one full-width `<button>` inside the article. The button name should include profile and status, e.g. `Inspect host resources for Local Dev: Warning`. Do not add `role=button` to a `div`.

### Card information hierarchy

1. Profile name + explicit connection label.
2. Resource status + unread incident count.
3. Hostname/OS and current vs last-known sample age.
4. Optional bounded memory/battery facts.
5. “Inspect” affordance only while connected.

Keep status labels deterministic; no relative-age interval inside each card. Age updates when snapshot/query/profile state re-renders, avoiding N card timers.

## Related code files

| File | Action | Purpose |
|---|---|---|
| `packages/ui/src/components/organisms/HostResourceFleetCard.tsx` | Create | Pure, accessible per-profile summary/inspection target. |
| `packages/ui/src/components/organisms/HostResourceFleetDeck.tsx` | Create | Ordered fleet layout, heading, empty state, card composition. |
| `packages/ui/src/hooks/use-multi-host-resources.ts` | Consume types only | No query/store reads in the components. |
| `packages/ui/src/lib/host-resource-state.ts` | Consume existing helpers; modify only for a missing pure formatter | Memory/battery/status finite projection. |
| `packages/ui/src/lib/host-metrics-format.ts` | Verify only | Reuse formatting; do not use `formatPercent` for unavailable values. |

## Implementation Steps

1. Create `HostResourceFleetCard.tsx` with a named props interface and named export, matching PascalCase component-file convention.
2. Build a pure card projection from `entry`. Use `resolveHostResourceMemory(undefined, entry.snapshot)` and existing battery/status helpers; preserve unavailable versus zero.
3. Render status tone using existing CSS variables/classes. Keep one non-color label and one icon with `aria-hidden`; expose one combined accessible name on the interactive card.
4. Show `profile.name` and normalized display URL as separate text. Wrap long unbroken values with `[overflow-wrap:anywhere]`; visual truncation must not remove accessible text.
5. For connected entries, render one full-width button with minimum 44px target and visible focus outline. Call `onInspect(entry.profile.id)` only from that button.
6. For connecting/offline/login-required/unsupported/disconnected entries, render a noninteractive article with visible connection reason. Do not use a disabled button as the only way assistive technology can read the row.
7. If cached snapshot exists while disconnected, prefix age/status with “Last known”; never display current healthy wording unqualified.
8. Add `HostResourceFleetDeck.tsx`. Use a labelled section and semantic list; map by `entry.profile.id`, never name/URL/hostname.
9. Add empty state and optional fleet-count description. Do not add retries, connect controls, sorting, filtering, pagination, or virtualization.
10. Keep cards in configured order. Health changes alter styling/text only, not focus order.
11. Verify compact/mobile layout against current popover width and safe-area rules; deck owns no independent scrolling so the popover remains the sole scroll container.

## Todo list

- [ ] Create pure `HostResourceFleetCard`.
- [ ] Render owner, connection, health, unread, host identity, age, and bounded optional facts.
- [ ] Make only connected cards inspectable with a 44px native button.
- [ ] Create ordered semantic `HostResourceFleetDeck`.
- [ ] Add empty and partial-failure presentation.
- [ ] Preserve long text, focus visibility, and non-color state cues.
- [ ] Avoid component-local queries, stores, timers, and mutations.

## Success Criteria

- Users can scan which profiles are connected, need attention, are unavailable, or carry unread incidents without opening each host.
- Connected cards enter drilldown by pointer, Enter, or Space. Non-connected rows do not expose unusable/destructive controls.
- Deep memory/battery values appear only when finite and supported; no unavailable value renders as `0`.
- Duplicate names, URLs, and hostnames render as distinct cards keyed by profile ID.
- Card order does not change when telemetry severity changes.
- At 320px viewport, every card remains within the popover, text remains reachable, and interactive targets remain at least 44px.

## Risk Assessment

| Risk | Impact | Mitigation |
|---|---|---|
| Too much detail | Fleet becomes harder to scan than drilldown | Fixed five-level hierarchy; optional facts limited to memory/battery. |
| Card as nested interactive container | Invalid semantics/focus traps | One native button only for connected row; no inner controls. |
| Health color alone | Inaccessible status | Visible connection/status/unread wording plus icon. |
| Cached offline snapshot looks current | Unsafe operator inference | “Last known” qualifier and connection state outrank resource tone. |
| Long endpoint/hostname overflow | Mobile horizontal scroll | Anywhere wrapping, bounded layout, browser coverage. |
| Reordering by severity | Keyboard/focus instability | Preserve configured profile order. |

## Security Considerations

- Render profile names, endpoints, hostnames, OS labels, and alert text with React text interpolation only.
- Do not expose auth type, username, bearer token, internal boot ID, raw alert evidence, mount paths, or process data on cards.
- Endpoint is disambiguating text, not an actionable link.
- Card click passes only the profile ID back to the owner-aware popover; it performs no request or mutation.
- Do not expose force-suspend, pinning, or other host actions on the fleet deck.

## Side-Effect Review Checklist

- [ ] Components import no API client, query hook, Zustand store, connection action, or browser storage.
- [ ] Card click changes only parent inspection selection.
- [ ] No timer per card and no separate scroll container.
- [ ] No metric average/sum or cross-host comparison claim.
- [ ] No action rendered for a stale/disconnected owner.
- [ ] Strings remain escaped text and long values cannot expand page width.

## Next steps

Phase 03 places Fleet and profile pills in the current modal popover, selects connected cards for drilldown, and preserves the existing single-profile body without forking it.

## Unresolved questions

None.