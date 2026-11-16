# Phase 04 — Cycle 2 Code Review

## Score: 6/10 — changes required

Static review confirms useful Cycle 1 fixes, not complete Phase 04 acceptance. Product code/tests unchanged; only this report written. Plan/task state left to integration owner.

## Reviewed files

- `server/src/browser_host/cdp_gateway.rs:1-844` — complete discovery/authentication/relay implementation.
- `server/src/browser_host/mod.rs:1-13` — gateway module export.
- `server/src/api/browser_host.rs:1-242,989-1128` — admission, tickets, reset interaction, gateway exports.
- `server/src/api/router.rs:575-716` — supervisor startup and gateway routes.
- `server/tests/browser_host_gateway.rs:1-357` — complete gateway tests.
- `packages/ui/e2e/os-host-browser/agent.spec.ts:1-217` — complete agent qualification.
- `server/examples/browser_host_qualification.rs:1-90,210-294,620-941` — production-router fixture, independent native session.
- `packages/ui/e2e/fixtures/browser-host-qualification.ts:1-542` — complete build/readiness/cleanup helper.

Supporting evidence: phase04 specification; plan overview; architecture contracts §§1–5/8; previous review `code-review-261108-2315-phase-04-fresh.md`; relevant manager/auth/attachment/config implementations; README, PDR, code standards, published development rules and code-review skill. Approximately 2,800 implementation/test lines inspected.

## Requested fix verification

| Requested resolution | Observed result |
|---|---|
| Immediate live ticket authorization | **Added:** `cdp_gateway.rs:586-589` awaits `verify_live_admission` before startup/upstream. Original missing check corrected. Ticket incarnation binding and later startup/connect cancellation remain broken (F1/F2). |
| No raw loopback endpoint in errors/logs | **Original explicit leaks removed:** version/list send/read failures now return fixed strings (`308-334,425-451`); upstream failure no longer explicitly logs `upstream_url` (`719-726`). No runtime error/log capture performed; universal zero-leak claim unverified. |
| Fast auth termination without 10s close tail | **Partially corrected:** auth-selected teardown skips close handshakes (`838-842`); ordinary close bounds reduced to 500ms each. Auth still cannot interrupt writes, registration locks or connect; no absolute deadline timer (F2). |
| Manager agent CDP registration | **Wired:** register/unregister called at `758,836`; manager increments/decrements counters (`manager.rs:676-688`). No target/geometry reconciliation or consumer-visible attached state (F3). |

Positive: dedicated native upstream per agent, shared 4MiB frame/message caps, nonwaiting semaphore admission and RAII gateway permits retained. Baseline discovery now uses full `evaluate_claims` through shared admission. No runtime Node sidecar introduced.

## Critical issues — MUST FIX

### F1 — High: ticket authority still crosses browser incarnation/profile boundaries

**Evidence:** `cdp_gateway.rs:566-591,618-637`; `attachments.rs:118-130,342-354`; architecture contract §5.

Consumed ticket contains `is_dev`, `profile_epoch`, `browser_incarnation`; gateway hardcodes `is_dev:false` and drops both instance identifiers. The `if ticket_capability.is_some()` branch is empty (`625-627`). `ensure_running` may return/start a different incarnation and no comparison occurs before upgrade/upstream access. **[INFERENCE]** A still-valid ticket issued before process replacement can authorize the replacement instead of its bound instance. Fixed CDP subprotocol is optional even for capability authentication (`538-545,684-685`). No concrete client need for this optional path demonstrated.

**Correction:** Remove optional ticket gateway path until needed, or preserve all bindings, require fixed+ticket subprotocols, reject stale epoch/incarnation before 101/upstream connection, and bind cancellation to that exact incarnation. Add restart/reset/racing-upgrade coverage. **Confidence: high, source-proven missing checks.**

### F2 — High: cancellation remains dependent on relay writes/manager locks; expiry is polled

**Evidence:** `cdp_gateway.rs:711-758,762-832,834-842`; `manager.rs:414-415,676-688`; architecture contract §5 requires independently cancellable writers and an absolute deadline timer.

Watcher starts only after upstream connect (up to 5s), skips immediate tick and polls deadline every 5s. A selected relay branch then awaits its write for up to 5s without polling auth cancellation. Fast skipping of final close calls cannot interrupt that wait. Registration/unregistration await the principal manager mutex; unregister happens before transports/permit drop, while reset holds that mutex through cleanup. Consequently authentication termination can retain sockets/capacity behind unrelated cleanup. Spawned watcher also lacks abort-on-drop ownership if relay future itself is cancelled.

**Impact [INFERENCE]:** Expired/revoked authority can remain connected beyond contractual timing, especially with backpressure or reset contention; even deadline expiry can permit further native commands before the next tick.

**Correction:** Race startup/connect and each write against one independently owned cancellation/absolute-deadline future; drop sockets/permit before blocking bookkeeping. Use incarnation-scoped RAII registration and watcher ownership. Qualify blocked writer + expiry, demotion, DB timeout and concurrent reset with elapsed-time assertions. **Confidence: high, direct control flow.**

### F3 — High: registration counts do not implement target/geometry reconciliation

**Evidence:** `cdp_gateway.rs:671-675,758-836`; `manager.rs:676-688`; phase04 steps `50,62` require target registration plus real Emulation/zoom epoch/input fencing.

New hooks only adjust private counts; relay still copies native commands/events without an independent observation/reconciliation path. No native target/navigation/Emulation change is applied to logical session state or input fencing here. Attached/bypass status remains a log, not a consumer-visible dynamic state. Existing architecture documentation correctly warns raw CDP is privileged, but does not supply the missing runtime integration.

