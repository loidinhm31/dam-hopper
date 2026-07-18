---
title: "Codex terminal notification controls"
description: "Add independently persisted toast, browser-popup, and selectable in-app chime controls for Codex OSC 9 notifications."
status: pending
priority: P2
effort: 6h
issue: null
branch: main
tags: [feature, frontend, backend, api]
created: 2026-07-19
---

# Codex Terminal Notification Controls

## Overview

Keep the existing Codex OSC 9 master switch and TUI sync. Add independent persisted switches for transient app toasts and browser popups, plus a selectable, volume-controlled in-app chime. Defaults preserve current enabled-delivery behavior.

## Preflight Contract

- **Output:** UI controls, config persistence, Web Audio patterns, tests, and docs for Codex notification delivery.
- **Acceptance:** master governs OSC 9/TUI sync; toast off retains bell/history; browser off creates no native `Notification`; chime remains independent; Default, Soft, Two-tone, Urgent play live at selected volume; preview uses selection; old configs retain defaults; unavailable/blocked audio no-ops.
- **Scope:** shared UI, global UI config/API/TOML, notification integration, tests, and relevant docs.
- **Non-goals:** uploads/assets, native-popup sound selection, service workers, permission-policy changes, or server-side notification delivery.
- **Public contracts:** camelCase API ↔ snake_case TOML mapping; browser permission stays runtime-only; sanitization, rate limits, history cap (50), and toast cap (3) stay unchanged.
- **Open questions:** none.

## Design Choice

Use four fixed **synthesized patterns**. Web Audio needs no asset pipeline, download, attribution/license review, or cache/error state, and it keeps the current best-effort model. Sound files could provide richer timbre but add bundle, loading, licensing, and missing-asset failure paths; defer them until custom audio is an explicit product need.

## Phases

| # | Phase | Status | Effort | Link |
|---|---|---|---|---|
| 1 | Persist delivery and pattern preferences | Completed 2026-07-19 01:07 +0700 | 1.5h | [phase-01](./phase-01-persist-notification-preferences.md) |
| 2 | Implement selectable synthesized chimes | Completed 2026-07-19 01:22 +0700 | 1.5h | [phase-02](./phase-02-implement-synthesized-chimes.md) |
| 3 | Wire delivery gates and Settings UI | Completed 2026-07-19 01:45 +0700 | 2h | [phase-03](./phase-03-wire-delivery-and-settings-ui.md) |
| 4 | Validate behavior and document contracts | Pending | 1h | [phase-04](./phase-04-validate-and-document.md) |

## Side-Effect Review

- Auth/session/roles: unchanged. Master-only writes Codex TUI config; browser permission is neither requested nor persisted by toggle saves.
- API/config: add backward-compatible optional UI fields with defaults and explicit camelCase-to-snake_case writes.
- Data/database: no schema migration or durable notification history; global TOML only.
- Security/privacy: preserve terminal text sanitization and diagnostics restrictions; no raw payload is added to config or audio APIs.
- Performance/concurrency: reuse one audio context; short-lived nodes must disconnect; existing bounds/rate limits remain.
- Deployment/onboarding: no dependency or browser-policy change. Update documentation with the delivery matrix and built-in pattern limits.

## Handoff

Run `cmd_code plans/260719-0032-codex-terminal-notification-controls`. Frontend implementation must follow current shared UI/Tailwind patterns and retain explicit-click-only permission/audio behavior.

## Unresolved Questions

None.
