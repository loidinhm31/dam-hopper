# Inline Terminal Suggestions: xterm Interaction and Geometry Research

Date: 2026-07-16  
Scope: desktop frontend/xterm behavior only; no implementation

## Local baseline

- `@xterm/xterm ^6.0.0`; DOM + optional WebGL renderer; Vitest 4 browser mode uses Playwright Chromium.
- Current hook owns Tab/Shift+Tab/Enter/Escape while popup visible, performs delayed unversioned search, and rewrites with `Ctrl+U + command`.
- Current geometry divides the outer terminal element by rows/cols, ignores computed cursor X, assumes five popup rows, and updates only when search completes.
- Brainstorm decision is correct: verified shell prompt, passive true-prefix ghost, suffix-only accept, explicit fuzzy/history list, fail closed on uncertainty.

## Official API findings

- `attachCustomKeyEventHandler` runs before xterm handles a browser keyboard event; returning `false` prevents xterm handling. It is the cancellation point. `onKey` is observational, not a safe ownership boundary. `onData` remains the canonical stream of user-generated terminal bytes. [Terminal API](https://xtermjs.org/docs/api/terminal/classes/terminal/)
- Public lifecycle signals include `onCursorMove`, `onResize`, `onScroll`, `onWriteParsed`, buffer-change events, `element`, `textarea`, rows/cols, and active-buffer cursor/viewport fields. They are sufficient to invalidate/recompute, not to guarantee pixel geometry. [Terminal API](https://xtermjs.org/docs/api/terminal/classes/terminal/), [IBuffer](https://xtermjs.org/docs/api/terminal/interfaces/ibuffer/), [IBufferNamespace](https://xtermjs.org/docs/api/terminal/interfaces/ibuffernamespace/)
- Decoration registration can anchor DOM content to cells and follow terminal rendering, but xterm labels parts of this surface experimental/proposed. It may require `allowProposedApi` and brings marker, scrollback, reflow, renderer, and upgrade risk. Confirm exact v6 contract from the pinned typings before adoption. [Official typings](https://github.com/xtermjs/xterm.js/blob/master/typings/xterm.d.ts), [IDecoration](https://xtermjs.org/docs/api/terminal/interfaces/idecoration/)
- xterm accessibility uses an internal textarea and accessibility tree; a passive visual hint should not compete with terminal announcements. [xterm accessibility guide](https://xtermjs.org/docs/guides/accessibility/)
- Vitest Browser Mode runs components in a real browser through Playwright and is appropriate for layout, keyboard, ResizeObserver, and real xterm rendering checks. [Vitest Browser Mode](https://vitest.dev/guide/browser/), [Playwright input](https://playwright.dev/docs/input)

## Recommended interaction controller

Keep one per-session controller outside React render state. React receives a snapshot only.

States:

1. `disabled` — setting off/mobile/unsupported environment.
2. `unverified` — no trusted editable prompt; all bytes opaque.
3. `ready-clean` — verified normal-buffer prompt, append-only shadow equals known shell line, cursor at EOL.
4. `querying` — `{promptEpoch, revision, query}` captured; no visible stale result.
5. `ghost` — immutable `{promptEpoch, revision, prefix, suffix, candidateId, anchor}`.
6. `opaque` — command running, alternate buffer, paste/IME/unmodelled edit, SSH/REPL/TUI, or invalid lifecycle.
7. `explicit-list` — deliberate modal history workflow owns only its focused controls.

Events:

- Shell: `prompt-ready`, `command-start`, `command-finish`, invalid marker sequence.
- Input: raw `onData`, browser `compositionstart/end`, paste, candidate acceptance.
- Terminal: cursor move, parsed write/render, resize, scroll, buffer switch.
- Host: ResizeObserver, font/zoom/visual viewport change, hide/show, detach/reparent, dispose.
- Feature: setting/project/session/history revision changes, explicit-list open/close.

Every input or lifecycle transition increments `revision` and synchronously clears the ghost before debounce/search. A result may commit only when session, prompt epoch, revision, exact raw input, normal buffer, verified state, EOL, and prefix relation still match. Acceptance repeats the same gate atomically.

## Safe key ownership and suffix acceptance

- Install one `attachCustomKeyEventHandler`; return `false` only for `keydown` of the configured accept key while the atomic `canAccept` gate succeeds. Reject repeat, composition/IME (`isComposing`/229), modifiers not in the contract, alternate buffer, non-EOL, dirty shadow, stale revision, and empty suffix.
- All other keyboard events return `true`; all resulting `onData` bytes pass to the PTY unchanged. Passive mode never owns Tab, Enter, Escape, arrows other than the chosen accept action, Ctrl+R, paste, or TUI keys.
- On accept, compute `suffix = candidate.command.slice(currentInput.length)` only after exact `startsWith(currentInput)`. Send suffix through the same PTY input function; never call `terminal.write`, send Enter, use `Ctrl+U`, or resend the prefix.
- Update the shadow/revision before sending so a repeated key cannot accept twice. Full accept inserts all suffix. Optional token accept inserts the shortest leading suffix through the next whitespace/punctuation boundary; keep it separate from full accept.
- Right/End can still conflict with readline/vi/fish semantics. Enable only for a verified supported mode; otherwise use an explicit modifier or explicit list. Do not infer shell mode from silence or terminal cursor cells.

## Cursor anchoring recommendation

There is no stable public xterm API that returns the rendered cursor cell rectangle. Public-only outer-box division is approximate because padding, scrollbar, renderer, DPR, font metrics, and reflow differ.

Use one `terminal-cursor-geometry-adapter` with fail-closed validation:

1. Prefer rect measurement from public `terminal.textarea` relative to the terminal host, but treat textarea placement as non-contractual behavior; accept only when its rect is visible, finite, within host bounds, and consistent with active cursor row.
2. If needed, isolate a measured screen/grid fallback behind one private DOM selector; no selector may leak into hooks/components. Validate inferred cell width/height against host, cols/rows, and cursor rect. Hide on mismatch.
3. Do not enable proposed decorations initially. Spike them only if the adapter cannot meet WebGL/DOM/reflow tests; if chosen, pin xterm, isolate `allowProposedApi`, dispose marker/decoration on every invalidation, and retain a no-suggestion fallback.

Ghost coordinates are host-relative. Start at cursor rect right edge, remain one line, clip/fade at terminal right edge, and remain `aria-hidden`. Do not attempt multi-row suffix wrapping until xterm exposes reliable cell-width mapping. Explicit list uses measured content size, terminal-edge clamp/flip, and internal scrolling.

Recompute at most once per animation frame on cursor move, parsed write/render, xterm resize/scroll, host ResizeObserver, visual viewport/font change, and explicit host attach/reparent callback. Dismiss immediately on hide/detach/dispose, alternate buffer, viewport scrolled away from bottom (`viewportY !== baseY`), invalid dimensions, or measurement failure. Same-size reparent needs an explicit lifecycle event; ResizeObserver alone is insufficient.

## Accessibility contract

- Passive ghost: unfocusable, `aria-hidden="true"`, no live-region announcement per keystroke, setting to disable, contrast readable without using color as the only signal.
- Explicit history: actual focused dialog/composer; labelled input, listbox/options or equivalent APG pattern, visible focus, selected state, result count announced sparingly, labelled close/copy/use actions, full command inspection. Escape is consumed only while this UI owns focus. [WAI-ARIA Listbox Pattern](https://www.w3.org/WAI/ARIA/apg/patterns/listbox/)
- “Use” inserts without execution; “Copy” never mutates PTY. Expose shortcut help as text, not title/color only.

## Verification strategy

- Pure Vitest: reducer transitions; monotonic revision/prompt epoch; debounce race; exact prefix/suffix including whitespace, Unicode, graphemes; partial boundary; invalid marker sequences; normal/alternate/scrollback gates.
- Controller tests with fake terminal/transport: byte-for-byte pass-through for Tab, Enter, Escape, Ctrl+R, arrows, paste; only gated accept suppressed; setting/session/project/dispose cancels; accepted suffix sent once and never executes.
- Vitest Browser + real xterm DOM: DOM renderer mandatory, WebGL smoke when available; textarea/screen adapter validity; fractional DPR; font load; fit/resize; split pane; narrow width; scrollback; wrap; alternate buffer; hide/show; DOM reparent; focus and composition events. Assert anchor within about 1 CSS pixel or hide, never stale coordinates.
- Accessibility browser tests: role/name/focus/keyboard assertions for explicit list; passive ghost absent from accessibility tree; optional automated axe smoke supplements, not replaces, behavior checks.
- Real PTY/browser matrix: bash required; supported zsh/fish/PowerShell when installed. Exercise completion, readline/vi modes, multiline/bracketed paste, `read -s` password prompt, SSH-like/no-echo prompt, REPL, silent command, full-screen TUI, resize/reparent. Assert native bytes and zero history capture outside verified prompt lifecycle.
- Manual: real IME on at least one desktop OS and screen reader smoke; synthetic composition events cannot prove platform behavior.

## Phase dependencies

1. Shell lifecycle protocol/support matrix and controller/revision reducer; blocks all automatic UI.
2. Safe key adapter + exact suffix acceptance; depends on phase 1, test with fake transport first.
3. Geometry spike and adapter + lifecycle subscriptions; depends on stable ghost state, may decide decoration fallback.
4. Explicit accessible history workflow; independent of pixel ghost after shared history/query separation.
5. Browser + real PTY matrix, privacy/settings/docs; release gate for phases 1–4.

## Risks

- “Public” textarea exists, but its cursor-relative placement is not promised; browser tests and fail-closed behavior mandatory.
- Decoration API may change across xterm upgrades and behave differently under WebGL/reflow.
- Shell lifecycle does not prove line-editor mode; key ownership must remain narrower than prompt verification.
- Unicode display width cannot be safely derived from JS string length; avoid cell-width suffix layout.
- Browser-only tests cannot validate actual shell editing, echo, password, or PTY modes.

## Unresolved questions

- Which shells and line-editor modes are first-class in v1, and how are lifecycle markers installed?
- Is plain Right/End acceptable, or should v1 require a modifier to minimize native conflicts?
- May the implementation enable xterm proposed APIs if the measured adapter fails the renderer matrix?
- Must WebGL be a release-gated geometry target or may geometry fall back to DOM renderer?
- What explicit-list shortcut should be reserved without colliding with terminal applications?
