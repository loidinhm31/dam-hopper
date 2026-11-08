# Phase 03 — Cycle 2 code review

## Score: 4/10 — NOT APPROVED

Canonical REST claim evaluation, expanded pair key and router supervisor startup are present. Origin enforcement and live cancellation remain incomplete; Phase 03 still reports successful operations without native effects. Source review only; no runtime success claimed.

## Reviewed files

All 11 assigned paths inspected (roughly 5,000 relevant source/test lines):
- `server/src/browser_host/{auth,session,network_policy,attachments,input}.rs`
- `server/src/api/{browser_host,mod,router}.rs`
- `server/tests/{browser_host_admission,browser_host_auth,browser_host_input}.rs`

Supporting evidence: phase specification, overview, architecture contracts; `README.md`, PDR, code standards; canonical auth service/policy; listener startup, state and session-revocation wiring. Loaded published `code-review/SKILL.md` directly. No product/test/plan-state edits; report only.

## Requested remediation assessment

| Item | Assessment / evidence |
| --- | --- |
| Canonical `evaluate_claims`, MFA, actual role | **Resolved for REST token/cookie path by inspection.** `api/browser_host.rs:182–224` evaluates canonical decisions, computes MFA deadline, uses persisted role, maps disabled account to 403. Canonical policy checks identity/version/revocation/expiry/MFA (`auth/policy.rs:104–169`). Negative MFA integration proof missing. |
| Exact Origin, unapproved →403 | **Partial.** `browser_host/auth.rs:129–169` exact-compares one parsed header; ordinary foreign Origin with nonempty allowlist maps to 403. Duplicate/invalid headers, empty allowlist and ticket-consume normalization remain unsafe (C1). |
| Principal + target-session pair key | **Resolved key expansion by inspection.** `attachments.rs:367–371,454–457` consistently uses `(principal,browserSessionId,viewerId,subscriptionEpoch)`; unregister order corrected. Ticket issuance does not establish that submitted target identity is current/owned (C4). |
| Supervisor initialized; healthy pairs retained | **Present, incomplete safety.** Router starts supervisor (`router.rs:595`); healthy connected pairs survive TTL pruning (`attachments.rs:375–388`). Deadline/revocation guarantees and pair cleanup remain incomplete (C2/C3/W2). |

## Critical issues — MUST FIX

All findings below high-confidence source findings; impact scenarios are **[INFERENCE]**, not executed reproductions. “Critical issues” means release blockers; individual severity shown.

### C1 — High: Origin policy still not exact/fail-closed end-to-end
- `browser_host/auth.rs:130,159` uses `headers.get(...).and_then(to_str().ok())`: a second Origin is ignored; non-text Origin is treated as absent.
- `auth.rs:163–164` accepts every syntactically ordinary Origin when `cors_origins` is empty. Dev also invents fallback origins (`137–138`) instead of requiring configuration.
- `attachments.rs:331–339` still strips trailing `/` and compares case-insensitively; a ticket issued without Origin has no Origin restriction at all.
- **Impact:** the stated strict-Origin fix does not cover capability admission; malformed/multiple/unconfigured origins can pass these primitives. CORS response visibility is not an authorization fence.
- **Correction:** one shared check over `get_all(ORIGIN)`, reject invalid/non-single values, byte-for-byte approved-origin match, fail closed without an approved origin. Ticket consume must preserve exact expected-Origin semantics; originless capability rules must be explicit, not implicit wildcard.

### C2 — High: deleted persisted login passes live authentication
- `browser_host/auth.rs:309–316` can return `(Some(user), None)` when a required auth session disappears. `321–352` checks session only under `if let Some(session)`; missing session returns success. No backend also falls through to success (`368–384`).
- **Impact:** already attached sockets can survive deletion of their persisted login until the captured deadline, despite a healthy store.
- **Correction:** require the bound login to exist and belong to the principal; reject absent backend, changed expiry/MFA/version and identity mismatch. Reuse canonical session policy where possible. Add deleted-session live-check regression.

