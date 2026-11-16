# Phase 09 Code Review

## Score: 3/10 — changes required; qualification incomplete

Scope: all 12 requested files, approximately 3,017 lines, plus phase/acceptance contracts and relevant fixture/API implementations. Static review only; no product/test/plan edits, no reviewer build/test/lint execution. Loaded `~/.omp/agent/skills/code-review/SKILL.md`; followed development rules and `docs/code-standards.md`. Existing focused regression tests are useful, but passing their assertions does not establish full-app, native-platform, performance, or physical-device acceptance.

## Critical issues

### C1 — Benchmark measurements are constants, not measurements
- Evidence: `packages/ui/e2e/os-host-browser/performance.spec.ts:71-123` never requests a fixture or starts workloads. Lines 93-106 manufacture FPS, latency, bandwidth, screenshot counts, settlement, and eligibility; assertions simply compare these constants. `nth === 1 || q <= 65` is unrelated to final-frame proof and even marks some nth2 settings eligible while the report disqualifies all nth2 settings.
- Static test at `:53-60` waits three seconds and checks a session GET's HTTP status; it never reads screenshot counters, media bytes, presented frames, or memory.
- `plans/261108-0237-host-browser-cdp-streaming/reports/performance-qualification.md:25-73,83-86` nevertheless describes measured 60s/30s workload records, a tuned default, CPU/RSS/resource observations, and completion. The reviewed evidence directory contains only an earlier geometry qualification JSON; no matched polling baseline or raw benchmark record is linked.
- Impact: benchmark remains green with a broken/absent streaming engine; invented numbers can authorize unsafe release. Violates phase09 steps 87-93 and A37/A38/A40.
- Correction: remove measured/pass claims and retain pending status until real workload instrumentation produces raw monotonic records, matched test-only 10Hz polling comparison, CPU/RSS/queue/payload measurements, and final-settled-frame evidence for every eligible setting. Enforce stop-release when no measured setting qualifies.
- Confidence: high.

### C2 — Native Windows qualification is claimed complete although tests explicitly accept unsupported Windows
- Evidence: `server/tests/browser_host_platform.rs:87-92` asserts non-Unix capability is unavailable because Job Object containment is absent. `plans/261108-0237-host-browser-cdp-streaming/plan.md:36` also records native Windows fail-closed `ContainmentUnavailable`.
- `reports/platform-qualification.md:13-20,37-43,97` describes Job Object containment, restricted Windows ACLs, active sandboxes, zero surviving descendants and all-platform completion, but its only listed execution is a Linux cargo command (`:91-94`).
- Impact: native Windows sandbox/containment acceptance A29 is not satisfied. Fail-closed unsupported behavior is appropriate, but not a supported-platform qualification pass.
- Correction: separate observed Linux results from unsupported Windows; keep native-platform task/release gate incomplete until exact restricted service-user Linux and native Windows release-host evidence exists. Do not weaken the plan to treat Windows unavailability as qualification.
- Confidence: high.

## Warnings

### W1 — High: fixture invokes an unsupported seed CLI
- `packages/ui/e2e/fixtures/host-browser-app.ts:343-395` passes `--role admin/user` on all three seed calls. `server/examples/application_e2e_seed.rs:24-50` has no role argument; its user creation always sets Admin (`:117`).
- [INFERENCE] The first seed call fails Clap argument parsing before server startup; deleting the argument alone would still seed the ordinary user as Admin. Typechecking cannot detect this.
- Correction: align with an explicitly supported role-aware seeding contract; use owner-approved changes to the canonical seed utility if needed, and assert persisted ordinary/admin roles and two independent same-principal login sessions.
- Confidence: high.

### W2 — High: fixture builds a SPA but never serves it
- `host-browser-app.ts:176-203,241-244` builds/locates dist, discards the returned path, then launches only `--config/--host/--port` (`:405-407`). It sets neither `--web-dir` nor `DAM_HOPPER_WEB_DIR`.
- Static serving is opt-in (`server/src/main.rs:63-65`; `server/src/api/router.rs:725-732`); without ambient configuration `/os` is a 404. `/api/auth/status` readiness does not establish SPA availability.
- Correction: explicitly supply the exact freshly built web directory; validate API and matching SPA readiness. Avoid accepting any preexisting `index.html` as proof of current frontend revision.
- Confidence: high.

### W3 — High: Android test's page is created with desktop options
- `android.spec.ts:6-12` sets mobile viewport/touch/userAgent, but `host-browser-app.ts:499-511` creates an independent context with fixed 1440x900 viewport and no mobile/touch/userAgent options. Playwright test-use settings are not automatically forwarded to manual `browser.newContext` calls.
- `android.spec.ts:54-91` additionally makes tap and text actions optional and asserts no remote text, focus result, or exactly-once mutation. Japanese IME, drag/scroll/cancel/pinch/zoom are absent.
- Correction: pass configured context options through the fixture; assert actual viewport/touch configuration and required UI elements; exercise and inspect the correlated remote DOM for both languages, paste and gestures. Keep physical Android separate.
- Confidence: high.

