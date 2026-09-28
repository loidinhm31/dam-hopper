# Phase 04 — profile-safe UI and notifications

## Context links

- [Plan](./plan.md), [architecture](../../docs/architecture/agent-status.md), [phase 03](./phase-03-omp-adapter-and-installer.md).
- Existing profile ownership: `api/connections.ts`, `api/ownership.ts`, `embed/dam-hopper-app.tsx:342-355`.
- Dependencies: server snapshot/push contract and functional OMP producer.

## Overview

Date: 2026-09-28. Priority: P2. Implementation: complete. Review: approved (advisor ADVICE_READY).

## Key Insights

- TerminalPanel/xterm mount is not a reliable semantic subscription lifetime. App root stays present across routes and inactive terminals.
- Existing notification history assigns fresh IDs per receipt; browser tags/rate limits use raw session IDs. Neither is adequate semantic dedupe.
- Existing focus policy is effectively always; no automatic focus suppression is present to preserve.
- Settings currently use Codex-specific scalar keys. Explicit one-way migration needed; never make OMP silently obey a Codex master switch.

## Requirements

- Owner-bound API/transport with profile generation, server epoch, terminal incarnation, report/snapshot revision fences.
- Subscribe-before-snapshot baseline, bounded race buffer, 15-second reconciliation, immediate lag recovery and no stale-generation fetch commit.
- Initial/reconnect snapshots are silent. Live attention delivered at most once per client across duplicates/replayed events; no closed-browser catch-up alerts.
- Maintain meaningful unknown/unavailable/unsupported presentation; do not replace existing output dot or process state.
- Existing Codex OSC notifications continue through shared presentation. No new alert framework or server-side seen state.
- Shared settings object preserves all old Codex values and leaves OMP notifications off until explicitly enabled. Badges are independent.

## Architecture

Mount `AgentStatusBridge` next to `TerminalNotificationToastViewport` in `dam-hopper-app.tsx`. It uses `subscribeConnections` and bound clients for every connected profile; owns subscription cleanup, baseline and periodic reconciliation. A small semantic store owns row state/attention cursors, distinct from terminal-output-activity.

On connecting: subscribe, buffer <=256 events, fetch snapshot R, silently install baseline, drop buffered events <=R, apply newer current-owner events. On gaps/overflow/invalid data rebaseline without replay notifications. On disconnect mark known rows unavailable and stop notifications; reject old asynchronous results. 404 means unsupported until next connection generation.

Before any channel side effect, dedupe stable attention ID. History, toast, sound and browser delivery share that decision; per-channel permission/rate-limit failure does not replay the event later. Two devices may each notify by user choice.

## Related code files

Create:
- `packages/ui/src/stores/agent-status.ts` — semantic snapshots and bounded attention cursors.
- `packages/ui/src/hooks/use-agent-status-connections.ts` — connection-owned subscriptions/reconciliation.
- `packages/ui/src/components/organisms/AgentStatusBridge.tsx` — app-lifetime bridge.
- `packages/ui/src/components/atoms/AgentStatusBadge.tsx` — compact accessible semantic state.
- Focused store/decoder/reconnect tests beside these modules; no permanent tests of wiring/text copies.
Modify:
- `packages/ui/src/embed/dam-hopper-app.tsx` — mount bridge once.
- `packages/ui/src/api/agent-status-types.ts`, `client.ts`, `ws-transport.ts` — typed read API and validated pushes; reuse `connections.ts`/`ownership.ts` owner APIs.
- `packages/ui/src/components/organisms/TerminalTabBar.tsx`, `TabBar.tsx`, `TerminalRuntimeNavigatorItem.tsx` — semantic badge beside existing output/process display.
- `packages/ui/src/stores/terminal-notifications.ts` — stable optional semantic event identity and incarnation-qualified targets, preserving OSC events.
- `packages/ui/src/lib/terminal-notification-signal-parser.ts`, `terminal-agent-notification-integration.ts`, `browser-notification-service.ts`, `terminal-notification-navigation.ts` — reuse notification pipeline; profile/incarnation-qualified tags/rate limits and safe target selection.
- `packages/ui/src/stores/settings.ts`, `lib/ui-config.ts`, `api/client.ts` — canonical versioned agent preferences and legacy read migration.
- `packages/ui/src/components/organisms/SettingsAppearanceSection.tsx`, `components/molecules/TerminalAgentNotificationSettings.tsx` — one Agent notifications section with Codex/OMP choices and existing channel controls.
- Corresponding existing settings, notification, navigation, and row tests where contract changes require updates.
Delete: obsolete `terminalCodex*` live-state/write fields and callers after one-way normalization. Retain migration readers only where actual persisted input enters; no dual-write or runtime aliases. Do not revive unused output-quiet AgentActivityTracker for this feature.

## Implementation Steps

1. Add protected snapshot client and strict push decoding using captured ConnectionRef; add new OMP identity without reclassifying other agents.
2. Implement app-root subscription lifecycle and semantic store with precise baseline race handling. Reconciliation does not depend on selected project or mounted xterm.
3. Add separate badge to all three named row surfaces; text/tooltip/non-color cue, compact/mobile fit. Plain shells have no agent badge; stale known agents show unavailable/unknown.
4. Feed live attention into existing history/toast/sound/browser path only after stable-ID dedupe. Preserve profile/incarnation in selection; closed/replaced targets must not focus replacement terminal.
5. Correct shared browser tag/rate-limit ownership using existing canonical key helpers; migrate all reset callers. Do not change enabled/focus behavior of existing Codex notifications.
6. Normalize persisted/config preference inputs into `terminalAgentNotifications` v1. Explicit new shape wins; migrate Codex scalar values and existing legacy alias; OMP defaults off. Strip obsolete fields from normal saves/exports and update all readers/writers/UI controls.
7. Cover C09–C12, C16–C17 and C19 in focused contract/store tests. Exercise actual surfaces in Chromium for inactive terminal, route changes, two profiles with identical IDs and permission denied; no new redundant UI test suite.

## Todo list

- [x] Add owner-safe snapshot/event bridge and semantic store.
- [x] Add three badge surfaces without changing output/process meanings.
- [x] Deduplicate notifications before all channel side effects.
- [x] Qualify tags/navigation by profile and incarnation.
- [x] Complete one-way preference migration and all caller cutover.
- [x] Verify real browser interaction and existing Codex behavior.

## Success Criteria

Status continues while terminal tab inactive or another route is open. Identical terminal IDs on two servers never suppress/overwrite each other. Reconnect restores status with zero replay alerts. Ended/blocked events produce one history record per client; OS permission denial does not affect badges/history. Migrated Codex preferences match prior behavior; OMP is explicitly enabled separately.

## Risk Assessment

Snapshot/event races and scattered preferences cause silent duplication or missing notifications. Centralize authority/dedupe at app lifetime, not per badge. Use revision-aware baseline reconciliation; never use receipt timestamp as semantic event ID.

## Security Considerations

Remote strings are validated and rendered as text; only generic attention reason codes reach new notifications. Bind all navigation/API requests to captured owner; reject retired generation/incarnation. Never expose local reporter capabilities to browser.

## Next steps

Phase 05 qualifies actual OMP-to-server-to-browser flow and packaging. Do not claim cross-client exactly-once, closed-browser push, viewed acknowledgement or project-level aggregation.
