# Phase 06: Automated and packaged Windows release gates

## Context Links

- [Plan](./plan.md)
- [Phase 05](./phase-05-explicit-connect-multi-port-ui.md)
- [Established-connection architecture](../../docs/system-architecture.md#planned-established-connection-forwarding-model)
- Baseline gates: `ssh_forward_e2e.rs`, `smoke-ssh-forward.mjs`, `ssh-forward-evidence.mjs`, `evidence.schema.json`, `native-ssh-forward-runtime-evidence.yml`, Windows jobs in `ci.yml`/`release.yml`.

## Overview

- Date: 2026-08-16
- Description: Prove migration, multiplexing, cleanup, contract security, UI flow, and commit-bound packaged Windows behavior before release.
- Priority: P2
- Implementation status: Pending
- Review status: Pending release-owner/security sign-off

## Key Insights

- Unit/browser tests cannot prove packaged WebView permission wiring, Windows listener ownership, or process-exit cleanup.
- Existing release gates already separate build/e2e from protected runtime evidence; extend them instead of creating another workflow family.
- Multi-connection acceptance must measure session/auth count, not only reachable ports.

## Requirements

- Rust unit/integration coverage: v1 migration/recovery; profile/rule graph validation; connection/rule generations; one session/many ports; many sessions; limits; trust/credential isolation; 30-day vault expiry/retention/rejection/Forget; reconnect; sibling failure; scope/purge/shutdown/force-close.
- TypeScript coverage: DTO validators/fixtures; exact command surface; explicit Connect flow; prompt count; grouping; conflict refresh; route/platform gating; secret absence.
- Windows native e2e uses real loopback sockets and instrumented russh fixtures, not mocks, to count handshakes/auth sessions/channels.
- Packaged evidence must bind package hash, commit SHA, Windows version/architecture, command/capability manifest, and test timestamps.
- Required packaged scenario: two target SSH servers; two established connections; at least two rules per connection; one auth prompt/attempt per connection; rapid off/on; one port conflict isolated; stale/unknown connection rejected; disconnect/scope switch/app restart retain saved credentials and reconnect without prompts; graceful exit removes all live listeners/sessions.
- Packaged vault scenario uses generated test-only credentials and an isolated opaque target prefix. Prove host-key change blocks before credential transmission while retaining the entry, explicit approval allows later reuse, and Forget/profile delete/scope purge remove entries. Seed one already-expired isolated test blob through the evidence harness to prove expiry without a production clock override or a 30-day wait. Always clean test targets.
- Test caps at boundaries: 16 admitted connections, 17th rejected; four handshakes max concurrently; 64 desired-enabled rules, 65th rejected; 64 channels per connection, 65th rejected without sibling loss.
- Scan snapshots/events/logs/TOML/fixtures/evidence/browser storage for passwords, passphrases, private-key content, Credential Manager targets/blobs, raw credential attempt IDs, and source chains. Vault secret content is never captured into evidence.
- Windows-only GO. Linux/macOS/mobile compile/handler/dependency absence remains a release gate, not runtime feature qualification.

## Architecture

`focused unit tests -> Rust/TS integration -> native ignored e2e on Windows -> package build -> protected commit-bound runtime evidence -> release job`.

- CI may build/test deterministic parts. Protected Windows environment owns packaged listener/process evidence.
- Runtime events remain hints; evidence queries authoritative snapshots after each action.
- A failed required assertion produces no valid evidence artifact and blocks release.

## Related Code Files

- `G:\ws\sharing\dam-hopper\apps\native\src-tauri\src\ssh_forward\manager.rs` — **modify**: race, caps, identity, cleanup, prompt/session/channel counter tests.
- `G:\ws\sharing\dam-hopper\apps\native\src-tauri\src\ssh_forward\connection_runtime.rs` — **modify**: parent/child lifecycle and isolation tests.
- `G:\ws\sharing\dam-hopper\apps\native\src-tauri\src\ssh_forward\credential_lease.rs` — **modify**: exact-binding, single-use, zeroization-boundary tests.
- `G:\ws\sharing\dam-hopper\apps\native\src-tauri\src\ssh_forward\credential_vault.rs` — **modify**: fixed clock, identity, expiry, rejection, replacement, sweep, and cleanup tests.
- `G:\ws\sharing\dam-hopper\apps\native\src-tauri\src\ssh_forward\credential_vault\windows.rs` — **modify**: isolated real Windows Credential Manager smoke with guaranteed target cleanup.
- `G:\ws\sharing\dam-hopper\apps\native\src-tauri\src\ssh_forward\store.rs` — **modify**: atomic fault, restart, rollback artifact, and purge tests.
- `G:\ws\sharing\dam-hopper\apps\native\src-tauri\src\ssh_forward\store_schema.rs` — **modify**: v1 migration and v2 graph validation tests.
- `G:\ws\sharing\dam-hopper\apps\native\src-tauri\tests\ssh_forward_e2e.rs` — **modify**: multi-server/multi-port real-socket scenarios.
- `G:\ws\sharing\dam-hopper\apps\native\src-tauri\tests\support\ssh_forward_fixture.rs` — **modify**: instrumented servers for host key/auth/session/channel/drop controls.
- `G:\ws\sharing\dam-hopper\apps\native\src\native-ssh-forward-host.test.ts` — **modify**: v2 commands/validators/hints/stale identity/secret absence.
- `G:\ws\sharing\dam-hopper\apps\native\src\smoke-ssh-forward.test.ts` — **modify**: package/capability/handler/static secret checks.
- `G:\ws\sharing\dam-hopper\packages\ui\src\hooks\use-ssh-forward.test.tsx` — **modify**: authoritative v2 actions, refresh conflicts, prompt-free toggles.
- `G:\ws\sharing\dam-hopper\packages\ui\src\components\pages\SshForwardingPage.test.tsx` — **modify**: multi-connection/multi-port status and action gating.
- `G:\ws\sharing\dam-hopper\packages\ui\browser-tests\ssh-forward-credential-dialog.browser.tsx` — **modify**: establishment prompt counts and secret clearing.
- `G:\ws\sharing\dam-hopper\packages\ui\browser-tests\ssh-forward-route-gating.browser.tsx` — **modify**: Windows desktop route and native-host behavior.
- `G:\ws\sharing\dam-hopper\packages\ui\browser-tests\ssh-forward-availability.browser.tsx` — **modify**: browser/mobile/non-Windows absence regression.
- `G:\ws\sharing\dam-hopper\apps\native\scripts\smoke-ssh-forward.mjs` — **modify**: v2 command/static/package checks.
- `G:\ws\sharing\dam-hopper\apps\native\scripts\ssh-forward-evidence.mjs` — **modify**: collect/validate multi-connection runtime evidence and cleanup.
- `G:\ws\sharing\dam-hopper\apps\native\test-fixtures\ssh-forward\evidence.schema.json` — **modify**: versioned v2 evidence schema and required observations.
- `G:\ws\sharing\dam-hopper\.github\workflows\ci.yml` — **modify**: Windows deterministic v2 tests; non-Windows exclusion audits.
- `G:\ws\sharing\dam-hopper\.github\workflows\native-ssh-forward-runtime-evidence.yml` — **modify**: protected v2 scenario and artifact validation.
- `G:\ws\sharing\dam-hopper\.github\workflows\release.yml` — **modify**: require v2 commit-bound evidence before Windows release.
- `G:\ws\sharing\dam-hopper\docs\configuration-guide.md` — **modify after implementation**: exact Connect/rule flow, 30-day Windows vault, trust gate, expiry/Forget, limits, rollback.
- `G:\ws\sharing\dam-hopper\docs\system-architecture.md` — **modify after implementation only if needed**: reconcile observed state/API/lifecycle with planned model.
- `G:\ws\sharing\dam-hopper\docs\CHANGELOG.md` — **modify after implementation**: delivered Windows behavior and qualification evidence.
- `G:\ws\sharing\dam-hopper\docs\project-roadmap.md` — **modify after implementation**: status and explicitly deferred non-Windows vault/platform work.
- No `G:\ws\sharing\dam-hopper\server\**` file — **no change**.

## Implementation Steps

1. Build a traceability matrix from every Success Criterion in Phases 01-05 to a named automated or packaged assertion; reject manual-only core behavior.
2. Extend fake SSH fixture with stable host keys, key/password auth counters, transport drop control, concurrent handshake counter, direct-tcpip target/channel counters, and two independent server instances.
3. Add Rust tests for all state transitions, exact identities, caps, races, migration faults, memory cleanup, fixed 30-day vault policy, and child isolation. Use real temporary filesystems/sockets and fake clock/vault by default.
4. Add shared/adapter/UI unit tests and Chromium flows. Assert rule toggles after establishment never call load-key/load-password or open a credential dialog.
5. Update canonical static smoke: command names equal handler/permission/build/adapter lists; old names absent; non-Windows/mobile dependency/handler trees clean; evidence schema version exact.
6. Extend native e2e to exercise two connections/four rules, restart reuse, changed trust, fixed expiry, rejection/replacement, Forget/delete/purge, and failure cases. Assert auth/session counts and listener reachability before/after each lifecycle boundary.
7. Package the exact commit on Windows. Run runtime evidence against the packaged executable, record package SHA-256/commit/environment, and validate JSON schema plus semantic assertions.
8. Validate graceful close, scope switch, explicit disconnect, and forced process termination cleanup; old listeners must be unreachable and memory leases gone within five seconds while unexpired vault entries remain. Separately prove explicit destructive paths delete vault entries.
9. Exercise migration rollback: upgrade copied v1 scope, verify v2, Forget v2 vault entries, stop app, restore retained v1 artifact, run prior package/read validation; never restore while process/lock is active. Document that an older binary cannot sweep orphaned v2 entries.
10. Run full gates: `pnpm lint`, focused UI/browser suites, native Rust tests, `pnpm check`, Windows e2e, build-only smoke, protected runtime evidence. Capture exact commands/results in release evidence.
11. Update docs only with observed implementation/evidence. Reconcile the planned architecture section if code intentionally differs; otherwise fix implementation drift.

## Todo List

- [ ] Create requirements-to-test traceability matrix.
- [ ] Instrument two-server SSH fixtures.
- [ ] Complete Rust migration/runtime/security tests.
- [ ] Complete fake-clock/fake-vault and isolated real Windows vault tests.
- [ ] Complete adapter/UI/browser prompt-count tests.
- [ ] Update command/package/static smoke.
- [ ] Produce valid commit-bound packaged Windows evidence.
- [ ] Prove stopped-app v1 rollback and listener cleanup.
- [ ] Run full repository gates and update observed docs.

## Success Criteria

- All focused suites and `pnpm check` pass; no skipped required Windows assertion.
- Evidence proves two simultaneous established servers and multiple independent ports per server with one auth per connection.
- Every unauthorized/stale/non-Established enable fails natively without a prompt or listener.
- Disconnect, scope switch, trust change, and shutdown close live listeners/channels/sessions and clear memory leases within five seconds while preserving unexpired saved credentials.
- Fixed 30-day expiry never silently extends; trust change blocks before secret use; Forget/profile delete/scope purge delete exact vault entries.
- Protected evidence matches the released package hash/commit and is required by release workflow.
- No Axum/server forwarding behavior or code changed.

## Risk Assessment

- **Critical — false release evidence:** protected environment, commit/package hash binding, schema plus semantic validation.
- **High — flaky socket timing:** readiness probes and bounded condition polling; no arbitrary sleeps.
- **High — rollback corrupts live state:** stopped-app exclusive lock, copied fixture first, checksum verification.
- **Medium — test matrix cost:** reuse one instrumented server fixture and parameterized cases; keep caps tests deterministic.

## Security Considerations

- Evidence/log capture must redact secrets and avoid raw key material/source errors.
- Real vault tests use random test-only targets, generated credentials, cleanup guards, and a final zero-entry assertion; never enumerate/read unrelated user credentials.
- Test credentials are generated fixtures only; never use developer SSH keys, agent identities, or real servers.
- Windows package retains only `main` SSH capability; evidence verifies no shell/general filesystem/HTTP/opener permission expansion.
- Treat packaged GO as Windows-specific; do not generalize to macOS/Linux/mobile.

## Next Steps

- Obtain architecture, security, UI accessibility, and release-owner sign-off.
- Ship behind the existing Windows native availability boundary; monitor redacted connection/rule error counts only if existing telemetry can do so without new sensitive fields.
- Defer non-Windows credential-vault and forwarding support to separate reviewed plans.

## Unresolved Questions

None.
