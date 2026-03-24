# Research: Electron + node-pty + xterm.js

## Architecture

```
Main Process (Node.js)          IPC           Renderer (Chromium)
├── node-pty spawn/manage  ◄──────────────►  ├── xterm.js terminal
├── Session registry (Map)   terminal:       ├── @xterm/addon-fit
├── @dev-hub/core direct     data/input/     ├── React 19 dashboard
│   import                   resize/kill     └── TanStack Query (non-terminal APIs)
```

## Key Packages

- `electron` v28+, `node-pty`, `@xterm/xterm` v5, `@xterm/addon-fit`, `@xterm/addon-web-links`
- `electron-rebuild` required for node-pty native compilation
- `electron-builder` or `electron-forge` for packaging

## IPC Pattern

1. Main process spawns PTY via `node-pty`, stores in `Map<string, IPty>`
2. PTY output → `ipcMain` sends `terminal:data:${id}` to renderer
3. Renderer keystrokes → `ipcRenderer.send('terminal:input', {id, data})`
4. Resize: `terminal:resize` → `pty.resize(cols, rows)`
5. Preload script uses `contextBridge` (secure, no nodeIntegration)

## Multiple Sessions

Map<string, IPty> registry. Each session gets UUID. IPC channels namespaced by ID. VS Code and Hyper use this exact pattern.

## Pros

- Native Node.js — node-pty just works, zero bridging
- @dev-hub/core imports directly in main process
- Existing React components transfer unchanged
- Real PTY (vim, htop, interactive prompts all work)
- Large ecosystem, battle-tested (VS Code, Hyper)

## Cons

- Bundle size ~150-200MB (Chromium + Node.js)
- Memory ~100-200MB baseline per window
- Native module compilation per platform/Electron version
- Must use contextIsolation + contextBridge pattern

## Migration Effort

| Area                     | Effort         |
| ------------------------ | -------------- |
| Electron shell setup     | 1-2 days       |
| React app into renderer  | 1 day          |
| Replace Hono RPC → IPC   | 2-3 days       |
| Replace SSE → IPC events | 1 day          |
| Terminal integration     | 1-2 days       |
| Packaging + CI           | 1-2 days       |
| **Total**                | **~7-11 days** |
