## Code Review Summary

**Score: 6/10. Disposition: changes required; Phase 01 blocked. Do not open dependent phases.**

### Scope
- Implementation review, Cycle 2; security, resource bounds, architecture, KISS/YAGNI/DRY, acceptance/evidence.
- Reviewed: `server/src/browser_host/{cdp,process,protocol,mod}.rs`; `server/tests/browser_host_{adapter,process,compatibility}.rs`; `server/examples/browser_host_qualification.rs`; `packages/ui/e2e/{fixtures/browser-host-qualification.ts,os-host-browser/compatibility.spec.ts}`.
- Contracts/evidence: selected-plan `plan.md`, `phase-01-compatibility-contracts.md`, `architecture-contracts.md`, `reports/engine-qualification.md`; Cycle 1 and historical tester reports.
- Supporting inspection: `server/{Cargo.toml,Cargo.lock,src/lib.rs}`, main-module registration search, README, PDR, code standards, published agent/development guidance and code-review skill/reference.
- Approximately 2,800 implementation/test lines plus contracts/dependency diff. Not a whole-repository audit.
- Source, plans and task state unchanged; only this report created. Integration owner retains plan updates and verification.

### Critical issues
- None established as a deployed exploitable vulnerability. High-priority qualification blockers below remain.

### Warnings

1. **High — command-memory admission still occurs after allocation/enqueue.** `server/src/browser_host/cdp.rs:194-224,317-360`; architecture `:16`.
   Every caller serializes before awaiting channel capacity. Arbitrarily many concurrent send futures retain JSON outside queue accounting; channel32 plus pending64 also exceeds max64 total. `queued_payload_bytes` measures already-written commands until response, not queued payloads, so `peak_queued_bytes` cannot establish writer-memory bounds. Oversize rejection also happens after full serialization.
   **Correction:** nonwaiting total-slot reservation before retained serialization; bounded serialization and byte reservation shared across queued/inflight work; RAII release on every exit. Test saturation with stalled writer and callers outside channel. Confidence high; static finding, not runtime reproduction.

2. **High — parent-death containment remains leader-only.** `server/src/browser_host/process.rs:204-210,383-408`; tests `server/tests/browser_host_process.rs:61-150`.
   Ignored `PR_SET_PDEATHSIG(SIGTERM)` result, no parent-death race check, signal targets leader only. Forked descendants do not inherit this setting; Rust Drop cannot group-kill after supervisor SIGKILL. Existing failure test covers launch failure, not post-launch supervisor death/root-crash descendants or unrelated PTY survival. Startup-error guard signals without explicit descendant proof/reap.
   **Correction:** checked race-safe supervision capable of group/descendant teardown independently of ordinary Drop; retain identity until proven exit. Add supervisor-kill, root-crash, stubborn-descendant and PTY-isolation cases. Confidence high.

3. **High — claimed helper output/descendant fix is incomplete.** `packages/ui/e2e/fixtures/browser-host-qualification.ts:28-73,92-121,135-164`; architecture `:20`.
   Cargo cap is applied only after readline allocates a complete line, counts UTF-16 characters rather than bytes, excludes stderr and uses 10MiB. Binary stderr remains inherited; stdout accounting stops after readiness. Required lifetime stdout/stderr64KiB bounds absent. Cargo timeout kills root only; partial binary startup kills root only. Cleanup kills browser leader by positive PID, not its process group, resolves immediately after kill without exit proof/reap, and its3s KILL timer races launcher's3s TERM grace. Bare PID reuse also risks signaling unrelated processes after leader exit.
   **Correction:** bounded byte-stream parsing and continued accounting/draining; owned group/Job lifecycle for build and fixture, stdin close then bounded reap/proof on every exit. Do not resolve cleanup merely after sending kill. Add overflow, malformed readiness, timeout and descendant-survival tests. Confidence high.

4. **High — auth fixture is not the frozen bounded/session-safe qualification harness.** `server/examples/browser_host_qualification.rs:112-195,210-219`; `packages/ui/e2e/os-host-browser/compatibility.spec.ts:84-118`; architecture `:20`.
   Proxy uses default WebSocket limits, no bounded write deadlines, ignores send/read errors, and checks bearer only: no Origin policy. It does not run a simultaneous internal actor/Page session or prove independent agent sessions. Discovery engine/target metadata is hardcoded. Header arrival and real evaluate are useful evidence, not bounded forwarding/Origin/session qualification required here.
   **Correction:** apply explicit4MiB ingress/write bounds and error cancellation, enforce/test allowed/rejected Origin, obtain actual discovery metadata, exercise internal actor plus independent upstream agent sessions simultaneously. Keep test-only, not a second product gateway. Confidence high.

5. **Medium — provisioned-engine/minimal-flags/restricted-profile contracts still bypassed.** `server/src/browser_host/process.rs:78-128,152-186`; architecture `:18-19`.
   Production primitive silently discovers PATH/system engines. Built-ins retain explicitly excluded background-throttling overrides and unnecessary IPC-flooding/hang-monitor/phishing protection reductions. Profile chmod and stale-port removal failures ignored.
   **Correction:** require explicit configured/env-provisioned executable in production; remove copied overrides and unneeded flags; propagate restriction/removal failures except absent stale file. Confidence high.

