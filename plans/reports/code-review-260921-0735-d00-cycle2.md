# Phase D00 Cycle 2 Code Review: Contracts, Identity, and Feasibility

### Overall Assessment
Cycle 1 fixes verified successfully. All critical blockers resolved: fixture dist tracked, JSON-RPC notifications and mutual exclusivity handled in runtime parsers, semver pattern applied in manifest schema, 8 bridge envelopes with version/generation fencing established, cancellation tracker handles settled requests with idempotence, and core Runner Protocol DTOs mirrored in Rust. Tests in TypeScript, Rust, and Chromium browser test suite pass 100%.

---

## 1. Score: 9.2/10

- **Security**: 9.5/10 (Strict CSP hash authorization, opaque origin, nonce/port ack, header length validation prior to body allocation, memory buffer caps).
- **Performance**: 9.5/10 (Non-blocking framing, buffer drainage, zero unnecessary allocations).
- **Architecture**: 9.0/10 (Clean contract separation, shared fixture validation between Rust & TS).
- **Correctness & Parity**: 8.8/10 (Runtime validators strict; minor schema precision drift in `runner-protocol-v1` and `ui-bridge-v1`).

---

## 2. Critical Issues (MUST FIX)
**None.** No security vulnerabilities, regressions, data loss risks, or test failures detected.

---

## 3. Warnings (SHOULD FIX)

1. **`runner-protocol-v1.schema.json` Missing Mutual Exclusivity for Response `result` / `error`**
   - **Problem**: `JsonRpcResponse` definition requires `["jsonrpc", "id"]` but lacks `oneOf` enforcing exactly one of `result` or `error`. A payload containing both or neither validates against the schema despite being rejected by TS/Rust parsers and violating JSON-RPC 2.0 §5.
   - **Fix**: In `runner-protocol-v1.schema.json`, add discriminator inside `JsonRpcResponse`:
     ```json
     "oneOf": [
       { "required": ["result"], "not": { "required": ["error"] } },
       { "required": ["error"], "not": { "required": ["result"] } }
     ]
     ```

2. **`ui-bridge-v1.schema.json` Lacks Envelope-Specific Discriminated Validation**
   - **Problem**: Schema is flat; all envelope properties are optional at top-level. `request` without `operation`, `response` with both `result`/`error`, or `host.bootstrap` without `nonce` passes JSON schema validation, though TS `validateBridgeMessage` catches it.
   - **Fix**: Refactor `ui-bridge-v1.schema.json` using `oneOf` discriminated on `type` with `additionalProperties: false` per envelope variant.

3. **Rust Contract Parity: Admin Management DTOs Missing in `contract.rs`**
   - **Problem**: `server/src/plugins/contract.rs` exports `ADMIN_RUNNER_METHODS` slice and `GrantKey`, but misses structs for `ManagementStageBeginParams`, `ManagementStageChunkParams`, `ManagementGrantsReplaceParams`, `ManagementBindingsReplaceParams`, etc., which exist in `runner-protocol.ts`.
   - **Fix**: Mirror admin management DTO structs in `contract.rs` before Phase D01/D02 implementation.

---

## 4. Suggestions (NICE TO HAVE)

1. **Context-Aware Settled Fencing in `WorkerCancellationTracker`**
   - In `worker-sdk.ts`, `settledOperations` stores only `Set<string>` (request IDs). Storing `Map<string, string>` (`requestId -> contextId`) ensures cancellation on settled operations verifies matching `contextId` rather than returning `alreadySettled` on cross-context collisions.
2. **Dedicated Negative Fixture for Dual `result`/`error` Response**
   - `test_jsonrpc_both_result_and_error_rejected` uses inline JSON strings. Adding `packages/plugin-sdk/fixtures/negative/jsonrpc-both-result-error.json` ensures cross-repository consistency with evcrate E00.
3. **Dedicated Positive Fixtures for Worker Notifications**
   - Add `packages/plugin-sdk/fixtures/positive/worker-health-notification.json` and `worker-shutdown-notification.json` to lock notification payload formats.

---

## 5. Reviewed Files List

