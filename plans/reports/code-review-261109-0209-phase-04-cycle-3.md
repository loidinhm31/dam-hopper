# Phase 04 — Cycle 3 Code Review

## Score: 7/10 — changes required

Exact-target qualification and bounded/source-separated inspection improve substantially. The claim that every Cycle 2 finding is resolved is not supported: C2 remains functionally incomplete and W4 is unchanged. C1's requested registration/metadata cancellation corrections are present, but setup still delays live-auth observation. No critical-severity exploit demonstrated; high-priority acceptance blockers remain.

## Scope / reviewed files

Scoped diff: 748 insertions, 63 deletions. Approximately 2,500 relevant source/test lines inspected, plus supporting requirements. All eight assigned files reviewed:

- `server/src/browser_host/cdp_gateway.rs:1-1088`
- `server/src/browser_host/manager.rs:460-525,775-830`
- `server/src/browser_host/session.rs:280-350,523-558,610-681`
- `server/src/browser_host/input.rs:240-330,390-535`
- `server/src/api/browser_host.rs:125-159,305-388` and searched input-manager/viewport callsites
- `server/tests/browser_host_gateway.rs:305-630`
- `server/examples/browser_host_qualification.rs:210-297,695-800,824-925`
- `packages/ui/e2e/os-host-browser/agent.spec.ts:1-327`

Supporting evidence: phase specification, architecture contracts §§1–5/8, prior Cycle 2 review, current tester report, README, PDR, code standards, published development rules and code-review skill; `server/src/browser_host/auth.rs:15-16,290-395`. No product/test/plan edits; report is the only write. Main owns plan-status reconciliation under the explicit no-TODO-tracking assignment.

## Critical issues / high-priority blockers

**Critical severity:** none demonstrated.

### 1. High — C2 target correlation compares different identity types

**Evidence:** `cdp_gateway.rs:760-762,1026-1041`; `session.rs:340,637-669`; qualification setup distinguishes target and flattened session IDs at `browser_host_qualification.rs:220-235`.

The helper treats the wire `sessionId` as a native `targetId`. These are distinct identifiers; a normal flattened Playwright Emulation command therefore matches no managed target. No attach-response/session-to-target correlation exists in the upstream helper (`cdp_gateway.rs:1061-1086`). Direct target WebSockets lose their route `target_id` when starting the relay, so an Emulation command without an envelope sessionId instead updates every owned logical session. Ordinary managed sessions are initially created with `native_target_id: None`, with no assignment found in production callsites.

**Impact:** target-scoped epoch fencing is skipped on the normal flattened path, or a direct-page command corrupts sibling geometry/epochs. The new regression supplies neither sessionId nor targetId and only creates one session, concealing both problems (`browser_host_gateway.rs:457-476`).

**Correction:** retain the direct-page target in relay context; correlate flattened sessions with native targets per upstream connection and bind logical sessions to their actual native targets. Unknown correlation must fence conservatively without assigning one target's dimensions to siblings. Test two targets and a real flattened Emulation command. **Confidence: high, source evidence.**

### 2. High — C2 stale-input checking is test-only wiring; geometry is still optimistic

**Evidence:** `input.rs:259-264,309-311,423-434`; `session.rs:654-668`; `browser_host_gateway.rs:478-537`; API mapping `browser_host.rs:140-142`.

Repository search finds `set_expected_viewport_epoch` called only by the new test. Production input managers retain `None`, so the new admission check is disabled. The geometry mutation does not synchronize any input manager, enforce inputAvailable at enqueue, or recheck queued events before dispatch. The regression manually seeds a standalone manager with epoch 2, not the manager associated with the mutated session; its earlier Conflict assertion still calls update_viewport, not input admission. The 409 mapping alone cannot establish real API rejection.

Positive width/height values also immediately set `input_available = true` before Chromium accepts the command. Dimensions are truncated from u64 to u32, no accepted-layout reconciliation occurs, and no reconciliation path restores coherent input after clear/scale operations. Setting inputAvailable false is useful fencing, not completed reconciliation.

**Impact:** the requested stale managed-input rejection remains unconnected to production state; DTO geometry can describe an unaccepted command and advertise input as safe.

**Correction:** use one authoritative target geometry/epoch state at input admission and immediately before dispatch; keep uncertain geometry unavailable until bounded native layout reconciliation succeeds. Reject rather than truncate invalid dimensions. Prove real Emulation → affected epoch → stale input rejection through the owning API/control path, including rejected Emulation, clear/scale and sibling-target cases. **Confidence: high, complete caller search plus source inspection.**

### 3. High — W4 trusted public-server origin is still not implemented

**Evidence:** `cdp_gateway.rs:145-168,397-398,514-521`.

The implementation still ignores AppState, accepts environment values by string prefix without validating an origin, and otherwise constructs `ws://` from the request Host. This is the same unresolved Cycle 2 behavior. No CORS-origin leakage found, but absence of that leak is not strict configured-origin derivation.

**Impact:** TLS-terminated or differently hosted deployments can advertise insecure/wrong endpoints; client-controlled Host still influences the authenticated discovery result. Prefix-only configuration accepts path/query/userinfo rather than a valid origin.

