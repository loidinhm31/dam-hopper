# Phase 05 — Smoke Tests + Docs

## Context Links

- Parent plan: `plans/20260425-port-detection-tunnel-combined/plan.md`
- Depends on: Phase 04 (layout integration complete)

## Overview

| Field | Value |
|---|---|
| Date | 2026-04-25 |
| Description | Manual smoke test checklist, CLAUDE.md update, mark old plan superseded |
| Priority | P3 |
| Implementation status | pending |
| Review status | pending |
| Effort | ~1h |

## Requirements

- All smoke tests passing manually.
- `cargo test` still green.
- `pnpm build` still green.
- Old plan marked superseded.
- CLAUDE.md updated if tunnel/ports section is stale.

## Smoke Test Checklist

### Backend
- [ ] `cargo test` — all tests pass
- [ ] Server starts: `cargo run -- --no-auth --workspace /path`
- [ ] `GET /api/ports` returns `{ports: []}` or detected ports
- [ ] `GET /api/tunnels` returns `[]`
- [ ] `POST /api/tunnels {port: 3000, label: "test"}` returns 503 (cloudflared not installed) OR 201 if installed
- [ ] `GET /api/proxy-token` returns 404 (route removed)
- [ ] `GET /proxy/3000/` returns 404 (route removed)

### Frontend — same-host scenario
- [ ] Open app at `http://localhost:4800`
- [ ] Start a dev server on port 5173 (Vite)
- [ ] Ports panel shows `:5173` row with "listening" badge within ~5s
- [ ] "Open localhost" button visible and opens `http://localhost:5173/` in new tab
- [ ] "Start tunnel" button visible; click shows spinner
- [ ] On `tunnel:ready` event: URL appears inline in row
- [ ] "Stop tunnel" button removes the URL and row returns to State A
- [ ] "Copy URL" copies Cloudflare URL to clipboard
- [ ] QR popover shows QR code

### Frontend — cross-host scenario
- [ ] Configure a server profile pointing to a remote server URL (different host)
- [ ] "Open localhost" button NOT visible in any port row
- [ ] "Start tunnel" still visible

### Frontend — custom port form
- [ ] Port 5432 (danger) shows validation error
- [ ] Port 65536 shows validation error
- [ ] Port 4000 (valid, not detected) submits successfully → tunnel starts

### Frontend — cloudflared missing
- [ ] When server returns 503 "binary not found", InstallerRow appears
- [ ] Auto-install button triggers `POST /api/tunnels/install`
- [ ] Install progress bar updates via WS events

### Frontend — WS reconnect
- [ ] Disconnect server briefly → reconnect → ports and tunnels list refreshes

## Docs Update

### CLAUDE.md — update if stale
Check the tunnel + ports section in CLAUDE.md. If it references `TunnelPanel` + separate `PortsPanel`, update to "Combined PortsPanel in sidebar — port detection + cloudflare tunnel actions."

### Mark old plan superseded
Add one line to `plans/20260424-terminal-split-and-port-forward/plan.md` immediately after the YAML frontmatter:

```md
> **Note:** Phases 04 (proxy route) and 05 (ports UI) of this plan are superseded by `plans/20260425-port-detection-tunnel-combined/`. Phases 01-03 (split panes) are complete.
```

## Implementation Steps

1. Run `cargo test` — record result.
2. Run manual smoke tests above with a local server.
3. Add superseded note to old plan.
4. Review CLAUDE.md for stale tunnel/ports references and update.
5. `pnpm build` final verification.
6. Update phase statuses in this plan to `completed`.

## Todo List

- [ ] `cargo test` passes
- [ ] Backend smoke tests pass
- [ ] Frontend same-host smoke tests pass
- [ ] Frontend cross-host check (or skip with note if no remote server available)
- [ ] Custom port form validation tests
- [ ] Add superseded note to `plans/20260424-terminal-split-and-port-forward/plan.md`
- [ ] Review and update CLAUDE.md if stale
- [ ] `pnpm build` final green

## Success Criteria

- All backend smoke tests pass.
- Frontend same-host scenario fully functional.
- Old plan marked superseded.
- `cargo test` + `pnpm build` green.

## Risk Assessment

| Risk | Likelihood | Impact | Mitigation |
|---|---|---|---|
| cloudflared not installed on test machine | High | Low | Test install flow via InstallerRow; alternative: mock install for test |
| Remote server not available for cross-host test | Medium | Low | Document as "skipped — verify on deployment" |

## Security Considerations

Final review: confirm no `/proxy/*` route in router, no proxy-token endpoint, no `reqwest` dep if it was exclusively used by proxy.

## Unresolved Questions

None — this is the validation phase.
