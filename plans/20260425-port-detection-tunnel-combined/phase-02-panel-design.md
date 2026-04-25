# Phase 02 — Combined Panel Design

## Context Links

- Parent plan: `plans/20260425-port-detection-tunnel-combined/plan.md`
- Depends on: Phase 01 (clean backend)
- Scout: `plans/20260425-port-detection-tunnel-combined/reports/00-scout-existing-code.md` §6-8

## Overview

| Field | Value |
|---|---|
| Date | 2026-04-25 |
| Description | ASCII mockup, row state machine, behavior matrix — implementation contract for Phase 03 |
| Priority | P2 |
| Implementation status | pending |
| Review status | pending |
| Effort | ~1.5h |

## Key Insights

- The panel replaces both TunnelPanel and PortsPanel. One section, one component.
- Three row states per port: (A) no tunnel, (B) tunnel starting, (C) tunnel ready.
- "Open localhost" is only rendered when `isLocalServer()` returns true — gated at render time, not hidden.
- Custom port form at bottom allows starting a tunnel for ports not yet detected (e.g., 4000 not in `/proc/net/tcp` yet, or a service on a non-detected port).
- The cloudflared installer row from TunnelPanel must be preserved — cloudflared missing is a valid state.
- Warning banner (public URL) must appear once (localStorage key `tunnel_warning_acknowledged`).

## ASCII Mockup

```
╭─ ports ──────────────────────── 3 ─╮
│ ● :5173  vite-app   [listening]    │
│   [↗ open localhost] [☁ tunnel]    │  ← State A: no tunnel, same-host
│                                    │
│ ● :3000  api-server [listening]    │
│   [☁ ···]                          │  ← State B: tunnel starting (spinner)
│                                    │
│ ● :8080  storybook  [provisional]  │
│   [☁ stop] https://abc.trycf.com  │  ← State C: tunnel ready, URL shown
│           [copy] [QR] [↗ open]     │
│                                    │
│ + Add port: [_5432___] [☁ tunnel]  │  ← Custom port form
╰────────────────────────────────────╯

[same-host=false variant]
│ ● :5173  vite-app   [listening]    │
│   [☁ tunnel]                       │  ← No "open localhost" button
```

## Port Row State Machine

```
             port:discovered
                  │
                  ▼
          ┌──────────────┐
          │  State A     │ ← no tunnel for this port
          │  no tunnel   │
          └──────┬───────┘
                 │ user clicks "Start tunnel"
                 │ POST /api/tunnels {port, label}
                 ▼
          ┌──────────────┐
          │  State B     │ ← TunnelInfo.status === "starting"
          │  starting    │ ← spinner on "☁" button
          └──────┬───────┘
         ┌───────┴──────────┐
         │ tunnel:ready     │ tunnel:failed
         ▼                  ▼
  ┌──────────────┐   ┌──────────────┐
  │  State C     │   │  State A     │ ← failed: back to A + error banner
  │  tunnel      │   │  + error msg │
  │  ready       │
  └──────┬───────┘
         │ user clicks "Stop" or tunnel:stopped
         ▼
  ┌──────────────┐
  │  State A     │ ← back to no tunnel
  └──────────────┘

             port:lost
                  │  (in any state)
                  ▼
          row disappears from list
          (active tunnel left running — user may want to keep sharing)
```

## Behavior Matrix

| Scenario | "Open localhost" | "Start tunnel" | "Stop tunnel" | Tunnel URL | Copy | QR |
|---|---|---|---|---|---|---|
| State A, same-host | visible | visible | hidden | hidden | hidden | hidden |
| State A, cross-host | hidden | visible | hidden | hidden | hidden | hidden |
| State B (starting) | — | spinner, disabled | hidden | hidden | hidden | hidden |
| State C (ready), same-host | visible | hidden | visible | visible | visible | visible |
| State C (ready), cross-host | hidden | hidden | visible | visible | visible | visible |
| State B failed | — | visible (retry) | hidden | hidden | hidden | hidden |

## Component Hierarchy

