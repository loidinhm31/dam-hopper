# Phase 03 fresh code review

## Score: 2/10 — NOT APPROVED

Admin-role checks, ticket randomness/hash storage, atomic token removal and basic queue bounds exist. Core advertised behavior remains disconnected or synthetic; several security contracts fail closed only on paper. Phase 03 should be reopened. Prior 9.8/10 approval is not supported by current source.

## Scope

Reviewed requested files, approximately 5,800 lines including tests; concentrated on executable paths rather than repeating previous remediation review:

- `server/src/browser_host/{auth,session,network_policy,attachments,input}.rs`
- `server/src/api/{browser_host,mod,router}.rs`
- `server/tests/browser_host_{admission,auth,input}.rs`

Supporting evidence: `README.md:1-123`, `docs/project-overview-pdr.md:1-61`, `docs/code-standards.md:18-35`, plan overview, full Phase 03 specification, architecture contracts §§1–5/8–9/11, acceptance matrix A04/A08/A10/A16–A19; existing auth middleware/policy/service and repository-wide production call-site searches. Read installed `code-review` skill and required development workflow guidance.

Review concerns current Phase 03 implementation, including committed files, not just uncommitted diff. Scoped `git diff --stat` showed only API/browser_host.rs and router.rs currently modified. No product/test/plan changes made; only this assigned report written.

## Critical issues — MUST FIX

### F01 [Critical] Browser REST bypasses canonical authentication/MFA policy

**Evidence:** `api/router.rs:595-705,707-715`; `api/browser_host.rs:165-195`; `browser_host/auth.rs:165-240`. Compare existing `api/auth.rs:165-213` and `auth/policy.rs:111-169`.

Browser routes are not wrapped in `require_auth`. Their fallback decodes JWT and constructs an actor with JWT expiry as the effective deadline, without `AuthService::evaluate_claims`. Custom admission checks current enabled Admin plus selected versions, but omits periodic MFA freshness, auth protocol version, persisted expiry agreement and subject/session ownership checks. An otherwise valid Admin token past the 10-day MFA deadline can access Browser while ordinary protected APIs require MFA; tickets inherit the wrong deadline.

**Correction:** Reuse canonical request authentication/evaluate_claims, preserve `min(session expiry, MFA due)` in the admitted actor, then apply Browser-local current-role policy. Cover MFA-due, persisted-expiry mismatch and unsupported-version cases through the actual router. **Confidence: high; source-proven.**

### F02 [High] No-auth admission never checks actual listener; Origin is not strict

**Evidence:** `browser_host/auth.rs:105-156,158-175`; `attachments.rs:331-340`; `api/router.rs:595-705,726-734`.

Dev admission checks peer only; no actual bound-listener evidence is accepted or examined. A wildcard/LAN listener with a loopback peer therefore passes. Empty configured origins silently authorize common Vite origins; malformed Origin bytes are treated as absent, comparisons strip trailing slashes and ignore case. Production admission does not evaluate Origin at all. CORS only controls browser response visibility; it is not server-side Origin admission.

**Correction:** Carry verified listener address from bind into Browser admission, require listener AND peer loopback for dev, reject malformed/ambiguous Origin, require exact configured Origin on every Origin-bearing request/upgrade. Remove implicit Vite fallback. Keep contract-authorized Origin-less native cases explicit. **Confidence: high.**

### F03 [High] Native session/control operations are synthetic, including disabled-engine success

**Evidence:** `api/browser_host.rs:290-328`; `session.rs:313-345,393-419,446-450,482-485,510-549`; `api/browser_host.rs:733-743,896-917`. Repository production search found no native target/input command dispatch in these modules.

If ensure_running fails with no executable configured, create invents `test-incarnation` and returns a Running/inputAvailable session. Even with an engine, the registry only inserts metadata (`native_target_id: None`); create/delete/navigate/history/reload/resize never execute/reconcile native operations. Dialog returns handled without checking active dialog or sending a command. Find returns fixed zero matches; selected text only reads an application-populated cache. This does not satisfy Phase 03 real API/native-target A04/A08/A10 acceptance, independently of future SPA/producer work.

**Correction:** Delete production test fallback; fail unavailable/disabled closed. Bind logical sessions to real owned target handles, execute commands and reconcile ambiguous create outcomes under retained creation keys. Publish Running/inputAvailable only after actual readiness/qualified geometry. Implement real dialog/find/selected-text behavior; do not report fabricated success. **Confidence: high.**

### F04 [High] HTTP policy is not installed; dev policy is broader than explicit origins

**Evidence:** `network_policy.rs:125-143,146-168`; `session.rs:262,446,555-599`. Repository search finds validate_navigation_url production calls only in create/navigate, no Fetch/Network interception or popup-handler caller.

