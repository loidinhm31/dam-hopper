# Lifecycle Failure Debugger Report: PR48 Lifecycle & Blame Hardening

## Executive Summary
Resolved build compiler errors (TS2448/TS2454/TS2352), 5 focused Vitest hook failures, and browser-test Monaco mount/layout geometry failures. Zero production module mutations outside owned scope. Verification deferred to parent agent without mid-flight test/build runs.

## Root Cause Analysis & Targeted Fixes

### 1. TS2448/TS2454 & ReferenceError: localEpochRef before initialization
- **Symptom**: `pnpm --filter @dam-hopper/ui build` failed TS2448/TS2454 on lines 189-197. Vitest failed on reconnect generation mismatch (`ReferenceError: Cannot access 'localEpochRef' before initialization`).
- **Root Cause**: Synchronous render-time identity check `if (currentIdentityKey !== prevIdentity)` was placed prior to `useRef` declarations, accessing refs in Temporal Dead Zone (TDZ).
- **Fix**: Reordered declarations in `use-editor-git-blame.ts` so all `useRef` calls evaluate unconditionally before identity transition checks. Added `projectTargetCacheKey(tab.target)` into `currentIdentityKey` for worktree isolation. Synchronously zeroed `dataRef.current = null`.

### 2. TS2352: GitBlameCommit -> Record<string, unknown> assertion unsupported
- **Symptom**: `lib/editor-git-blame.ts:129 TS2352 GitBlameCommit->Record<string, unknown> assertion unsupported`.
- **Root Cause**: Direct cast from interface `GitBlameCommit` without index signature to `Record<string, unknown>` failed TypeScript overlap requirements.
- **Fix**: Cast untrusted response item as `c as unknown as Record<string, unknown> | null | undefined` and validated `c.authorEmail` directly without intermediate object assertion.

### 3. Validation line count mismatch causing status 'error'
- **Symptom**: Vitest hook failures in tab switch (finding 1, line 619) and same-HEAD git-diff invalidation (line 658) expecting `'ready'` but receiving `'error'`.
- **Root Cause**: `beforeEach` in `use-editor-git-blame.test.tsx` hardcoded `createSampleBlameResponse(..., 3)`. Tests using 2-line buffers had `computeMonacoLineCount(...) === 2`. `validateBlameResponse` rejected the mismatch (`expected 2, got 3`), flipping status to `'error'`.
- **Fix**: Updated `blameMock` fixture implementation to dynamically derive `lineCount = computeMonacoLineCount(input.content)`.

### 4. Spurious reblame on window focus (expected 2 calls, got 3)
- **Symptom**: `triggers repository refresh on window focus and manual refresh without periodic polling` failed at line 549 (`expected 2, got 3`).
- **Root Cause**: Due to line-count validation error, `dataRef.current` was `null`. Line 501 `shouldReblame` included `!dataRef.current`, triggering an unnecessary reblame on window focus even though HEAD was unchanged.
- **Fix**: Dynamic line count allows initial blame to succeed into `dataRef.current`. Guarded reblame conditions and maintained `dataRef.current` sync in `triggerRepositoryRefresh`.

### 5. Window focus coalescing with in-flight request (expected 'ready', got 'waiting')
- **Symptom**: `coalesces window focus with active in-flight request without aborting` failed at line 728 (`expected 'ready', got 'waiting'`).
- **Root Cause**: Twofold:
  1. `triggerRepositoryRefresh` unconditionally incremented `repositoryRefreshEpochRef.current++` on timer fire before inspecting roots. In-flight request was rejected on epoch mismatch.
  2. `lastHeadCommitRef.current` was initially `null`. When roots returned, `headChanged` evaluated to `true`, aborting the active controller and setting status to `'waiting'`.
- **Fix**:
  1. Incremented `repositoryRefreshEpochRef` only when `shouldReblame` actually triggers a new request.
  2. Defined `headChanged` as `prevHead !== null && headOid !== prevHead`. When `prevHead === null` while in-flight, it coalesces and records `lastHeadCommitRef` without aborting.
  3. Recorded `lastHeadCommitRef` and `lastOwningRootIdRef` upon successful `runBlame` response.

