# Code Review Report — Phase 03: Host Resource Popover Integration

**Date**: 2026-09-20  
**Reviewer**: CodeReviewerPhase03  
**Plan**: `plans/260920-0137-multi-profile-host-resources/phase-03-host-resource-popover-integration.md`  
**Score**: 9.5/10  

---

## Code Review Summary

### Scope
- **Files reviewed**:
  - `packages/ui/src/components/organisms/HostResourcePopover.tsx`
  - `packages/ui/src/components/organisms/HostResourcePopover.test.tsx`
  - Referenced components & hooks: `HostResourceFleetDeck.tsx`, `HostResourceFleetCard.tsx`, `HostIdleSuspendStatus.tsx`, `ForceSleepDialog.tsx`, `use-multi-host-resources.ts`, `use-host-resource-alert-presentation.ts`, `queries.ts`, `TopNavUtilityStrip.tsx`
- **Lines of code analyzed**: ~1,800 LOC
- **Review focus**: Phase 03 — Host Resource Popover Integration: multi-profile fleet deck & drilldown, polling tier gating, alert presentation isolation, accessibility & focus restoration, single-profile compatibility, security.
- **Updated plans**:
  - `plans/260920-0137-multi-profile-host-resources/phase-03-host-resource-popover-integration.md`
  - `plans/260920-0137-multi-profile-host-resources/plan.md`

---

## Overall Assessment

Implementation adheres to all specifications and constraints defined in the Phase 03 plan:
- Clean mode boundary between single-profile (`owner !== undefined || configuredProfileCount <= 1`) and fleet mode (`owner === undefined && configuredProfileCount > 1`).
- Non-persisted view state (`inspectedProfileId: string | null`) safely resets on popover close, fleet toggle, or profile disconnect/removal.
- Strict polling tier gating: 15s snapshots across watched profiles via `useMultiHostResources`, and 1s `useHostMetrics` active ONLY when popover is open AND connected drilldown is active. No high-frequency polling on Fleet Deck.
- Per-profile alert isolation: opening Fleet Deck does not clear unread badges. Only inspecting a profile calls `markRead(profileId)`.
- Accessible toolbar (`role="toolbar"`), full `aria-pressed`, `aria-label`, text status indicators, focus restoration to header pills / trigger, and resilient Tab cycling trap.
- Security and fencing: strict owner bounding to selected connection ref, no ambient fallback in fleet mode, text-only profile/endpoint labels in force-sleep confirmation dialog.

---

## Detailed Check Categories

### 1. Multi-Profile vs Single-Profile Compatibility
- `fleetMode` correctly evaluates to `false` when explicit `owner` prop is provided or `configuredProfileCount <= 1`.
- When `!fleetMode`, exact legacy single-profile behavior is preserved:
  - Header displays original status indicator, hostname, and OS info.
  - No fleet navigation toolbar rendered.
  - Directly renders drilldown without redundant duplicate headers.
  - Trigger open marks the profile read immediately.
  - All snapshots and DOM markup verified identical via `HostResourcePopover.test.tsx`.

### 2. Fleet Deck vs Drilldown View State Management
- `inspectedProfileId` is managed via component `useState<string | null>(null)` without local persistence.
- Closing popover (via button, Escape, or pointer down outside) resets `inspectedProfileId` and `diagnosisOpen`.
- Selecting "Fleet" pill resets `inspectedProfileId` and `diagnosisOpen`.
- Diagnosis disclosure state is scoped to the inspected profile and never leaks across profile switches.

### 3. Polling Tier Gating
- `isDrilldown = !fleetMode || (inspectedProfileId !== null && detailConnected)`.
- `useHostMetrics(open && isDrilldown, detailOwner)`:
  - Fleet Deck: `isDrilldown === false` -> polling disabled (`refetchInterval: false`).
  - Closed: `open === false` -> polling disabled (`refetchInterval: false`).
  - Disconnected profile: `detailConnected === false` -> polling disabled.
  - Active connected drilldown: 1s polling active for inspected profile only.
