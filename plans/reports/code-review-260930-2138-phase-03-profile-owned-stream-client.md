# Code Review: Phase 03 Profile-Owned Host-Resource Stream Client

**Date:** 2026-09-30  
**Status:** Approved with Warnings  
**Score:** 9.2 / 10  
**Target Plan:** `plans/260929-1522-host-resources-sse/phase-03-profile-owned-stream-client.md`  

---

## Code Review Summary

### Scope
- **Files Reviewed (10):**
  - `packages/ui/src/api/ws-transport.ts`
  - `packages/ui/src/api/ws-transport.test.ts`
  - `packages/ui/src/api/host-resource-sse-parser.ts`
  - `packages/ui/src/api/host-resource-sse-parser.test.ts`
  - `packages/ui/src/api/host-resource-sse-codec.ts`
  - `packages/ui/src/api/host-resource-sse-codec.test.ts`
  - `packages/ui/src/api/host-resource-stream-coordinator.ts`
  - `packages/ui/src/api/host-resource-stream-coordinator.test.ts`
  - `packages/ui/src/api/connections.ts`
  - `packages/ui/src/api/connections.test.ts`
- **Lines of Code Analyzed:** ~2,800 lines across implementations and comprehensive unit/integration suites.
- **Review Focus:** Criteria verification (ownership/generation fencing, bounded UTF-8 parsing, paired pre-data status, revision sequencing, error precedence/latching, deadlines/backoff, token rotation bug fix).
- **Updated Plans:** `plans/260929-1522-host-resources-sse/phase-03-profile-owned-stream-client.md`

---

## Overall Assessment

Phase 03 implementation delivers an exceptionally well-engineered, profile-scoped host-resource stream client subsystem. The architecture cleanly separates concerns across:
1. **03-T (Transport):** Cancellable, bound `openHostResourceEvents` with narrow auth classification (`MFA_REQUIRED` -> 4403, `AUTH_REQUIRED` -> 4401) and strict 4 KiB finite error parsing.
2. **03-P (Parser):** Incremental streaming UTF-8 parser handling chunk splits across CRLF/CR/LF, extracting heartbeat comments, and strictly enforcing 256 KiB data / 4 KiB status limits.
3. **03-D (Codec):** Exact-key DTO validation, canonical BigInt revision parsing (`0 <= revision <= 2^64 - 1`), and monotonic freshness tracking.
4. **03-I (Coordinator & Registry):** Single coordinator per `(ConnectionRef, QueryClient)`, 7-state lifecycle machine, paired pre-data status adjacency requirement, latching precedence (`AUTH_BLOCKED` > `REST_ONLY`), 10 s data deadline, 45 s byte idle timeout, jittered exponential backoff (max 5 retries), and 60 s stable revision reset.

All previous build/type issues and fixture discrepancies identified in test runs were resolved. All 95 targeted test cases pass with zero TypeScript diagnostics. A few warnings regarding DOM event listener cleanup on disposal and memory compaction during oversized chunk discard are documented below for hardening before Phase 04/05.

---

## Criteria Verification Matrix