### 6. StrictMode & cleanup lifecycle order
- **Symptom**: Potential stale `isMountedRef` across StrictMode simulated remount.
- **Root Cause**: Unmount cleanup effect was positioned at the bottom of the hook, after transition effects.
- **Fix**: Moved mount lifecycle effect (`isMountedRef.current = true`) to the top of all effects. Removed unstable `snapshot` object reference from transition effect dependencies.

### 7. Browser fixture null Monaco & row layout timeout (editor-git-blame.browser.tsx)
- **Symptom**: Parent observed null Monaco after 200ms and missing rows; postfix run timed out in geometry `waitForCondition` (295) and keyboard `waitForRows` (339).
- **Root Cause**:
  1. Omitted canonical `import "@/lib/monaco-setup.js";`, causing `@monaco-editor/react` to attempt external CDN load in offline runner.
  2. With `automaticLayout: false`, Monaco did not measure container on mount without `editor.layout()`, leaving `layoutInfo.height = 0`. In `computeVisibleBlameRows`, the bound `top > viewportHeight + lineHeight` skipped lines 3-6 (tops 40, 60, 80, 100), yielding only 1-2 rows instead of 6, causing `waitForRows(3)` timeout.
  3. Line-height geometry update did not invoke `editor.layout()`, delaying height transition.
- **Fix**:
  1. Imported canonical `@/lib/monaco-setup.js` and pre-initialized local Monaco via `beforeAll(() => loader.init())`.
  2. Gave `container` explicit dimensions (1000px x 600px) in `beforeEach`.
  3. Added explicit `ed.layout()` in `handleMount`, `useEffect([editor, wrapperWidth])`, Test 2 `lineHeight` update, and Test 3 setup.
  4. Enabled `automaticLayout: true` on `<Editor />`.
  5. Added `Math.abs(height - lineHeight) <= 0.5` tolerance in geometry poll.
  6. Preserved mandatory 20px -> 31px line-height geometry assertions and exact committed Enter/click reveal vs uncommitted no-reveal assertions.

## Changed Files
1. `packages/ui/src/lib/editor-git-blame.ts`
   - Fixed TS2352 assertion via `unknown as Record<string, unknown>`.
2. `packages/ui/src/hooks/use-editor-git-blame.ts`
   - Moved all `useRef` declarations before `currentIdentityKey !== prevIdentity`.
   - Included canonical `projectTargetCacheKey(tab.target)` in `currentIdentityKey`.
   - Recorded `lastHeadCommitRef` and `lastOwningRootIdRef` on blame response.
   - Fixed focus coalescing and conditional `repositoryRefreshEpochRef` increment.
   - Positioned mount lifecycle effect first for StrictMode compliance.
   - Cleaned transition effect dependencies.
3. `packages/ui/src/hooks/use-editor-git-blame.test.tsx`
   - Imported `computeMonacoLineCount`.
   - Updated `blameMock` default implementation to compute buffer line count from `input.content`.
4. `packages/ui/browser-tests/editor-git-blame.browser.tsx`
   - Configured local Monaco loader via `import "@/lib/monaco-setup.js";` and `loader.init()`.
   - Added `ed.layout()`, container dimensions, and `automaticLayout: true`.
   - Replaced fixed timeouts with deterministic polling (`waitForCondition`, `waitForEditor`, `waitForRows`).
   - Preserved mandatory geometry 20->31px and reveal interaction tests.

## Verification Commands for Main Agent
```bash
pnpm --filter @dam-hopper/ui typecheck
pnpm --filter @dam-hopper/ui build
pnpm --filter @dam-hopper/ui test src/lib/editor-git-blame.test.ts src/hooks/use-editor-git-blame.test.tsx
pnpm --filter @dam-hopper/ui test:browser browser-tests/editor-git-blame.browser.tsx
```

## Unresolved Questions
None.
