# Terminal renderer research

## Evidence

- `TerminalKeepAliveHost.tsx` mounts every retained session in an offscreen host.
- `TerminalPanel.tsx` activates a WebGL addon for every mounted panel.
- `terminal-renderer.ts` also creates a WebGL2 capability-probe context per activation.
- Unmount cleanup disposes the addon and terminal, but retained sessions do not unmount.

## Recommended design

Use DOM rendering by default for retained panels; activate WebGL only for sessions visible in a pane, bounded by the visible-pane count. Pass the visible session set through the terminal host. Make renderer activation a separate lifecycle that disposes when a session becomes non-visible or unmounts. Remove the capability-probe canvas and use addon initialization failure as the capability signal.

## Test seams

- Extend `src/lib/terminal-renderer.test.ts` for disabled, disposal, and reactivation paths.
- Add host/panel coverage: only visible sessions activate WebGL; switching disposes the prior addon.
- Browser smoke: many retained tabs do not emit WebGL context-limit or loss errors.

## Unresolved questions

- Visible sessions must include every active split-pane session, not just the globally selected tab.
