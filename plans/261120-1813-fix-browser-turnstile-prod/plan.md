---
title: "Fix Browser Turnstile Loop in Production Deploy"
description: "Preserve pre-click hover, human click dwell, Web Worker UA/Client Hints stealth, and OOPIF iframe admission under production latency."
status: completed
priority: P1
effort: 7h
branch: main
tags: [bugfix, frontend, backend, browser-host]
created: 2026-11-20
---

# Fix Browser Turnstile Loop in Production Deploy

## Overview

DamHopper Browser passes Cloudflare Turnstile locally (`http://localhost:...`) yet loops in production (`https://app-hop.qm-hub-v001.cloud` + `dam-hopper-api.service` v0.18.0) due to four interacting gaps under real WAN RTT and Chromium 156:
1. Pre-click hover moves are dropped while `!isController`, and RTT > click dwell causes synchronous 0 ms out-of-order `pointerDown`/`pointerMove`/`pointerUp` replay.
2. `Browser.getVersion` prefers reduced `userAgent` (`156.0.0.0`) over `product` (`156.0.8078.79`), repeats uncached per `iframe`, and skips `Emulation.setUserAgentOverride` on paused `worker`/`shared_worker` targets.
3. OOPIF `iframe` `ChildAttached` kills paused Turnstile iframes when the parent's async `Page.getFrameTree` has not entered `state.frame_sessions` yet.
4. Patched `ANTI_DETECTION_SCRIPT` methods (notably `Document.prototype.hasFocus`) expose inline JS via `.toString()`.

Pure bug-fix scope aligning runtime behavior with `docs/architecture/host-browser-cdp-streaming.md` (security fences, origin/CORS/TLS, `network_policy`, and `downscale_input_qualified` remain untouched).

## Phases

| # | Phase | Status | Effort | Link |
|---|-------|--------|--------|------|
| 1 | Backend Stealth, Worker Overrides & OOPIF Admission | Completed | 3h | [phase-01](./phase-01-backend-worker-stealth-and-oopif.md) |
| 2 | Frontend Pre-Click Hover Replay & Click Dwell | Completed | 3h | [phase-02](./phase-02-frontend-click-handoff-and-hover.md) |
| 3 | Verification, Regression Gates & Rollout Notes | Completed | 1h | [phase-03](./phase-03-verification-and-rollout.md) |

## Dependencies

- Phase 1 and Phase 2 touch disjoint crates/packages (`server/` vs `packages/ui/`) and may execute concurrently or sequentially.
- Within Phase 1, `fix-oopif-frame-tree-admission-race` depends on `fix-chrome-identity-and-worker-stealth` (shared edits in `server/src/browser_host/manager.rs`).
- Phase 3 depends on both Phase 1 and Phase 2.