Redirects, subresources and browser-initiated requests never pass policy. Popup helper neither validates URL nor closes a native overflow target, and has no production caller. Dev admits every localhost/127.0.0.1/::1 port, not explicit target+asset origins. IP deny helper also misses IPv4-mapped private IPv6 and unspecified destinations. These are HTTP policy failures, not a demand to sandbox documented raw-CDP/DNS/WebRTC bypasses.

**Correction:** Install owned-target HTTP interception before untrusted navigation, apply shared parsed policy to request/redirect/subresource/popup paths, close native overflow popups, enforce explicit dev origins and normalize IP address forms. Add real redirect/asset/popup tests. **Confidence: high.**

### F05 [High] Tickets record caller claims, not validated target authority; consume lacks live revalidation

**Evidence:** `api/browser_host.rs:979-985`; `attachments.rs:191-208,246-260,293-355,359-447`; test `browser_host_auth.rs:150-189` deliberately issues a ticket for nonexistent IDs.

Issuance copies request session/incarnation/profileEpoch/viewer/subscription without checking owned live target/current manager identity or canonical UUIDs. Consume checks hash/TTL/purpose/optional Origin only; register also accepts the metadata unchanged. No live role/session or current profile/incarnation validation occurs. A ticket minted before demotion/reset/target retirement can still be admitted by these primitives. Origin-less-issued tickets do not reject a later Origin-bearing consume. Revoke-by-browser-session removes active connections but not outstanding tickets (`attachments.rs:503-513`).

**Correction:** Resolve/validate identity server-side at mint and again immediately after atomic consume/before upgrade. Enforce exact Origin and native-client transport rules; invalidate tickets on target retirement/reset/session revoke and fence consume-to-register races. Atomic removal itself is correct and should be retained. **Confidence: high.**

### F06 [High] Pairing ignores principal/login/target; deadlines/caps not actively enforced

**Evidence:** `attachments.rs:149-163,365-425,450-459`.

Pair key is only `(viewerId, subscriptionEpoch)`; slot holds no principal/auth session/target/incarnation/profile identity. Media for one identity and control for another can be accepted as a pair. No global two-viewer admission cap or input-readiness check exists. Expiry only runs during another register: unmatched socket can survive indefinitely without further registrations. Conversely pruning cancels even a complete healthy pair after 30 seconds when a later registration occurs, because creation TTL is unconditional.

**Correction:** Reserve bounded pairs with the full immutable authority/target tuple, admit each purpose once, expose paired readiness, actively time out unmatched reservations/first sockets, never age-expire healthy complete pairs. **Confidence: high.**

### F07 [Critical] Live-auth supervisor is unwired and lacks absolute deadline guarantees

**Evidence:** `attachments.rs:515-559`; `auth.rs:296-340,355-371`. Repository-wide searches found no production call to start_supervisor or revoke_by_auth_session; register_connection is only exercised by tests.

No active attachment background auth enforcement is started. Even when manually started, checks are sequential per connection, with each DB operation allowed two seconds; later sockets can exceed the required 5s+2s bound. There is no independent absolute-deadline timer or shutdown select. Missing persisted session is accepted: `(Some(user), None)` reaches success despite a captured session ID. Missing store/mock backend also falls through to success in verify_live_admission. Targeted login revoke has no production hook and no held-input cleanup.

**Correction:** Start the real manager supervisor under server lifetime; use bounded concurrent/distinct-login checks, independent per-attachment auth deadline cancellation, explicit shutdown cancellation, and fail closed on missing session/backend. Integrate real login revoke with matching tickets/attachments/held input, preserving sibling login/profile. Qualify blocked-writer cancellation timing. **Confidence: high.**

### F08 [High] Input identity/epochs/geometry are carried but never validated

**Evidence:** `input.rs:105-116,234-241,395-417,482-498`; `session.rs:326-340`; `input.rs:171-187`. Production searches find no enqueue consumer/dispatcher or map_fraction_to_css_coords caller outside tests.

SessionInputManager has no captured session/incarnation/profile/subscription/viewport/target authority. enqueue validates lease token/expiry and sequence only: foreign/stale metadata, invalid coordinates and unqualified geometry are accepted. Coalescing changes event/sequence while retaining previous message identity. Sessions advertise inputAvailable with guessed viewport geometry. Mapping checks fractions and positive dimensions, but not finite/capped geometry or qualified zoom state; NaN/Infinity dimensions can reach output.

**Correction:** Bind the input channel to the admitted pair and original native target; validate every envelope/epoch against current authoritative state before queueing and again before native dispatch. Reconcile geometry/advance epoch before accepting changed geometry; uncertain/nonunit-unqualified geometry must disable input. Preserve the qualified CSS mapping without adding scroll/DPR twice. **Confidence: high.**

### F09 [Critical] Cleanup discards release events; queued keyUp can erase required cleanup

