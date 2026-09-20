# Root Cause Analysis & Fix: Multi-Profile Terminal Floating Keyboard Routing

**Date:** 2026-09-20  
**Context:** Recent multi-profile commits (`699b9174`, `d948bf0a`, `ce1b48b2`, `069fa43f`)  
**Target Files:**
- `packages/ui/src/components/organisms/MobileTerminalAccessoryBar.tsx`
- `packages/ui/src/components/organisms/TerminalRuntimeOutput.tsx`
- `packages/ui/src/components/organisms/PaneContainer.tsx`
- `packages/ui/src/components/organisms/MobileTerminalAccessoryBar.test.tsx`
- `packages/ui/browser-tests/pane-terminal-accessory.browser.tsx`

---

## 1. Root Cause in Recent Multi-Profile Changes

Recent multi-profile changes introduced composite JSON tuple keys for terminal sessions:
- `terminalKey({ profileId, id })` format: `JSON.stringify([profileId, id])`, e.g. `'["default","terminal-1"]'` or `'["remote-profile","api-server"]'`.
- `useTerminalManager` and `WorkspacePage` use these qualified tuple keys for tab management and active pane session tracking (`node.activeSessionId`, `activeSessionId`).
- `TerminalPanel.tsx` in commit `699b9174` was updated to:
  1. Extract `safeSessionId = terminalRef?.id ?? sessionId` (the raw backend PTY id).
  2. Resolve `ownerProfileId = terminalRef?.profileId ?? profileId`.
  3. Route writes through `getConnectionSnapshot(ownerProfileId)` -> `getConnectionTransport(snapshot.owner).terminalWrite(safeSessionId, data)`.

However, `MobileTerminalAccessoryBar.tsx` was **never updated for multi-profile**:
1. It received `sessionId` as the qualified JSON tuple string (e.g. `'["default","terminal-1"]'`).
2. It passed that raw tuple string directly to `getTransport().terminalWrite(sessionId, sequence)`.
3. The backend Rust PTY manager looks up sessions by raw ID (`"terminal-1"`). Looking up `'["default","terminal-1"]'` returned `None` and silently dropped all keystrokes.
4. Furthermore, `getTransport()` only targeted the ambient/fallback transport. For remote profiles or when ambient was idle, keystrokes were directed to the wrong server entirely.

---

## 2. Changes Implemented

1. **`MobileTerminalAccessoryBar.tsx`**:
   - Added props `profileId?: string` and `terminalRef?: TerminalRef`.
   - Used `parseTerminalKey(sessionId)` from `@/api/ownership.js` to extract `safeSessionId` (raw backend ID) and `ownerProfileId`.
   - Implemented `writeTerminal` helper that queries `getConnectionSnapshot(ownerProfileId)`. If connected, it writes via `getConnectionTransport(snapshot.owner)`; otherwise falls back to `getTransport()`.
   - Updated `handlePress`, `handleCustomKeyPress`, and `handleTerminalInput` to route through `writeTerminal(sequence)`.
   - Passed `safeSessionId` to `TerminalFloatingControlShell`.

2. **`TerminalRuntimeOutput.tsx` & `PaneContainer.tsx`**:
   - Passed `profileId` and `terminalRef` from `mountedSessions` matching `activeSessionId` / `node.activeSessionId` to `MobileTerminalAccessoryBar`.

3. **`MobileTerminalAccessoryBar.test.tsx`**:
   - Added regression test verifying multi-profile composite key routing: verifies `terminalWrite` reaches the profile transport with the unescaped raw backend session ID.

4. **`pane-terminal-accessory.browser.tsx`**:
   - Updated `@/api/transport.js` mock to include `getTransportGeneration` and `subscribeTransportChanges`.

---

## 3. Verification Evidence

- `pnpm --filter @dam-hopper/ui exec vitest run src/components/organisms/MobileTerminalAccessoryBar.test.tsx`: 13/13 unit tests passed.
- `pnpm --filter @dam-hopper/ui exec vitest run --config vitest.browser.config.ts browser-tests/mobile-terminal-accessory-bar.browser.tsx`: 10/10 browser tests passed in Chromium.
- `pnpm --filter @dam-hopper/ui exec vitest run --config vitest.browser.config.ts browser-tests/pane-terminal-accessory.browser.tsx`: 2/2 browser tests passed in Chromium.
- `pnpm --filter @dam-hopper/ui test`: 262/262 test files passed, 1838/1838 unit tests passed.
- `pnpm --filter @dam-hopper/ui test:browser`: 40/40 test files passed, 214/214 browser tests passed.
- `pnpm --filter @dam-hopper/ui build`: clean TypeScript compilation (`tsc -p tsconfig.json`).
- `npx eslint`: 0 errors, 0 warnings on modified files.

---

## 4. Unresolved Questions
None.
