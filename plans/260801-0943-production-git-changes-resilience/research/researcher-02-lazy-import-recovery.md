# Research: lazy-import recovery for WorkspacePage / ChangedFilesList

Timestamp: 2026-08-01 (Asia/Ho_Chi_Minh)

## Findings

- `packages/ui/src/embed/dam-hopper-app.tsx` defines the route-level lazy import for `WorkspacePage` and wraps it in `<ErrorBoundary><Suspense>…`; the same pattern is used for every page route.
- `WorkspacePage.tsx` has many nested `React.lazy` imports. `ChangedFilesList` is lazy-loaded at lines ~190-193 and rendered in multiple IDE/terminal surfaces under `Suspense` only. There is no nested error boundary around those panels, so a rejected chunk import bubbles to the `/workspace` route boundary.
- `ErrorBoundary.tsx` currently records the error and renders “Try Again”. Resetting state does **not** help a rejected `React.lazy` promise: React caches the rejection, so the same stale Vite chunk URL fails repeatedly.
- No existing `ErrorBoundary` unit test or stale-chunk detector was found. Existing `WorkspacePage.test.tsx` and `ChangedFilesList.test.ts` exercise rendering/helpers, not dynamic-import failures. Browser tests render `WorkspacePage` directly and are not a good place for deterministic module-loader failure simulation.

## Minimal recommendation

Make the existing route `ErrorBoundary` perform one guarded full reload when its error is a stale Vite chunk/dynamic-import failure. Keep normal runtime errors on the existing “Try Again” UI.

1. Add a small, exported predicate (e.g. `isStaleChunkError`) in `packages/ui/src/components/ui/ErrorBoundary.tsx`. Match conservative signals only: `ChunkLoadError`, `Loading chunk <n> failed`, `Failed to fetch dynamically imported module`, or `Importing a module script failed`. Do not reload for arbitrary errors.
2. In `componentDidCatch`, use a session-storage marker scoped to the current page/build (for example `dam-hopper:chunk-reload-attempted`). If marker absent, set it and call `window.location.reload()`. This handles both the top-level `WorkspacePage` import and nested `ChangedFilesList`/other panel imports because all bubble to the route boundary.
3. Clear the marker after a successful render/mount (or on a short, build-agnostic success effect) so a later, unrelated deployment can recover again. Avoid clearing synchronously in `componentDidCatch`; that would permit an infinite reload loop. If storage is unavailable, fail closed and show the existing fallback.
4. Preserve route/query/hash automatically by using `location.reload()`; no custom navigation needed. Avoid cache-busting query strings, which can bypass Vite’s cache but risk duplicate app state and CDN behavior.

The one-reload guard is intentionally global per tab, not per component. Multiple lazy failures during one boot must not trigger repeated reloads.

## Tests / exclusive files

Implementation ownership should be limited to:

- `packages/ui/src/components/ui/ErrorBoundary.tsx` — detector, session marker, guarded reload.
- `packages/ui/src/components/ui/ErrorBoundary.test.tsx` (new) — pure predicate cases; normal error renders fallback; stale chunk invokes `location.reload` once; second mount/error with marker does not reload; storage failures do not throw.

No source changes are required in `WorkspacePage.tsx`, `ChangedFilesList.tsx`, or `dam-hopper-app.tsx`; their current boundary topology already routes failures correctly. Keep existing `WorkspacePage.test.tsx` and `ChangedFilesList.test.ts` unchanged unless a regression test is specifically desired for boundary placement. A lightweight integration assertion could be added to a future `dam-hopper-app.test.tsx`, but it is not necessary for the minimal fix.

## Caveats / unresolved questions

- Exact Vite error text can vary by browser and deployment proxy; keep the predicate conservative and include tests for Chromium/Firefox wording observed in production logs.
- Decide whether the marker should include a build identifier if one is already exposed. A plain session marker is simpler and still prevents loops, but may suppress recovery for a second deployment in the same tab until the tab is reopened.
- `sessionStorage` access can throw in privacy modes; guard reads/writes with `try/catch` and leave the current fallback available.