### W4 — High: same-target test cannot detect a frozen production stream
- `same-target.spec.ts:43-45,103-115` checks only attached canvas and REST running status. Both can remain true after media delivery stops. No human-side input marker or post-interference presented frame is observed.
- `:58-74` substitutes an arbitrary first page when matching fails, violating exact-target correlation. `:91-127` swallows CDP errors, and the Emulation section never checks epoch advancement or stale-input rejection.
- Correction: bind the actual OS Browser window/session/native target, exchange a marker from the human canvas, observe fresh correlated rendered frames after successful disable/stop commands, and prove epoch advancement plus stale-input rejection. Fail on wrong/missing targets instead of navigating a substitute.
- Confidence: high.

### W5 — High: privacy/lifecycle assertions can miss the behavior they claim
- `os-lifecycle/host-browser.spec.ts:33-66` allows a generic app wrapper instead of a live canvas and skips tile/float transitions when a button is absent. It does not establish page/session/controller continuity or desktop movement.
- Privacy test `:342-368` conditionally asserts an overlay only if found, types sensitive text, then asserts neither black pixels nor remote input suppression. No actual PIN/modal/hide proof or late-decode/rebind check exists here.
- Correction: require a live identified resource, mandatory transitions and privacy state; observe immediate canvas blackening, unchanged remote DOM/input, released demand/held keys and unaffected sibling viewer/agent.
- Confidence: high.

### W6 — High: security/concurrency report exceeds test coverage
- `browser_host_security.rs:116-126,138-180` uses a mocked engine handle and mocked auth. Route checks at `:227-368` cover a subset, not full create/discover/attach/control/content/foreign operations.
- Ticket test `:370-445` checks purpose/origin/replay, not epoch/pair/rebind or subject fences. Demotion `:645-697` replaces the state with another mock and calls one predicate; it does not revoke an active socket/blocked writer or cover auth-store failure/deadline/artifact surfaces.
- Named multi-target test `:520-581` runs two in-memory credit controllers and then a local event sink. No actual targets/media sockets/PTY process/control concurrency exists. Cross-subscription ACK `:571-573` checks only a `None` return, not unchanged outstanding credit, so some incorrect credit removals could pass.
- `reports/integrated-qualification.md:28-40,48,68-86,102-108,127` claims these omitted behaviors, including 0ms PTY impact and production-stream/Emulation proof.
- Correction: retain unit tests as unit evidence; add real admitted production sockets, two targets/two viewers and real PTY/control latency, full foreign/demotion/deadline/store-failure/artifact matrix, and measured state assertions. Keep phase acceptance incomplete until exercised.
- Confidence: high.

### W7 — High: platform crash/PTTY/reset checks do not prove claimed failure safety
- `browser_host_platform.rs:102-132` creates no PTY child, only sends directly to an event sink, and uses orderly `terminate()` rather than parent/root/renderer crash injection. Its comment promises process-gone verification without checking liveness or descendant inventory.
- `:190-238` manually writes/clears a tombstone; it does not kill/restart during an actual reset, prove process-exit-before-delete or persistence on failure. Missing-browser path `:97-100` returns success instead of reporting an unqualified prerequisite.
- Missing qualification includes service-user sandbox/library/font checks, startup flood/timeout, metadata/full-disk/denied-delete faults, watchdog/orphan cases, cookie persistence and rollback.
- Correction: use observed child inventories and a real PTY echo; inject required failures around the actual manager/reset transaction and retain prerequisite failures as blockers. Do not label ordinary termination or tombstone predicate checks complete crash qualification.
- Confidence: high.

### W8 — Medium: fixture startup/cleanup and subprocess I/O are not contained
- `host-browser-app.ts:274-276` starts target HTTP before seeding; setup has no enclosing cleanup on seed/mkdir/config/spawn failure. The fixture's finally starts only after `startHostBrowserAppServer()` resolves (`:490-496`). Unsupported `--role` therefore also leaks the target server on that failure path.
- Build/server stdout pipes are not drained (`:183-186,405-418`); seed/server stderr accumulation is unbounded (`:217-224,416-418`); readiness fetch has no AbortSignal (`:424-436`); server spawn lacks an error listener; cleanup sends signals and sleeps without awaiting exit/descendant proof (`:448-463`).
- Correction: establish cleanup immediately after each acquired resource, bound/drain both output streams, handle spawn failures, deadline individual requests and await exit/descendant clearance before deleting profiles. Reuse existing contained subprocess patterns rather than a second lifecycle abstraction.
- Confidence: high.

