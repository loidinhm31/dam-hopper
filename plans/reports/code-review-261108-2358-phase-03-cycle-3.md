# Phase 03 — Cycle 3 code review

## 1. Score: 4.5/10 — NOT APPROVED

Requested duplicate-Origin, exact ticket-Origin and missing-live-backend/session fixes are present. They close specific Cycle 2 defects, not Phase 03 acceptance. Native session/input implementation, cancellation guarantees and other previously identified blockers remain incomplete.

## 2. Reviewed files

All 11 assigned paths inspected; approximately 5,000 relevant source/test lines:
- `server/src/browser_host/auth.rs`
- `server/src/browser_host/session.rs`
- `server/src/browser_host/network_policy.rs`
- `server/src/browser_host/attachments.rs`
- `server/src/browser_host/input.rs`
- `server/src/api/browser_host.rs`
- `server/src/api/mod.rs`
- `server/src/api/router.rs`
- `server/tests/browser_host_admission.rs`
- `server/tests/browser_host_auth.rs`
- `server/tests/browser_host_input.rs`

Supporting evidence: `phase-03-admission-control.md`, overview, architecture contracts, previous Cycle 2 report; README, PDR, code standards; browser config/manager and auth-revocation callsites. Published `code-review/SKILL.md` read directly. Report-only review; product code, tests and plan/task state unchanged.

### Requested fix assessment

| Fix | Source assessment |
| --- | --- |
| Reject repeated Origin with 403 `originForbidden` | Present in dev and production: `auth.rs:130–132,162–164`. Other Origin failures remain C1. |
| Exact ticket-consumption Origin | Present: `attachments.rs:331–338` compares unchanged strings. Originless-issued tickets still skip the comparison entirely. |
| Missing persisted login → `SessionRevoked` | Present: `auth.rs:358–362`. |
| Missing auth backend → `StorageUnavailable` | Present: `auth.rs:392–395`. |
| Additional finite-geometry validation | Present: `input.rs:180–186`. |

Positive: atomic ticket removal precedes validation; failed purpose/Origin consumes capability; stored tickets are hashed; foreign session reads return indistinguishable 404; canonical REST claim evaluation retains MFA deadline/current role; explicit credentialed CORS includes `X-Browser-Lease` without wildcard origins.

## 3. Critical issues — MUST FIX

Release blockers below have **High** severity and high source confidence. Impact scenarios are **[INFERENCE]**, not executed reproductions. Most carry forward from Cycle 2; fixing the requested three cases does not close them.

### C1 — Origin admission still fails open for malformed/unconfigured origins
- Evidence: `auth.rs:133,165` converts an invalid header to `None`, treating a present non-text Origin as absent. `165–175` accepts arbitrary ordinary Origin values when `cors_origins` is empty. Dev invents fallback origins (`139–147`) rather than requiring configured authority. `attachments.rs:331–339` does not constrain actual Origin when ticket was issued without one.
- Impact: strict approved-Origin invariant remains bypassable at shared admission/ticket boundaries. CORS response visibility is not authorization.
- Correction: distinguish absent from invalid; exact approved-byte matching, fail closed on missing approved configuration. Preserve Origin presence/absence in capability binding; originless capability-only upgrade must not become an implicit wildcard. Add invalid-byte, empty-config and originless-issued-ticket regressions. Raw gateway's separate Origin check does not repair shared REST/ticket policy.

### C2 — Shared supervisor does not meet independent cancellation/deadline contract
- Evidence: `attachments.rs:523–556` serially awaits every connection's live check; each can take two seconds (`auth.rs:315–324`). Effective deadlines are checked on the five-second sweep, not an absolute per-connection timer (`auth.rs:306–313`). Real device-session revoke/logout clear old media tickets only (`api/auth_sessions.rs:123–128`, `api/auth.rs:618–623`); source callsite search found no production caller of Browser `revoke_by_auth_session`.
- Impact: four stalled checks can delay the last cancellation beyond seven seconds; expiry waits for a sweep; Browser tickets/held input lack targeted immediate invalidation. A separate raw-gateway watcher does not satisfy shared media/control primitives.
- Correction: independent absolute timer; bounded concurrent/deduplicated persisted checks; connect actual logout/revoke to exact login attachments/tickets/input. Preserve sibling login resources. Prove cancellation with blocked writers and timed-out storage.

