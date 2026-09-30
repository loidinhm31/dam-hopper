# Analysis of Phase 03 Profile-Owned Host-Resource Stream Client Failures

## Executive Summary

Phase 03 build and test runs encountered 3 compilation/type errors and 19 test failures across 6 files. Investigation identified the root causes across 6 distinct failure categories. Three issues are build/type errors or omissions introduced during recent refactoring (`registryQueryClient` undeclared reference, duplicate `QueryClient` import, and unhandled `Timeout | null` in `clearTimeout`), one is a cascading runtime failure in MFA step-up caused by the undeclared reference, three are fixture/mock mismatches in tests (BigInt serialization in SSE payloads, missing `attemptNumber` sync in finite response handler, and missing mock transport on test connection entries), one is a typo in an SSE parser unit test (`\n\r` vs intended `\n\r\r`), and one is a missing JSON truncation fallback in `WsTransport.openHostResourceEvents`.

---

## Technical Analysis & Fix Steps

### 1. `src/api/connections.ts:571`: Undeclared `registryQueryClient` and Duplicate Identifier `QueryClient`

#### Root Cause
- **Duplicate Identifier**: `packages/ui/src/api/connections.ts:2` imports `import type { QueryClient } from "@tanstack/react-query"`. Line 63 concurrently imported `type QueryClient` from `./host-resource-stream-coordinator.js`, triggering TypeScript compiler diagnostic `duplicate identifier 'QueryClient'`.
- **ReferenceError**: A recent refactor removed `let registryQueryClient: QueryClient | null = null;` and its assignment inside `setConnectionRegistryQueryClient`. However, `performConnectProfile` at line 571 still passes `registryQueryClient ?? undefined` to `installTransportBridge(owner, transport, registryQueryClient ?? undefined)`. During connection establishment, accessing the undeclared identifier raises `ReferenceError: registryQueryClient is not defined`, failing 7 tests in `connections.test.ts`, 3 tests in `connections-mfa.test.tsx`, and `phase-02-unified-shell.test.tsx`.

#### Fix Steps
1. In `packages/ui/src/api/connections.ts:60-64`, remove `type QueryClient` from the import list of `./host-resource-stream-coordinator.js`.
2. At module scope (line 71), restore `let registryQueryClient: QueryClient | null = null;`.
3. In `setConnectionRegistryQueryClient(queryClient: QueryClient | null)` (lines 72-80), store `registryQueryClient = queryClient;`:
```ts
let registryQueryClient: QueryClient | null = null;
let legacyQueryClientDisposer: (() => void) | null = null;
export function setConnectionRegistryQueryClient(
  queryClient: QueryClient | null,
): void {
  registryQueryClient = queryClient;
  legacyQueryClientDisposer?.();
  legacyQueryClientDisposer = null;
  if (queryClient) {
    legacyQueryClientDisposer = registerConnectionRegistryQueryClient(queryClient);
  }
}
```

---

### 2. `src/api/connections-mfa.test.tsx`: `stepUpProfileMfa expected true but received false`

#### Root Cause
- In `stepUpProfileMfa(profileId, code)` (`packages/ui/src/api/connections.ts:836-859`), the function executes:
  1. `requestMfaStepUpChallenge(cleanUrl, token)` (mock returns 200 with challenge token).
  2. `verifyMfa(cleanUrl, challenge.challengeToken, code)` (mock returns 200 with replacement session token).
  3. `setAuthToken(session.token, profileId)`.
  4. `disconnectProfile(profileId)`.
  5. `await connectProfile(profileId)` -> calls `performConnectProfile(profileId)`.
- At line 571 inside `performConnectProfile`, `registryQueryClient ?? undefined` threw `ReferenceError: registryQueryClient is not defined`.
- `stepUpProfileMfa` wraps the operations in `try { ... } catch { return false; }`. The uncaught `ReferenceError` was caught by this block, causing `stepUpProfileMfa` to return `false` instead of `true`.
- This is a direct cascade from Issue 1.

#### Fix Steps
- Resolving Issue 1 (declaring and setting `registryQueryClient`) completely resolves this failure. No change to `connections-mfa.test.tsx` or `stepUpProfileMfa` is required.

---

### 3. `src/api/host-resource-stream-coordinator.ts:369`: `clearTimeout` Incompatible Type `Timeout | null`

#### Root Cause
- In `packages/ui/src/api/host-resource-stream-coordinator.ts:113`, `byteIdleTimer` is defined as:
  `private byteIdleTimer: ReturnType<typeof setTimeout> | null = null;`.
- At line 369 in `armByteIdleDeadline(capturedAttempt: number)`:
  `clearTimeout(this.byteIdleTimer);` is invoked without checking for null.
