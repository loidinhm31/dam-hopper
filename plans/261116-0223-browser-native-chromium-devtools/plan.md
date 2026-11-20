---
title: "Native Host Chromium Developer Tools and File Downloads in Browser App"
description: "Embed host Chromium's native DevTools frontend and enable native host file downloads inside BrowserApp."
status: completed
priority: P2
effort: 14h
branch: main
tags: [feature, backend, frontend, api, security]
created: 2026-11-16
---

# Native Host Chromium Developer Tools and File Downloads in Browser App

## Overview

Enable two native host-Chromium capabilities in `BrowserApp`:
1. **Native Chromium Developer Tools (`devtools_app.html`):** Open the host machine's bundled Chromium DevTools inside a docked `BrowserApp` split pane via a target-scoped asset and CDP WebSocket proxy to check Console errors, Network requests, DOM elements, and Issues.
2. **Native Host File Downloads:** Configure host Chromium (`Browser.setDownloadBehavior`) to save browser-initiated downloads directly to the host machine's native `Downloads` directory (`~/Downloads`) and surface live download progress/completion in `BrowserApp`.

<!-- evcrate-progress:start -->
Tasks: 3/3 completed; remaining: 0.
<!-- evcrate-progress:end -->

## Phases

| # | Phase | Status | Effort | Link |
| --- | --- | --- | --- | --- |
| 1 | Backend DevTools Proxy & Native Host Downloads | DONE (2026-11-16 04:20:50 EST) | 6h | [phase-01](./phase-01-backend-devtools-proxy.md) |
| 2 | UI DevTools Dock, Toolbar Controls & Download Banner | DONE (2026-11-16 05:01:24 EST) | 5h | [phase-02](./phase-02-ui-devtools-dock.md) |
| 3 | Integrated Verification & Architecture Documentation | DONE (2026-11-16 09:04:55 EST) | 3h | [phase-03](./phase-03-verification-and-docs.md) |

## Settled Design Decisions

- **Host-Bundled Native Chromium DevTools:** Proxy `/devtools/*` assets (`devtools_app.html`, ES modules, CSS) directly from `127.0.0.1:{chrome_port}/devtools/*` under `/api/browser/devtools/{token}/{*path}`. Refresh the 300s lease TTL on each 5s live-auth check tick while the DevTools WebSocket is open so lazy panel imports never expire mid-session.
- **Target-Scoped CDP Isolation & Geometry Protection:** Relay `/api/browser/devtools/{token}/ws` to `ws://127.0.0.1:{chrome_port}/devtools/page/{native_target_id}`. Reject browser-wide, cross-target, and viewport-mutating commands (`Browser.*`, `Target.createTarget`, `Target.closeTarget`, `Target.activateTarget`, `Target.getTargets`, `Target.sendMessageToTarget`, `Target.attachToTarget` for `targetId != native_target_id`, and `Emulation.*` `GEOMETRY_METHODS`) with JSON-RPC `-32601` so `ScreencastProducer` remains sole owner of tab geometry and `input_available`.
- **Native Host File Downloads (`Browser.setDownloadBehavior`):** Configure `Browser.setDownloadBehavior({ behavior: "allow", downloadPath, eventsEnabled: true })` targeting the host's native `Downloads` directory (`XDG_DOWNLOAD_DIR` or `$HOME/Downloads`). Allow `data:` and policy-validated `blob:` URLs in `NetworkPolicy::check_request` when `RequestKind::Navigation` occurs on `<a download>` links, and publish `lastDownload` on `BrowserSessionDto` via `sessionUpdated`.
- **On-Demand Stealth & Privacy Teardown:** `stealth.rs` remains untouched during normal browsing/login. DevTools unmounts and revokes its lease immediately on Cognito Privacy Mode, Lock Screen, tab switch/close, window minimize/hide, single-session logout, target retirement, or profile reset.

## Dependencies & Related Plans

- **Concurrent overlap:** [Host Browser review remediation](../261109-2251-host-browser-review-remediation/plan.md) (`in-progress`, phases 02–04 pending) shares `server/src/browser_host/` and `packages/ui/src/os/apps/BrowserApp.tsx`. Serialize conflicting writers through one integration owner.
- **Review Status:** Independent plan review ([plan-review.md](./reports/plan-review.md)) completed; all 4 findings (2 high, 2 medium) accepted and propagated into Phases 01–03.

## Non-Goals

- No browser-wide `/devtools/browser/*` access from UI DevTools; no custom React Console/Network re-implementation; no persistence of DevTools tokens in `localStorage`.

## Unresolved Questions

- None. User confirmed native host Chromium for both DevTools and host-machine file downloads.
