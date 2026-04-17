# Phase 03 — Frontend Reconnect UI

## Context
- Parent: [plan.md](./plan.md)
- Dependencies: Phase 2 (protocol extension)

## Overview
- Date: 2026-04-17
- Description: Implement client-side `terminal:attach` on WS reconnect and handle `terminal:buffer` response.
- Priority: P2
- Implementation status: pending
- Effort: 6h

## Key Insights
- `TerminalPanel.tsx` already tracks `sessionId` and `wsStatus` via context.
- On WS reconnect, client should send `terminal:attach` instead of `terminal:create`.
- `terminal:buffer` response replays scrollback into xterm.js.
- Need "Reconnecting..." indicator during attach to avoid confusing blank state.
- Store `offset` for delta replay optimization (optional but straightforward).

## Requirements
- Send `terminal:attach` when WS reconnects AND session was previously active.
- Handle `terminal:buffer` message — clear xterm, write buffer, store offset.
- Show "Reconnecting..." overlay during attach (between send and response).
- If attach fails (timeout or no response), fallback to `terminal:create`.
- Maintain live `terminal:output` handling after attach completes.

## Architecture

### State Machine

```
                    ┌───────────────────────────┐
                    │       DISCONNECTED        │
                    │   (WS down, session ID    │
                    │    remembered)            │
                    └───────────┬───────────────┘
                                │ WS reconnects
                                ▼
                    ┌───────────────────────────┐
                    │       ATTACHING           │
                    │   send terminal:attach    │
                    │   show "Reconnecting..."  │
                    └───────────┬───────────────┘
                                │
              ┌─────────────────┴─────────────────┐
              │                                   │
              ▼                                   ▼
  ┌───────────────────────┐          ┌────────────────────────┐
  │      ATTACHED         │          │    ATTACH_FAILED       │
  │  write buffer to xterm│          │  (timeout or error)    │
  │  resume live output   │          │  → fallback to create  │
  └───────────────────────┘          └────────────────────────┘
```

### Component Changes

```tsx
// TerminalPanel.tsx

// New state
const [attachState, setAttachState] = useState<'idle' | 'attaching' | 'attached'>('idle');
const [lastOffset, setLastOffset] = useState<number>(0);

// On WS reconnect
useEffect(() => {
  if (wsStatus === 'connected' && sessionId && attachState === 'idle') {
    setAttachState('attaching');
    sendMessage({
      kind: 'terminal:attach',
      id: sessionId,
      from_offset: lastOffset || null,
    });
    
    // Timeout fallback
    const timeout = setTimeout(() => {
      if (attachState === 'attaching') {
        console.warn('terminal:attach timeout, creating new session');
        setAttachState('idle');
        createSession(sessionId);
      }
    }, 3000);
    
    return () => clearTimeout(timeout);
  }
}, [wsStatus, sessionId]);

// Handle terminal:buffer
useWsMessage('terminal:buffer', (msg) => {
  if (msg.id === sessionId) {
    termRef.current?.clear();
    termRef.current?.write(msg.data);
    setLastOffset(msg.offset);
    setAttachState('attached');
  }
});
```

### Reconnecting Indicator

```tsx
// Overlay during attach
{attachState === 'attaching' && (
  <div className="absolute inset-0 bg-black/50 flex items-center justify-center">
    <div className="text-sm text-zinc-400 flex items-center gap-2">
      <Spinner size="sm" />
      Reconnecting...
    </div>
  </div>
)}
```

## Related Code Files
- `packages/web/src/components/organisms/TerminalPanel.tsx` — main changes
- `packages/web/src/api/client.ts` — add message types
- `packages/web/src/hooks/useWsMessage.ts` — may need handler for new message type

## Implementation Steps
1. Add `TerminalAttach` and `TerminalBuffer` types to `client.ts`.
2. Add `attachState` and `lastOffset` state to `TerminalPanel`.
3. Implement attach-on-reconnect effect.
4. Implement `terminal:buffer` handler.
5. Add timeout fallback to `terminal:create`.
6. Add "Reconnecting..." overlay.
7. Manual test: kill WS, reconnect, verify buffer replay.

## Todo
- [ ] TypeScript message types
- [ ] Attach state management
- [ ] Reconnect effect
- [ ] Buffer handler
- [ ] Timeout fallback
- [ ] Reconnecting overlay
- [ ] Manual smoke test

## Test Scenarios

| Scenario | Expected |
|----------|----------|
| WS disconnect + reconnect | "Reconnecting..." → buffer replays → live output continues |
| Browser refresh | Attach on mount → buffer replays |
| Session killed during disconnect | Attach timeout → new session created |
| Multiple tabs same session | Both receive buffer on reconnect |

## Success Criteria
- Browser refresh replays scrollback (no blank terminal).
- WS disconnect + reconnect replays buffer without user action.
- Live output continues seamlessly after replay.
- "Reconnecting..." shown during attach (UX feedback).

## Risk Assessment
- Medium. Frontend state machine complexity — must handle edge cases cleanly.
- Race: `terminal:output` arrives during attach — queue or ignore until attached.
- Mitigation: Attach completes before live output can arrive (server sends buffer first).

## UX Considerations
- "Reconnecting..." should fade in after 200ms to avoid flash on fast reconnect.
- If buffer is large (>64KB), consider chunked write to avoid UI freeze.
- Cursor position: after replay, cursor is at end — matches expected behavior.

## Next Steps
Phase A complete after this phase. Phase 4 begins Phase B (SQLite persistence).
