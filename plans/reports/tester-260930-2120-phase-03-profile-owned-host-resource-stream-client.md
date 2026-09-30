# Phase 03 Profile-Owned Host-Resource Stream Client — Test Report

## Test Results Overview

- **Requested command:** `pnpm --filter @dam-hopper/ui test -- src/api/ws-transport.test.ts src/api/host-resource-sse-parser.test.ts src/api/host-resource-sse-codec.test.ts src/api/host-resource-stream-coordinator.test.ts src/api/connections.test.ts src/api/connections-mfa.test.tsx`
  - Exit 1. Its generated invocation was `vitest run -- <paths>` and Vitest ran the full package suite rather than filtering to the six paths: **2,056 tests total; 2,037 passed, 19 failed**, across 284 files (278 passed, 6 failed). Duration: 13.68s.
- **Explicitly scoped rerun:** `pnpm --filter @dam-hopper/ui exec vitest run src/api/ws-transport.test.ts src/api/host-resource-sse-parser.test.ts src/api/host-resource-sse-codec.test.ts src/api/host-resource-stream-coordinator.test.ts src/api/connections.test.ts src/api/connections-mfa.test.tsx`
  - Exit 1. **95 tests total; 77 passed, 18 failed** across six files (1 passed, 5 failed). Duration: 665ms.
  - Only `host-resource-sse-codec.test.ts` passed; required 100% pass rate was not met.
- **Coverage:** Not generated; coverage was not requested by the assigned commands.

## Failed Tests

- `connections.test.ts`: 7 failures. `performConnectProfile` throws `ReferenceError: registryQueryClient is not defined` at `src/api/connections.ts:571`.
- `connections-mfa.test.tsx`: 2 failures with the same `registryQueryClient` reference error; `stepUpProfileMfa...` also expected `true` but received `false`.
- `host-resource-stream-coordinator.test.ts`: 6 failures:
  - Two expected `STARTING`, received `RETRY_WAIT`.
  - Two throw `TypeError: Do not know how to serialize a BigInt` while JSON-stringifying `MOCK_STATUS`.
  - `AUTH_UNAVAILABLE` expected `AUTH_BLOCKED`, received `STOPPED`.
  - `FRAME_TOO_LARGE` expected `REST_ONLY`, received `STOPPED`.
- `host-resource-sse-parser.test.ts`: 1 failure. CRLF/CR line-ending split test expected a `host-resources-status` event with data `123`, received an empty array.
- `ws-transport.test.ts`: 1 failure. Non-200 response test expected parsed code `FRAME_TOO_LARGE`, received `null`.

The unscoped run additionally failed `phase-02-unified-shell.test.tsx` (the same `registryQueryClient` reference error). It also logged jsdom's `Not implemented: navigation (except hash changes)` errors.

## Performance Metrics

- Explicit target test command: 665ms.
- Exact requested command (which ran all package tests): 13.68s.
- Build command: 7.10s.

## Build Status

- **Command:** `pnpm --filter @dam-hopper/ui build`
- **Result:** Failed (exit 2); UI build did not meet the zero-error criterion.
- TypeScript diagnostics:
  - `src/api/connections.ts:2,63`: duplicate identifier `QueryClient`.
  - `src/api/connections.ts:571`: cannot find name `registryQueryClient`.
  - `src/api/host-resource-stream-coordinator.ts:369`: `clearTimeout` argument type `Timeout | null` is incompatible with the available overloads.

## Critical Issues

- The named connection flows fail because `registryQueryClient` is unresolved; this also prevents the package TypeScript build.
- The package build has additional duplicate-import/type errors, and stream/parser/transport tests expose further behavior or fixture failures.

## Recommendations / Next Steps

1. Resolve the duplicate `QueryClient` identifier and the undeclared `registryQueryClient` reference; rerun the two connection test files and UI build.
2. Correct the timer nullability/type at `host-resource-stream-coordinator.ts:369`.
3. Investigate the remaining parser, coordinator, and transport failures, including BigInt serialization in coordinator fixtures.
4. Rerun the explicit six-file command and `pnpm --filter @dam-hopper/ui build`; require all 95 target tests to pass and a zero-error build.

## Unresolved Questions

- None for this validation assignment.