- `useHostResourceSnapshot`: Disabled on Fleet Deck; in drilldown uses canonical query key matching `useMultiHostResources` (deduplicated by TanStack Query).

### 4. Alert Presentation & Unread State
- Trigger click in fleet mode opens dialog without calling `markRead`.
- `handleInspectProfile` invokes `markAlertRead(profileId)`, clearing unread IDs only for that specific profile.
- Unread count in fleet summary reflects aggregate unread across remaining profiles.

### 5. Disconnect / Removal Fallback to Fleet View
- `useEffect` watches `[fleetMode, inspectedProfileId, multiResources.entries, forceSleepOpen]`.
- When inspected profile disconnects or is removed from watch scope, returns to fleet view (`setInspectedProfileId(null)`).
- When `forceSleepOpen` is true during disconnect, `handleCloseForceSleep` ensures safe return to fleet view upon closing.
- `ForceSleepDialog` has generation-fencing to warn and block execution if connection/generation changed during review.

### 6. Accessibility & Keyboard Navigation
- Header toolbar has `role="toolbar"` and `aria-label="Host resource view navigation"`.
- Fleet button and profile pills use `aria-pressed`.
- Profile pills include status dot and textual status in `aria-label` (no color-only reliance, WCAG 1.4.1).
- Disconnected pills have `disabled={true}`, `cursor-not-allowed`, and `(disconnected)` aria label.
- Focus restoration:
  - Card/pill inspect focuses persistent profile pill in header.
  - Return to fleet focuses persistent Fleet pill in header.
  - Dialog close (or Escape) restores focus to trigger button.
- Tab trap cycles cleanly across all non-hidden focusable elements.

### 7. Security: Owner Bounding, Sanitization, Force-Sleep Context
- In fleet mode, `detailOwner` is bound strictly to `selectedEntry.owner`. No fallback to ambient active profile or settings profile.
- `forceSleepEndpointLabel` in fleet mode uses `${selectedEntry.profile.name} (${selectedEntry.profile.url})` directly from inspected entry.
- All dynamic strings rendered in JSX text nodes; no `dangerouslySetInnerHTML`, clickable URL injection, or ambient mutation leaks.

---

## Critical Issues
None.

## Warnings
None.

## Suggestions
1. **Render tick fallback optimization (Minor)**:
   In `HostResourcePopover.tsx` line 248:
   ```tsx
   const drilldownStatus = fleetMode && selectedEntry
     ? selectedEntry.status
     : singleStatus;
   ```
   If in fleet mode and `selectedEntry` is missing (e.g. removed prior to effect cleanup), `drilldownStatus` briefly resolves to `singleStatus` (which references `legacyResolvedOwner`). Consider defaulting to `multiResources.summary.presentation` in fleet mode:
   ```tsx
   const drilldownStatus = fleetMode
     ? (selectedEntry?.status ?? multiResources.summary.presentation)
     : singleStatus;
   ```
2. **Immediate Deck fallback on disconnect (Minor)**:
   In `HostResourcePopover.tsx` line 459:
   ```tsx
   {fleetMode && inspectedProfileId === null ? (
   ```
   Using `{fleetMode && !isDrilldown ? (` allows the component to immediately render the Fleet Deck on the first render tick when a selected profile disconnects (`detailConnected === false`), avoiding a 1-frame render of the disconnected drilldown body before the effect fires.

---

## Validation Commands and Results

- **Unit tests**:
  ```bash
  pnpm --filter @dam-hopper/ui test src/components/organisms/HostResourcePopover.test.tsx
  ```
  Result: **Passed** (1 file, 8 tests passed, 886ms).

- **Full Host organism test suite**:
  ```bash
  pnpm --filter @dam-hopper/ui test Host
  ```
  Result: **Passed** (21 test files, 178 tests passed, 1.35s).

- **TypeScript compilation & typecheck**:
  ```bash
  pnpm --filter @dam-hopper/ui build
  ```
  Result: **Passed** (`tsc -p tsconfig.json` exit code 0).

---

## Unresolved Questions
None.
