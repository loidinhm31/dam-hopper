# xterm / PTY replay and render repair

Status: complete
Workflow: cmd-fix__hard, executed directly; no explicit advice token.

## Exact enhanced workflow input

Analyze debug result and fix issue for render xterm and pty. Repair the demonstrated defects from debug.json and debug-render.json: historical xterm replies leaking to live PTY input; full replay retaining prompt/cursor/mode state; replay/live byte overlap; transient renderer/hidden-host geometry updates; and redundant suggestion updates during TUI output. Preserve live terminal queries, UTF-8 stream continuity, session/profile ownership, normal and alternate-screen behavior, input responsiveness, and bounded retained history. Use the completed debugger investigation and isolated browser evidence, not speculative production attribution. No Arrow/binary transport redesign, server-side terminal-emulator project, unrelated embedded-browser changes, or changes to existing unrelated work. Verify actual xterm behavior and targeted regressions before delivery.

## Evidence and decisions

- Prior debugger reports and Chromium runs confirmed reply leakage, stale prompt replay, hidden fitting, renderer-dependent columns, and opaque-state notification churn.
- Both diagnostic exports lack frontend event timelines. Fix verified mechanisms; do not claim the exact historical trigger is established.
- No applicable unfinished plan exists. Existing Arrow capacity advice is investigation, not an implementation plan.
- Keep JSON transport. Give live output an authoritative end offset and reconcile replay overlap/gaps; no client recount of accepted duplicate bytes.
- Full replacement replay resets terminal parser/buffer/modes; historical parsing cannot send PTY replies. Delta replay retains state. Truncated history is not a complete emulator snapshot; expose that boundary honestly.
- Only the attached measurable visible host may size a PTY. Commit renderer choice before fit; suppress parking/hidden geometry.
- Unchanged opaque suggestion state must not republish for every TUI output chunk.

## Implementation slices

1. PTY stream integrity: byte-positioned live output, safe UTF-8 snapshot boundaries, replay/live overlap handling and affected transport consumers/regressions.
2. xterm replay/input: true reset, historical-response suppression through asynchronous parsing, orderly live drain and replay generation fencing; suggestion-state churn repair.
3. Geometry: visible host ownership, hidden fit guard, renderer-before-fit ordering, affected callers and meaningful regression coverage.
4. Integration: exercise actual xterm query/replay/reset and renderer/hidden geometry; run affected Rust/UI checks; independently review; update existing terminal/API documentation.

## Acceptance

- Replay emits no PTY input; legitimate live queries still receive replies.
- Reset replay cannot append a duplicate prompt or inherit old alternate/wrap state.
- Snapshot/live overlap is rendered once with correct authoritative offsets; gaps do not silently continue a corrupt stream.
- UTF-8 split between reads does not produce replacement characters or duplicate bytes during attach.
- Hidden/parked terminals keep their last usable PTY geometry; reveal does not publish transient DOM then WebGL widths.
- Enabled suggestions do not republish identical opaque state on each output chunk.
- Actual browser smoke and targeted regression checks pass. No fixes to unrelated files; no automatic commit or push.

## Verification and delivery

- Backend: `cargo test --lib pty::` — 172 passed, 1 ignored; `cargo test --lib api::ws::tests::` — 9 passed; `cargo test --lib api::ws_protocol::tests::` — 10 passed. `cargo check` and `cargo build --bin dam-hopper-server` succeeded.
- Frontend: `pnpm --filter @dam-hopper/ui build` succeeded. Targeted terminal/transport/geometry unit run: 123 passed across 13 files. Chromium replay, panel lifecycle, zoom, and fit-ownership run: 20 passed across 4 files.
- Focused ESLint: zero errors; warnings remained in existing/fixture unused parameters and effect dependencies. The new missing keyboard-policy effect dependencies were corrected.
- Live smoke: real TerminalPanel + WsTransport + rebuilt Rust server + disposable raw-mode Python TUI. Historical replay emitted zero PTY input; keyboard `p` produced five live query replies; 80 redraw frames preserved one prompt, stable geometry, and scroll position. Hidden/revealed host produced zero resize messages. Socket reconnect preserved input readiness without historical replies. Manual same-ID replacement produced only `REPLACED CLEAN` in the normal buffer, with no stale TUI content or outgoing input.
- Visual proof inspected in Chromium: `/tmp/omp-sshots-1593a5fbe692faeb.webp` (DOM rendering, header/UTF-8/footer). Real WebGL geometry passed browser checks; the isolated headless screenshot after DPR emulation omitted WebGL glyphs, so this is not a claim of complete GPU visual qualification.
- Independent reviews identified and drove fixes for completion across rebinding/restart, renderer installation before registry notification, incarnation namespace changes, native input restoration, and deterministic UTF-8 synchronization.
- Updated terminal/API documentation and changelog. Removed disposable HTML/TUI/config/browser profiles; stopped smoke services. No commit or push.
- Deployment: update client and server together; output/replay now require authoritative `offset` and `incarnation`. Native input is intentionally locked while attaching/replaying. A truncated raw tail cannot restore missing emulator state. Actual omp/Claude/Codex generation sessions and the original production incident were not re-executed.