- Under TypeScript compiler type definitions, `clearTimeout` overloads do not accept `null`, causing compilation diagnostic:
  `src/api/host-resource-stream-coordinator.ts:369: Argument of type 'Timeout | null' is not assignable to parameter of type 'Timeout | undefined'`.
- All other invocations in the file (lines 290, 294, 298, 302, 309, 313, 317, 577) guard with `if (this.timer) clearTimeout(this.timer);`.

#### Fix Steps
- In `packages/ui/src/api/host-resource-stream-coordinator.ts:369`, guard `byteIdleTimer`:
```ts
private armByteIdleDeadline(capturedAttempt: number): void {
  if (this.byteIdleTimer) {
    clearTimeout(this.byteIdleTimer);
    this.byteIdleTimer = null;
  }
  this.byteIdleTimer = setTimeout(() => {
    if (this.disposed || capturedAttempt !== this.attemptNumber) return;
    this.handleStreamFailure(
      capturedAttempt,
      new Error("45 s byte idle timeout expired"),
    );
  }, BYTE_IDLE_TIMEOUT_MS);
}
```

---

### 4. `src/api/host-resource-stream-coordinator.test.ts`: BigInt in JSON.stringify, attemptNumber check in handleFiniteResponse, getTransport mock

#### 4A. BigInt in `JSON.stringify` and SSE Wire Key Mismatch
- **Root Cause**:
  - Tests at lines 232 and 282 call `JSON.stringify(MOCK_STATUS)`, and lines 255 and 293 call `JSON.stringify(MOCK_FRAME)`.
  - Both fixtures contain `revisionBigInt: 10n` (`bigint`) and internal discriminator `kind: "status"` / `kind: "data"`.
  - Native `JSON.stringify()` throws `TypeError: Do not know how to serialize a BigInt`.
  - Furthermore, `decodeHostResourceEvent` in `host-resource-sse-codec.ts` enforces exact key counts: 5 keys for status (`serverEpoch`, `revision`, `snapshotAgeMs`, `metricsAgeMs`, `freshnessTtlMs`) and 6 keys for data (`schemaVersion`, `serverEpoch`, `revision`, `snapshot`, `metrics`, `lightSampleMs`). Serializing internal domain frames with `kind` and `revisionBigInt` violates key constraints.
- **Fix Steps**:
  - In `src/api/host-resource-stream-coordinator.test.ts`, declare wire payloads matching the wire specification:
```ts
const MOCK_STATUS_WIRE = {
  serverEpoch: VALID_UUID,
  revision: "10",
  snapshotAgeMs: 50,
  metricsAgeMs: 50,
  freshnessTtlMs: 10000,
};

const MOCK_FRAME_WIRE = {
  schemaVersion: 1,
  serverEpoch: VALID_UUID,
  revision: "10",
  snapshot: MOCK_FRAME.snapshot,
  metrics: MOCK_FRAME.metrics,
  lightSampleMs: 5000,
};
```
  - In lines 232 and 282, replace `JSON.stringify(MOCK_STATUS)` with `JSON.stringify(MOCK_STATUS_WIRE)`.
  - In lines 255 and 293, replace `JSON.stringify(MOCK_FRAME)` with `JSON.stringify(MOCK_FRAME_WIRE)`.

#### 4B. `attemptNumber` Check in `handleFiniteResponse`
- **Root Cause**:
  - Tests for `AUTH_UNAVAILABLE` (line 333) and `FRAME_TOO_LARGE` (line 354) instantiate a new coordinator `coord = new HostResourceStreamCoordinator(owner, mockQc)`.
  - On instantiation, `coord["attemptNumber"]` is `0`.
  - The tests invoke `coord["handleFiniteResponse"](1, 503, "AUTH_UNAVAILABLE", null)`.
  - Line 673 of `host-resource-stream-coordinator.ts` enforces:
    `if (this.disposed || capturedAttempt !== this.attemptNumber) return;`.
  - Because `1 !== 0`, the handler returns immediately without setting `authBlockedLatch`/`restOnlyLatch` or updating `coord.mode`, leaving mode as `"STOPPED"`.
- **Fix Steps**:
  - Set `coord["attemptNumber"] = 1;` before invoking `handleFiniteResponse` in both tests (lines 333 and 354):
```ts
coord["attemptNumber"] = 1;
coord["handleFiniteResponse"](1, 503, "AUTH_UNAVAILABLE", null);
```

#### 4C. `getTransport` Mock and Test Transport Injection
- **Root Cause**:
  - Tests "shares one coordinator..." (line 130) and "handles 10 s initial data deadline..." (line 306) register interest via `registerHostResourceInterest(owner, mockQc, "fleet")`.
  - This calls `startAttempt()`, which synchronously invokes `executeAttempt()` -> `transport = getTransport(this.owner)`.
  - `__setConnectionSnapshotForTests` populated `owner` and `status`, but left `entry.transport` `undefined`.
  - `getTransport` threw `ConnectionOwnerError("Transport unavailable")`, which was caught in `executeAttempt` and routed to `handleStreamFailure`, instantly transitioning mode from `"STARTING"` to `"RETRY_WAIT"`.
