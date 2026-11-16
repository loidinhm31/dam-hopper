# Phase 04 Fresh Code Review

## Score: 4.5/10 — changes required

Read-only product/test review. Only this report written; plans/task status intentionally unchanged. Phase 04 completion claims not supported by current implementation/qualification coverage.

## Reviewed files

All eight assigned files inspected:
- `server/src/browser_host/cdp_gateway.rs:1-818` — discovery, Origin, admission, limits, relay, teardown.
- `server/src/browser_host/mod.rs:1-13` — module registration.
- `server/src/api/browser_host.rs:1-215,959-987,1096-1098` — shared admission, ticket issuance, exports; additional relevant handler sections inspected.
- `server/src/api/router.rs:665-705` — gateway routes and middleware boundary.
- `server/tests/browser_host_gateway.rs:1-357` — complete gateway tests.
- `packages/ui/e2e/os-host-browser/agent.spec.ts:1-217` — complete agent qualification.
- `server/examples/browser_host_qualification.rs:620-941` — production gateway mode; native session setup `210-292`.
- `packages/ui/e2e/fixtures/browser-host-qualification.ts:1-542` — build/readiness/lifetime/cleanup interface.

Supporting evidence: phase04 specification, plan overview, architecture contracts §§1–5/8, acceptance matrix A16/A19/A20; `browser_host/{auth.rs,attachments.rs,config.rs,manager.rs,session.rs}` relevant sections; README, PDR, code standards, installed development/review workflow and code-review skill. Approx. 3,000 implementation/test lines inspected, excluding supporting documentation.

## Critical issues — MUST FIX

### F1 — Critical: ticket upgrade grants raw CDP before live authorization and loses incarnation binding

**Evidence:** `cdp_gateway.rs:566-584,611-625,720-738`; `attachments.rs:293-355`; architecture contract §5 requires live authorization at consume and instance/profile binding.

`consume_ticket` validates token existence/TTL/purpose/Origin only. Gateway converts consumed metadata directly into `BrowserAdmission`, hardcodes `is_dev:false`, discards `profile_epoch`/`browser_incarnation`, then calls `ensure_running`. No live check occurs before upstream access; first check occurs five seconds after upstream connection. A ticket issued before role demotion/account disable or during a revocation race can still execute privileged native commands. A ticket for an old incarnation can attach to, or start, a new instance. Fixed CDP subprotocol is also optional even on ticket authentication (`529-545,673-675`).

**Correction:** Prefer removing optional ticket gateway path until a concrete client requires it, as phase04 directs. If retained: atomically consume, immediately verify live session/role/deadline, require fixed+ticket subprotocols, preserve `is_dev`, compare ticket epoch/incarnation against current owned handle, and reject stale bindings before 101/upstream creation. Register attachment lifecycle and unregister on drop. Qualify demotion/revoke/reset/restart races.

**Confidence:** High; source-proven authorization gap, not runtime-exercised.

### F2 — High: auth cancellation waits behind writes/close handshakes; no absolute expiry timer

**Evidence:** `cdp_gateway.rs:700-738,740-816`; architecture contract §5 requires independent cancellation, absolute deadline timer, healthy revocation observation ≤5s and error path ≤7s plus scheduling.

The watcher starts only after a possible five-second upstream connect, skips its initial tick, and checks expiry only on ticks. Once a relay select branch wins, its send is awaited outside the cancellation select for up to five seconds. After cancellation, gateway awaits upstream close and then client close for up to five seconds each. Auth signal therefore cannot preempt a blocked write; client disconnect/permit release can lag considerably beyond contracted bounds. There is no absolute `effective_deadline` timer or attachment cancellation token. Aborting the relay task also detaches the separately spawned watcher because its handle lacks abort-on-drop ownership.

**Correction:** Start admission/deadline cancellation before upstream connection; race connect and every write directly against cancellation/deadline. On invalidation immediately drop both transports and permit, without sequential awaited close handshakes. Ensure watcher lifetime is RAII-owned or avoid the detached task. Exercise stalled writer + expiry, demotion and DB timeout with elapsed-time assertions.

**Confidence:** High; direct control-flow evidence.

### F3 — High: raw loopback debugger endpoints leak through errors and logs

**Evidence:** `cdp_gateway.rs:308-315,329-334,425-432,446-451,709-715`; architecture contracts §§2/5 forbid logging raw endpoints and returning raw loopback URLs.