### C3 — High: supervisor startup does not satisfy cancellation timing contract
- `attachments.rs:520–557` checks every connection serially, each potentially consuming the two-second lookup timeout. Four stalled checks can defer the last cancellation beyond seven seconds.
- Absolute auth deadlines are checked only by the five-second sweep (`auth.rs:300–307`); no independently scheduled deadline timer in connection registration/supervisor.
- `attachments.rs:466–483` has no production caller in `server/src`; actual session revoke only clears old media tickets (`api/auth_sessions.rs:123–128`). Browser held input is not connected to that revocation path.
- **Impact:** auth expiry is not immediate; DB trouble scales cancellation latency with sockets; targeted revoke does not synchronously clear Browser tickets/input.
- **Correction:** independent per-admission absolute timer; bounded concurrent/deduplicated persisted checks; wire targeted cancellation/held-state cleanup to real revoke/logout, preserving sibling logins. Prove timing with blocked writers and DB timeout.

### C4 — High: attachment tickets bind client assertions, not current owned target identity
- `api/browser_host.rs:989–1016` authenticates caller then forwards the body unchanged; no session ownership, current incarnation or profile-epoch lookup. `attachments.rs:191–207` validates only `Option` presence, accepting empty/non-UUID identities.
- Existing REST test explicitly expects issuance for nonexistent `sess-uuid-1` / `inc-1` (`tests/browser_host_auth.rs:150–188`).
- **Impact:** successfully minted media/control capabilities can refer to foreign/nonexistent/stale targets; pair-key expansion alone is not target authorization.
- **Correction:** resolve current owned logical session/instance before minting; derive or compare epoch/incarnation, require valid nonempty canonical identifiers; consumers must revalidate current identity and live admission before upgrade. Tests should reject foreign/stale identity rather than bless arbitrary values.

### C5 — High: Phase 03 native session/control behavior remains unimplemented behind success responses
- `api/browser_host.rs:328–330` fabricates `test-incarnation` after *any* manager failure whenever no executable is configured, including disabled capability.
- `session.rs:326–345` marks session running/input-available with `native_target_id: None`; create/navigate/history/reload/viewport/delete mutate only registry state (`313–367,422–549`). No production native-target/popup/input-queue consumer found by callsite search.
- `api/browser_host.rs:773,813,846,939–946` returns handled/selection/find success without native work. Artifact UUID response (`882–890`) is not persisted; artifact implementation belongs to Phase 08, so that endpoint must not claim success now.
- Network policy is a URL helper, not installed Fetch/Network redirect/subresource interception; popup handler is uncalled. Dev policy additionally permits every localhost/loopback port (`network_policy.rs:132–143`), contrary to explicit target+asset allowlists.
- **Impact:** phase DONE/acceptance claims overstate end-to-end behavior; disabled/missing engine can still yield created/running sessions.
- **Correction:** remove production synthetic fallback; connect required Phase 03 native operations/events/policy to the owned actor. Out-of-phase unimplemented endpoints must fail unavailable, not fabricate success. Reopen affected acceptance until real-target evidence exists.

### C6 — High: input revocation loses release actions and omits identity fences
- `input.rs:399–411` validates lease token/expiry only; never checks session/incarnation/profile/subscription/viewport against authoritative captured target context. Counter DTOs are JSON `u64` (`105–115`), not required canonical decimal strings.
- Gap and overflow discard `revoke_lease()` release events (`435,452`); REST release discards them too (`api/browser_host.rs:727–729`). Expired lease rejection does not release held native input. No production dispatcher consumes them.
- **Impact:** cannot prove stale/replacement-target safety or no stuck keys; tests currently prove only local lease removal (`tests/browser_host_input.rs:505–507`).
- **Correction:** capture immutable target/subscription authority; serialize validation, dispatch and cleanup against it; deliver releases independently of writer queues and fail input closed on release failure. Use canonical string counter decoders. Assert actual original-target releases and no replacement-target effects.

### C7 — High: input lock inversion can deadlock lease acquisition against overflow
- `input.rs:273–298`: acquisition holds `lease`, then waits on `last_processed_seq`.
- `424–452`: overflow holds `last_processed_seq`, then awaits `revoke_lease`, which locks `lease` (`385`).
- **Impact:** concurrent acquisition/overflow can deadlock. Lease validation is also released before enqueue state mutation, allowing old-lease work to race replacement.
- **Correction:** serialize input/lease transition state under one consistent lock or actor; never hold sequence lock while reacquiring lease. Add concurrent acquire/overflow/revoke regression.

