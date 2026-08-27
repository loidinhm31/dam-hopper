# Phase 01 — Implement shortcut

## Context links

- [Overview](plan.md)
- `apps/native/src/main.tsx`
- `apps/native/src-tauri/src/lib.rs`

## Overview

- Date: 2026-08-22
- Priority: quick
- Status: completed

## Key insights

- Keyboard events arrive in the native webview, not Tauri `WindowEvent`.
- Tauri’s desktop `WebviewWindow::open_devtools()` is the native action, enabled for release builds by the existing Tauri dependency.

## Requirements

- Match only `Shift+F12` with no Ctrl, Alt, Meta, or repeat state.
- Prevent the browser default and stop propagation.
- Ignore mobile platforms and keep the command desktop-only; support production desktop builds.

## Architecture

`apps/native/src/main.tsx` capture listener → `invoke("open_debug_console")` → desktop Tauri command → `WebviewWindow::open_devtools()`.

## Related code files

- `apps/native/src/main.tsx`
- `apps/native/vite.config.ts`
- `apps/native/src-tauri/Cargo.toml`
- `apps/native/src-tauri/src/lib.rs`

## Implementation steps

1. Add native desktop shortcut listener and cleanup.
2. Add/register the desktop command in both desktop invoke-handler variants.
3. Enable Tauri devtools for production desktop builds.
4. Review the diff; skip tests as requested.

## Todo list

- [x] Add frontend listener.
- [x] Add Rust command and registrations.
- [x] Enable release devtools support.
- [x] Review diff.

## Success criteria

`Shift+F12` opens Tauri developer tools during desktop debug runs without changing web/mobile behavior.

## Risk assessment

Low. The handler is scoped to the native desktop entrypoint and the command has no external inputs.

## Security considerations

No new data access. Devtools remains unavailable from the command body in non-debug builds.

## Next steps

Implemented and reviewed; tests/builds intentionally skipped per request.
