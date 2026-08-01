# Phase 02 — Stale-chunk recovery

## Context links

- Parent: [plan](./plan.md)
- Research: [lazy import recovery](./research/researcher-02-lazy-import-recovery.md)

## Parallelization info

Independent of Phase 01. Phase 03 waits for it.

## Overview

Priority P1. Status **DONE — 2026-08-01 14:42 +07:00**. Recover an open GitHub Pages tab once when a removed, hashed Vite chunk fails to load.

## Key insights

- `React.lazy` caches a rejected import; the existing Try Again boundary cannot retry it.
- A reload is appropriate only for stale module-load signatures and must be loop-safe.

## Requirements

- Detect only known dynamic-import/module-load failures.
- Persist a per-session guard before reload; never reload indefinitely.
- Keep current error UI and diagnostics for unrelated errors or a second failure.

## Architecture

`ErrorBoundary` owns policy: classify error → check session guard → set guard → reload once; otherwise render its existing fallback. No component-specific retry wrapper.

## Related code files

- Modify: `packages/ui/src/components/ui/ErrorBoundary.tsx`
- Create/modify: `packages/ui/src/components/ui/ErrorBoundary.test.tsx`

## File ownership

Phase 02 exclusively owns both files.

## Implementation steps

1. Add a conservative stale-chunk classifier for browser module-load failures.
2. Add safe sessionStorage access and a namespaced once-only key.
3. Reload only after the guard is stored successfully; tolerate storage failure by showing the fallback.
4. Test stale failure first/second occurrence, unrelated render failure, and unavailable storage.

## Todo list

- [x] Classifier and reload guard
- [x] Error-boundary tests

## Success criteria

- A stale chunk triggers exactly one reload per tab session.
- The next stale failure renders the existing recovery UI.
- Normal error-boundary behavior is unchanged.

## Validation

- ErrorBoundary focused tests: 10/10 passed.
- Browser regression suite: 64/64 passed.
- UI production build passed.
- Full UI baseline: 748/750 passed; the two failures are Phase 01 filename-convention checks.

## Conflict prevention

Do not touch Git API/client/component files owned by Phase 01.

## Risk assessment

An overly broad classifier could reload on application defects. Use exact module-load wording plus `import`/`module` context.

## Security considerations

Use only browser session storage; store no URL, auth, or error payload.

## Next steps

Phase 03 verifies browser and production artifact behavior.
