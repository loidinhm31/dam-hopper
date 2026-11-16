# Phase 04 Cycle 3 — Code Review

## Score: 6/10

**Disposition: changes required.** Both requested Cycle 3 fixes are present in source; Phase 04 end-to-end acceptance remains incomplete. Static review, not runtime approval.

## Reviewed files

All eight assigned files inspected (~2,700 relevant lines, including supporting context):

| File | Review focus |
|---|---|
| `server/src/browser_host/cdp_gateway.rs:1-892` | Discovery, Origin, tickets, instance binding, bounds, cancellation |
| `server/src/browser_host/mod.rs:1-13` | Module integration |
| `server/src/api/browser_host.rs:1-242,989-1017,1125-1128` | Caller authentication, tickets, exports |
| `server/src/api/router.rs:570-735` | Production route mounting and middleware |
| `server/tests/browser_host_gateway.rs:1-357` | Eight gateway tests; coverage limits |
| `packages/ui/e2e/os-host-browser/agent.spec.ts:1-217` | Seven interoperability scenarios and assertions |
| `server/examples/browser_host_qualification.rs:210-292,620-941` | Native-session setup and actual-router qualification |
| `packages/ui/e2e/fixtures/browser-host-qualification.ts:1-542` | Prebuild, launch, readiness, process cleanup |

Supporting evidence: phase specification, architecture contracts §§1–5/8/11, acceptance matrix; manager agent-registration/reset paths; session identity/geometry paths; auth live-check implementation; README, PDR, code standards, published development rules and code-review skill. No product/test/plan-status edits.

## Critical issues — MUST FIX

No demonstrated cross-principal exploit. Following **high-severity acceptance/security blockers** prevent approval:

### C1 — Absolute auth expiry still depends on polling; cancellation does not immediately drop sockets

- **Evidence:** `cdp_gateway.rs:743-788,790,882-889`; `manager.rs:438,703-715`; architecture contract `architecture-contracts.md:84` explicitly requires an independent absolute timer and direct cancellation.
- **Failure:** Watcher starts only after upstream connection, skips its immediate tick, and checks `effective_deadline` only every five seconds. A connection expiring just after a tick continues forwarding until the next tick. An expiry during upstream connection is not rejected before forwarding. On cancellation, both sockets remain owned while `unregister_agent_cdp(...).await` acquires the instance mutex; reset holds that mutex across cleanup. The new `write_with_cancel` removes write-deadline blocking, not these other delays.
- **Impact:** Expired instance-administrator authority outlives its deadline; cleanup lock contention delays actual socket teardown.
- **Correction:** Race an absolute deadline independently from DB polling, including setup/registration; revalidate before first forwarding. Drop both sockets before awaiting manager accounting. Keep registration/cleanup from blocking transport cancellation.
- **Confidence:** High; direct control-flow evidence. Add near-deadline setup, blocked-write and contended-manager teardown tests.

### C2 — Native agent changes never reconcile managed target/geometry state

- **Evidence:** `cdp_gateway.rs:790-880` only increments attachment accounting and relays opaque messages; `manager.rs:703-715` only changes counters. Manager `active_targets` is initialized/cleared, never populated. Session creation retains `native_target_id: None` (`session.rs:326-344`); viewport epoch changes only through managed viewport updates (`session.rs:518-546`). Phase specification `phase-04-agent-cdp-gateway.md:50,62` explicitly requires target registration and native Emulation/zoom epoch/input fencing through real API.
- **Failure:** No inspected gateway/manager path observes agent-created/closed/navigated targets or native geometry mutations and invalidates corresponding managed metadata/input state.
- **Impact:** Managed target identity and geometry remain disconnected from the browser being controlled. Native agent mutations have no demonstrated stale-input fence. Raw authority bypass being intentional does not remove the requirement to detect interference safely.
- **Correction:** Reconcile owned native target lifecycle and geometry with managed identities, fencing uncertain geometry/input without rewriting native relay traffic. Prove Emulation/zoom mutation against the correlated managed target using the actual API.
- **Confidence:** High for missing integration and acceptance; downstream user-visible input consequences not runtime-exercised here.

### C3 — Qualification can pass without proving same-target native-session survival; mandatory cases absent

- **Evidence:** `agent.spec.ts:109-126,140-157` selects `pages()[0]` or creates another page rather than using the fixture's exposed native `targetId`. Disable/stop exceptions are swallowed. After interference, assertions check only hardcoded `active: true` and absence of terminal error; no frame counter increase. Fixture status/poke (`browser_host_qualification.rs:841-868`) reports presence as active and discards command failures; ACK failures are also discarded (`:268-272`).
- **Failure:** Stopped screencast, wrong target or rejected interfering commands can satisfy the assertions. Initial `framesReceived > 0` is not proof of new frames after interference.
- **Additional missing proof:** No agent-suite scenarios for role demotion, stale incarnation/epoch ticket rejection, Origin-less capability-only denial, congestion plus cancellation, foreign-principal discovery, or native geometry fencing. Rust gateway tests do not exercise `write_with_cancel` or stale-ticket rejection; `test_live_revocation_detection` checks an expired admission, not an actual revoked socket (`browser_host_gateway.rs:330-357`).
- **Correction:** Select via admin-only exact native-target correlation; assert mutation through independent native session; require disable/stop command success; record frame baseline, mutate DOM, and await a strictly larger frame count with successful ACK. Propagate fixture command/ACK failures. Add missing production-surface cases, especially both Cycle 3 regressions.
- **Confidence:** High. Existing passing test counts cannot establish these acceptance criteria.