**Impact [INFERENCE]:** Cooperative consumers can retain stale target identity/geometry while raw agents mutate the instance. Counting attachments does not resolve the previous integration finding.

**Correction:** Reconcile native target/navigation/layout observations through the independent manager/actor path, publish attachment/bypass state, and invalidate stale geometry/epochs before input. Do not rewrite/filter raw CDP as a substitute. Assert real API changes after agent target and Emulation mutations. **Confidence: high for missing integration.**

### F4 — High: unchanged qualification permits false same-target/session-survival passes

**Evidence:** `agent.spec.ts:101-160,163-215`; example `210-223,778-793,840-868`; gateway tests `306-357`.

- Fixture creates a native target, but agent picks `pages()[0]` or creates another; never correlates native `targetId`.
- Independence test swallows `Page.stopScreencast/Page.disable` failures and checks constant `active:true` plus broadcast-channel error state, not a new frame or native command result after interference.
- Earlier frame count is cumulative, not a post-interference delta; native poke ignores command errors and still returns success.
- Required sibling token absence silently skips qualification. No shared site-storage persistence assertion.
- No regression exercises immediate ticket live check, stale ticket incarnation, fast cancellation under congestion, error/log redaction, manager registration, demotion, capability-only Origin-less rejection, full exact-Origin variants, foreign-target isolation or Emulation fencing. Rust “live revocation” only calls the helper with an expired admission, not an open relay.

**Correction:** Correlate exact target; require interference commands to succeed; compare new native frame count and native DOM/command result after mutation. Make required fixture fields mandatory and add transport/security/failure tests for these fixes. Full producer/SPA/human proof correctly remains Phase09, not demanded here. Phase04 checked tasks (`phase04:130-135`) are not supported by this coverage. **Confidence: high, inspected assertions.**

## Warnings — SHOULD FIX

1. **Medium — empty-allowlist Origin fallback not exact/explicit.** `cdp_gateway.rs:197-203` accepts hardcoded Vite origins case-insensitively even in authenticated production. Remove production fallback; compare exact bytes for explicitly supported development defaults. Test case variants with empty allowlists. **Confidence: high.**
2. **Medium — configured relay capacity ignored.** Gateway static always permits two (`32-39,605-615`), while config accepts `max_raw_cdp_connections` 1–8 and uses it in memory estimation (`config.rs:145,167-170`). A configured cap of one still permits two. Own admission in configured state and test HTTP saturation/release at cap one. **Confidence: high.**
3. **Medium — discovery bound checked after allocation.** `resp.bytes().await` fully collects before 64KiB/256KiB checks (`320-326,437-443`); concurrent discovery has no relay permit. Use bounded streaming accumulation/reservation. **Confidence: high.**
4. **Medium — public URL fallback/DevTools links fragile.** `109-131` falls back to request Host with `ws://`; external HTTPS requires explicit configuration. Frontend URL string replacement (`352-357,476-480`) retains unauthenticated native `/devtools/page/...` path. Require validated public origin; reconstruct or omit frontend links. Test version/list and WSS behavior. **Confidence: high for source behavior; deployment not exercised.**
5. **High shared Phase03 dependency — missing auth session accepted by watcher.** `auth.rs:320-353` succeeds for enabled Admin plus missing session because only `Some(session)` is checked; persisted session expiry is also not checked. Fail closed on absent session and evaluate current expiry/MFA policy. Reported to Phase03 reviewer; no shared code edited. **Confidence: high for missing-session acceptance.**
6. **Medium — qualification runtime output ceiling contradicts retained contract.** Fixture `415,519-524` retains stderr up to 10MiB instead of architecture §2's 64KiB per runtime stream. Cargo's independent build-output limit is separate. Restore runtime ceiling and test overflow cleanup. **Confidence: high.**

## Suggestions — NICE TO HAVE

- Consolidate discovery fetch/rewrite and Origin policy after correctness fixes; avoid maintaining a divergent watcher.
- Remove `/json` aliases unless mandatory Playwright evidence demonstrates need, as specified.
- Map manager process saturation to `429 browserBusy`, not generic 503 (`cdp_gateway.rs:265-276,382-393,630-635`).
- Redact/classify remaining upstream `{err}` logging (`720`) rather than relying on third-party error formatting; add captured-log regression before claiming universal zero leakage.

## Validation commands and verified results

Executed inspection only:

```text
git diff --stat -- <eight assigned paths>
```

Observed: five tracked files changed; 446 insertions, 15 deletions. New gateway/tests/spec separately inspected; tracked diff-stat is not complete review coverage.

No build, lint, typecheck, behavioral tests or browser smoke run by this review worker; single integration validation owner/tester retains execution. No pass claims. Coverage percentages/lint counts unavailable.

Commands for integration owner after repairs:

```bash
cargo check --manifest-path server/Cargo.toml --example browser_host_qualification
cargo test --manifest-path server/Cargo.toml --test browser_host_gateway -- --nocapture
pnpm --filter @dam-hopper/ui test:e2e -- os-host-browser/agent.spec.ts
```

Existing commands cannot prove omitted acceptance cases until assertions/tests are added. Reconcile phase04 completion markers and overview pending status only against actual acceptance evidence.

## Unresolved questions

- Which concrete existing client requires optional agent ticket upgrades or `/json` aliases? No need demonstrated in inspected Phase04 qualification.
- What deployment guarantees a validated `DAM_HOPPER_PUBLIC_SERVER_ORIGIN` for HTTPS/WSS discovery?