- **Fix Steps**:
  1. Extend `__setConnectionSnapshotForTests` in `packages/ui/src/api/connections.ts:906-924` with optional `transport?: Transport`:
```ts
export function __setConnectionSnapshotForTests(
  profileId: ProfileId,
  snapshot: Partial<ConnectionSnapshot> | null,
  transport?: Transport,
): void {
  if (snapshot === null) {
    entries.delete(profileId);
    notifyListeners();
    return;
  }
  const entry = getOrCreateEntry(profileId, snapshot.serverUrl ?? "");
  if (snapshot.owner?.generation !== undefined) {
    entry.generation = snapshot.owner.generation;
  }
  if (snapshot.status !== undefined) {
    entry.status = snapshot.status;
  }
  if (transport !== undefined) {
    entry.transport = transport;
  }
  entry.snapshot = freezeSnapshot(entry);
  notifyListeners();
}
```
  2. In `packages/ui/src/api/host-resource-stream-coordinator.test.ts`, create a mock `WsTransport` supporting streaming:
```ts
const mockTransport = Object.create(WsTransport.prototype) as WsTransport;
mockTransport.supportsHostResourceStreaming = () => true;
mockTransport.openHostResourceEvents = vi.fn().mockReturnValue(new Promise(() => {}));
```
  3. Pass `mockTransport` as the 3rd argument to `__setConnectionSnapshotForTests("p1", { owner, status: "connected" }, mockTransport)`.

---

### 5. `src/api/host-resource-sse-parser.test.ts`: Trailing `\r` Buffer Hold Logic

#### Root Cause
- In `host-resource-sse-parser.ts:84-98`, when a chunk ends with `\r`, the parser cannot know if the next incoming byte will be `\n` (`\r\n` boundary split across chunks) or another character (standalone CR). It holds the trailing `\r` in `this.buffer`.
- In `host-resource-sse-parser.test.ts:31-36`:
  - `chunk1`: `event: host-resources-status\r\ndata: 123\r` -> `data: 123\r` is held.
  - Test comment (line 35): `// Chunk 2 starts with \n followed by \r\r (blank line via \r)`.
  - Test code (line 36): `const chunk2 = encoder.encode("\n\r");`.
- In `chunk2`, `\n` pairs with `chunk1`'s trailing `\r` to complete line `data: 123\r\n`.
- The remaining single `\r` is at the very end of `this.buffer`. The parser's hold logic holds it waiting for the next chunk, so no blank line is completed, returning `[]` instead of dispatching the event.
- Providing `\n\r\r` (as the comment states) provides the blank line `\r` followed by another byte (`\r`), allowing the parser to recognize the first `\r` as a newline and dispatch the event.

#### Fix Steps
- In `packages/ui/src/api/host-resource-sse-parser.test.ts:36`, update the encoded chunk to match the test comment:
```ts
// Chunk 2 starts with \n followed by \r\r (blank line via \r)
const chunk2 = encoder.encode("\n\r\r");
```

---

### 6. `src/api/ws-transport.test.ts`: Non-200 Finite Response JSON Truncation When Body Exceeds 4096 Bytes

#### Root Cause
- In `packages/ui/src/api/ws-transport.ts:1993-2003`, when reading a non-200 finite response body, bytes are strictly bounded to 4096 bytes (`bytesRead < 4096`).
- In `ws-transport.test.ts:1713-1741`, `oversizePayload` has a 5000-character error field:
  `JSON.stringify({ code: "FRAME_TOO_LARGE", error: "X".repeat(5000) })`.
- Truncating at 4096 bytes leaves `rawText` as `{"code":"FRAME_TOO_LARGE","error":"XXXXX...` without a closing string quote or brace.
- At line 2028, `JSON.parse(rawText)` throws a `SyntaxError`. The catch block ignores the error, leaving `code = null`. The assertion `expect(result.code).toBe("FRAME_TOO_LARGE")` fails.

#### Fix Steps
- In `packages/ui/src/api/ws-transport.ts:2026-2039`, add regex extraction fallback for truncated JSON responses within the 4 KiB buffer:
```ts
let code: string | null = null;
if (rawText) {
  try {
    const parsed = JSON.parse(rawText);
    if (
      parsed &&
      typeof parsed === "object" &&
      typeof parsed.code === "string"
    ) {
      code = parsed.code;
    }
  } catch {
    const match = rawText.match(/"code"\s*:\s*"([^"\\]+)"/);
    if (match) {
      code = match[1];
    }
  }
}
```

---

## Unresolved Questions

- None. All 6 root causes and exact code remedies have been fully diagnosed and verified against the codebase.