1. `.gitignore`
2. `server/src/lib.rs`
3. `server/src/plugins/mod.rs`
4. `server/src/plugins/contract.rs`
5. `server/src/plugins/error.rs`
6. `server/src/plugins/framing.rs`
7. `server/src/plugins/manifest.rs`
8. `server/tests/plugin_contract_fixtures.rs`
9. `packages/plugin-sdk/package.json`
10. `packages/plugin-sdk/tsconfig.json`
11. `packages/plugin-sdk/src/index.ts`
12. `packages/plugin-sdk/src/manifest.ts`
13. `packages/plugin-sdk/src/runner-protocol.ts`
14. `packages/plugin-sdk/src/worker-sdk.ts`
15. `packages/plugin-sdk/src/ui-bridge.ts`
16. `packages/plugin-sdk/src/framing.ts`
17. `packages/plugin-sdk/src/errors.ts`
18. `packages/plugin-sdk/src/contracts.test.ts`
19. `packages/plugin-sdk/src/cancellation-feasibility.test.ts`
20. `packages/plugin-sdk/schemas/manifest-v1.schema.json`
21. `packages/plugin-sdk/schemas/runner-protocol-v1.schema.json`
22. `packages/plugin-sdk/schemas/worker-sdk-v1.schema.json`
23. `packages/plugin-sdk/schemas/ui-bridge-v1.schema.json`
24. `packages/plugin-sdk/scripts/build-opaque-fixture.mjs`
25. `packages/plugin-sdk/fixtures/opaque-ui/src/App.tsx`
26. `packages/plugin-sdk/fixtures/opaque-ui/src/main.tsx`
27. `packages/plugin-sdk/fixtures/opaque-ui/dist/metadata.json`
28. `packages/plugin-sdk/fixtures/positive/manifest-valid.json`
29. `packages/plugin-sdk/fixtures/positive/jsonrpc-request-valid.json`
30. `packages/plugin-sdk/fixtures/positive/jsonrpc-response-valid.json`
31. `packages/plugin-sdk/fixtures/positive/ui-bridge-request-valid.json`
32. `packages/plugin-sdk/fixtures/negative/manifest-bad-version.json`
33. `packages/plugin-sdk/fixtures/negative/manifest-invalid-id.json`
34. `packages/plugin-sdk/fixtures/negative/manifest-unknown-field.json`
35. `packages/plugin-sdk/fixtures/negative/jsonrpc-numeric-id.json`
36. `packages/plugin-sdk/fixtures/negative/jsonrpc-batch-rejected.json`
37. `packages/ui/browser-tests/plugin-isolation.browser.tsx`
38. `plans/260920-1603-plugin-platform/phase-00-contracts-and-feasibility.md`

---

## 6. Validation Commands and Results

| Command | Target | Result |
|---|---|---|
| `pnpm --filter @dam-hopper/plugin-sdk test` | Vitest Unit Tests (Framing, Manifest, Bridge, Cancellation) | **PASS** (3 files, 40 tests passed, 0 failed) |
| `cargo test --manifest-path server/Cargo.toml --test plugin_contract_fixtures` | Rust Fixture & Framing Contract Tests | **PASS** (14 tests passed, 0 failed) |
| `node packages/plugin-sdk/scripts/build-opaque-fixture.mjs --verify` | Vite IIFE bundle & byte-identical deterministic build | **PASS** (Byte-identical output verified twice, SHA: `6dfb5e43...`) |
| `pnpm --filter @dam-hopper/ui test:browser -- plugin-isolation.browser.tsx` | Real Chromium Opaque `srcdoc`, Host CSP, PortAck | **PASS** (41 test files passed, 215 tests passed) |
| `pnpm --filter @dam-hopper/plugin-sdk build` | TypeScript `tsc -p tsconfig.json` compile | **PASS** (Clean build, zero diagnostic errors) |
| `cargo check --manifest-path server/Cargo.toml` | Rust crate compilation & typecheck | **PASS** (Clean build, zero diagnostic errors) |

---

## 7. Unresolved Questions

1. **Node >=22.19 Packaging/Distribution Mechanism**: Immutable Node runtime bundling mechanism on the target Linux profile remains pending decision before G0 pinning.
2. **Concrete Deployment Targets and Production Path Grants**: Hardware staffing and production account subject IDs are not supplied; synthetic IDs currently used in contract fixtures.