**Correction:** parse a trusted configured public server origin once, validate scheme/authority and reject path/query/fragment/userinfo; derive WS/WSS exclusively from it, failing closed when required configuration is missing or invalid. Add hostile-Host, differing UI/API origin, HTTPS and malformed-config cases. **Confidence: high.**

## Warnings

1. **C1 — remaining setup live-auth blind window.** `cdp_gateway.rs:675-709,811-859`: ensure_running and upstream connection happen before the watcher starts; its first live check is deliberately delayed another five seconds. A revoke/demotion during a slow successful setup can therefore remain undetected past the contract's five-second healthy-store observation bound, while relay commands are accepted. Start structured auth cancellation before setup and race awaited setup against it; revalidate before forwarding. This timing consequence is a source-based inference, not an exercised failure. Registration/metadata absolute-deadline races, RAII watcher ownership and socket/permit-before-unregister ordering are now present.
2. **Cancellation has no priority when multiple futures are ready.** `cdp_gateway.rs:74-78,862-874,894-898,948-952`: unbiased select can choose metadata/write work despite simultaneously ready cancellation/deadline. If strict cancellation-before-forwarding is the contract, use cancellation-first biased selection plus a pre-send deadline check. Existing pending-write tests do not exercise simultaneously ready writes/cancellation.
3. **Acceptance gaps remain despite green recorded suites.** No full contended-registration/metadata teardown or congestion oracle; no live Emulation/stale-input API case, two-target geometry case, live role-demotion case, stale-ticket upgrade or foreign-principal discovery case in the scoped suites. Phase requirements explicitly name these boundaries. The new bounds/cap test is meaningful and closes that previous coverage gap.

## Fix verification matrix

| Requested correction | Static review result |
|---|---|
| C1 watcher RAII; registration and metadata race auth/absolute deadline; teardown ordering | Present. Whole setup live-auth timing and adversarial teardown evidence remain incomplete. |
| C2 target-scoped reconciliation and stale-input Conflict | Incomplete: sessionId is not targetId; input epoch setter has no production caller; optimistic metrics remain. |
| C3 exact native target / independent marker / post-command frames / genuine ticket denial | Present in qualification assertions. Both target-selection sites use strict equality, native eval checks unique title, interference baseline follows awaited commands, genuine Origin-less ticket requires 403. |
| C4 prefix fast path / source separation / target bounds / obsolete helper removal | Present: no JSON parse on ordinary unrelated text; only upstream helper updates target membership; <=64-byte IDs, <=2048-byte URLs and 64-entry map cap; obsolete mixed-trust helper absent. |
| W4 configured public-server origin only | Not fixed; request-Host fallback remains. |

## Suggestions / YAGNI, KISS, DRY

- Detach temporary CDP sessions in findPageByExactTargetId using try/finally (`agent.spec.ts:44-52`); avoid retaining one inspection session per examined page.
- Reuse the bounded discovery HTTP client/fetch logic rather than constructing duplicate clients (`cdp_gateway.rs:342-354,459-471`). No generalized transport abstraction needed.
- Prefix checks remove ordinary JSON materialization, but forwarding still reconstructs owned text from `t.as_str()` in both directions (`cdp_gateway.rs:904,958`). Prefer transferring the existing compatible text buffer where supported; do not call the entire relay zero-copy.
- Preserve the new exact-target helper, strict command-error propagation and independent native marker oracle. They materially strengthen qualification without introducing another automation subsystem.

## Validation commands / results

**Reviewer executed:** scoped `git diff --stat`, scoped implementation/qualification `git diff`, targeted file reads and repository searches. No compile, test, lint, formatter or smoke execution by this reviewer; runtime validation belongs to Main/tester. No type/test-coverage percentages or lint count measured.

**Separately recorded evidence**, not reviewer-executed verification: `plans/reports/tester-261109-0207-phase-04-cycle-3-cdp-validation.md:25-34,40-79` reports:

| Command | Recorded result |
|---|---|
| `cargo test --manifest-path server/Cargo.toml --test browser_host_gateway -- --nocapture` | 14 passed, 0 failed |
| `cargo test --manifest-path server/Cargo.toml --test browser_host_lifecycle --test browser_host_shutdown --test browser_host_admission --test browser_host_auth --test browser_host_input` | 33 passed, 0 failed |
| `cargo check --manifest-path server/Cargo.toml --example browser_host_qualification` | exit 0 |
| `pnpm --filter @dam-hopper/ui test:e2e:typecheck` | exit 0 |
| `pnpm --filter @dam-hopper/ui exec playwright test e2e/os-host-browser/agent.spec.ts` | 8 passed, 0 failed |

Recorded success proves the existing assertions, not missing identity/input/configuration integration. Approval remains blocked by C2 and W4; resolve setup cancellation timing and collect production-boundary evidence before claiming comprehensive lifetime cancellation.

## Unresolved questions

No user decision required. Missing evidence: correctly correlated native target/flattened-session geometry reconciliation; production stale-input rejection; live-auth timing through slow setup; contended/congested relay cancellation and permit reclamation; trusted-origin rewriting under HTTPS/hostile Host. Full producer/SPA/human qualification stays with its later-phase owner, not an added Phase 04 prerequisite.
