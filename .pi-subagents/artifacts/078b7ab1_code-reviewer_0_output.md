## Code Review Summary

**Score: 5/10 — not ready for attested Phase 05 acceptance.**

### Reviewed files
- `apps/native/src/native-ssh-forward-host.ts`
- `apps/native/src/native-ssh-forward-host.test.ts`
- `apps/native/src/main.tsx`
- `packages/ui/src/lib/ssh-forward-host.ts`
- `packages/ui/src/lib/ssh-forward-host.test.ts`
- `packages/ui/src/contexts/SshForwardHostContext.tsx`
- `packages/ui/src/hooks/use-ssh-forward.ts`
- `packages/ui/src/api/server-config.ts`
- `plans/260808-1310-ssh-port-forwarding-control/phase-05-host-context-native-adapter.md`
- Relevant Rust DTO/command contracts.

### Critical
- None.

### Warnings
- **High — stale activation is returned/published:** `apps/native/src/native-ssh-forward-host.ts:76`. A late A activation response is only prevented from updating adapter fields; it is still returned to the caller. `SshForwardScopeBridge` then writes `activeScopeId = result.scopeId` at `packages/ui/src/contexts/SshForwardHostContext.tsx:29-31`. A/B/C can therefore publish stale A after C. Must reject/ignore superseded responses before resolving to caller.
- **High — stale command snapshot can overwrite authoritative cache:** `apps/native/src/native-ssh-forward-host.ts:90,96`. Commands validate against captured context/token but do not confirm they still equal live adapter state after `await`. A late snapshot after activation/new client epoch can replace current `snapshotState`, violating exact-current acceptance.
- **High — timestamp parser is not equivalent to strict Rust validation:** `packages/ui/src/lib/ssh-forward-host.ts:19`. `Date.parse` accepts normalized impossible dates such as `2026-02-30T00:00:00.000Z`; Rust `PrimitiveDateTime::parse` rejects them. This undermines strict DTO parity. Same issue duplicated in adapter `validTimestamp` at `apps/native/src/native-ssh-forward-host.ts:62`.
- **Medium — required coverage absent:** no `SshForwardHostContext.test.tsx` or `use-ssh-forward.test.tsx`; `server-config.test.ts` has no Phase 05 diff. Required A/B/C stale-response, new-client-epoch response, deletion sequencing, unavailable storage, URL-edit, no-replay hook, wrong hint identity, and trailing refresh tests are not evidenced.
- **Medium — plan TODO remains entirely unchecked:** `plans/.../phase-05-host-context-native-adapter.md`. Attestation cannot claim all listed requirements complete.
- **Low — maintainability:** adapter is densely minified-style (~103 physical lines containing much more logical code), making security/order review and future edits error-prone; project standard favors readable focused modules.

### Positive observations
- Shared UI SSH modules contain no Tauri imports/invoke/listen/network calls.
- Factory is Windows-only; Android/iOS/macOS/Linux return `null` with zero Tauri calls.
- Exact 12-command mapping exists and test asserts it.
- Adapter listener installs before `openClient`.
- Counters remain strings, use `BigInt`, enforce canonical u64 range.
- Error parsing allowlists codes and discards unknown raw fields.
- No mutation replay on manager-session mismatch; only snapshot is retried.
- Disposal only unlistens; no Stop/deactivate/purge.
- Hint reconciliation is single-flight plus one trailing fetch in the adapter, not event patching.
- Deletion bridge awaits tracked activation before purge and blocks purge when profile read is unavailable.

### Validation commands/results
- **Passed:** `pnpm --filter @dam-hopper/native test -- native-ssh-forward-host.test.ts` — 2 files, 15 tests.
- **Passed:** `pnpm --filter @dam-hopper/native build` — TypeScript and Vite build succeeded.
- **Passed:** `pnpm --filter @dam-hopper/ui build` — TypeScript succeeded.
- **Failed:** `pnpm --filter @dam-hopper/ui test -- src/lib/ssh-forward-host.test.ts src/api/server-config.test.ts` — unrelated existing failure: `src/api/transport-utils.test.ts`, expected `WsTransport("http://monitor.example")`, received additional `undefined`.
- **Failed:** full UI test command with `--runInBand` — Vitest invocation unsupported/failed; no Phase 05-specific result produced.
- **Passed:** `git diff --check` — no whitespace errors.

### Recommended actions
1. Gate activation promise resolution on current operation/context/token/scope; stale A/B must not reach bridge state.
2. Gate all post-await command result acceptance against current live context/token/scope/generation and operation epoch.
3. Replace `Date.parse` timestamp validation with exact calendar round-trip validation matching Rust.
4. Add the required context/hook/server-config/adapter race and deletion tests.
5. Update Phase 05 TODO/status only after the above evidence passes.

### Unresolved questions
- Runtime Phase 04 loader issue intentionally deferred; not evaluated as a Phase 05 blocker.