# Backend final review (round 2) — device login management

Reviewer: ApproveDeviceBackend. Read-only; no source edits, no checks run. Pass counts below are tester-reported (`review-fixes-validation.md`), not re-executed by me.

## Verdict: **APPROVED** (backend). No Critical/High/Medium blockers. 1 Low note, 1 docs follow-up for phase-04.

## Scope read
`server/src/api/auth_sessions.rs` (revoke/list/no_store), `server/src/api/auth.rs:126-264` (mechanism + `require_auth`), `server/src/api/router.rs:73-78,580-606`, `server/tests/auth_device_sessions.rs` (:82-134, :157-233), `server/tests/auth_no_auth.rs:711-727`, `review-fixes-validation.md` §3.1/§6, `contracts.md:12,33`. Owner/pagination/media/store left as in prior clean review (`review-backend.md`); not re-audited.

## F1 (bearer self-revoke clears unrelated cookie) — RESOLVED
- `auth_sessions.rs:126-129`: success arm = `revoke_by_actor_or_session` + `StatusCode::NO_CONTENT.into_response()`. No `SET_COOKIE` / cookie jar in the file (grep `SET_COOKIE` over `server/src`: only `auth.rs:492,700` login/logout, `auth_mfa.rs:606,909,994` session issue, `fs_image/fs_video/media_session` media cookies — none reachable from `/api/auth/sessions*`).
- Test `auth_device_sessions.rs:107-133`: bearer(alice) + foreign cookie(bob) self-revoke → 204, `no-store`, **no Set-Cookie** (:116); alice's bearer and cookie both 401 afterwards (:117-124); foreign cookie still 200 on GET (:125-130); foreign session `revoked_at` None (:132).
- Helper `request()` (:10-19) asserts `no-store` on every response and **no Set-Cookie on every DELETE** in the file.

## F2 (cookie-authorized DELETE / CSRF consistency) — RESOLVED by stronger route (bearer-only), not by Origin guard
- `auth_sessions.rs:116-119`: `mechanism != Bearer` → 403 `BearerRequired` (via `auth_error_response`, inside outer `no_store`), **before** `store()` access/storage mutation. Ordering: `no_auth` 409 check first (:111), then mechanism, then store. Mechanism comes from the extension that `authenticate_request` inserts (`auth.rs:214`) after successful claims validation, not from header sniffing.
- Precedence (`auth.rs:142-161`): `Authorization` with prefix `"Bearer "` (incl. empty/invalid token) → mechanism Bearer; decode/eval failure → 401, **never falls back to cookie** (matrix confirms). Missing/`Basic`/`Bearer` (no space) falls to cookie → authenticated as Cookie → 403 at handler. Lowercase `bearer x` behaves like `Basic` (cookie fallback → 403) — safe direction.
- Denial matrix `auth_device_sessions.rs:157-198`: auth ∈ {none, `Basic invalid`, `Bearer`, `Bearer `, `Bearer invalid`} × id ∈ {alice, bob(self), sibling, missing}, valid bob cookie on all: first three → 403 `BearerRequired`; last two → 401 `AUTH_REQUIRED`. Each asserts `no-store`, no Set-Cookie, and after each auth variant all 3 sessions still unrevoked and cookie GET list still 200 with 2 rows (`current` correct). Covers zero storage mutation + GET stays cookie-capable (matches contract :12 / :33).
- Policy denials (stale MFA, expired, superseded credential, disabled, authVersion bump) 401 for GET+DELETE with `no-store` (:200-233) — middleware-level, unchanged.
- Origin guard (prior F2 fix) no longer needed: no cookie credential can reach the mutation, so CSRF surface on DELETE is nil (cookie requests are rejected pre-storage).