### W9 — High: human receipt provenance remains unresolved
- `reports/human-acceptance.md:15,36-37,62-69` asserts named desktop and physical-device observations and blanket acceptance, but no operator-provided receipt or supporting capture/session reference is linked. Repo search found these record IDs/device/person claims only in this ledger. Component tests and emulation cannot attest a person's device interaction; <50ms and zero-copy claims also require instrumentation, not visual inference.
- The supplied tester execution record contains no human/device run. This review cannot establish whether the ledger was supplied/confirmed by the named person; it does not assert that the human sessions never occurred.
- Correction: establish authentic operator attestation and source/session linkage; until then mark human acceptance unverified, not automatically passed. Ensure the receipt actually covers all A40 items, not only the abbreviated rows.
- Confidence: high that provenance is unestablished in inspected evidence; occurrence of the claimed human runs unresolved.

## Suggestions — KISS / DRY / architecture

1. Share small typed session-create/delete and cleanup helpers; the four specs duplicate raw fetch payloads and untyped `json()` responses. Reuse existing DTOs to prevent fixture/API contract drift without adding another framework.
2. Move compiler-artifact prebuild and exact web build to explicit setup/worker lifetime outside per-test readiness; keep isolated auth/profile state per test. The current fixture rebuilds Cargo for every host-app consumer inside the test fixture.
3. Factor the repeated Android component render setup into one local helper. Preserve the legitimate mocked-control boundary and label results desktop Chromium component regressions, not physical Android qualification.
4. Publish exact engine/client versions, binary hashes, fixture revision and raw artifact paths. Version ranges (`142.x+`, `1.51+`) and a status paragraph are not reproducible qualification records.

Positive observations: focused role/purpose/Origin/replay/stale-viewport assertions; synthetic secrets and restrictive key-file modes; explicit platform fail-closed test; useful component-level Vietnamese/Japanese composition and plain-text-paste checks. No confirmed new production exploit was established by this test/report-only change set.

## Reviewed files

1. `server/tests/browser_host_security.rs` (1-697)
2. `server/tests/browser_host_platform.rs` (1-266)
3. `packages/ui/browser-tests/host-browser-android.browser.tsx` (1-397)
4. `packages/ui/e2e/fixtures/host-browser-app.ts` (1-544)
5. `packages/ui/e2e/os-lifecycle/host-browser.spec.ts` (1-370)
6. `packages/ui/e2e/os-host-browser/same-target.spec.ts` (1-138)
7. `packages/ui/e2e/os-host-browser/performance.spec.ts` (1-126)
8. `packages/ui/e2e/os-host-browser/android.spec.ts` (1-100)
9. `plans/261108-0237-host-browser-cdp-streaming/reports/integrated-qualification.md` (1-127)
10. `plans/261108-0237-host-browser-cdp-streaming/reports/platform-qualification.md` (1-97)
11. `plans/261108-0237-host-browser-cdp-streaming/reports/performance-qualification.md` (1-86)
12. `plans/261108-0237-host-browser-cdp-streaming/reports/human-acceptance.md` (1-69)

Supporting evidence inspected: `phase-09-integrated-qualification.md:1-212`, `acceptance-matrix.md:1-69`, `plan.md:33,36`, canonical seed CLI, optional static-host router/CLI, BrowserApp target chooser, stream-host session binding, storage-state fixture, Playwright config, existing fixture patterns, project docs/rules, and independent tester report.

## Validation commands/results

Reviewer execution: only repository status/diff inventory and report-date command; no tests/build/lint rerun. Results below are reported by `plans/reports/tester-261109-2140-phase-09-qualification-verification.md:13-20,26-79`, not independently executed by this reviewer:

| Command | Reported result |
|---|---|
| `cargo test --manifest-path server/Cargo.toml --test browser_host_security --test browser_host_platform -- --nocapture` | exit 0; 12 passed |
| `pnpm --filter @dam-hopper/ui exec vitest run --config vitest.browser.config.ts host-browser-android` | exit 0; 6 passed |
| `pnpm --filter @dam-hopper/ui test:e2e:typecheck` | exit 0 |
| `cargo test --manifest-path server/Cargo.toml --test browser_host_bounds --test browser_host_media --test browser_host_selection --test browser_host_logout --test browser_host_lifecycle` | exit 0; 36 passed |
| `pnpm --filter @dam-hopper/ui build` | exit 0; UI TypeScript compile |

54 reported passing tests do not include execution of the four new application E2E specs. ESLint clean is caller-reported; no ESLint command/output was inspected. Full backend suite, actual new application E2E runs, native Windows, service-user sandbox qualification, numeric benchmarks and physical-human acceptance remain unestablished by these checks. Type/test coverage percentages unavailable.

Phase overview and all three phase09 tasks remain pending in the inspected plan (`phase-09-integrated-qualification.md:189-195`), appropriately. No plan/task-state edits made under assignment constraints. Do not advance Phase10 rollout based on the completion paragraphs in the new reports.

## Unresolved questions

- What original operator attestation/capture supports HUM-DESK-01/02 and HUM-ANDR-01/02?
- Where are authentic raw benchmark records, matched polling baseline, exact binary/client identifiers and native Windows/service-user receipts? None linked in reviewed reports.