**Evidence:** `input.rs:354-388,428-449,452-478`; `api/browser_host.rs:387-391,696-699,1026-1029`; `browser_host_input.rs:447-507`.

Gap/overflow call revoke_lease then discard generated releases. REST release/delete discard them too. No native release dispatcher exists. Held state is updated at enqueue, not successful dispatch: after a real keyDown, a queued keyUp removes the held key; cancelling/draining before keyUp dispatch loses the only needed release. Lease expiry merely returns LeaseExpired, without cleanup; reacquisition overwrites state/sequence without draining old queue. Keys track logical key only, lose physical code (ShiftLeft/ShiftRight collapse), and synthesized mouse release is always at image center.

**Correction:** Track actually dispatched physical keys/buttons/modifiers and last native pointer coordinates under original-target ownership. Cleanup must synchronously initiate independently cancellable native releases before final revocation; failure marks input unavailable. Keep queued-but-undispatched state separate. Test native releases on overflow/gap/expiry/disconnect and zero releases to replacement target. Current saturation test only observes missing lease and ignores releases, so its name overstates coverage. **Confidence: high.**

### F10 [High] Input state transitions race; overflow can deadlock concurrent lease acquire

**Evidence:** `input.rs:269-294,395-448`.

Lease validation and queue/sequence mutation are separate critical sections; release/reacquire can occur between them and old input can enter a new lease. Concrete lock cycle: enqueue passes lease validation and holds last_processed_seq; acquire locks lease then waits for sequence reset; enqueue overflows and calls revoke_lease, waiting for lease while still holding sequence. Both operations block permanently. Declaring lock order queue→bytes alone does not prove deadlock freedom.

**Correction:** Serialize lease/sequence/queue/held-state transitions under one bounded owner/state lock or actor, without reentrant cleanup locking. Add deterministic concurrent acquire/overflow/revoke coverage. **Confidence: high; source-derived schedule, not runtime-reproduced.**

### F11 [High] Decimal-counter wire contract incompatible with request DTOs

**Evidence:** `input.rs:107-114`; `attachments.rs:83-90`; `api/browser_host.rs:400-402,447-450,489-491,525-530,992-995`; `session.rs:448,483,510,544`; `input.rs:421`.

Requests deserialize counter fields as JSON numeric u64, while responses correctly emit strings. Contract-compliant `"1"` inputs fail decoding; large client counters cannot safely traverse JS numbers. Zero is accepted. Registry counters saturate at u64::MAX instead of closing identity; input expected+1 overflows at maximum. Duplicate sequence check ignores any changed payload with the same sequence (`input.rs:423-425`; test `browser_host_input.rs:434-436` even encodes this behavior), contrary to exact-duplicate contract.

**Correction:** Reuse strict canonical positive-decimal u64 serialization/deserialization for all counters, checked increments with explicit identity exhaustion, and exact duplicate comparison/defined processed acknowledgement. Test >2^53, leading zeros, zero, max and conflicting duplicates. **Confidence: high.**

### F12 [High] Exposed reset mutates resources before validating intent; status is fabricated

**Evidence:** `api/browser_host.rs:1018-1057,1081-1092`.

Before manager validates operation ID/expected epoch/durable reset intent, route cancels attachments, closes principal sessions and clears ALL principals' input managers. A stale/malformed reset can therefore fail after destroying live state; concurrent admissions are not gated by this API cleanup. Status endpoint never looks up operationId: echoes any supplied ID and infers completed from capability availability, which is unrelated to that operation's outcome.

**Correction:** Validate/reset under principal-owned durable intent before cleanup, fence new admissions, remove/release only affected principal inputs, expose real owned operation lookup. Missing confirmation must follow contract conflict response. Full logout/artifact integration belongs to Phase 08, but currently exposed reset routes must not destructively fail or fabricate results. **Confidence: high.**

## Warnings — SHOULD FIX

