# Phase 06: P3 — System Monitor and tray

Estimate: 32h; implementation status: **pending**. [Overview](plan.md) · [Ownership](ownership.md) · [Acceptance](acceptance.md).

## Context / objective
Priority P2; status pending. Merge Dashboard + Host Resources into one fleet app; keep underlying host-resource monitoring/system actions/idle-suspend APIs. Usage analytics deletion does not delete system CPU/memory “usage”. [UI Monitor](../reports/ui-ux-designer-261101-1738-ai-dev-os-initial-ui.md#43-system-monitor-app-replaces-dashboard--host-resources-popover).

## Architecture / requirements
System Monitor = singleton/none context, explicit selected-profile filter over fleet. Reuse HostResourceFleetDeck, Glance, Diagnosis, StorageDetails, IncidentDetails, HostIdleSuspendStatus and ForceSleepDialog. Fold Dashboard project/session counts and session table (kill/jump) into app; move activity presentation to OS bell/event log. TopBar tray mini CPU/MEM meters + alert dot opens Monitor at exact profile/incident; idle timing/status tray opens correct host action. Expose online/stale/connecting/offline honestly, no metric estimate or unknown->zero conversion.

## Ordered implementation by task ID
### implement-system-monitor
1. Extract reusable Dashboard counts/session table and existing popover drilldowns into Monitor composition. Leave DashboardPage and HostResourcePopover wrappers functioning until Phase08, without second subscriptions or duplicate event processing.
2. Use owner-qualified multi-host hooks and shared HostResourceStreamCoordinator for both app and tray. Visibility demand/backpressure and existing stream caps/REST fallback remain canonical; do not open SSE per component/window or change server limits.
3. Row kill captures profile/generation + terminal incarnation where available and confirmation; revalidation rejects stale action. Jump dispatches terminal.focus. Force sleep/settings/auth step-up stay existing fail-closed flows; no fake privileged capability executor or sleep tests on personal machine.
4. Add tray meters/alert badges and intent monitor.alert -> reveal exact incident; one attention/read state authority. Move activity cards into notifications using typed existing events, no raw output/env/private tool args.
5. Register Monitor manifest, palette/dock/tray handlers, save filter/view state only. Compact tray collapses metrics to pill; widths/zoom follow Phase04.

## Success / checks
Dashboard counts/session table, kill, host diagnosis/storage/incidents/fleet/idle-suspend accessible as one app. Background tray remains current via shared coordinator while hidden Monitor app body can unmount. Cover >=2 profiles with identical terminal IDs, one disconnect/reconnect and SSE stale/fallback; stale row cannot kill replacement process or another profile. Alert opens correct host/incident, not global active profile. Main runs contract commands after join; explicit unavailable capabilities remain unavailable.

## Risks / security / rollback
Fan-out can exceed stream leases; reuse coordinator/assert subscription counts. Redact identities under Cognito. Usage retirement never removes host metrics. Roll back Monitor/tray registration/extraction retaining old Dashboard/popover until cutover and preserving shipped P0. No server API/data mutation here; never repeat earlier one-time operator deletion. Next AI layer.

## Literal file actions and ownership

Paths below are project-root-relative (`/home/loidinh/WS/dam-hopper/`). Directory entries own all descendants; no glob expansion, no implicit adjacent-test ownership. All unlisted source/docs/other plans read-only. Existing files are re-read before editing; discoveries requiring additional writable paths return to coordinator for a reviewed contract revision.

### `implement-system-monitor` file actions

| Action | Literal writable path |
|---|---|
| Create | `packages/ui/src/os/apps/SystemMonitorApp.tsx` |
| Create | `packages/ui/src/os/MonitorTray.tsx` |
| Modify | `packages/ui/src/os/app-registry.ts` |
| Modify | `packages/ui/src/os/TopBar.tsx` |
| Modify | `packages/ui/src/os/intents.ts` |
| Modify | `packages/ui/src/os/notifications.ts` |
| Modify | `packages/ui/src/components/pages/DashboardPage.tsx` |
| Modify | `packages/ui/src/components/organisms/HostResourcePopover.tsx` |
| Modify | `packages/ui/src/components/organisms/HostResourceFleetDeck.tsx` |
| Modify | `packages/ui/src/components/organisms/HostResourceGlance.tsx` |
| Modify | `packages/ui/src/components/organisms/HostResourceDiagnosis.tsx` |
| Modify | `packages/ui/src/components/organisms/HostIdleSuspendStatus.tsx` |
| Create | `packages/ui/browser-tests/os-system-monitor.browser.tsx` |

## Durable task contracts

Exactly one authored fence; no execution state/hydration, completion or test receipts implied. Dependency IDs are plan-wide.

```evcrate-tasks
[
  {
    "id": "implement-system-monitor",
    "title": "Fold Dashboard and host resources into System Monitor with shared tray stream",
    "blocked_by": [
      "migrate-management-apps"
    ],
    "allowed_files": [
      "packages/ui/src/os/apps/SystemMonitorApp.tsx",
      "packages/ui/src/os/MonitorTray.tsx",
      "packages/ui/src/os/app-registry.ts",
      "packages/ui/src/os/TopBar.tsx",
      "packages/ui/src/os/intents.ts",
      "packages/ui/src/os/notifications.ts",
      "packages/ui/src/components/pages/DashboardPage.tsx",
      "packages/ui/src/components/organisms/HostResourcePopover.tsx",
      "packages/ui/src/components/organisms/HostResourceFleetDeck.tsx",
      "packages/ui/src/components/organisms/HostResourceGlance.tsx",
      "packages/ui/src/components/organisms/HostResourceDiagnosis.tsx",
      "packages/ui/src/components/organisms/HostIdleSuspendStatus.tsx",
      "packages/ui/browser-tests/os-system-monitor.browser.tsx"
    ],
    "constraints": [
      "Only listed paths writable; escalate additions to coordinator before editing.",
      "No mid-flight build/test/formatter runs while other writers are active; main integration owner verifies after the group joins."
    ],
    "acceptance": [
      "Counts/sessions/kill plus all host drilldowns and idle controls reachable; no Dashboard behavior lost.",
      "Tray and app share streams; captured-owner actions reject stale profile/generation/incarnation."
    ],
    "verification": [
      "pnpm --filter @dam-hopper/ui test -- src/os src/api/host-resource-stream-coordinator.test.ts src/components/organisms/HostResourceFleetDeck.test.tsx",
      "pnpm --filter @dam-hopper/ui test:browser -- browser-tests/os-system-monitor.browser.tsx browser-tests/host-resource-monitoring.browser.tsx browser-tests/idle-suspend-settings-status.browser.tsx",
      "pnpm --filter @dam-hopper/ui build"
    ]
  }
]
```

- [ ] <!-- evcrate-task:implement-system-monitor --> Fold Dashboard and host resources into System Monitor with shared tray stream
