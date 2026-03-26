# Research: Backend Terminal IPC + PTY for Free Terminals

## Key Findings

### 1. terminal.ts (IPC handler)
- `opts.project` is required but code already handles projectless gracefully (env/cwd fallbacks exist)
- Make `project` optional in IPC request shape
- Env resolution and cwd logic already support undefined project

### 2. session-manager.ts (PTY)
- `deriveType()` checks ID prefixes → add "free:" prefix
- Add `"free"` to SessionMeta.type union
- Session ID: `free:${timestamp}` derives type "free"

### 3. ipc-channels.ts
- No changes needed — existing channels are generic

### 4. preload/index.ts
- Make `project` optional in TerminalCreateOpts

## Summary
Minimal backend changes. Existing code already handles projectless operation. Changes:
1. Make `project` optional in two type signatures (preload, IPC handler)
2. Add "free" to type union and derive function
3. Env/cwd fallback logic already works for undefined project
