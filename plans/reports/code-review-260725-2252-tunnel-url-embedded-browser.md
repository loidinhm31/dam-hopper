## Code Review Summary

### Scope

- Files reviewed: 12 changed UI/test files; supplied phase plan; PDR and frontend/security standards.
- Lines analyzed: ~1,400 (397 changed source/test lines plus navigation/tunnel context).
- Focus: ready cloudflared URL → embedded Browser flow.
- Updated plan: `plans/260725-2234-tunnel-url-embedded-browser/phase-01-wire-tunnel-url-to-embedded-browser.md`.

### Overall Assessment

Score: **7.5/10**. Good small-scope design; `navigateTo()` fixes stale-address navigation and preserves the existing ready-origin allowlist. Not merge-ready: controller and Ports data use independent tunnel snapshots, so a visible ready action can be rejected during initial load. Keyboard propagation is also incomplete.

### Critical Issues

None.

### High Priority Findings

1. **H1 — ready action can fail during initial tunnel-state race.** [`use-browser-debug.ts:85-86`](../../packages/ui/src/hooks/use-browser-debug.ts) starts with no tunnels and fetches later at [`137-152`](../../packages/ui/src/hooks/use-browser-debug.ts). `navigateTo()` validates only that local snapshot at [`182-196`](../../packages/ui/src/hooks/use-browser-debug.ts), while Ports independently exposes a ready tunnel from TanStack Query ([`use-ports.ts:52-86`](../../packages/ui/src/hooks/use-ports.ts)). A user can see/click the ready action ([`PortsPanel.tsx:361-375`](../../packages/ui/src/components/organisms/PortsPanel.tsx)) before the hook fetch completes; navigation rejects, clears the current target, and does not reveal Browser. Share the `['tunnels']` query or make `navigateTo()` async and refresh/revalidate immediately before accepting.

### Medium Priority Improvements

1. **M1 — runtime keyboard activation still selects the terminal.** The new button stops only `click` propagation ([`TerminalRuntimeNavigatorItem.tsx:69-72`](../../packages/ui/src/components/organisms/TerminalRuntimeNavigatorItem.tsx)); Space/Enter `keydown` bubbles to the parent pseudo-button, which selects its session at [`143-147`](../../packages/ui/src/components/organisms/TerminalRuntimeNavigatorItem.tsx). Stop relevant key events on every chip action, ideally replace the nested interactive pseudo-button structure. Add a keyboard regression test; current test invokes click only ([`TerminalRuntimeNavigatorItem.test.tsx:201-208`](../../packages/ui/src/components/organisms/TerminalRuntimeNavigatorItem.test.tsx)).

2. **M2 — required outcomes lack behavioral tests.** No WorkspacePage diff tests navigation acceptance/rejection or compact/IDE/terminal reveal results; no test covers non-ready/missing URL suppression in Ports; no invalid `navigateTo()` test. Static markup tests prove presence, not callback execution. Add interaction tests for those plan success criteria.

### Low Priority Suggestions

1. New icon-only targets are about 15–20px and runtime action lacks explicit `focus-visible` styling ([`PortsPanel.tsx:366-374`](../../packages/ui/src/components/organisms/PortsPanel.tsx), [`TerminalRuntimeNavigatorItem.tsx:64-76`](../../packages/ui/src/components/organisms/TerminalRuntimeNavigatorItem.tsx)). Make each at least 24×24px and use the existing focus ring treatment; preserve the compact layout with a shared action class.

### Positive Observations

- `navigateTo()` shares normalization, allowlist, history, reset, and error behavior with typed navigation; no URL trust bypass ([`use-browser-debug.ts:154-216`](../../packages/ui/src/hooks/use-browser-debug.ts)).
- Ready-only action gating and existing external links remain separate ([`PortsPanel.tsx:267-277`](../../packages/ui/src/components/organisms/PortsPanel.tsx), [`TerminalRuntimeNavigatorItem.tsx:56-88`](../../packages/ui/src/components/organisms/TerminalRuntimeNavigatorItem.tsx)).
- Callback plumbing stays local to affected components; no backend/API/global-store scope creep.

### Recommended Actions

1. Fix H1 with one authoritative ready-tunnel snapshot or an awaited revalidation; retain fail-closed behavior.
2. Fix M1 keyboard bubbling and add keyboard interaction coverage.
3. Add callback/reveal and negative-state tests, then rerun focused tests/build/lint.

### Metrics

- Type coverage: unavailable.
- Test coverage: focused 5 files / 17 tests passed.
- TypeScript build: `pnpm --filter @dam-hopper/ui build` passed.
- Lint: 0 errors; 14 pre-existing warnings, none in reviewed files.

### Unresolved Questions

- Why do both `phase-01-wire-tunnel-url-to-embedded-browser.md` and `phase-01-wire-tunnel-urls-to-browser.md` exist with conflicting status/TODO metadata? The requested plan was updated; the duplicate should be reconciled before the next phase.
