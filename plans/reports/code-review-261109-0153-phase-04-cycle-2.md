# Phase 04 — Cycle 2 code review

## Score: 6/10 — changes required

Remediation improves bounds, write cancellation, source-separated event inspection, and qualification assertions. C1–C3 remain incomplete; W4 remains open. No demonstrated cross-principal exploit. Findings below distinguish high-severity approval blockers from improvements; static review is not runtime approval.

## Scope / reviewed files

Reviewed all six assigned files; complete scoped diff: 524 insertions, 53 deletions. Inspected approximately 1,700 relevant source/test lines plus supporting contracts.

- `server/src/browser_host/cdp_gateway.rs:1-1057`: discovery, authorization, URL rewriting, connection accounting, relay/cancellation, metadata inspection.
- `server/src/browser_host/manager.rs:460-520,557-630,791-831`: reset lock ownership, registration, bounded target map.
- `server/src/browser_host/session.rs:300-345,523-558,637-662`: geometry, identity, epoch mutation.
- `server/tests/browser_host_gateway.rs:311-533`: capacity, cancellation, geometry and target coverage.
- `server/examples/browser_host_qualification.rs:210-297,775-900`: native-session setup, frame ACK, status/poke/error propagation.
- `packages/ui/e2e/os-host-browser/agent.spec.ts:1-301`: eight qualification scenarios.

Supporting evidence: phase specification; architecture contracts §§1–5/7–8; README; relevant PDR/code standards; published development rules and code-review skill; `server/src/browser_host/input.rs:107-131,395-503`; auth/attachment/config consumers. Product, tests and plan status unchanged. Report is the only write.

## Critical issues / approval blockers

### C1 — High: cancellation still does not cover the whole connection lifetime

**Evidence:** `cdp_gateway.rs:783-804,823-859,872-880,917-925,965-977`; manager locks at `manager.rs:468,793,809`.

- `deadline_instant` is calculated once, but registration uses `timeout(deadline_duration, ...)` after upstream connection and the idle relay timer uses a fresh `sleep(deadline_duration)` after registration. Setup time therefore extends those deadlines. An idle connection can survive absolute expiry until the restarted timer or five-second auth watcher fires.
- Registration does not race `auth_abort_rx`. Both metadata helpers are awaited inside selected relay branches, before `write_with_cancel`; upstream target registration can wait on the same instance mutex held by reset. While awaiting that helper, neither outer cancellation branch is polled. The socket-drop correction cannot execute until this wait finishes.
- Registration timeout returns without aborting the spawned auth watcher, detaching it until it subsequently exits. Thus C4's no-detached-task requirement also has an uncovered exit path.

**Impact:** transport cancellation and capacity reclamation can lag expiry/revocation under setup/manager contention. Write-helper tests do not cover this lifecycle.

**Correction:** use one absolute `timeout_at`/`sleep_until` deadline throughout setup, registration and relay; race every awaited metadata operation against auth/deadline cancellation, with cancellation taking priority before forwarding. Give the watcher structured/abort-on-drop ownership on every exit. Preserve the existing drop-sockets/drop-permit-before-unregister ordering. Add contended-registration/target-update and near-expiry setup socket tests.

**Confidence:** high; direct control-flow evidence, timing not exercised here.

### C2 — High: geometry mutation is metadata assignment, not reliable target/input reconciliation

**Evidence:** `cdp_gateway.rs:981-1002`; `session.rs:649-659`; `browser_host_gateway.rs:463-492`; supporting input admission `input.rs:399-503`.

- A target-specific Emulation command overwrites geometry of **every** session belonging to the principal; flattened CDP `sessionId`/native target identity is ignored. Different targets acquire incorrect dimensions.
- Requested values become authoritative before Chromium accepts them. Integer casts truncate large values; zero dimensions and DPR are retained without reconciliation. `clearDeviceMetricsOverride` and `setPageScaleFactor` merely advance epochs, leaving dimensions/page scale stale. `input_available` stays true despite unknown geometry.
- The regression labelled stale-input rejection calls `update_viewport`, not managed input admission/dispatch. `enqueue_input` never compares `viewport_epoch`. No agent E2E sends native Emulation and then stale managed input through the real API.

**Impact:** new epochs can advertise fabricated/stale geometry; required managed-input Conflict behavior remains unimplemented/unproven at the input boundary. This does not allege an exercised incorrect click.

**Correction:** synchronously advance the affected target epoch and disable uncertain input before forwarding; reconcile actual accepted layout/scale through the owned native session, then re-enable only qualified geometry. If target correlation is unavailable, fence conservatively without assigning one target's requested dimensions to its siblings. Validate epoch at managed input admission and again before dispatch; test actual input rejection plus clear/scale/failure and two-target cases.

**Confidence:** high for state corruption and missing acceptance proof.

### C3 — High: qualification still does not select the correlated native target

**Evidence:** `agent.spec.ts:160-174,208-215`; `browser_host_qualification.rs:210-235,859-876`.

`Target.getTargets` proves only that the internal target exists. The DOM mutation still uses `pages()[0]` or creates another page. The interference test independently does the same and never compares its target ID with the internal target. Meanwhile `/poke` mutates the internal target directly. Consequently, wrong-target agent mutation/disable/stop plus healthy native frames can satisfy every assertion.

**Correction:** select the Playwright page by exact `Target.getTargetInfo`/native target ID equality with the fixture's ID in both tests; prohibit fallback page creation. Read the agent's unique DOM/title marker back through the independent native session. Retain successful stop/disable calls, post-command baseline and strict frame increase.

