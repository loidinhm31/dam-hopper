# Phase 07 Test Failure Analysis & Remediation Report

**Date:** 2026-09-17  
**Context:** Phase 07 media session isolation and encrypted-write ownership validation  
**Target Files:**
- `packages/ui/src/components/organisms/ServerProfilesDialog.test.tsx`
- `packages/ui/src/contexts/EncryptContext.tsx`
- `packages/ui/src/hooks/use-encrypted-write.ts`

---

## Executive Summary

Phase07Tester identified 2 test failures in `ServerProfilesDialog.test.tsx` (unhandled mock rejections) and 3 TypeScript diagnostics across `EncryptContext.tsx` (TS2550: `Promise.withResolvers`) and `use-encrypted-write.ts` (TS2554: `getTransport` argument mismatch).
All 3 root causes analyzed, minimal non-breaking line fixes determined and verified locally.
Verification results: 50/50 UI unit tests passed, UI TypeScript compilation (`pnpm --filter @dam-hopper/ui build`) passed cleanly with 0 errors.

---

## Technical Analysis & Exact Line Fixes

### 1. `packages/ui/src/components/organisms/ServerProfilesDialog.test.tsx`

- **Symptom:** `Error: [vitest] No "getMediaClientIdForProfile" export is defined on the "@/api/connections.js" mock.` Tests failed with 0 calls to `revokeCurrentMediaSession`.
- **Root Cause:** `ServerProfilesDialog.tsx` imports `getMediaClientIdForProfile` from `@/api/connections.js` and calls it inside `handleLogout` and `handleDelete`. The test file's `vi.mock("@/api/connections.js")` did not define this export, causing a runtime `TypeError` when clicking Remove or Logout buttons. Tests at lines 124-128 and 167-171 expect `expect.anything()`, which requires a non-null, non-undefined return value.
- **Exact Line Fix:**
  In `packages/ui/src/components/organisms/ServerProfilesDialog.test.tsx`, add `getMediaClientIdForProfile` to `vi.mock("@/api/connections.js")` (line 23):

```tsx
// packages/ui/src/components/organisms/ServerProfilesDialog.test.tsx
vi.mock("@/api/connections.js", () => ({
  connectProfile: mockConnectProfile,
  disconnectProfile: mockDisconnectProfile,
  removeProfileConnection: mockRemoveProfileConnection,
  getMediaClientIdForProfile: vi.fn(() => "test-media-client-id"),
  subscribeConnections: vi.fn(() => () => {}),
  getConnectionSnapshot: vi.fn((profileId: string) => {
    ...
```

---

### 2. `packages/ui/src/contexts/EncryptContext.tsx`

- **Symptom:** `error TS2550: Property 'withResolvers' does not exist on type 'PromiseConstructor'. Do you need to change your target library? Try changing the 'lib' compiler option to 'es2024' or later.` at lines 324 and 338.
- **Root Cause:** `Promise.withResolvers` is an ECMAScript 2024 feature. `packages/ui/tsconfig.json` specifies `"target": "ES2022"` and `"lib": ["ES2022", "DOM", "DOM.Iterable"]`. Under ES2022 compiler settings, `Promise.withResolvers` is not in the type definitions.
- **Exact Line Fix:**
  Add a standard ES2022-compatible `createDeferred<T = void>()` helper function (matching the identical remediation in `packages/ui/src/api/connections.ts:24`), and replace lines 324 and 338:

```tsx
// Insert above toEncryptKey (around line 34):
function createDeferred<T = void>(): {
  promise: Promise<T>;
  resolve: (value: T | PromiseLike<T>) => void;
  reject: (reason?: unknown) => void;
} {
  let resolve!: (value: T | PromiseLike<T>) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}
```

```tsx
// Line 324 (in-flight prompt deduplication):
// Replace:
//   const { promise, resolve, reject } = Promise.withResolvers<string>();
// With:
const { promise, resolve, reject } = createDeferred<string>();
```

```tsx
// Line 338 (new prompt request):
// Replace:
//   const { promise, resolve, reject } = Promise.withResolvers<string>();
// With:
const { promise, resolve, reject } = createDeferred<string>();
```

---

### 3. `packages/ui/src/hooks/use-encrypted-write.ts`

- **Symptom:** `error TS2554: Expected 1 arguments, but got 0.` at line 135.
- **Root Cause:** Line 135 invokes `(owner ? getTransport(owner) : getTransport())`. The file imported `getTransport` solely from `@/api/connections.js`, where the signature is `getTransport(owner: ConnectionRef): Transport` (requires 1 argument). The 0-argument ambient fallback transport getter is exported by `@/api/transport.js`.
- **Exact Line Fix:**
  Align with repo convention used across `use-fs-ops.ts`, `LargeFileViewer.tsx`, `use-file-search.ts`, and `editor.ts`:
  Import ambient `getTransport` from `@/api/transport.js` and alias `@/api/connections.js`'s `getTransport` to `getConnectionsTransport`.

```tsx
// packages/ui/src/hooks/use-encrypted-write.ts
// Lines 20-25: Replace imports:
import { getTransport } from "@/api/transport.js";
import {
  captureConnection,
  getConnectionSnapshot,
  getTransport as getConnectionsTransport,
  isCurrentConnection,
} from "@/api/connections.js";
```

```tsx
// Line 135: Update call inside resolveOwnerAndTransport:
// Replace:
//   const transport = (owner ? getTransport(owner) : getTransport()) as WsTransport;
// With:
const transport = (owner ? getConnectionsTransport(owner) : getTransport()) as WsTransport;
```

---

## Verification Evidence

1. **TypeScript Build:**
   ```bash
   pnpm --filter @dam-hopper/ui build
   # Exit code 0, 0 diagnostics
   ```
2. **UI Test Suite (8 files / 50 tests):**
   ```bash
   pnpm --filter @dam-hopper/ui test \
     src/api/media-session.test.ts \
     src/api/image-tickets.test.ts \
     src/api/video-tickets.test.ts \
     src/contexts/EncryptContext.test.tsx \
     src/hooks/use-encrypted-write.test.tsx \
     src/components/organisms/ImagePreview.test.tsx \
     src/components/organisms/VideoPreview.test.tsx \
     src/components/organisms/ServerProfilesDialog.test.tsx
   # Result: 8 passed (8), 50 passed (50), 0 failed
   ```

---

## Unresolved Questions

None.