Upstream connect failure explicitly logs `url = %upstream_url`, including `/devtools/browser/<id>` or page endpoints. Discovery interpolates full reqwest errors into public JSON; request/response errors can carry `http://127.0.0.1:<debug-port>/json/...`. Rewriting successful `webSocketDebuggerUrl` does not cover failure paths.

**Correction:** Stable generic client errors; log bounded error classification without URL/native endpoint. Add failure-path assertions over response bodies and captured diagnostics, not only successful version JSON.

**Confidence:** High for explicit endpoint logging; high for reqwest error disclosure path, not reproduced here.

### F4 — High: agent mutations never reconcile manager targets/geometry or fence input

**Evidence:** `cdp_gateway.rs:660-678,740-810` only warns and copies messages; no manager/session synchronization. `manager.rs:99-119` target/agent state is not connected to gateway; `session.rs:326-344,515-549` holds independent session geometry/epochs. Phase04 steps `50,62` explicitly require target registration and real Emulation/zoom epoch/input fencing.

Native agent `Target.createTarget/closeTarget`, navigation or Emulation changes do not update logical target identity/viewport epoch/input availability through this gateway. Cooperative consumers can retain stale geometry/target state while an agent mutates the same browser. The requested agent-attached/lease-bypass state is only a server log, not consumer-visible state.

**Correction:** Reconcile through the independent native manager/actor observation path, not by rewriting/filtering raw CDP. Publish attached/bypass state and invalidate input geometry/epochs when native state changes; correlate logical/native targets. Add real API assertions after agent target/navigation/Emulation mutation. This is phase04 acceptance, not a reason to require phase09 SPA/human work early.

**Confidence:** High for missing integration; impact follows architecture contract.

### F5 — High: interoperability tests can pass without proving same-target session survival; required security/bounds cases absent

**Evidence:** `agent.spec.ts:101-160,163-215`; fixture `browser_host_qualification.rs:210-223,778-793,840-868`; Rust tests `browser_host_gateway.rs:306-357`.

- Native fixture creates its own target, but agent tests pick `pages()[0]` or create another page instead of correlating returned native `targetId`. DOM roundtrip and native poke can exercise different targets.
- Independence test swallows `Page.stopScreencast/Page.disable` errors. It asserts constant `active:true` and no broadcast-channel terminal error, not a new native frame or command/DOM result after interference. A stopped native screencast with an open channel passes.
- Earlier `framesReceived > 0` is cumulative; no post-mutation baseline comparison.
- Gateway Rust “live revocation” test only calls the shared helper with an already-expired admission; no open relay is revoked. Capacity test checks semaphore directly, not HTTP 429/upgrade failure cleanup.
- Neither suite covers demotion, capability-only Origin-less denial, stale ticket/incarnation, expiry under blocked writes, real congestion/4MiB boundaries, exact-case/null/repeated Origin matrix, foreign-principal target isolation, or manager Emulation fencing. List-discovery rewrite is untested. Sibling storage persistence is not asserted. Sibling qualification silently skips when its required token is absent.

**Correction:** Select the exact admin-correlated target, assert both interference commands succeed, record frame baseline, mutate from agent and require independent native command/DOM + later frame roundtrip. Add missing gateway transport/security cases and strict required fixture fields. Do not mark task complete from existing weak assertions. Full producer/SPA/human checks correctly remain phase09.

**Confidence:** High; assertions and omissions inspected, tests not executed.

## Warnings — SHOULD FIX

### W1 — Medium: Origin fallback violates exact approved-byte matching

**Evidence:** `cdp_gateway.rs:197-202`.

When both allowlists are empty, hardcoded Vite origins are accepted case-insensitively, even in authenticated production mode. Thus `HTTP://LOCALHOST:5173` can pass without an explicitly approved exact Origin. Configured allowlist branch correctly compares raw bytes.

**Correction:** Remove fallback for production and require explicit approved origins; if development defaults are retained, compare exact bytes and guard actual development mode. Add empty-allowlist and case-variant tests. **Confidence:** High.

### W2 — Medium: configured connection/memory admission ignored

**Evidence:** `cdp_gateway.rs:32-39,598-607`; `config.rs:137-145,167-171`.

Global static always permits two agents, ignoring `budgets.max_raw_cdp_connections`. Setting configured capacity to one still admits two; configured worst-case memory accounting assumes one relay. Raising configured capacity also has no effect. Default-two and permit drop mechanics themselves are correct.

