---
title: "Multi-profile Host Resources watch"
description: "Add an automatic fleet overview with profile-safe monitoring and focused host drilldown."
status: completed
priority: P2
effort: 19h
branch: main
tags: [feature, frontend, accessibility, monitoring]
created: 2026-09-20
---

# Multi-profile Host Resources watch

## Overview

Extend the top-nav Host Resources popover with the selected **Fleet Deck & Drilldown Popover** pattern. Automatically watch configured profiles that are connected or marked auto-connect, keep each profile's telemetry/cache ownership isolated, and retain today's exact single-profile experience.

No Rust, Axum, transport, or wire-contract work. Existing resource snapshot, alert history, metrics, config, idle-suspend, and force-suspend APIs are sufficient.

## Status

- Plan status: COMPLETE (4/4 phases; 100%; updated 2026-09-20).
- Phase 03 — Host Resource popover integration: DONE (2026-09-20; 100%; 6/6h).
- Phase 04 — Verification and testing: DONE (2026-09-20; 100%; 4/4h). Focused unit/component and Chromium validation passed 102/102; see the [Phase 04 tester report](../reports/tester-260920-1130-phase04-multi-profile-host-resources.md) and [code review](../reports/code-review-260920-1132-phase04-verification-and-testing.md).

## Phases

| Phase | Goal | Status / progress | Effort |
|---|---|---|---:|
| [01 — Multi-profile state and hooks](./phase-01-multi-profile-state-and-hooks.md) | Automatic watch scope, isolated `useQueries`, fleet aggregation | DONE / 100% (2026-09-20) | 5h |
| [02 — Fleet deck and cards](./phase-02-fleet-deck-and-card-components.md) | Accessible overview cards and empty/partial states | DONE / 100% (2026-09-20) | 4h |
| [03 — Host Resource popover integration](./phase-03-host-resource-popover-integration.md) | Header pills, fleet toggle, profile drilldown, single-profile compatibility | DONE / 100% (2026-09-20) | 6h |
| [04 — Verification and testing](./phase-04-verification-and-testing.md) | Unit, interaction, accessibility, polling, and edge-case proof | DONE / 100% (2026-09-20) | 4h |

## Preflight Contract

- Watch scope = configured profiles where `connection.status === "connected" || profile.autoConnect`; never initiate a connection.
- Multi-profile mode only when no explicit `owner` is supplied and more than one profile is configured. One configured profile keeps the current rendering, labels, read acknowledgement, and query behavior.
- Every remote read binds a current `ConnectionRef` through `resolveTargetOwner`; every cache key uses `profileQueryKey` including generation.
- `useQueries` performs 15s resource-snapshot reconciliation independently per connected watched profile. One failure never hides healthy peers.
- Only the visible connected drilldown calls `useHostMetrics` with its 1s interval. Deck cards never start high-frequency polling.
- Alert presentation remains bounded in `useHostResourceAlertPresentationStore`; fleet counts read `byProfile`, while legacy global state remains compatible.
- Duplicate names, endpoints, hostnames, and incident IDs never merge profile identity. Profile ID is the UI/cache join key.
- Existing server authorization, SSE validation, storage pinning, idle-suspend revision fencing, and force-suspend confirmation remain unchanged.

## Side-Effect Review Checklist

- [x] No connect/disconnect, profile persistence, server config, telemetry, sleep, or host-action mutation added by fleet observation.
- [x] No ambient/active-profile fallback after a fleet card selects an owner.
- [x] Removed/disconnected/replaced owners stop polling; late generations cannot publish into current cards.
- [x] Opening Fleet does not acknowledge every profile; inspecting a profile acknowledges only that profile.
- [x] Offline auto-connect cards qualify cached data as last known and cannot open destructive controls.
- [x] Popover close/unmount removes observers and restores focus; no timer/listener leak.
- [x] No new dependency, endpoint, Rust change, persistence key, or background sampler.
- [x] User-provided profile/host/path text renders as text, never HTML, URL navigation, or command input.

## Dependency flow

Phase 01 defines the view model consumed by Phase 02. Phase 03 composes both without duplicating current drilldown content. Phase 04 validates all contracts and performs the post-implementation architecture comparison.

## Unresolved questions

None. Product choices and watch scope are fixed by this plan.