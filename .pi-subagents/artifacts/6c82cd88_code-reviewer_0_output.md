## Code Review Summary

### Scope
- Files reviewed: Phase 05 host/bridge/hook, tests, Rust command/manager gates.
- Focus: stale gates, timestamps, purge ordering, adapter hint owner.
- No edits.

### Terminal score
**7/10 — not attested.** Build/type/Rust static gates pass; UI suite fails; one adapter ownership flaw.

### Critical Issues
- None.

### Warnings
- **High** — `packages/ui/src/hooks/use-ssh-forward.ts:30`: hook ignores `event.snapshot` returned by `NativeSshForwardHost`, then calls `host.snapshot()` again. The adapter already owns accepted-hint refetch/coalescing in `apps/native/src/native-ssh-forward-host.ts:handleHint`. Each accepted hint therefore produces two IPC snapshots, defeating intended bounded/coalesced hint behavior. Consume `event.snapshot` when present; only call `refresh()` for hosts that omit it.
- **Medium** — `packages/ui/src/hooks/use-ssh-forward.test.tsx:10-23`, `packages/ui/src/contexts/SshForwardHostContext.test.tsx:13`: newly added tests use `any` and a missing React-effect dependency, yielding 5 lint warnings. Replace casts with typed fixtures and make the test effect dependency-safe.
- **Medium** — Full UI test gate fails unrelated existing test: `packages/ui/src/api/transport-utils.test.ts:47`. `WsTransport` now receives a second `undefined` argument while test asserts one argument. This prevents suite-level attestation.

### Validation Notes
- Stale activation/command gates: manager admission, intent rechecks, and command context/scope checks are present; no static bypass found.
- Strict timestamps: TS parser validates real calendar days/leap years; Rust uses strict shape plus `PrimitiveDateTime::parse`; invalid February date covered.
- Bridge purge ordering: active deletion awaits prior activation, deactivates first, then purges; unavailable profile inventory suppresses purge. Static logic correct.
- Adapter hint owner: exact context/token/scope and numeric freshness checks are good; duplicate refresh above remains.
- Added native tests: **17/17 pass**.
- Rust `fmt`, `check`, and clippy all pass.
- No staged files; no TODO markers in reviewed feature files.

### Next Action
1. Fix duplicate hook snapshot behavior and its test.
2. Fix/align failing transport-utils expectation.
3. Re-run UI full suite; retain Phase 04 runtime blocker as deferred.

### Unresolved Questions
- Does the product intend `useSshForward` to support non-native hosts that emit hints without snapshots? If yes, use `event.snapshot ?? await refresh()`.