**Correction:** Own gateway admission in the configured service state, charge configured relay reservations, keep immediate try-acquire/429 and RAII release. Cover capacity one and HTTP upgrade failure/close. **Confidence:** High.

### W3 — Medium: discovery size checks occur after full allocation; rewriting duplicated and URL basis fragile

**Evidence:** `cdp_gateway.rs:109-131,294-358,411-483`.

`resp.bytes().await` collects the entire body before applying 64KiB/256KiB bounds; many concurrent discovery requests have no gateway concurrency admission. Raw agents can grow target-list metadata. A two-second timeout does not impose a byte budget. Without `DAM_HOPPER_PUBLIC_SERVER_ORIGIN`, URLs always use `ws://` and request Host, breaking typical externally HTTPS/WSS deployments. Frontend URLs are string-replaced without fixing their `/devtools/page/...` path to the authenticated gateway.

**Correction:** Shared bounded streaming discovery helper; reject before retained bytes exceed cap, account concurrent discovery work. Validate configured public HTTP(S) origin and derive matching WS scheme; reconstruct or omit frontend links instead of string substitution. Add list/version and HTTPS-origin tests. **Confidence:** High for code behavior; deployment occurrence not exercised.

### W4 — High, shared dependency: missing persisted sessions pass the live checker

**Evidence:** `browser_host/auth.rs:296-340` (supporting Phase03-owned code called by Phase04 watcher).

With an enabled Admin user and `get_session(sid) -> None`, checker skips the `if let Some(session)` block and returns success. Active raw relay can outlive removal of its auth-session record until token deadline. Current checker also does not compare persisted `session.expires_at` to current time.

**Correction:** Producing auth owner must reject missing session and enforce persisted expiry/current effective deadline; qualify actual raw relay closure. Coordinate repair with Phase03 owner rather than editing shared code in this read-only review. **Confidence:** High for missing-session logic; expiry consequences depend on session-store mutation policy.

## Suggestions — NICE TO HAVE

- Remove `/json` aliases unless recorded Playwright evidence demonstrates need; contract allows them only on that evidence (`router.rs:685-691`). Current Playwright baseline uses version discovery.
- Consolidate discovery/rewrite and Origin policy into existing boundaries after correctness fixes; avoid duplicating version/list request/error logic and maintaining a divergent auth watcher.
- Return `429 browserBusy`, not generic `503 browserUnavailable`, when manager startup reports process capacity (`cdp_gateway.rs:265-276,382-393,612-623`).

## Positive observations

- Dedicated upstream per connection; no raw-command filtering or false target sandbox.
- Incoming client and upstream message/frame caps use shared 4MiB constant; every explicit relay send has a 5s timeout.
- Nonwaiting semaphore rejects saturation; owned permit and counter decrement are RAII-managed.
- Configured Origin matching uses exact raw bytes; duplicate/comma/null/trailing-slash branches exist.
- Discovery/auth JSON helper consistently sets no-store. Auth/session test fixtures and production router mode avoid introducing a runtime Node sidecar.
- Qualification helper preserves absolute-root Cargo artifact discovery, separate build/readiness deadlines and bounded process cleanup.

## Validation commands and verified results

Executed inspection command:

```text
git diff --stat -- <eight assigned paths>
```

Result: five tracked files changed, 403 insertions/3 deletions. New gateway/test/spec files separately read in full; diff-stat alone is not coverage evidence.

No build, test, lint, typecheck or browser smoke executed by this review worker; single validation owner/tester remains responsible. No pass claims. Type/test coverage percentages and lint counts unavailable.

Recommended integration-owner checks after repair:

```bash
cargo test --manifest-path server/Cargo.toml --test browser_host_gateway -- --nocapture
cargo check --manifest-path server/Cargo.toml --example browser_host_qualification
pnpm --filter @dam-hopper/ui test:e2e -- os-host-browser/agent.spec.ts
```

Existing commands cannot establish missing acceptance cases until those cases are implemented. Phase04 file marks both tasks complete (`phase-04-agent-cdp-gateway.md:130-135`), whereas overview still says pending (`plan.md:28`); owner should reconcile only after genuine acceptance evidence.

## Unresolved questions

- Which concrete existing client requires optional agent ticket upgrades or `/json` alias? None demonstrated in inspected Phase04 tests.
- What production configuration guarantees `DAM_HOPPER_PUBLIC_SERVER_ORIGIN` behind HTTPS? Current fallback cannot infer a secure public origin.
