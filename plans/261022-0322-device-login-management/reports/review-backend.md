# Backend review — device login management (server/**)

Reviewer: ReviewDeviceBackend. Read-only; no source edits, nothing executed. Basis: working-tree source + tests read; tester.md pass counts taken as reported, not re-verified.

## Scope
`server/src/api/auth_sessions.rs` (new), `server/src/auth/session_inventory.rs` (new), `002-session-user-agent.sql` (new), `auth/store.rs`, `store/{mongo,sqlite}.rs`, `sqlite/{open,records}.rs`, `api/{auth_mfa,router,mod}.rs`, `auth/{model,mod}.rs`, `fs/media_ticket.rs` (test only), constructors in examples/tests, new tests `auth_device_sessions.rs`, `auth_device_session_{store,failures}.rs`, `auth_session_metadata.rs`. Compared against existing cookie-mutation guards (`host_actions.rs`, `idle_suspend.rs`), `auth.rs` middleware/logout.

## Verdict
Core contract correct: no Critical/High defects. 2 findings on the cookie `Set-Cookie`/cookie-authority path (Medium-Low, Low) need Main disposition before closing; both small. Rest verified clean.

## Findings

### F1 — Medium-Low: bearer self-revoke mutates an unrelated cookie
- `server/src/api/auth_sessions.rs:122-127`: `Set-Cookie: damhopper-auth=; Max-Age=0` emitted whenever `actor.session_id == id`, **regardless of `CredentialMechanism`**. Comment at :123-124 admits cookie may be a "different" credential, yet it is still cleared.
- `server/tests/auth_device_sessions.rs:104-115` pins this: bearer of alice + cookie of **bob** → 204 + clear-cookie. Persisted bob session is untouched (:117) but bob's browser login is wiped.
- Repro (consumer-visible): browser/client holding cookie for account B calls `DELETE /api/auth/sessions/<A current>` with `Authorization: Bearer <A>` and `credentials: "include"` (or same-origin default `fetch` without `omit`) → response clears B's cookie; B's cookie-authorized media/WS/HTTP in that browser 401.
- Mitigated only on the shipped path: `packages/ui/src/api/auth-client.ts:562` uses `credentials: "omit"` (Set-Cookie ignored). Not a server guarantee. Also means contract "self revoke clears auth cookie" is **not achieved** by the UI (dead cookie of revoked session stays; harmless, 401s).
- Fix (minimal, `revoke` only): add `Extension<CredentialMechanism>` to the handler; emit Set-Cookie only when mechanism == `Cookie` (cookie token IS the revoked credential). Never for `Bearer`. (If a matching-cookie clear for bearer is wanted, decode cookie with `AuthClaims::decode(.., &state.jwt_secret)` and require `sid == id`; not needed for current UI.)
- Acceptance: flip `auth_device_sessions.rs:104-115` — bearer self-revoke + foreign cookie → 204, **no** `Set-Cookie`, foreign cookie session still OK; keep cookie-only self-revoke → 204 + `Max-Age=0` (:142-158); sibling revoke → no Set-Cookie. Update frozen contract sentence: "clears auth cookie when the cookie authorized the revoke".

### F2 — Low (hardening, not a demonstrated exploit): cookie-authorized DELETE lacks the repo's Origin guard
- Evidence: cookie-only `DELETE` with no `Origin` header → 204 (`auth_device_sessions.rs:142-158`). Router adds no Origin/CSRF layer (`router.rs:73-78`). Precedent: `host_actions.rs:38-45`, `idle_suspend.rs:89-98` reject cookie-credential mutations unless `state.origin_is_allowed(headers)` (`state.rs:490`: exact CORS allowlist or same-origin Host match, single Origin/Host header).
- Exploitability is constrained: `SameSite=Strict` (`auth.rs:43`), cross-origin DELETE needs a CORS preflight (allowlist only), target IDs are UUIDv4 (`auth_mfa.rs:555,858`), IDs readable only via the same protected GET. So: consistency/defense-in-depth, not a live CSRF. `POST /api/auth/logout` has the same property (existing precedent).
- Related, unfixable server-side: a delayed 204 `Set-Cookie` clear can wipe a replacement login cookie set meanwhile. Applies to any response-time Set-Cookie, **including bearer requests sent with `credentials: "include"`** (so bearer-only admission alone does not remove it; F1 gating does). Same as `/api/auth/logout`; shipped UI immune via `omit`. Document as known cookie-flow limitation; do not redesign auth.
- Fix (smallest compatible): inside `revoke`, if mechanism == `Cookie` && `!state.origin_is_allowed(&headers)` → 403 `INVALID_ORIGIN` via `auth_error_response` (inside `no_store` layer), **before** any storage mutation. Mechanism from the authenticated extension, not header sniffing. Bearer admission unchanged. Alternative (stricter, only if Main accepts dropping cookie DELETE): require `Bearer` (unused `auth::require_bearer_auth` at `auth.rs:305` exists) + F1 gating; breaks cookie-only callers with no in-repo consumer, so not preferred.
- Acceptance tests: cookie DELETE with missing / disallowed / duplicated Origin → 403, no-store, `revoked_at` unchanged, no Set-Cookie; allowed Origin (same-origin Host or configured) → 204 + clear; bearer without Origin → 204 as before; GET list unaffected.