## Warnings — SHOULD FIX

1. **Configured capacity ignored.** `cdp_gateway.rs:32,38-39,622-633` always permits two connections; `config.rs:73-74` exposes `max_raw_cdp_connections`. Configuring one still allows two and diverges from configured resource estimates. Initialize gateway admission from effective server config while preserving qualified ceilings.
2. **Discovery checks size after full allocation.** `cdp_gateway.rs:332-348,449-465` uses `resp.bytes()` before enforcing 64/256 KiB. Browser-controlled title/URL data can make discovery oversized; concurrent requests are not admission-bounded. Stream with a running cap and reject before retaining excess; use bounded discovery admission consistent with payload accounting.
3. **Origin fallback is not exact or development-scoped.** `cdp_gateway.rs:209-214` uses `eq_ignore_ascii_case` for localhost fallback without checking `state.no_auth`; with empty production allowlists, shared admission permits the request (`auth.rs:169-175`) and this path accepts non-exact bytes. Gate development fallback explicitly and use byte-exact matching; configured production Origin policy should fail closed.
4. **Public URL fallback breaks HTTPS deployments.** `cdp_gateway.rs:121-143` silently uses `ws://` plus request Host if public origin is missing/malformed. Configured HTTPS origin is handled correctly; absent config behind TLS termination yields an insecure returned endpoint. Validate public origin at startup or derive from trusted direct-listener configuration; never forwarded headers.

## Suggestions — NICE TO HAVE

- Share the discovery HTTP client and bounded fetch/rewrite helper (`cdp_gateway.rs:306-318,423-435`), avoiding duplicate per-request client construction.
- Consolidate Origin policy/error kinds with existing Browser admission after preserving gateway's stricter header-only Origin-less rule. Current gateway emits `forbiddenOrigin`; common auth emits `originForbidden`.

## Positive observations

- Cycle 3 instance binding is present: consumed ticket incarnation and epoch are compared with the running handle and rejected with HTTP 401 (`cdp_gateway.rs:591-592,642-658`).
- All explicit relay sends now race `auth_abort_rx` via `write_with_cancel` (`:62-72,801-868`); DB work runs outside the forwarding loop.
- Dedicated upstream per connection; explicit 4 MiB frame/message limits, five-second write deadline, RAII connection permits, bounded target-ID syntax.
- Production-gateway qualification mounts the actual router/auth store/manager rather than substituting the Phase 01 proxy. Helper preserves compiler-artifact prebuild and separate post-spawn readiness deadlines.
- Duplicate/comma Origin handling and configured-Origin byte comparison are explicit. Ticket capability is not echoed as selected subprotocol or placed in URLs.

## Validation commands and verified results

**Executed here:** source/diff inspection only (`git diff --stat -- <eight scoped files>`, `git diff -- server/src/api/browser_host.rs server/src/api/router.rs`, targeted reads/searches). No build, test, lint, formatter or runtime smoke executed; integration/test execution belongs to Main/TesterCycle3. No fresh runtime pass claimed.

Commands for integration owner:

```sh
cargo test --manifest-path server/Cargo.toml --test browser_host_gateway -- --nocapture
cargo check --manifest-path server/Cargo.toml --example browser_host_qualification
pnpm --filter @dam-hopper/ui exec playwright test e2e/os-host-browser/agent.spec.ts
pnpm --filter @dam-hopper/ui run test:e2e:typecheck
```

Historical report `plans/reports/tester-261108-2207-phase-04-raw-cdp-gateway.md:17-24` records 8 gateway + 7 Playwright + 33 regression passes. Historical only, not fresh Cycle 3 verification and not proof of missing assertions. Type/test coverage percentages and current lint counts: not measured.

## Completion assessment

- Requested stale-ticket comparison and cancellable-write changes: present by inspection, missing targeted runtime regression evidence.
- `serve-agent-cdp`: incomplete pending C1/C2.
- `qualify-agent-interoperability`: incomplete pending C2/C3.
- Phase file marks complete/checked (`phase-04-agent-cdp-gateway.md:9,130-135`), while overview still says pending (`plan.md:28`). Main owns status reconciliation; unchanged here per assignment. Full producer/SPA/human acceptance remains correctly deferred to Phase 09, not demanded by this review.

## Unresolved questions

None requiring user decisions. Unresolved evidence: fresh Cycle 3 runtime results and corrective regression proofs above.