### C3 — Tickets bind untrusted identity assertions instead of current owned sessions
- Evidence: `api/browser_host.rs:989–1016` forwards request identity unchanged after account admission. `attachments.rs:191–207` checks only field presence; no ownership/current epoch/incarnation/UUID validation. REST test explicitly blesses nonexistent `sess-uuid-1`/`inc-1` (`browser_host_auth.rs:150–188`).
- Impact: media/control capabilities can claim foreign/nonexistent/stale targets; expanded pair key alone does not authorize targets. Phase 04 agent-ticket running-instance comparison does not cover this media/control issuance contract.
- Correction: resolve owned current session/instance before minting; derive or compare authoritative identity; validate canonical UUIDs/counters; consumers revalidate before upgrade. Replace arbitrary-identity success expectation with current-owned/foreign/stale cases.

### C4 — Required native operations still return success without native effects
- Evidence: `api/browser_host.rs:328–330` fabricates `test-incarnation` after manager failure whenever executable is unset, including disabled configuration. `session.rs:326–345` creates a running/input-available session with no native target. Create/delete/navigation/history/reload/viewport only mutate registry state (`313–367,393–549`). Source searches found no production caller of popup handler, native-target reconciliation, input queue consumers, or Fetch request interception.
- `api/browser_host.rs:773,813,846,939–946` reports handled/selection/find results without native work; artifact response at `882–890` invents an unpersisted ID. Selection artifact implementation belongs to Phase 08, but its current endpoint must not claim completed work.
- `network_policy.rs` is only called by registry create/navigate; redirects/subresources are not intercepted. Development allows every localhost/loopback port (`132–143`), and API passes CORS origins rather than configured target/asset policy (`api/browser_host.rs:348,462`).
- Impact: disabled/missing engine yields created/running sessions; navigation/find/control requests appear successful without browser changes; HTTP policy and popup bounds are not operational.
- Correction: remove synthetic production fallback; connect Phase 03 target/session/control operations/events and Fetch policy to owned native actor. Out-of-phase unimplemented endpoints must fail unavailable, not fabricate success. Require real-target observations for Phase 03 acceptance, without pulling Phase 05 streaming/Phase 08 artifacts forward.

### C5 — Input authority and release guarantees are absent
- Evidence: `input.rs:399–411` checks lease token/expiry only, never authoritative session/incarnation/profile/subscription/viewport. DTO counters are JSON `u64`, not canonical decimal strings (`105–115`; REST revision/epoch DTOs likewise numeric). Gap/overflow throw away release events (`435,452`); REST release/delete throw them away too (`api/browser_host.rs:419–420,727–729`). No native dispatcher consumes queued input/releases. Expired lease merely returns an error.
- Impact: stale/replacement-target fences and no-stuck-key acceptance cannot hold. Existing saturation test checks lease disappearance, not original-target release (`browser_host_input.rs:499–507`).
- Correction: capture immutable owned target/subscription context; serialize identity validation, dispatch and cleanup; deliver releases independently of media writers, fail input unavailable if release fails. Decode canonical positive decimal counter strings and handle exhaustion without wrap/saturation. Assert original-target releases and zero replacement-target effects.

### C6 — Input locking can deadlock acquisition against overflow
- Evidence: acquisition holds `lease` then awaits `last_processed_seq` (`input.rs:273–298`). Overflow holds `last_processed_seq` then awaits `revoke_lease`, which needs `lease` (`424–452,384–385`). Enqueue also releases lease validation before later mutations.
- Impact: same-viewer reacquisition or expired-lease acquisition concurrent with overflow can deadlock; old-lease work can race replacement.
- Correction: one serialized state transition/actor or consistent lock ordering; never reacquire lease while holding sequence lock. Add deterministic concurrent acquisition/overflow/revoke coverage.

### C7 — Dev admission never verifies actual bound listener
- Evidence: `auth.rs:113–158` checks `no_auth`, peer and Origin only. Neither argument nor admission state carries actual bound-listener authority; inspected `AppState`/browser config contains no listener receipt.
- Impact: loopback client/proxy can receive Browser no-auth privileges while server is externally bound, contrary to required listener AND peer loopback conjunction.
- Correction: propagate verified `listener.local_addr()` authority to admission; reject dev Browser access unless both listener and peer loopback. Do not substitute Host/forwarded headers. Add mixed-listener/peer regression.

