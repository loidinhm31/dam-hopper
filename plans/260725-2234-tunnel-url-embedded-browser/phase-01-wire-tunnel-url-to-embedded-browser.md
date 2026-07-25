# Phase 01: Wire Tunnel URL to Embedded Browser

## Context Links

- Parent: [plan.md](./plan.md)
- Architecture: [docs/system-architecture.md](../../docs/system-architecture.md)
- Standards: [docs/code-standards.md](../../docs/code-standards.md)
- Design guide: `docs/design-guidelines.md` if present during `/code` (absent now)
- Dependency: existing `TunnelInfo`, `usePorts`, `useBrowserDebug`, and `BrowserDebugKeepAliveHost`

## Overview

- Date: 2026-07-25
- Description: Add ready-tunnel embedded-browser actions and route them to the workspace-owned browser controller.
- Priority: P2
- Implementation status: Complete — changes requested by review
- Review status: Changes requested
- Effort: 4h

## Key Insights

- Backend already emits ready/stopped lifecycle and URL data; no backend gap.
- Browser debug already accepts ready tunnel origins and invalidates stopped tunnels.
- `setInputUrl(url)` then current `navigate()` risks stale React state; provide one atomic controller operation.
- `WorkspacePage` alone owns browser target plus desktop/compact reveal state.

## Requirements

### Functional

- Show an embedded-browser action only when tunnel status is `ready` and URL exists.
- Add action in `PortsPanel` rows and all runtime navigator port chips.
- Keep current external-tab action separate and unchanged.
- Replace current browser target, then reveal it:
  - wide terminal mode: open browser split;
  - wide IDE mode: activate Terminal bottom tool and open browser split;
  - compact mode: select Browser surface without changing workspace mode.
- Stop propagation from runtime chip actions.

### Preflight Contract

- Input is an opaque URL string from the currently rendered ready tunnel.
- Port components never mutate browser state; they call `onOpenInBrowser(url)`.
- Browser controller owns normalization, ready-origin validation, target/history mutation, and reset side effects.
- Workspace reveals browser only after controller accepts navigation.

### Side-effect Checklist

- Preserve tunnel start/stop/install, copy, QR, warning, and external-link flows.
- Preserve target invalidation on tunnel stop/failure/replacement.
- Reuse browser navigation reset behavior: selection, picker, capture, console, capabilities, error.
- Avoid workspace-mode switches, duplicate history entries, extra tunnel creation, and backend writes.

## Architecture

`PortsPanel | RuntimePortChip → callback chain → WorkspacePage → browserDebug.navigateTo(url) → existing keep-alive iframe`

- Add a controller method (for example `navigateTo(rawUrl): boolean`) and share internals with address-bar `navigate()`.
- Add optional callback props through `PortsPanel`, `TerminalRuntimeNavigator`, `TerminalRuntimeNavigatorGroup`, `TerminalRuntimeNavigatorItem`, and `ActiveTerminalRuntimeDisplay`.
- Keep layout coordination in `WorkspacePage`; no global store/event bus.

## Related Code Files

### Modify

- `packages/ui/src/hooks/use-browser-debug.ts` — atomic validated URL navigation.
- `packages/ui/src/components/organisms/PortsPanel.tsx` — ready-only embedded action + callback.
- `packages/ui/src/components/organisms/TerminalRuntimeNavigator.tsx` — callback forwarding.
- `packages/ui/src/components/organisms/TerminalRuntimeNavigatorGroup.tsx` — callback forwarding.
- `packages/ui/src/components/organisms/TerminalRuntimeNavigatorItem.tsx` — ready-only chip action.
- `packages/ui/src/components/organisms/ActiveTerminalRuntimeDisplay.tsx` — callback forwarding in compact/desktop navigators.
- `packages/ui/src/components/pages/WorkspacePage.tsx` — navigate and reveal browser per layout mode.
- `packages/ui/src/hooks/use-browser-debug.test.ts`
- `packages/ui/src/components/organisms/TerminalRuntimeNavigatorItem.test.tsx`
- `packages/ui/src/components/organisms/ActiveTerminalRuntimeDisplay.test.tsx`
- `packages/ui/src/components/pages/WorkspacePage.test.tsx`

### Create if direct panel tests cannot fit existing files

- `packages/ui/src/components/organisms/PortsPanel.test.tsx`

### Delete

- None.

## Implementation Steps

1. Refactor browser navigation into one shared resolver/apply function. Expose atomic `navigateTo(url)` returning acceptance; keep address-bar `navigate()` behavior.
2. Add `onOpenInBrowser?: (url: string) => void` to `PortsPanel`/`PortRow`. Render an accessible embedded-browser button beside ready tunnel actions; retain URL anchor.
3. Add same optional callback across runtime navigator props. In `RuntimePortChip`, require ready status + URL, stop propagation, and retain external link.
4. Forward callback through both `ActiveTerminalRuntimeDisplay` navigator render paths.
5. In `WorkspacePage`, create stable handler: validate/navigate first; compact selects `browser`; wide sets `browserOpen`; IDE also requests bottom `terminal` tool activation.
6. Pass handler to `PortsPanel` and `ActiveTerminalRuntimeDisplay`; update memo dependencies.
7. Add tests for invalid/ready controller navigation, ready-only rendering, exact URL callback, stopped propagation, passthrough, and compact/IDE/terminal reveal outcomes.
8. Run UI tests/build; manually confirm external and embedded actions remain distinct.

## Todo List

- [x] Add atomic browser-controller URL API.
- [x] Wire Ports panel action.
- [x] Wire runtime navigator action.
- [x] Coordinate workspace reveal behavior.
- [x] Add regression tests.
- [x] Run unit tests and TypeScript build.

## Success Criteria

- Any visible ready cloudflared URL can open in embedded browser from both port surfaces.
- Current embedded target is replaced; browser is immediately visible in each layout mode.
- Non-ready/missing URLs cannot trigger embedded navigation.
- External link and tunnel controls behave unchanged.
- Tests/build pass; no server diff.

## Risk Assessment

- Medium: stale-state navigation. Mitigate with atomic controller API.
- Medium: browser opens behind inactive IDE tool. Mitigate with explicit Terminal tool request.
- Low: nested runtime click selects terminal. Mitigate/test `stopPropagation`.
- Low: duplicated callback plumbing. Keep one prop name/signature through chain.

## Security Considerations

- Never navigate directly from UI callback; keep `resolveBrowserDebugTarget` allowlist gate.
- Do not broaden accepted schemes/origins or bypass ready-tunnel verification.
- Retain `noopener noreferrer` on external links and stopped-tunnel invalidation.

## Next Steps

- Before merge, make controller validation share or freshly obtain the ready-tunnel snapshot; a visible ready action can currently race the hook's independent initial fetch.
- Stop keyboard events from the runtime embedded-browser button reaching its parent session selector; add keyboard and mode-reveal regression coverage.
- Re-run focused UI tests, `pnpm --filter @dam-hopper/ui build`, and `pnpm lint` after the fixes.

## Unresolved Questions

None.
