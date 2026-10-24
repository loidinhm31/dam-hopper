# Phase 04: Real Terminal Display & Input Surface
Phase: 04
Dependencies: Phase 01

## Scope
Implement `ProjectTerminalScreen.kt` and update `TerminalScreens.kt` in `native-app/shared/src/commonMain/kotlin/dev/damhopper/nativeapp/`:
1. Session management for the selected project:
   - Queries `terminalRepo.listDetailed()`.
   - Filters/associates sessions with the selected project (or creates a session if none exists for that project).
   - Allows switching between project terminal sessions.
2. Terminal output buffer rendering:
   - Fetches historical buffer from `terminalRepo.getBuffer(sessionId)`.
   - Listens to WebSocket events (`terminalBuffer`, `terminalOutput`, `terminalExit`).
   - Reconciles chunks via `TerminalSessionController` or maintains an in-memory observable buffer of text lines.
   - Monospace font, dark background, scrollable LazyColumn or vertical scroll container with auto-scroll to bottom on new output.
3. Interactive command & keystroke input:
   - Single-line command input field with "Send" action button.
   - Pressing Enter or tapping "Send" sends `<command>\r` via `terminalRepo.writeTerminal(id, ...)`.
   - Inline accessory bar with key shortcuts:
     - [Ctrl+C]: sends `\u0003`
     - [Tab]: sends `\t`
     - [Esc]: sends `\u001b`
     - [↑]: sends `\u001b[A`
     - [↓]: sends `\u001b[B`
     - [Clear]: clears client-side view buffer
4. Lifecycle & Back-Navigation:
   - "← Projects" button to return to the project list.
   - Does NOT kill remote PTY when navigating back (allows detaching and re-attaching cleanly).

## Acceptance Criteria
- Live terminal output is rendered and visibly updates when output arrives.
- Commands typed by user are sent to PTY and executed.
- Back button cleanly detaches and returns to Project List.

## Implementation Status: Completed
- [x] Top Header with "← Projects" navigation, project title, and session picker tabs / "+ New Terminal".
- [x] `ConsoleBufferTerminalSurface` implementing `NativeTerminalSurface` with ANSI stripping (`cleanAnsiCodes`) and bounded line buffer (2000 lines).
- [x] Bounded scrollable monospace console viewer with auto-scroll to bottom.
- [x] Reconciled output routed strictly through `TerminalSessionController` and `TerminalReplayGate`.
- [x] Interactive command input with IME action "Send" and inline accessory bar ([Ctrl+C], [Tab], [Esc], [↑], [↓], [Clear]).
- [x] Client-side "Clear" clears only local display surface lines without resetting server stream offsets.
- [x] Back button cleanly performs local cleanup without killing remote server PTY session.
- [x] `TerminalPanelScreen` in `TerminalScreens.kt` updated with `ConsoleBufferTerminalSurface` rendering and inline command bar.
- [x] Zero WebView and zero floating action buttons.
