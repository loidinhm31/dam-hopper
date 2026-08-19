## Code Review Summary

**Score: 3/10 — not ready for Phase 05 acceptance.**

### Scope
- Reviewed: Phase 05 plan; changed TS/React/Tauri adapter/UI files; IPC Rust contracts/ACL.
- Focus: isolation, strict decimals, reconciliation, deletion ordering, no-call behavior, tests.
- No edits made. Plan TODO remains unchecked.

### Critical Issues
- None.

### High Priority Findings
1. **High — untrusted IPC errors accepted verbatim**  
   `apps/native/src/native-ssh-forward-host.ts:15` accepts any object with string `code`, retaining arbitrary `message`, fields, and invalid codes. This violates the fixed redacted error contract; malformed/unknown errors must become fixed `IPC_UNAVAILABLE`.  
   **Fix:** allowlist every error code and validate optional counter fields with `parseWireCounter`; construct a new fixed DTO, never cast raw input.

2. **High — command/snapshot responses are not identity-validated**  
   `apps/native/src/native-ssh-forward-host.ts:42-43,61-67` only partially checks activation response (`clientEpoch`), and accepts every command snapshot. It never validates exact desktop/manager/client/token/scope/scope-generation identity before caching/publishing. A delayed result after reload/scope switch can overwrite current state.  
   **Fix:** centralize strict result/snapshot validation; reject responses unless exact current context/token/scope match.

3. **High — hint reconciliation missing numeric freshness/coalescing**  
   `apps/native/src/native-ssh-forward-host.ts:70-74`, `packages/ui/src/hooks/use-ssh-forward.ts:15-18` forwards every identity-matching hint and starts an unlimited concurrent `snapshot()`. It does not compare hint revisions/generations numerically against the authoritative cached snapshot, nor enforce one in-flight plus one trailing refetch.  
   **Impact:** stale/duplicate/reordered valid hints create request herds and can surface stale snapshots.  
   **Fix:** strict-parse and compare `BigInt` revisions/generations; add single-flight/trailing refresh and exact snapshot acceptance.

4. **High — manager restart recovery absent**  
   `apps/native/src/native-ssh-forward-host.ts` maps `MANAGER_SESSION_MISMATCH` to an error but does not clear context, reopen once, then reactivate current scope. Required recovery/no-mutation-replay behavior is unimplemented.

### Warnings
1. **Medium — deletion purge sequence races activation**  
   `packages/ui/src/contexts/SshForwardHostContext.tsx:31-40`: `activeScopeId` is only updated after activation resolves. A delete while initial activation is pending can purge an actually-active scope, receive native rejection, and never retry. Concurrent active-change/delete activation intents are not serialized as “latest deactivate/new-scope then purge.”  
   **Fix:** maintain a bridge-local latest activation promise/intent generation; on deleted event always await the latest replacement/null activation before purge when deletion affected active intent.

2. **Medium — desktop platform capability mismatch**  
   `apps/native/src/native-ssh-forward-host.ts:13,77` creates a host for macOS/Linux, while Rust handler registration and capability are Windows-only (`apps/native/src-tauri/src/lib.rs:65+`, `capabilities/ssh-forward.json`). Those platforms perform Tauri calls to unavailable commands.  
   **Fix:** return `null` unless the platform is actually capability-supported, or add matching native support/ACL.

3. **Medium — wire/error contract parity incomplete**  
   `packages/ui/src/lib/ssh-forward-host.ts:32` omits Rust compatibility codes (`INVALID_COUNTER`, `INVALID_TIMESTAMP`, `INVALID_PROFILE`, `IDENTITY_CORRUPT`, `STALE_CLIENT`, `STORAGE_UNAVAILABLE`; see `error.rs:52-60`). The promised full fixture/error-table parity test is also absent.

4. **Medium — lint fails**  
   `packages/ui/src/hooks/use-ssh-forward.ts:16` synchronously calls `setSnapshot` inside an effect. `pnpm lint` fails.

5. **Medium — required tests absent**  
   Missing:
   - `packages/ui/src/contexts/SshForwardHostContext.test.tsx`
   - `packages/ui/src/hooks/use-ssh-forward.test.tsx`
   - Phase-specific `server-config` tests for typed commit events/read failure/deletion identity.  
   Existing tests do not prove A/B/C late responses, new client epoch, manager recovery, malformed errors, hint ordering/coalescing, delete ordering, URL-edit no-op, or no HTTP/WS calls.

### Low Priority Suggestions
- `apps/native/src/native-ssh-forward-host.ts:44`: redundant `try/catch` rethrows unchanged errors.
- Format one-line dense adapter declarations for maintainability; current files are within size limits.
- `server-config.ts` is 615 LOC, exceeding project’s 200-LOC guideline; not introduced solely by Phase 05 but worth separating later.

### Positive Observations
- Shared UI forwarding modules contain no Tauri imports/invoke/listen/fetch/WebSocket usage.
- Context default is nullable browser-safe host.
- Adapter map contains exactly 12 intended command names; Rust ACL/handler map aligns.
- Canonical decimal parser uses `BigInt`, rejects noncanonical/overflow values; `9→10`, `99→100`, and max overflow tests exist.
- Android/iOS/unknown factory test verifies zero Tauri calls.
- Dispose only unlistens; no implicit stop/deactivate.
- Native test suite passes.

### Validation Evidence
- Passed: `pnpm --filter @dam-hopper/native test` — 12 tests.
- Passed: `pnpm --filter @dam-hopper/native build`.
- Passed: `pnpm --filter @dam-hopper/ui build`.
- Failed: requested UI test command ran full UI suite; 973 passed, 1 unrelated existing failure in `src/api/transport-utils.test.ts:47` (`WsTransport` receives an extra `undefined`).
- Failed: `pnpm lint` — one Phase 05 error at `use-ssh-forward.ts:16`.
- Passed: `git diff --check`.
- No staged files.

### Next Minimal Fixes
1. Implement strict redacted error and exact response/snapshot validators.
2. Add numeric hint freshness + single-flight/trailing reconciliation.
3. Add reopen/reactivate manager-session recovery without mutation replay.
4. Serialize active-delete replacement activation before purge.
5. Make native factory match Windows-only capability or extend capability.
6. Add required Phase 05 tests; fix lint issue; rerun focused UI tests correctly.

### Unresolved Questions
- Is macOS/Linux intended to be supported now despite Windows-only native command registration/capability?