6. **Medium — malformed required responses still time out instead of failing owner.** `server/src/browser_host/cdp.rs:447-470`; adapter test `:380-400`; architecture `:17`.
   `{"id":1,"error":{"code":"bad","message":"x"}}` fails whole-envelope deserialization and disappears, retaining known owner until timeout. Invalid JSON similarly ignored instead of closing actor. Id-only regression covers only successfully deserialized envelopes.
   **Correction:** separate minimal routing from typed required-response validation; fail identified owner immediately, close unrouteable malformed framing. Add wrong error type/result shape/invalid-JSON cases. Confidence high.

7. **Medium — wire/endpoint strictness still below stated contract.** `server/src/browser_host/protocol.rs:95-121,154-159`; adapter test `:60-71`; `server/src/browser_host/process.rs:588-596`; process tests `:10-14,152-165`; architecture `:9,63,103`.
   Decimal zero still explicitly accepted despite canonical positive counters. CSS dimensions now capped, but10,000,000 is an offset ceiling, not documented viewport dimensions; oversized trusted geometry still validates. Endpoint path validates nonempty prefix only, accepting non-UUID IDs/additional path segments despite Cycle 2's UUID claim; tests use `123`/`abc-123` as successes.
   **Correction:** reject zero counters, enforce documented viewport limits (or explicitly freeze a justified distinct bound), validate one actual browser UUID suffix and add negative cases. Canonical frame-header UUID validation is now present. Confidence high.

8. **Medium — completion/evidence remains overstated.** Phase file `:77-86,91-97,198-200`; engine report `:30-35,81-96`; compatibility tests `:90-168`; adapter tests `:214-240`.
   Process task checked complete although native Windows containment is unimplemented and parent-death/PTY proof absent. Report still asserts mocked10s deadline and32-message/2MiB writer-bound verification; inspected tests do not establish these cases. Real fixture covers initial frame/one ACK/one screenshot, not resize, animation-to-final-static, old-run accounting or single-per-epoch recovery policy. Candidate executable hash/retained current raw records absent from inspected qualification report. These are Phase01 obligations, not all deferrable to Phase05.
   **Correction:** integration owner reopen unsupported task acceptance, retain blocked phase/dependents, remove unsupported claims, enumerate all missing cases and retain binary SHA-256 plus raw result references. Confidence high.

### Cycle 2 positive observations
- EOF-tail endpoint parsing and absolute `sleep_until(deadline)` present (`process.rs:520-535`).
- Port file now requires final newline/nonempty identifier; endpoint rejects non-ws, missing/zero port, credentials/query/fragment.
- Cancellation regression isolated in private test module; no added public cancellation-test control.
- Process lifecycle assertion now demands exact ESRCH (`browser_host_process.rs:142-148`).
- CSS-zoom/document-scroll labels corrected; architecture/report honestly retain native zoom, visual-offset, screencast-pixel mapping and Windows blockers. Shared BHJF immutable Bytes and generated schema-only dependencies remain appropriate.

### Suggestions / KISS–YAGNI–DRY
- Replace frame `Value` extraction/string copy/metadata clone with owned typed required-event parsing (`cdp.rs:489-500`); avoid allocating unknown params trees solely to ignore them.
- Consolidate resource reservation and fixture termination ownership rather than adding more independent counters/PID timers.
- Scan the known DevTools announcement, or continue beyond an invalid earlier `ws://` token (`process.rs:501-510,523-529`); current first-match scan can miss a later valid endpoint.
- Remove stale comments claiming browser zoom, authoritative image mapping and exact-once/per-epoch proof (`browser_host_compatibility.rs:133,150,392,450-459`). Corrected case names do not correct these comments.

### Validation commands / results
- Executed here: static reads/searches; `git status --short && git diff --stat`; scoped `git diff -- server/Cargo.toml server/Cargo.lock server/src/lib.rs`; report-date lookup. No build/tests/lint/formatter/smoke rerun; single integration owner owns verification.
- Assignment-supplied results, not independently rerun or raw-output verified here:
  - `cargo test --manifest-path server/Cargo.toml --lib test_actor_skips_cancelled_command_on_dequeue`:1 pass.
  - `cargo test --manifest-path server/Cargo.toml --test browser_host_adapter`:13 pass.
  - `cargo test --manifest-path server/Cargo.toml --test browser_host_process`:10 pass.
  - `DAM_HOPPER_REQUIRE_BROWSER=1 cargo test --manifest-path server/Cargo.toml --test browser_host_compatibility`:2 pass.
  - `pnpm --filter @dam-hopper/ui exec playwright test e2e/os-host-browser/compatibility.spec.ts`:4 pass.
  - Supplied total30 passed/0 failed; passing present tests does not establish omitted acceptance.
- Historical tester report `plans/reports/tester-261108-1201-phase-01-compatibility-contracts.md:18-27` records19 passes and all-target cargo check. Not current-state build evidence.
- Integration-owner next checks: impacted commands above with explicit provisioned browser, `cargo check --manifest-path server/Cargo.toml --all-targets`, native Windows equivalents, and missing adversarial/containment/geometry/session scenarios after fixes. Coverage percentages and current lint totals not measured.

### Unresolved questions
- Where will current30-test raw output, candidate executable SHA-256 and missing behavioral records be retained?
- Native Windows containment implementation/runner and authoritative native-zoom/nonzero-offset/pixel-mapping evidence remain prerequisites; no support/release pass established.
