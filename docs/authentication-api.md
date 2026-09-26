# Authentication API and Protected Access (Phases 02–03)

This reference covers password login, TOTP enrollment and verification, MFA step-up, session status, and logout. JSON field names use `camelCase`; timestamps are RFC 3339 UTC strings. Auth handler responses set `Cache-Control: no-store`.

## Flow overview

In normal authenticated mode, password login does not create a session. It returns a five-minute challenge for enrollment or login verification. Enrollment confirmation or code verification creates a session and returns a signed bearer token while also setting the `damhopper-auth` cookie. An MFA challenge for an existing session is completed with the same verification endpoint.

The `server-token` file is the server's JWT signing secret, not a client bearer
credential. Use the session `token` returned after successful MFA for bearer
requests.

All MFA endpoints validate their challenge or session credential directly; a challenge is not a session. Phase 03 extends the same policy to protected REST, WebSocket, and media access; see [Protected REST and live transports](#protected-rest-and-live-transports-phase-03).

## Endpoints

| Method and path | Request | Success |
| --- | --- | --- |
| `POST /api/auth/login` | `{ "username", "password" }` | Enrollment or login-MFA challenge; no session token in normal mode |
| `POST /api/auth/mfa/setup` | `{ "challengeToken" }` | TOTP secret and provisioning details |
| `POST /api/auth/mfa/confirm` | `{ "challengeToken", "code" }` | Authenticated session after first enrollment |
| `POST /api/auth/mfa/verify` | `{ "challengeToken", "code" }` | Authenticated session after login MFA or step-up |
| `POST /api/auth/mfa/challenge` | Current bearer token or auth cookie; empty body | Step-up challenge |
| `GET /api/auth/status` | Current bearer token or auth cookie | Current session state and deadlines |
| `POST /api/auth/logout` | Current bearer token or auth cookie (optional) | Revoke session when supplied; clear cookie |

The MFA route group is capped at 16 KiB. `setup`, `confirm`, and `verify` accept JSON; `challenge` has no request body. MFA challenge handles expire after five minutes and are single-purpose; setup can be fetched repeatedly with the same pending enrollment challenge and returns the same secret.

## Login and enrollment

### `POST /api/auth/login`

Normal mode requires a JSON body with `username` and `password`:

```json
{ "username": "alice", "password": "<password>" }
```

For an enabled account without an enrolled factor, the `200` response is:

```json
{
  "state": "enrollmentRequired",
  "challengeToken": "<opaque challenge>",
  "challengeExpiresAt": "<RFC3339 timestamp>",
  "authProtocol": 2
}
```

For an enrolled account, `state` is `mfaRequired`; the remaining fields have the same shape. Neither challenge response sets an authenticated cookie or returns a session token. Submit the enrollment challenge to `setup` and `confirm`, or submit the login challenge to `verify`.

When `--no-auth` is enabled, login skips the account/MFA challenge flow, accepts
an empty JSON body, and returns the development token directly:

```json
{
  "ok": true,
  "token": "<development token>",
  "dev_mode": true,
  "devMode": true,
  "role": "user",
  "workbenchProtocol": 2,
  "authProtocol": 2
}
```

The development response also sets the auth cookie. Keep `--no-auth` limited to
trusted development environments.

### `POST /api/auth/mfa/setup`

Use the enrollment challenge to retrieve the authenticator configuration:

```json
{ "challengeToken": "<enrollment challenge>" }
```

The `200` response contains both the Base32 manual key and an equivalent provisioning URI:

```json
{
  "secret": "<Base32 secret>",
  "otpauthUri": "otpauth://totp/...",
  "issuer": "DamHopper",
  "accountName": "alice",
  "algorithm": "SHA1",
  "digits": 6,
  "period": 30
}
```

Treat `secret` and `otpauthUri` as credentials. Keep them only for the enrollment interaction; do not log or persist them in client state.

### `POST /api/auth/mfa/confirm`

Submit the enrollment challenge and current six-digit TOTP code:

```json
{ "challengeToken": "<enrollment challenge>", "code": "012345" }
```

A successful `200` response confirms enrollment, creates the first session, returns the session cookie, and has this JSON shape:

```json
{
  "state": "authenticated",
  "token": "<signed bearer token>",
  "expiresAt": "<RFC3339 timestamp>",
  "mfaDueAt": "<RFC3339 timestamp>",
  "user": "alice",
  "role": "user",
  "authProtocol": 2
}
```

Roles serialize as lowercase `user` or `admin`. Session lifetime is 30 days; `mfaDueAt` is ten days after the latest successful proof, capped at `expiresAt`.

## Login verification and step-up

### `POST /api/auth/mfa/verify`

The JSON body is the same for both challenge purposes:

```json
{ "challengeToken": "<login or step-up challenge>", "code": "012345" }
```

A login-MFA challenge creates a new session and returns the authenticated-session response shown for `confirm`. A step-up challenge rotates the session credential and returns the same response shape; the old credential is superseded, `mfaDueAt` advances, and the original `expiresAt` does not change. A fresh password login is required after absolute session expiry.

### `POST /api/auth/mfa/challenge`

Send the current session bearer token in `Authorization: Bearer <token>` or the `damhopper-auth` cookie. No request body is required. On success, the response is:

```json
{
  "challengeToken": "<opaque step-up challenge>",
  "challengeExpiresAt": "<RFC3339 timestamp>",
  "authProtocol": 2
}
```

The challenge is bound to the current session and credential revision. Complete it through `POST /api/auth/mfa/verify`.

The handler currently accepts either Bearer or cookie credentials, although
the [security contract](../plans/260926-2157-token-rotation-mfa/security-contract.md)
specifies Bearer for this endpoint. Use Bearer for clients; cookie-only
step-up is a current contract deviation.

## Session status

### `GET /api/auth/status`

Send a bearer token or auth cookie. Successful status is `200`:

```json
{
  "authenticated": true,
  "user": "alice",
  "role": "user",
  "workbenchProtocol": 2,
  "authProtocol": 2,
  "issuedAt": "<RFC3339 timestamp>",
  "expiresAt": "<RFC3339 timestamp>",
  "mfaDueAt": "<RFC3339 timestamp>"
}
```

When MFA is due before absolute expiry, status is `401` with `code: "MFA_REQUIRED"`; the response includes the user and both deadlines so the client can request a step-up challenge:

```json
{
  "authenticated": false,
  "code": "MFA_REQUIRED",
  "error": "MFA verification required",
  "user": "alice",
  "expiresAt": "<RFC3339 timestamp>",
  "mfaDueAt": "<RFC3339 timestamp>",
  "workbenchProtocol": 2,
  "authProtocol": 2
}
```

Missing/invalid, expired, revoked, or disabled-account sessions also return `401` with `authenticated: false`, a machine-readable `code`, `error`, and both protocol fields. A state-store failure returns `503` with `code: "AUTH_UNAVAILABLE"`. Status responses use `Cache-Control: no-store`.

With `--no-auth`, status remains authenticated and reports the development actor:

```json
{
  "authenticated": true,
  "dev_mode": true,
  "devMode": true,
  "user": "dev-user",
  "role": "user",
  "workbenchProtocol": 2,
  "authProtocol": 2
}
```

## Logout and errors

`POST /api/auth/logout` succeeds even when MFA is stale. It revokes the supplied current session when available, clears the auth cookie, and returns:

```json
{ "ok": true, "token": null, "role": null }
```

MFA endpoint errors use `{ "error": "...", "code": "..." }`; `retryAfter` (seconds) is included only when applicable, with a matching `Retry-After` header. Errors are not cacheable. Challenge, code, account, and backend failures remain distinct through the returned `code`; do not treat any error as an authenticated session.

## Protected REST and live transports (Phase 03)

Protected REST routes evaluate signed V2 claims against the current account and
session. Stale MFA, expired/revoked sessions, disabled accounts, legacy tokens,
and unavailable auth state are denied; auth-store failures return
`503 AUTH_UNAVAILABLE`. Public health and flow-specific auth routes remain
explicit exceptions. `--no-auth` is development-only and bypasses this policy.

The WebSocket handshake applies the same session policy. An open socket checks
the effective deadline before each inbound frame and before outbound writes;
a background watcher checks persisted user/session state every five seconds
with a two-second lookup timeout. It closes with `4403` for MFA required,
`4401` for full login required, or `1013` when auth state is unavailable.
`CloseAuth` is an internal writer control that sends a WebSocket close frame,
not a new JSON `kind`; `4001` remains queue overflow. Revocation detected by
the periodic watcher can take up to seven seconds to close an existing socket.
The local session lease/effective-deadline guard runs before inbound
dispatch/commit without per-frame database reads; the shared watcher enforces
persisted revocation at the bounded interval above.

Image/video ticket issue routes use the protected REST actor. Tickets and media
sessions bind the auth session, account/credential versions, and effective
deadline; absolute capability lifetimes are clamped to that deadline. Every
HEAD/GET admission revalidates session state, and active bodies check the
deadline and poll for revocation on the same five-second/two-second bounds.
Exact-origin ticket-only access is a media-cookie fallback, not an auth bypass.

See [Phase 01 auth state, cryptography, and policy](./phase-01-auth-state-cryptography-and-policy.md) for persistence, TOTP, encryption-key, and policy details, and [API Reference](./api-reference.md#authentication) for the server-wide route index.
