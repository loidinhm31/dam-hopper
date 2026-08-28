# Fix: terminal scroll buttons trigger keyboard + janky touch scroll

Status: in-progress · Date: 2026-08-28

## Decision
Fix two Android-coarse-pointer regressions without changing desktop behavior: (1) scroll controls open soft keyboard, (2) terminal viewport scroll is janky vs native.

## Phases
1. [Scroll controls no longer trigger keyboard](phase-01-scroll-controls-keyboard.md) — DONE 2026-08-28 18:04:32 +07:00
2. [Native smooth touch scroll](phase-02-native-smooth-scroll.md) — pending

## Preflight contract
- Output: `TerminalScrollButtons` no longer focuses/activates IME on Android Chrome; terminal viewport scrolls with native momentum, same as other scroll containers.
- Acceptance: on Android Chrome (coarse pointer), tapping toggle/scroll buttons does not open keyboard, `document.activeElement` is not xterm textarea, `inputMode` stays suppressed; drag/flick scroll on `.xterm-viewport` has native fling/overscroll and is visually smooth; desktop mousewheel/keyboard scroll unchanged; existing vitest + browser tests pass.
- Scope: `packages/ui` terminal UI only. In: `TerminalScrollButtons.tsx`, `terminal-touch-scroll.ts`, `TerminalPanel.tsx` callsite, optional CSS touch-action. Out: server, agent store, tunnel, non-terminal pages, `android-chrome-input-policy` global guard (already correct), xterm config.
- Non-goals: new scroll UI, changing global IME policy, reworking xterm theming.
- Risks/public contracts: touch/pointer event handling affects all mobile terminals; must not break desktop click/keyboard access; `bindTerminalTouchScroll` is only caller in `TerminalPanel.tsx:335`.
- Affected files: `packages/ui/src/components/organisms/TerminalScrollButtons.tsx`, `packages/ui/src/lib/terminal-touch-scroll.ts`, `packages/ui/src/components/organisms/TerminalPanel.tsx`, `packages/ui/src/components/organisms/TerminalRuntimeOutput.tsx` (host context), optional CSS in `packages/ui/src/index.css` or inline style on viewport.
- Testing: `pnpm --filter @dam-hopper/ui test` (vitest), `pnpm --filter @dam-hopper/ui test:browser` for `terminal-scroll-buttons.browser.tsx` + `android-chrome-input-policy.browser.ts`; manual Android Chrome (or DevTools coarse-pointer emulation) for keyboard + scroll momentum.
- Open questions: none — root causes verified from source.

## Side-effect review
- Auth/session: no change.
- API/client compat: no API change; touch behavior is client-only.
- DB/schema: none.
- Business logic: scroll actions same (`scrollToTop/Bottom`, `scrollLines`).
- Security/privacy: no input logging; `preventDefault` scoped to controls only.
- Perf/concurrency: remove per-touchmove `scrollTop` assignment + `preventDefault`; restore compositor scrolling.
- Docs/config/deploy: no config; mention in CHANGELOG if needed.

## Research
- CodeGraph scout: `TerminalScrollButtons`, `TerminalRuntimeOutput`, `terminal-touch-scroll`, `MobileTerminalCustomKeyboard`, `android-chrome-input-policy`, `TerminalPanel`
- Prior plan ref: `plans/260805-2058-android-chrome-keyboard-suppression` (global guard pattern)

## Handoff
`/code plans/260828-1430-terminal-touch-keyboard-and-smooth-scroll/plan.md`