```
PortsPanel
├── WarningBanner           (reuse from TunnelPanel — once-dismissed)
├── InstallerRow            (reuse from TunnelPanel — cloudflared missing)
├── ul.ports-list
│   └── PortRow (per detected port)
│       ├── status dot + port number + project label + state badge
│       └── action bar (group-hover reveal)
│           ├── OpenLocalButton     (isLocalServer only)
│           ├── TunnelStartButton   (State A) / TunnelSpinner (State B) / TunnelStopButton (State C)
│           ├── TunnelUrl link      (State C)
│           ├── CopyButton          (State C)
│           └── QrButton            (State C)
└── AddPortForm
    ├── number input (port)
    └── "Start tunnel" submit button
```

## Data Model for `usePorts` (combined hook)

```ts
interface PortEntry {
  // From DetectedPort
  port: number;
  project: string | null;
  state: "provisional" | "listening" | "lost";
  // Derived: active tunnel for this port (null if none)
  tunnel: TunnelInfo | null;
}
```

The hook merges `DetectedPort[]` from `port:list` with `TunnelInfo[]` from `tunnel:list` by matching `TunnelInfo.port`. It subscribes to both sets of WS push events.

## Custom Port Form Validation

- Port must be 1–65535.
- Port must NOT be in DANGER_PORTS list (same allowlist as server: 22, 25, 53, etc.).
- Label auto-generated: `"port-${portNum}"` if user doesn't provide one.
- Form does not require port to be in detected list — it calls `POST /api/tunnels` directly.

## isLocalServer() Spec

```ts
// packages/web/src/api/server-config.ts
export function isLocalServer(): boolean {
  try {
    return new URL(getServerUrl()).host === location.host;
  } catch {
    return true; // if URL parse fails, assume local (safe default)
  }
}
```
Dev-mode caveat: when `import.meta.env.DEV`, `getServerUrl()` returns `location.origin`, so `isLocalServer()` is always true. Accepted — in dev the server IS on the same host.

## Related Code Files

| File | Role |
|---|---|
| `packages/web/src/components/organisms/TunnelPanel.tsx` | Pattern source for WarningBanner, InstallerRow, TunnelRow (will be deleted in Phase 04) |
| `packages/web/src/components/organisms/PortsPanel.tsx` | Pattern source for port row layout, state badges (will be rewritten in Phase 03) |
| `packages/web/src/hooks/useTunnels.ts` | Pattern source for WS event cache-patching |
| `packages/web/src/hooks/usePorts.ts` | Will be rebuilt in Phase 03 |

## Todo List

- [ ] Review this phase doc — confirm mockup and state machine with stakeholder before Phase 03
- [ ] Verify DANGER_PORTS list on server side (proxy.rs allowed list) — decide if same list applies to custom port form
- [ ] Confirm: QR code import (`react-qr-code`) is available in `packages/web/package.json`

## Success Criteria

This phase produces no code — it produces the design contract that Phase 03 implements. Success = implementer can build Phase 03 without questions about UX behavior.

## Risk Assessment

| Risk | Likelihood | Impact | Mitigation |
|---|---|---|---|
| Panel height too tall with many ports | Low | Low | Sidebar is scrollable; no change needed |
| Port lost while tunnel active — orphan tunnel | Medium | Low | Tunnel continues working (server-side); row stays in list via tunnel-only entries if needed (or just removed — tunnel events still work) |

## Security Considerations

- "Open localhost" navigates to `http://localhost:{port}/` in a new tab — no credentials passed, correct behavior.
- Custom port form must not submit danger ports (22, 25, 53, 3306, 5432, 6379 etc.) — validate client-side with same list the server uses, and server also validates.

## Next Steps

Phase 03: implement `isLocalServer`, rebuild `usePorts`, rebuild `PortsPanel`.

## Unresolved Questions

1. When a port is `lost` (removed from detection), should the row stay visible if a tunnel is still active for it? Proposal: yes — keep rows that have an active tunnel even if port is no longer detected. Row shows `(undetected)` label instead of project. Needs confirmation.
2. Label for custom port form: auto-generate `"port-{N}"` or require user input? TunnelPanel required a label. Proposal: auto-generate for simplicity.
