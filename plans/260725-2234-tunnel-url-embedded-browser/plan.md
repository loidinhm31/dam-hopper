---
title: "Open Tunnel URLs in Embedded Browser"
description: "Route ready cloudflared tunnel URLs from port surfaces into the existing embedded browser."
status: pending
priority: P2
effort: 4h
branch: main
tags: [feature, frontend, browser, tunnel]
created: 2026-07-25
---

# Open Tunnel URLs in Embedded Browser

## Overview

Add an embedded-browser action to ready tunnel URLs in Ports and Runtime views. Reuse existing tunnel lifecycle, URL validation, and browser host; no server/protocol changes.

## Assumptions

- Action replaces current browser target and reveals the browser.
- Only `status: "ready"` tunnels with a URL expose the action.
- Existing external-tab link, copy, QR, and stop actions remain.

## Preflight Contract

- Source: current `TunnelInfo`/`RuntimePort`, ready status, non-empty URL.
- Boundary: port UI emits URL; `WorkspacePage` coordinates navigation + layout.
- Trust: browser controller normalizes and revalidates against ready tunnel origins.
- Success: target/history update, prior selection/capture/console reset, browser enters loading.
- Failure: controller error shown; no unsafe iframe navigation.

## Phases

| # | Phase | Status | Progress | Effort |
|---|---|---|---|---|
| 1 | [Wire tunnel URL to embedded browser](./phase-01-wire-tunnel-url-to-embedded-browser.md) | Pending | 0% | 4h |

## Side-effect Checklist

- [ ] No backend, tunnel lifecycle, transport, or API shape changes.
- [ ] External-link behavior remains available.
- [ ] Desktop IDE reveals Terminal/browser split; terminal mode opens browser split.
- [ ] Compact layout selects Browser surface; workspace mode unchanged.
- [ ] Existing stopped/failed tunnel invalidation remains authoritative.
- [ ] No duplicate navigation/history writes or click bubbling into terminal selection.

## Validation

- UI unit/integration tests for ready-only actions, callback propagation, atomic navigation, and mode-aware reveal.
- `pnpm --filter @dam-hopper/ui test`
- `pnpm --filter @dam-hopper/ui build`

## Frontend Handoff

During `/code`, follow `docs/design-guidelines.md` if present. It was absent at planning time. Call `ui-ux-designer` if icon placement, labels, responsive behavior, or interaction hierarchy becomes non-trivial.

## Unresolved Questions

None.
