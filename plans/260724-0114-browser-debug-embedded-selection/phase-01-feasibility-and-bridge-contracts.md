# Phase 01 — Feasibility and Bridge Contracts

## Context links

- Parent: [plan.md](./plan.md)
- Brainstorm: [browser-debug report](../../reports/brainstorm-260724-0114-browser-debug-embedded-selection.md)
- Research: [bridge/capture](./research/researcher-01-browser-bridge-capture.md)
- Architecture: [system architecture](../../docs/system-architecture.md)

## Overview

- Date: 2026-07-24
- Description: Prove cooperative iframe selection and freeze a versioned bridge
  contract before server/UI work.
- Priority: P1
- Implementation status: Done (2026-07-24 15:09 +07)
- Review status: Automated validation passed (2026-07-24 15:09 +07)

## Key Insights

- Parent cannot inspect a cross-origin iframe; code in the target must collect
  DOM/accessibility data.
- Every load/navigation needs a fresh nonce and exact source/origin validation.
- Framing requires target CSP `frame-ancestors` and no conflicting X-Frame-Options.
- `getDisplayMedia` is optional and user-mediated; semantic selection must work
  without pixels.

## Requirements

- Define request/response envelopes with version, nonce, request ID, type, and
  bounded payload.
- Support readiness, start/stop picker, selection result, and bridge error.
- Allow only exact parent origin and exact iframe `contentWindow`.
- Provide a framework-neutral target bridge with no shell/network privilege.
- Build ESM and IIFE outputs from one source so bundled and script-tag targets
  use identical protocol logic.

## Architecture

`@dam-hopper/browser-bridge` owns picker UI and DOM extraction inside the target
and is distributed through the Chromium extension. `packages/ui` owns the
parent protocol parser and handshake state. The target never receives server
tokens and the parent never accepts `*` as a target origin.

## Related code files

- Create `/mnt/data/ws/sharing/dam-hopper/packages/browser-bridge/package.json`.
- Create `/mnt/data/ws/sharing/dam-hopper/packages/browser-bridge/tsconfig.json`.
- Create `/mnt/data/ws/sharing/dam-hopper/packages/browser-bridge/src/index.ts`.
- Create `/mnt/data/ws/sharing/dam-hopper/packages/browser-bridge/src/protocol.ts`.
- Create `/mnt/data/ws/sharing/dam-hopper/packages/browser-bridge/src/picker.ts`.
- Create `/mnt/data/ws/sharing/dam-hopper/packages/browser-bridge/vite.config.ts`
  (or equivalent library build) with ESM and IIFE outputs.
- Create `/mnt/data/ws/sharing/dam-hopper/packages/ui/src/lib/browser-debug-protocol.ts`.
- Create `/mnt/data/ws/sharing/dam-hopper/packages/ui/src/lib/browser-debug-protocol.test.ts`.
- Modify `/mnt/data/ws/sharing/dam-hopper/pnpm-workspace.yaml` only if package
  scripts require explicit inclusion (normally the existing glob suffices).
- Modify `/mnt/data/ws/sharing/dam-hopper/docs/frontend-components.md` with
  bridge installation and CSP requirements.

## Implementation Steps

1. Build a target fixture with a cross-origin-compatible dev route, nested
   element, accessible name, shadow-root case, and hostile text.
2. Implement handshake with exact `targetOrigin`, source check, nonce, and
   load invalidation.
3. Implement hover highlight and click selection inside the target document.
4. Extract only allowlisted tag/role/name/text/attributes/locators/bounds.
5. Add parser guards for unknown versions/types, stale requests, wrong source,
   oversized text, invalid bounds, and malformed attributes.
6. Validate parent reload/navigation and bridge reconnect behavior in Chromium.
7. Build both ESM and IIFE artifacts from the same source; verify no duplicated
   protocol implementation.
8. Freeze `BrowserSelectionV1` and error codes in the package README/docs.

## Todo list

- [x] Prove bridge in an iframe on loopback (Chromium browser test).
- [ ] Prove CSP `frame-ancestors` failure is surfaced clearly (Phase 3 release gate; requires distinct-origin fixture).
- [x] Test navigation invalidates nonce and selection (Chromium browser test).
- [x] Test prompt-injection/control text is data, never HTML (Vitest + Chromium).
- [x] Document and build ESM import and IIFE script-tag installation (dual Vite outputs).

### Validation evidence

- `pnpm --filter @dam-hopper/browser-bridge test` — 10 tests passed.
- `pnpm --filter @dam-hopper/browser-bridge build` — ESM and IIFE outputs built
  from the shared bridge source.
- `pnpm --filter @dam-hopper/ui exec vitest run src/lib/browser-debug-protocol.test.ts` — 9 tests passed.
- `pnpm --filter @dam-hopper/ui test:browser -- browser-bridge.browser.ts` — 9
  files / 32 tests passed, including real iframe `MessageEvent` handling,
  hostile text-as-data, source checks, picker lifecycle, and navigation nonce
  refresh.

### Deferred release gates

- Phase 3 must add a distinct-origin CSP/X-Frame-Options fixture and verify the
  failure is surfaced clearly; same-origin `srcdoc` coverage does not prove it.
- Phase 3/6 UI owner must verify stale-state behavior and CSP-denial UX in the
  integrated Browser tool before release.

## Success Criteria

- Fixture returns a bounded semantic selection through a real `MessageEvent`.
- Wrong source/origin/nonce never changes parent state.
- Target bridge has no access to DamHopper auth, filesystem, or PTY APIs.
- Contract tests pass in Vitest and Chromium browser test.

## Risk Assessment

- Shadow DOM and nested frames may require later bridge extensions.
- Apps may ship restrictive CSP or X-Frame-Options.
- A package-only bridge may be hard to consume from non-monorepo projects.

## Security Considerations

- Use exact origins and `event.source === iframe.contentWindow`.
- Render text only; never send HTML, input values, cookies, storage, or handlers.
- Cap every field and reject control characters before preview.

## Next steps

After contract approval, implement the server artifact manager against the fixed
selection schema. If the screenshot feasibility spike fails, retain DOM-only
mode and manual upload as the release fallback.

## Unresolved questions

- Whether non-monorepo consumers need a separately published package in
  addition to the generated ESM and IIFE artifacts.
- Minimum supported Chromium/Firefox capture behavior for later phases.
