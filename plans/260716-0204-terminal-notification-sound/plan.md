---
title: "Terminal notification sound"
description: "Play a safe, unobtrusive in-app chime for enabled Codex OSC 9 notifications."
status: completed
priority: P2
effort: 1h
issue: null
branch: main
tags: [feature, frontend, terminal]
created: 2026-07-16
completed: 2026-07-16T02:14:46+07:00
---

# Terminal Notification Sound

## Overview

Add one generated, low-volume Web Audio chime to the existing enabled Codex OSC 9 notification path. It is best-effort and must never affect existing in-app or native delivery.

## Preflight Contract

- **Output:** `terminal-notification-sound` helper plus OSC 9 integration.
- **Acceptance:** enabled valid OSC 9 attempts one chime; disabled setting plays nothing; native permission denial does not suppress it; unsupported, SSR, and autoplay-blocked browsers safely no-op; audio errors never interrupt delivery.
- **Scope:** session-local generated sound; fixed low volume; one shared/reused audio context.
- **Non-goals:** assets, dependencies, sound settings/persistence, volume or mute UI, server/API/config changes, native OS sound controls.
- **Risk/public contracts:** Web Audio may be suspended or reject; concurrent terminals must not leak contexts or break notifications; no permission prompt.
- **Affected systems:** `@dam-hopper/ui` notification integration and unit tests only.
- **Testing:** helper and integration unit tests; full UI test suite; UI build; scoped lint; browser regression if practical.
- **Open questions:** none.

## Phases

| # | Phase | Status | Effort | Link |
|---|---|---|---|---|
| 1 | Implement and validate | Completed 2026-07-16 02:14 +07 | 1h | [phase-01](./phase-01-implement-and-validate.md) |

## Side-Effect Review

- Auth/session/roles, API/client contracts, database, config, and deployment: unchanged.
- Security/privacy: no terminal text enters audio or persistent storage; no permission request.
- Performance/concurrency: reuse a singleton context and disconnect/release short-lived nodes; failures are swallowed locally.
- Business behavior: existing master setting gates all three channels; native denial remains independent of in-app sound.
- Docs/onboarding: no update expected unless implementation makes current documentation inaccurate.

## Handoff

Run `cmd_code plans/260716-0204-terminal-notification-sound` for Phase 01. Validate the existing notification-center behavior stays intact before finalizing.