## Verified clean (read evidence)
- Owner predicate atomic: SQLite `UPDATE … WHERE username=?1 AND id=?2 RETURNING id`, `COALESCE(revoked_at_ms, now)` (`sqlite.rs:467-486`); Mongo `update_one {_id, username}` pipeline `$ifNull(revokedAt, now)`, `matched_count==1` (`mongo.rs:446-460`). Foreign/missing both `false` → identical 404 body (test `:85-91`); repeat = 204, first `revokedAt` kept.
- List filters: username, authVersion, unrevoked, `expiresAt > now`; MFA-due rows included; fetch 51, emit 50; order `(issuedAt DESC,_id DESC)` with strict `$or`/tuple continuation both stores (`sqlite.rs:436-464`, `mongo.rs:415-444`). Binary string order both. Cursor ms-precision, `[ms,id]` base64url, ≤512 chars, id ≤256 no control, 400 on malformed/duplicate/empty (`session_inventory.rs:164-180`; tests `:129-133,177`).
- Indexes: Mongo `{username,authVersion,issuedAt:-1,_id:-1}` (`mongo.rs:90-93`); SQLite partial `(username,auth_version,issued_at_ms DESC,id DESC) WHERE revoked_at_ms IS NULL` in migration 002; `ADD COLUMN` + CHECK 1..512 bytes. Migration runner transactional, ordered, 001 untouched; downgrade to older binary is refused (fail-closed by design) — ops note only.
- UA: `HeaderMap` taken in `confirm`/`verify` (full-session creation only: `auth_mfa.rs:564,867`); step-up keeps stored value (`auth_session_metadata.rs` asserts); non-UTF8 → null; truncation on char boundary ≤512 (`session_inventory.rs:183-190`); `#[serde(default)]` legacy Mongo (`model.rs:81-83`, test `auth_state_and_policy.rs:711`). No IP/token/other headers stored. All `AuthSession {` literals in src/examples/tests updated (grep).
- DTO whitelist `id,userAgent,issuedAt,expiresAt,mfaVerifiedAt,current` (`auth_sessions.rs:22-44`); RFC3339 UTC; asserted key-set test `:57-61`.
- No-store: separate router with `require_auth` as `route_layer` inside outer `no_store` `.layer` (`router.rs:73-78`) → covers 401/400/404/409/503 incl. policy denials; tests `auth_device_sessions.rs:10-16,160-192`. `--no-auth` → 409 `DEVICE_SESSIONS_UNAVAILABLE` before storage (`auth_sessions.rs:75,110`). MFA-stale/expired/superseded/disabled/authVersion-bumped callers get 401 (middleware), so a stale session cannot revoke others.
- Media: `revoke_by_actor_or_session(subject, Some(&id))` filters on exact `auth_session_id` for tickets and media sessions only (`media_ticket.rs:974-995`); invoked after owned-record success; same call shape as `logout` (`auth.rs:694`), only other caller. Added test proves sibling ticket survives (`media_ticket.rs` diff ~1736-1768). Residual: ticket issuance racing the revoke is existing media-admission design, not new.
- Foreign/missing timing: single predicate statement both stores; no existence oracle observed.

## Low / operational (not security defects)
1. `revoke`/`list` map storage errors to 503 with no `tracing::error!` (`auth_sessions.rs:88-92,116-117`); siblings in `auth_mfa.rs` log. Add log (no secrets) for diagnosability.
2. SQLite `decode_session` rejects control chars (`records.rs:127-134`) but CHECK only bounds length, so a non-API writer's corrupt `user_agent` makes the whole account inventory 503 (test `auth_device_session_failures.rs` pins). Mongo has no read-side validation → store behaviour differs for corrupt rows. API writer always normalizes; acceptable, note only.
3. `normalize_user_agent` drops UA containing any control char incl. HTAB (legal in headers) — stricter than contract text; harmless. Bidi/format chars (e.g. U+202E) are kept: frontend should render as inert text; UA is an untrusted hint.
4. SQLite keyset predicate `(?4 IS NULL OR …)` scans from head for deep pages; bounded by per-account session count, fine.

## Test-evidence caveat
Mongo parity test `auth_device_session_store.rs:~100-104` silently returns when `TEST_MONGODB_URI` unset; qualification counts only the isolated-Mongo run tester.md reports (2015 pass). Not re-verified by me.

## Recommended actions
1. F1: gate Set-Cookie on `CredentialMechanism::Cookie`; update test :104-115 + contract sentence.
2. F2: Origin guard for cookie mechanism in `revoke`; add the 4 Origin tests; document residual delayed-Set-Cookie race in docs/api auth page.
3. Targeted rerun: `cargo test --test auth_device_sessions` (+ lib `api::` unchanged). No other server changes needed.

## Unresolved questions
- Does Main accept contract rewording ("clear cookie only when cookie authorized")? If cookie clearing must also happen for bearer+matching cookie, need cookie-sid decode (small) — confirm.
- Should GET `/api/auth/sessions` stay cookie-capable (current) or follow SSE bearer-only precedent? No defect found either way.