## No reachable cookie-writing middleware
- `device_sessions` router (`router.rs:74-78`): only `require_auth` (route_layer) + `no_store` (outer layer). `require_auth` takes `CookieJar` as **extractor only** and returns the `Request` or an error `Response`; it never returns/mutates a jar (`auth.rs:254-264`).
- Global layers at `router.rs:598-606`: `DefaultBodyLimit` + optional CORS. Neither writes cookies. Merged siblings with cookie writers (`mark_allowed_media_origin`, media stream routes) are route_layers scoped to their own routers, not the device router.
- `no_store` (`auth_sessions.rs:64-68`) wraps authentication and extractor rejections (401/400/403/404/409/503). It inserts `Cache-Control` only.

## No-auth
- `auth_no_auth.rs:711-727`: GET and DELETE with `--no-auth` → 409 `DEVICE_SESSIONS_UNAVAILABLE`, `cache-control: no-store`, no `set-cookie`. Handlers check `state.no_auth` first (:75, :111), so `NoAuthDev` mechanism never hits the 403 branch or storage.

## Real-cookie regression evidence (§6) — proves replacement identity, not just bearer status
Adequate. Chain of evidence:
1. Wire-level: real backend (container, SQLite Lite) returned genuine 204 to `route.fetch()` with **no `set-cookie` header** (§6.1 step 3). This is the root-cause absence — any later clear would have required that header.
2. Identity: during the held response, Cookie B(`damhopper-auth=tokenB`) installed; after release, `context.cookies()` still shows value `tokenB` (jar identity, not status).
3. Server-side identity confirmation: cookie-only `GET /api/auth/status` 200 authenticated and cookie-only `GET /api/auth/sessions` → exactly 1 row = Session B with `current:true` (server resolved the jar cookie to session B's id), while bearer A → 401 `SESSION_REVOKED`. This binds the surviving cookie to B's session id, not merely "some cookie works".
4. Cookie-only/malformed-header DELETE matrix executed against the real backend with cookie B: 403/403/403/401/401, no Set-Cookie, sessions list intact (§6.1 step 2). Matches the in-process matrix.
Caveats (non-blocking, report honestly):
- Report does not state the DELETE's fetch `credentials` mode; if `omit`, the held-response race is not exercised end-to-end by the browser. Mitigated: the invariant is "no Set-Cookie on the wire", asserted at the response and in every unit DELETE.
- Throwaway spec was deleted post-run (§6.5); evidence is the tester's narrative, not a retained artifact. §7.3 suggests promoting it; recommended but not required for backend approval.
- Mongo parity and 7 ignored/4 skipped baselines unchanged from earlier; not part of this delta.

## Low / non-blocking
1. **Docs gap**: `docs/api/authentication.md` and `docs/` have no `auth/sessions` entry (grep `auth/sessions` in `docs` = 0 matches). Phase-04 must document bearer-only DELETE, no Set-Cookie, `BearerRequired`, `DEVICE_SESSIONS_UNAVAILABLE`, no-store, and the cookie-GET-capable list. Not a code blocker.
2. Carry-over from prior review (unchanged, optional): `revoke`/`list` map storage errors to 503 without `tracing::error!` (`auth_sessions.rs:88-92,123-124`).
3. Residual: a bearer client that sends `credentials:"include"` is now safe from cookie clears by this endpoint; unrelated `/api/auth/logout` race remains by existing design — out of scope.

## Closure status
- F1: closed. F2: closed (stricter alternative from prior review accepted; cookie DELETE intentionally dropped, no in-repo consumer — UI uses bearer with `credentials:"omit"`, `auth-client.ts:562`).
- Validation (tester-reported, unverified by me): auth_device_sessions 5, failures 1, no_auth 14, media-lib 1, store 2, metadata 1, sqlite 20; build/lint/typecheck clean.
- Human visual review remains PENDING (not a backend gate). Test-only UI fixture edit after image captures cannot affect server behavior; it can alter the source-status fingerprint (porcelain text), so image label vs tree may differ — disclose, no runtime impact.

## Unresolved questions
- Does Main want the throwaway cookie-boundary spec promoted to `packages/ui/e2e/device-login-management/` (tester §7.3)? Not required for approval.