### C8 — High: Browser dev admission never checks actual bound listener
- `browser_host/auth.rs:113–155` checks `no_auth`, peer and Origin only. Router is built before listener bind (`main.rs:1219–1226`); state carries no bound-listener authority (`state.rs:74–77`).
- **Impact:** loopback clients/proxies can receive Browser no-auth authority on an externally bound server, contrary to the required conjunction.
- **Correction:** propagate verified `listener.local_addr()` authority; reject Browser dev requests unless actual listener and peer are loopback. No Host/forwarded substitute. Add mixed-listener/peer tests.

## Warnings — SHOULD FIX

1. **Ticket cap race and permanent stale saturation:** global count checked outside ticket lock (`attachments.rs:210–215`), not rechecked inside (`263–281`). Concurrent principals can exceed 64; once expired tickets leave count at 64, issuance returns before pruning, potentially remaining full indefinitely. Check/prune/count/insert atomically under the existing lock.
2. **Pair lifecycle cleanup incomplete:** pair timeout pruning runs only on another registration (`372–388`), so lonely sockets need not close at 15s. Revoke methods remove active records without removing pair slots (`466–513`); later unregister cannot find those records, and fully-connected slots are never TTL-pruned. Clean exact pairs on revocation and schedule timeout independently. Guard against old unregister removing a replacement slot.
3. **Unbounded stale state:** `session.rs:411–419` retains every closed session forever; creation TTL pruning does not remove sessions. `api/browser_host.rs:583–586` creates input managers for arbitrary nonexistent IDs before owner lookup. Reap bounded retired records; authenticate owned target before allocating per-target state.
4. **UTF-8 boundary panic:** byte truncation at `session.rs:607–609` and `input.rs:507–509` can split a multibyte character. Truncate at a valid character boundary while preserving byte cap.
5. **Expired lease can read selected text:** `input.rs:515–521` validates token but not deadline; acquisition also replaces same-viewer lease without clearing queue/held state (`276–298`). Apply one consistent lease transition/expiry policy.
6. **Regression coverage inadequate for the claimed fixes:** supplied suites contain no stale-MFA route case, duplicate/invalid/empty-config Origin matrix, cross-principal/session pair collision, healthy-pair age-over-30s regression or actual supervisor timing/revocation exercise. `test_live_auth_verification_demotion` swaps mock state and directly calls helper (`browser_host_auth.rs:379–408`), not running supervisor.

## Suggestions — NICE TO HAVE

- Replace reason-string classification (`api/browser_host.rs:207`) with typed canonical auth failure categories when that shared API evolves.
- Make registries/supervisor AppState-owned rather than process-global. First-router-only static guard (`attachments.rs:516–519`) captures one state/runtime forever; separate router tests can abort its task while leaving the guard set.
- Split admission/ticket API from unrelated future selection handlers after correctness fixes; keep one policy implementation rather than multiple Origin/auth interpretations.

## Validation commands and verified results

**Executed:** scoped `git diff -- <11 assigned paths>` (exit 0); targeted source/callsite searches and line reads. Confirmed the changed claim-evaluation path, key expansion, healthy-pair retain condition and router startup call. No changed tests appeared in scoped diff.

**Not executed:** builds, tests, linters, formatters or smoke runs. Shared Cycle 2 test execution belongs to integration/test owner; no concurrent Cargo run started. No test/type/lint coverage percentage claimed. Earlier plan pass counts are historical, not this review's verification.

Recommended single-owner checks:
```sh
cargo test --manifest-path server/Cargo.toml --test browser_host_admission --test browser_host_auth --test browser_host_input -- --nocapture
cargo test --manifest-path server/Cargo.toml --test auth_no_auth --test auth_device_sessions -- --nocapture
cargo check --manifest-path server/Cargo.toml
```
Existing tests alone cannot close C1–C8; add behavioral regressions described above and real owned-target/input-release smoke evidence.

## Completeness and recommended disposition

Phase file marks all three tasks complete (`phase-03-admission-control.md:189–195`), but inspected implementation does not meet live cancellation/native-target/input acceptance. Do not carry forward 9.8/10 approval from prior report. Reopen affected Phase 03 tasks under integration owner; preserve scope of future Phase 05/08/09 work without treating those future proofs as completed now. Plan/task state intentionally unchanged per assigned report-only ownership.

## Unresolved questions

None requiring a product decision. Fresh integration-run results, negative security regressions and native-target timing/release evidence remain unverified.