### C8 — Reset invalidates resources before validating durable reset intent; clears other principals' input
- Evidence: `api/browser_host.rs:1056–1067` revokes attachments/closes sessions and globally clears input managers before manager validates expected epoch (`manager.rs:471–479`) and persists reset intent. The clear is not principal-scoped. Status route reports completion from capability availability rather than requested operation record (`api/browser_host.rs:1111–1122`).
- Impact: rejected stale reset still closes active resources; one principal's reset removes another principal's input state; arbitrary operation IDs can receive misleading completion status.
- Correction: validate/reset-intent commit under principal lock before effects, then cancel only that principal's exact resources with release cleanup. Query actual owned operation state; unknown operation must not infer completion from capability. Add stale-epoch/no-side-effect, unrelated-principal and unknown-operation cases.

## 4. Warnings — SHOULD FIX

1. **Ticket-cap race/stale saturation:** global check precedes lock/pruning (`attachments.rs:210–215,263–281`). Concurrent principals can exceed 64; reaching 64 then expiry can leave issuance permanently rejected before pruning. Perform prune/count/check/insert atomically under ticket lock.
2. **Pair timeout/cleanup incomplete:** timeout pruning runs only on another registration (`attachments.rs:374–388`); lonely socket need not close at 15s. Revocation removes connection records without pair slots (`465–511`), preventing unregister cleanup; fully connected slots never TTL-expire. Schedule timeout and remove exact pairs on all retirement paths; protect replacement slot from late old unregister.
3. **Unbounded stale state:** closed sessions retained forever (`session.rs:411–419`); TTL pruning only removes creation records. Arbitrary viewport session IDs allocate input managers before owner lookup (`api/browser_host.rs:583–590`). Bound/reap retired sessions; verify ownership before allocation.
4. **UTF-8 panic:** byte truncation at `session.rs:607–609` and `input.rs:507–509` can split a code point. Truncate at a valid character boundary within byte cap.
5. **Lease transition/read consistency:** selected-text read ignores expiry (`input.rs:515–521`). Acquisition replaces same-viewer lease without clearing held state/old queue (`276–298`); initial lease not clipped to auth deadline. Apply common expiry/retirement logic and update session lease summary from actual lease authority.
6. **Regression proof missing:** the three assigned test files have no changed hunks in scoped diff. Tests do not cover requested repeated-Origin, exact case/slash ticket Origin, deleted persisted session or absent-backend fixes; no timed blocked-writer/supervisor test. Mock role-swap helper test (`browser_host_auth.rs:379–408`) is not supervisor proof. Existing queue test even accepts different payload at same inputSeq as duplicate (`browser_host_input.rs:432–436`). Add meaningful negative and lifecycle regressions, not only status assertions.

## 5. Suggestions — NICE TO HAVE

- AppState-own registries/supervisor rather than static process-global resources. First-router-only guard (`attachments.rs:515–519`) captures one state/runtime indefinitely, problematic for separately built routers/tests.
- Replace reason substring classification (`api/browser_host.rs:207`) with typed canonical auth failure categories when shared API permits.
- Keep shared Origin/auth policy single-source; separate API/native behavior only after correctness fixes, not another parallel convention.

## 6. Validation commands and verified results

**Executed:** scoped `git diff --stat -- <11 assigned paths>` and `git diff -- <changed phase paths>` — exit 0. Five modified files: auth, attachments, input, API browser host, router; 140 insertions/39 deletions at inspection. Targeted reads/callsite searches confirm requested fix branches and remaining integration gaps. No literal TODO/todo!/unimplemented! found in assigned source/test search; this does not establish feature completion.

**Not executed:** Cargo/build/tests/lint/formatter/smoke. Shared Cycle 3 validation belongs to main/test owner; no competing verification run started. No test pass count, coverage percentage, compile result or lint-clean claim supplied by this review. Prior plan pass counts are historical only.

Single-owner validation commands:
```sh
cargo check --manifest-path server/Cargo.toml
cargo test --manifest-path server/Cargo.toml --test browser_host_admission --test browser_host_auth --test browser_host_input -- --nocapture
cargo test --manifest-path server/Cargo.toml --test auth_no_auth --test auth_device_sessions -- --nocapture
```
Existing suites alone cannot close C1–C8. Add the targeted regressions above and real owned-target/navigation/policy/input-release evidence. Full producer/SPA/human/device qualification remains later-phase scope.

### Completeness/disposition

`phase-03-admission-control.md:189–195` marks all three tasks complete and requires observed acceptance. Source does not satisfy session-native behavior, live cancellation or ordered-input safety; do not retain full-phase approval solely from the narrow fixes. Main owner should reopen affected acceptance and reconcile stale DONE/9.8 claims in phase/overview. No plan mutation performed under report-only assignment.

## 7. Unresolved questions

No product decision required. Fresh Cycle 3 integration results, negative security regressions and real native-target/timing/release evidence remain unverified by this reviewer.