**Confidence:** high. The new baseline/error propagation assertions are useful but do not establish same-target isolation.

## Warnings

1. **W4 — High, still open: public URL derives from request Host without required trusted configuration.** `cdp_gateway.rs:145-168` ignores state, accepts a prefix-matching environment string without origin validation, and otherwise returns `ws://{Host}`. No client CORS origin leaks, but the requested strict configured-origin derivation is absent; TLS-terminated deployments without a valid override advertise insecure/wrong endpoints. Validate a trusted public origin once, require it for production, and fail closed on missing/malformed values. Test differing UI/API origins, HTTPS, hostile Host and invalid configuration.
2. **Medium: acceptance coverage still misses adversarial boundaries.** New tests exercise the write helper and happy-path target map, not full relay congestion/cancellation, registration contention, forged client target events, ID/URL overflow or the 64-entry cap. Agent suite also lacks live role demotion, stale-ticket upgrade and foreign-principal discovery scenarios required by the phase. Passing helper/regression suites do not replace these production-surface oracles (`browser_host_gateway.rs:364-533`; `agent.spec.ts:1-301`).
3. **Medium, KISS/security boundary: newly added obsolete wrappers remain.** `inspect_cdp_message` (`cdp_gateway.rs:1048-1057`) still invokes both trusted-upstream and client handlers on one untyped source. Search found no callers. `advance_viewport_epochs_for_principal` (`session.rs:637-639`) is also unused. Delete rather than introduce deprecated compatibility paths; particularly avoid retaining the original mixed-trust API.
4. **Medium, performance:** both inspection helpers materialize a full `serde_json::Value` for every text message (`cdp_gateway.rs:981-984,1015-1017`), including large responses with no relevant method. This adds avoidable allocation/copying on a 4 MiB relay path. Use a borrowed minimal envelope and parse relevant bounded parameters only.

## Fix verification matrix

| Item | Inspection result |
|---|---|
| C1 absolute cancellation / teardown | Partial: per-write absolute deadline and fast normal-loop teardown present; setup/registration/metadata waits remain outside effective cancellation. |
| C2 geometry / stale input | Partial: synchronous pre-forward epoch bump present; target correctness, actual reconciliation and real input Conflict proof absent. |
| C3 target / frames / capability | Partial: genuine Origin-less ticket denied; command errors propagate and frame baseline is post-command; exact target selection absent. |
| C4 source / bounds / task ownership | Relay only trusts upstream target events; ID <=64, URL <=2048 and map cap 64 present. Registration timeout still detaches watcher; mixed-trust deprecated helper remains. |
| W1 capacity | Effective configured limit now used; immediate 429 retained. |
| W2 bounded discovery | Running size cap now enforced while collecting response chunks. |
| W3 Origin fallback | Now no-auth scoped and case-sensitive; keep exact-byte policy throughout. |
| W4 trusted public URL | Not fixed. |
| W5 capacity release before unregister | Present at `cdp_gateway.rs:973-977`; no manager await between socket/permit drop and unregister. Runtime contention oracle absent. |

## Suggestions

- Reuse one discovery HTTP client and a small bounded fetch/rewrite helper rather than reconstructing duplicate clients (`cdp_gateway.rs:342-354,444-456`).
- Extract one exact-target qualification helper and one frame-advancement assertion to eliminate duplicated but diverging test logic; no general automation abstraction needed.

## Positive observations

Dedicated upstream per agent remains intact. Configured admission, bounded streaming reads, source-separated lifecycle inspection and pre-forward epoch ordering improve the implementation. Native ACK/poke failures now propagate; genuine capability-only denial and strict post-command frame growth are meaningful additions. Socket and permit drops now precede manager unregister.

## Validation commands / results

**Executed by this reviewer:** scoped `git diff --stat`, scoped `git diff`, targeted reads/searches. No tests, compilation, lint, formatter or smoke run executed here; execution is owned by Main/tester. No lint count, type-coverage percentage or test-coverage percentage measured.

**Separately recorded tester evidence**, not reviewer-executed verification: `plans/reports/tester-261109-0152-phase-04-cycle-2-cdp-validation.md:25-34,70-78` reports:

| Command | Recorded result |
|---|---|
| `cargo test --manifest-path server/Cargo.toml --test browser_host_gateway -- --nocapture` | 13 passed, 0 failed |
| `cargo test --manifest-path server/Cargo.toml --test browser_host_lifecycle --test browser_host_shutdown --test browser_host_admission --test browser_host_auth --test browser_host_input` | 33 passed, 0 failed |
| `cargo check --manifest-path server/Cargo.toml --example browser_host_qualification` | exit 0 |
| `pnpm --filter @dam-hopper/ui test:e2e:typecheck` | exit 0 |
| `pnpm --filter @dam-hopper/ui exec playwright test e2e/os-host-browser/agent.spec.ts` | 8 passed, 0 failed |

These results establish the existing assertions passed, not the missing cancellation/target/input oracles. Phase approval remains blocked by C1–C3 and W4. Main owns status reconciliation; no plan edits performed under this assignment.

## Unresolved questions

No user decision required. Unresolved evidence: exact-target native roundtrip/interference; real native-emulation/stale-input Conflict; absolute expiry/revocation during setup, metadata contention and congestion; watcher/capacity release on all exits; strict configured-origin rewrite; remaining negative production-surface cases above. Full producer/SPA/human qualification remains a later-phase gate, not an added Phase 04 requirement.