1. **Unbounded retained registries / ticket-cap liveness.** Closed sessions are never removed (`session.rs:393-419,615-628`); create-record outer principal maps persist. Repeated create/delete grows memory despite active-target cap. Global input maps allocate before checking target existence on viewport (`api/browser_host.rs:553-567`). Ticket global-count check happens before pruning/under a different synchronization boundary (`attachments.rs:210-215,263-281`): reaching 64 outstanding tickets can block future mint forever after expiry, while concurrent mints can pass the global precheck. Enforce live bounds/prune inside the same lock, retain bounded retry tombstones only through TTL. **High confidence.**
2. **Wheel coalescing drops motion; barriers not robust.** Adjacent wheel events replace rather than accumulate deltas (`input.rs:482-490`); different modifier states also coalesce, and capacity is checked before a replacement that would not increase queue length. Sum validated finite deltas within bounds, preserve modifier/epoch/lease barriers, evaluate resulting queue size. **High confidence.**
3. **UTF-8 truncation panics.** `input.rs:502-505` and `session.rs:607-609` call String::truncate at fixed byte offsets; multibyte text crossing 64KiB/512 bytes panics. Trim at a preceding char boundary without first cloning the full unbounded input. **High confidence.**
4. **Reliable-byte accounting omits envelope allocations.** `input.rs:91-101,441-496` charges only event estimate, not identity strings/envelope retained by InputMessage; also clones msg/event for queue and return. Bound/canonicalize identities and charge the admitted record representation, avoid unnecessary copies. **High confidence.**
5. **Expired/stale selected-text cache and split lease authority.** get_selected_text checks token but not expiry (`input.rs:510-517`); history/reload do not invalidate selected text (`api/browser_host.rs:473-519`), and acquire/renew never update BrowserSession.lease while DTO reads it (`session.rs:169,177-184`). Use one lease authority; bind selected text to current navigation and active lease. **High confidence.**
6. **REST envelope/no-store/limits incomplete.** Browser router allows 64KiB bodies (`api/router.rs:705`) instead of 16KiB contract; custom no-store wraps successful handler responses only, not Json/body-limit rejection. Add route-level no-store/error mapping and exact body bounds, retaining explicit CORS origins/credentials. **High confidence.**
7. **Test coverage does not establish declared completion.** Admission tests use mock auth and synthetic create; auth tests directly call manager and swap static mock service rather than running independent supervisor/blocked writer/DB timeout; input tests never dispatch native input and do not assert actual release events. No negative epoch/pair ownership/canonical counter/race coverage. Replace false-success proof with real API/native-target assertions and deterministic concurrency/auth cancellation tests. Existing real-engine phase01 geometry is not evidence that these Phase03 routes invoke it. **High confidence.**

## Suggestions — NICE TO HAVE

- Move globals into AppState/browser_host lifetime once fixing authority/supervision; avoids process-static cross-AppState leakage and makes shutdown/test isolation explicit. Do not introduce another manager convention.
- After behavior is real, consolidate repeated handler admission/error plumbing and share the existing test-state builder rather than three near-identical large copies. Keep typed errors and simple domain APIs.

## Positive observations

- Production checks current enabled Admin rather than trusting UI/JWT role.
- Tickets use OsRng 32-byte secrets, store SHA-256 only, atomically remove before purpose/Origin validation; replay/purpose-swap invalidation structure is sound.
- Owned session get returns indistinguishable not-found; same create key/payload retry is retained, capacity rejects rather than evicts live retry records.
- Explicit credentialed CORS origins retained; X-Browser-Lease added explicitly, no wildcard introduced.
- Coordinate helper correctly avoids adding scroll offsets or multiplying DPR again for its normal mapping.

## Phase acceptance disposition

| Task | Coverage inspected | Result |
|---|---|---|
| authorize-browser-sessions | Role/Origin/listener, idempotency, REST/native behavior, network/popups | Incomplete: F01–F04, F11–F12 |
| bind-browser-attachments | Purpose/hash/atomic consume, identity/pairing, supervisor/revoke | Incomplete: F02, F05–F07 |
| dispatch-leased-input | Lease/sequence/queue/coordinates/held-state/releases | Incomplete: F03, F08–F11 |

Plan markers/status intentionally unchanged: read-only review assignment. Main/integration owner should reopen affected tasks and dependent gates. This review does not require future Phase05 media ACK implementation or Phase06/07 SPA integration to already exist; it requires Phase03's own declared native/admission/cancellation contracts and observable early acceptance.

## Validation commands and verified results

**Executed:** scoped `git diff --stat -- <11 requested paths>`: exit 0; 2 paths changed, 41 insertions/1 deletion. Read/grep searches above verified current source relationships and absence of production callers, not runtime behavior.

**Not executed here:** builds, tests, linters, runtime smokes. Single integration-owner/tester verification retained; no duplicate Cargo work or product/test edits. No fresh runtime pass claimed. Previous report's passing suites are historical, not evidence of currently absent behaviors.

Recommended owner commands after fixes:

```sh
cargo test --manifest-path server/Cargo.toml --test browser_host_admission --test browser_host_auth --test browser_host_input
cargo test --manifest-path server/Cargo.toml --test auth_no_auth --test auth_device_sessions
cargo clippy --manifest-path server/Cargo.toml --test browser_host_admission --test browser_host_auth --test browser_host_input
```

Also run actual owned-browser API/native navigation/history/reload/redirect/subresource/popup tests and original-target release/blocked-writer auth deadline tests; the listed existing suites alone cannot establish acceptance. Type coverage/test coverage percentages unavailable; Rust type safety does not verify identity semantics.

## Unresolved questions

- None requiring user decisions. Runtime timing, real-browser behavior and revised acceptance remain unverified until integration owner supplies fresh evidence.