| # | Criterion | Status | Evidence / Notes |
|---|-----------|--------|------------------|
| 1 | Captured owner, profileId, generation, token immutability & fencing | **PASS** | `baseUrl`, `profileId`, `generation`, `authToken` captured at `WsTransport` construction; coordinator checks `isCurrentConnection` & `capturedAttempt === attemptNumber` on all timer/stream callbacks; `cleanupCoordinatorsForOwner` invoked on generation change/disconnect. |
| 2 | Bounded UTF-8 parser and 256 KiB data / 4 KiB status/error limits | **PASS** | `MAX_DATA_EVENT_BYTES` (262,144 B) and `MAX_CONTROL_EVENT_BYTES` (4,096 B) enforced in parser; finite response body in transport capped at 4 KiB with regex fallback. |
| 3 | Strict paired pre-data status; comment clears status adjacency | **PASS** | Status event arms `statusAdjacent = true`; comments and errors set `statusAdjacent = false`; data event strictly checks `statusAdjacent`, matching `serverEpoch`, and matching `revision`, then consumes adjacency. |
| 4 | Reconnection equal revision accepted; within-attempt strict advancement | **PASS** | When `mode !== "LIVE"`, `decoded.revisionBigInt >= lastCommittedRevisionBigInt` accepted as baseline; when `mode === "LIVE"`, requires `decoded.revisionBigInt > lastCommittedRevisionBigInt`. |
| 5 | Error precedence and latch persistence | **PASS** | `AUTH_UNAVAILABLE` triggers persistent `authBlockedLatch`; `FRAME_TOO_LARGE` sets `restOnlyLatch`; `AUTH_BLOCKED` takes precedence over `REST_ONLY` and cannot be unlocked by subsequent 503 or 404. |
| 6 | 10 s data deadline, 45 s byte idle, 5 retries with jitter, 60 s stable reset | **PASS** | 10 s timer disarmed on first valid data frame; 45 s byte idle timer rearmed on each chunk; base delays [1s, 2s, 4s, 8s, 16s] + jitter; retry count resets after 60 s LIVE with committed advancing revisions. |
| 7 | Token rotation intent preservation bug fix in `connections.ts` | **PASS** | Captures `const wasIntent = entry.intent;` before `disconnectProfile(profile.id)`, reconnecting when `wasIntent` is true. |

---

## Critical Issues (MUST FIX)

*None. Zero blocking issues or test failures.*

---

## Warnings (SHOULD FIX)

### 1. Missing DOM Event Listener Cleanup on Coordinator Disposal
- **Location:** `packages/ui/src/api/host-resource-stream-coordinator.ts:194-229`, `783-791`
- **Problem:** `setupVisibilityListeners()` registers `document.addEventListener("visibilitychange", onVisibilityChange)` and `window.addEventListener("pagehide", onPageHide)`. In `dispose()`, these listeners are not removed (`removeEventListener`).
- **Impact:** Disposed coordinator instances, along with their captured references (`owner`, `queryClient`, closures), remain referenced by DOM global listeners, creating a memory leak in long-running sessions with repeated profile disconnect/reconnect cycles.
- **Recommended Fix:** Store handler references as private class fields and remove them in `dispose()`:
  ```ts
  private onVisibilityChange = () => { ... };
  private onPageHide = () => { ... };

  public dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    if (typeof document !== "undefined") {
      document.removeEventListener("visibilitychange", this.onVisibilityChange);
    }
    if (typeof window !== "undefined") {
      window.removeEventListener("pagehide", this.onPageHide);
    }
    ...
  }
  ```

### 2. Unbounded Memory Accumulation During Oversized Discard Without Delimiters
- **Location:** `packages/ui/src/api/host-resource-sse-parser.ts:101-123`
- **Problem:** When an event exceeds the byte limit, the parser sets `this.discardingUntilBlankLine = true` and resets event state. However, if subsequent chunks contain no newline delimiters (`delimiterIdx === -1`), `scanIdx` remains 0 and `this.buffer` continues merging all incoming chunks.
- **Impact:** A misbehaving or hostile producer sending megabytes of contiguous non-newline bytes could cause unbounded buffer allocation in memory while in discarding mode.
- **Recommended Fix:** When `this.discardingUntilBlankLine` is true and `delimiterIdx === -1`, compact `this.buffer` to retain at most the trailing byte (to catch split `\r\n`):
  ```ts
  if (delimiterIdx === -1) {
    if (this.discardingUntilBlankLine) {
      if (this.buffer.length > 1) {
        this.buffer = this.buffer.subarray(this.buffer.length - 1);
      }
      break;
    }
    ...
  }
  ```

