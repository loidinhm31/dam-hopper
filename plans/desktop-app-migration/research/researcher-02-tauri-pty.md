# Research: Tauri v2 + PTY Integration

## Architecture

```
System WebView (React/Vite)        Tauri Core (Rust)
├── xterm.js terminal         ◄──► ├── portable-pty (PTY spawn)
├── @tauri-apps/api invoke()       ├── tauri::command (RPC)
└── listen() for events            └── tauri::Emitter (streaming)
```

## Key Packages

- `@tauri-apps/cli` v2, `@tauri-apps/api` v2
- `portable-pty` (Rust crate, by wezterm author)
- `xterm.js` + `@xterm/addon-fit`
- `tauri-plugin-shell` v2 (NOT sufficient — no PTY, stdout/stderr only)

## The Core Problem: @dev-hub/core is TypeScript

Three bridging options:

| Approach                    | Effort     | Bundle                          | Pragmatism             |
| --------------------------- | ---------- | ------------------------------- | ---------------------- |
| **A: Sidecar Node.js**      | 2-3 weeks  | ~60MB (defeats Tauri advantage) | High — zero rewrite    |
| **B: Rewrite core in Rust** | 6-10 weeks | ~10MB ideal                     | Low — massive effort   |
| **C: NAPI-RS bridge**       | 3-4 weeks  | ~40MB                           | Medium — complex build |

## Tauri + Vite Integration

Works well — configure `src-tauri/tauri.conf.json` to point at Vite dev server and `packages/web/dist`. Existing React app runs as-is in webview.

## Pros

- Small bundle ~10-15MB (without sidecar)
- Lower memory (system webview)
- Built-in auto-updater
- Modern, growing ecosystem

## Cons

- Rust requirement adds language barrier
- @dev-hub/core impedance mismatch (TS ↔ Rust)
- Sidecar approach negates size advantage
- Less mature PTY ecosystem than node-pty
- Team must learn Rust for maintenance

## Recommendation

For a 100% TypeScript codebase, Tauri only makes sense if willing to rewrite core in Rust (6-10 weeks) or accept sidecar bloat. **Electron is the pragmatic choice for dev-hub.**
