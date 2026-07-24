---
title: "Controlled Browser Debug Preview and Terminal Handoff"
description: "Add a cooperative iframe browser tool that captures selected UI context into an ephemeral bundle for any selected xterm agent."
status: in-progress
priority: P2
effort: 52h
branch: main
tags: [feature, frontend, backend, api, security, experimental]
created: 2026-07-24
---

# Controlled Browser Debug Preview and Terminal Handoff

## Overview

Add a web-only Browser tool for controlled loopback applications and exact
currently-ready DamHopper tunnel origins. A dev-only target bridge returns
bounded DOM/ARIA/locator data through authenticated `postMessage`; optional
user-mediated current-tab capture supplies pixels. The user previews a
sanitized selection, then attaches short-lived JSON/PNG paths to a chosen xterm
without auto-submit.

## Phases

| # | Phase | Status | Effort | Link |
|---|---|---|---:|---|
| 1 | Feasibility, protocol, bridge package | Done (2026-07-24 15:09 +07) | 6h | [phase-01](./phase-01-feasibility-and-bridge-contracts.md) |
| 2 | Ephemeral artifacts and REST API | Done (2026-07-24 15:46 +07) | 10h | [phase-02-artifact-manager-and-api.md](./phase-02-artifact-manager-and-api.md) |
| 3 | Browser tool, iframe, origin policy | Done (2026-07-24 17:27 +07) | 10h | [phase-03-browser-tool-and-iframe-bridge.md](./phase-03-browser-tool-and-iframe-bridge.md) |
| 4 | Screen capture, crop, fallback | Pending | 8h | [phase-04-capture-and-image-fallback.md](./phase-04-capture-and-image-fallback.md) |
| 5 | Terminal handoff and workspace integration | Pending | 8h | [phase-05-terminal-handoff-and-workspace-integration.md](./phase-05-terminal-handoff-and-workspace-integration.md) |
| 6 | Hardening, tests, docs, manual gate | Pending | 10h | [phase-06-hardening-tests-and-docs.md](./phase-06-hardening-tests-and-docs.md) |

## Dependencies

- Existing authenticated REST/WS transport and PTY sessions.
- `TunnelSessionManager` ready URLs and lifecycle events.
- Target app can include the framework-neutral dev bridge and allow the parent
  origin through CSP `frame-ancestors`.
- Browser supports iframe messaging and, optionally, `getDisplayMedia`.
- A singleton keep-alive host preserves one iframe DOM node for the full
  Workspace lifetime, reparenting it into visible or parked containers.
- No extension, reverse proxy, Electron migration, or Tauri sidecar in V1.

## Release gate

All phases remain pending until hostile-page tests, capture-denial fallback,
stale-session handling, tunnel shutdown, artifact cleanup, and manual Chromium
permission checks pass.

## Validation Summary

**Validated:** 2026-07-24

**Questions asked:** 7

### Confirmed Decisions

- V1 is capture + bundle handoff only; no page-control CLI/MCP.
- Bridge builds ESM and IIFE from one framework-neutral TypeScript source.
- Automatic crop is progressive; DOM + manual image remains releasable fallback.
- Direct server-local PTYs may read ephemeral bundle paths; containers/SSH defer.
- Live iframe persists for the full Workspace lifetime.

### Applied Revisions

- Phase 03/05 specify singleton iframe keep-alive and reparenting outside
  conditional shells.
- Phase 04/06 separate capture privacy: closing Browser stops `MediaStream`
  tracks but does not unload the iframe.
- Phase 01 requires ESM and IIFE outputs from one bridge source.

### Phase 2 validation

- Completed implementation and review: 2026-07-24 15:46 +07 (Asia/Ho_Chi_Minh).
- `cd server && cargo test`: 492 passed, 0 failed.
- Artifact manager/API tests cover auth, terminal/selection validation, JSON/PNG caps, MIME and PNG validation, expiry, deletion races, shutdown cleanup, and private files.

### Phase 3 validation

- Completed implementation and user-approved review: 2026-07-24 17:27 +07 (Asia/Ho_Chi_Minh).
- Browser tool is mounted across Workspace IDE, terminal, and compact surfaces with a singleton stable iframe overlay and exact-origin allowlist.
- Validation covers origin parsing, stable iframe behavior, panel rendering, workspace integration, and Chromium browser-flow screenshots/tests.
