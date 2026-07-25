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
currently-ready DamHopper tunnel origins. An extension-assisted target bridge
returns bounded DOM/ARIA/locator data through origin-bound `postMessage`;
optional user-mediated current-tab capture supplies pixels. The user previews a
sanitized selection, then attaches short-lived JSON/PNG paths to a chosen xterm
without auto-submit.

## Phases

| # | Phase | Status | Effort | Link |
|---|---|---|---:|---|
| 1 | Feasibility, protocol, bridge package | Done (2026-07-24 15:09 +07) | 6h | [phase-01](./phase-01-feasibility-and-bridge-contracts.md) |
| 2 | Ephemeral artifacts and REST API | Done (2026-07-24 15:46 +07) | 10h | [phase-02-artifact-manager-and-api.md](./phase-02-artifact-manager-and-api.md) |
| 3 | Browser tool, iframe, origin policy | Done (2026-07-24 17:27 +07) | 10h | [phase-03-browser-tool-and-iframe-bridge.md](./phase-03-browser-tool-and-iframe-bridge.md) |
| 4 | Screen capture, crop, fallback | Done (2026-07-24 18:20 +07) | 8h | [phase-04-capture-and-image-fallback.md](./phase-04-capture-and-image-fallback.md) |
| 5 | Terminal handoff and workspace integration | Done (2026-07-25 15:18 +07) | 8h | [phase-05-terminal-handoff-and-workspace-integration.md](./phase-05-terminal-handoff-and-workspace-integration.md) |
| 6 | Hardening, tests, docs, manual gate | Complete (implementation, 2026-07-25 16:02 +07) | 10h | [phase-06-hardening-tests-and-docs.md](./phase-06-hardening-tests-and-docs.md) |

## Dependencies

- Existing authenticated REST/WS transport and PTY sessions.
- `TunnelSessionManager` ready URLs and lifecycle events.
- Client browser can load the packaged Chromium extension; target app still
  permits the parent through CSP `frame-ancestors`.
- Browser supports iframe messaging and, optionally, `getDisplayMedia`.
- A singleton keep-alive host preserves one iframe DOM node for the full
  Workspace lifetime in a stable overlay that moves off-screen when hidden.
- No reverse proxy, Electron migration, or Tauri sidecar in V1. Chromium
  extension distribution and setup are now the V1 bridge delivery path.

## Release gate

Automated validation is complete: UI 689 tests, Chromium 39 tests, Rust 494
tests, build pass, and lint pass. Native Chromium permission chooser, HiDPI,
live-tunnel, and real-xterm checks remain manual release follow-up and are not
recorded as passed.

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

### Phase 5 validation

- Approved after terminal handoff, extension setup, and origin-bound bridge review: 2026-07-25 15:06 +07 (Asia/Ho_Chi_Minh).
- Handoff requires explicit review/confirmation, a mounted/registered/live terminal, server-generated artifact paths, one-time server claim, control-free single-line PTY input, and no Enter submission.
- Web build stages a deterministic MV3 archive; the client presence marker is onboarding telemetry only. Bridge activation requires loopback or configured exact DamHopper parent origins.
- `@dam-hopper/browser-bridge`: 11 tests passed; `@dam-hopper/ui`: 684 tests passed; Chromium: 38 tests passed; Rust: all suites passed (439 unit, 50 integration); build/lint passed with 0 errors and 14 existing warnings.
- Manual Chromium extension installation, permission, deployed-origin, tunnel, and real-xterm checks remain Phase 6 release gates.

### Phase 6 validation

- Implementation completed: 2026-07-25 16:02 +07 (Asia/Ho_Chi_Minh).
- Automated validation: UI 689 tests passed; Chromium 39 tests passed; Rust 494 tests passed; build and lint passed.
- Native Chromium permission chooser, HiDPI, live-tunnel, and real-xterm checks remain manual release follow-up; not passed by automation.