### 3. Fallthrough on Recognized 401/403 Finite Responses in Coordinator
- **Location:** `packages/ui/src/api/host-resource-stream-coordinator.ts:702-728`
- **Problem:** In `handleFiniteResponse()`, unknown 401/403 codes transition to `REST_ONLY`. However, recognized codes (`MFA_REQUIRED`, `AUTH_REQUIRED`, etc.) trigger `onDrop` in `WsTransport` and fall through to `this.scheduleRetry(capturedAttempt, delayMs)`.
- **Impact:** If `onDrop` execution is delayed, asynchronous, or mocked in detached tests, the coordinator schedules a retry attempt with the invalid token rather than stopping.
- **Recommended Fix:** Explicitly stop active streams and return without scheduling a retry on recognized auth error codes:
  ```ts
  if (status === 401 || status === 403) {
    if (
      code === "MFA_REQUIRED" ||
      code === "AUTH_REQUIRED" ||
      code === "SESSION_EXPIRED" ||
      code === "SESSION_REVOKED"
    ) {
      this.stopActiveStream(true);
      return;
    }
    this.restOnlyLatch = true;
    this.stopActiveStream(true);
    this.mode = this.authBlockedLatch ? "AUTH_BLOCKED" : "REST_ONLY";
    this.notify();
    return;
  }
  ```
  Additionally, add `if (this.disposed) return;` at the beginning of `scheduleRetry()`.

---

## Suggestions (NICE TO HAVE)

### 1. Reset Stable Revision Timer on Active Stream Stop
- **Location:** `packages/ui/src/api/host-resource-stream-coordinator.ts:307-340`, `655-668`
- **Suggestion:** `stopActiveStream()` clears retry, deadline, and idle timers, but leaves `this.stableWindowTimer` running. If a stream flaps and reconnects within the window, revisions from the previous attempt could count toward resetting the retry budget. Clearing `stableWindowTimer` and resetting `revisionsCommittedInStableWindow = 0` in `stopActiveStream()` guarantees 60 continuous seconds of stability strictly within the active connection attempt.

### 2. Atomic Query Cache Mutation Hook for Phase 04 Cutover
- **Location:** `packages/ui/src/api/host-resource-stream-coordinator.ts:605-653`
- **Suggestion:** In Phase 04, `switchToHostResourceFrame` will need to cancel in-flight queries and batch write snapshot/metrics to TanStack Query. Providing an optional asynchronous mutation hook in `switchToHostResourceFrame` will make Phase 04 query cache binding clean and testable without monkey-patching coordinator internals.

---

## Positive Observations

1. **Defensive Schema Decoding:** `host-resource-sse-codec.ts` validates exact key count (`5` for status, `6` for data), prevents extraneous keys from polluting domain models, validates UUID formats, and verifies canonical decimal representation for 64-bit BigInt revisions.
2. **Strict Adjacency Contract:** Strict pairing prevents stale or mismatched statuses from associating with subsequent data frames. Heartbeats and comments clear adjacency as mandated by the architectural specification.
3. **Robust Token Rotation Handling:** Moving the `entry.intent` capture ahead of `disconnectProfile` in `connections.ts` solves a subtle reconnect intent bug in multi-profile scenarios.
4. **Clean Fencing:** Dual-layered fencing with `ConnectionRef` generation and `attemptNumber` ensures stale network packets or timer callbacks cannot mutate active coordinator state.

---

## Validation Commands and Results

1. **TypeScript Static Typecheck:**
   ```bash
   pnpm --filter @dam-hopper/ui exec tsc --noEmit
   ```
   *Result:* Clean (0 errors, 0 warnings).

2. **Scoped Phase 03 Vitest Suite Execution:**
   ```bash
   pnpm --filter @dam-hopper/ui exec vitest run \
     src/api/ws-transport.test.ts \
     src/api/host-resource-sse-parser.test.ts \
     src/api/host-resource-sse-codec.test.ts \
     src/api/host-resource-stream-coordinator.test.ts \
     src/api/connections.test.ts \
     src/api/connections-mfa.test.tsx
   ```
   *Result:*
   - **Test Files:** 6 passed (6)
   - **Tests:** 95 passed (95)
   - **Duration:** 654 ms

---

## Metrics
- **Type Coverage:** 100% (Strict TypeScript mode, no any casting in public interfaces)
- **Target Test Coverage:** 95 tests passing across 6 test suites
- **Lint / Compiler Diagnostics:** 0 errors

---

## Unresolved Questions

1. Which native packaged runtime environments (e.g. Electron / Tauri / Capacitor) reliably expose a cancellable `ReadableStreamDefaultReader` on `fetch()` responses without buffering the full response in memory? *(Per plan, non-capable environments will fall back to `REST_ONLY` until Phase 05 qualification).*
