# Authentication API and Protected Access

**Authority:** Server Authentication API (`server/src/api/auth.rs`, `server/src/api/auth_mfa.rs`)  
**Status:** Authoritative REST & Transport Specification  

This reference covers password login, TOTP enrollment and verification, MFA step-up, session status, logout, and protected transport enforcement. JSON field names use `camelCase`; timestamps are RFC 3339 UTC strings. All authentication responses set `Cache-Control: no-store`.

## Flow Overview

In normal authenticated mode, password login does not create an active session. It returns a five-minute challenge for enrollment or login verification. Enrollment confirmation or code verification creates a session, returns a signed bearer token, and sets the HTTP-only `damhopper-auth` cookie. An MFA challenge for an existing session is completed using the same verification endpoint.

The `~/.config/dam-hopper/server-token` file is the server's JWT signing secret, not a client bearer credential. Clients must use the session `token` returned after successful MFA for bearer requests.

All MFA endpoints validate their challenge or session credential directly; a challenge is not a session. Protected REST routes, WebSockets, and media streams enforce session policy and deadlines; see [Protected REST and Live Transports](#protected-rest-and-live-transports).

## Endpoints

| Method and Path | Request | Success |
| --- | --- | --- |
| `POST /api/auth/register` | `{ "username", "password" }` | `{ "ok": true }`; created disabled pending operator approval |
| `POST /api/auth/login` | `{ "username", "password" }` | Enrollment or login-MFA challenge; no session token in normal mode |
| `POST /api/auth/mfa/setup` | `{ "challengeToken" }` | TOTP secret and provisioning details |
| `POST /api/auth/mfa/confirm` | `{ "challengeToken", "code" }` | Authenticated session after first enrollment |
| `POST /api/auth/mfa/verify` | `{ "challengeToken", "code" }` | Authenticated session after login MFA or step-up |
| `POST /api/auth/mfa/challenge` | Bearer token or `damhopper-auth` cookie; empty body | Step-up challenge |
| `GET /api/auth/status` | Bearer token or `damhopper-auth` cookie | Current session state and deadlines |
| `POST /api/auth/logout` | Bearer token or `damhopper-auth` cookie (optional) | Revoke session when supplied; clear cookie |
The MFA route group enforces a `16 KiB` request body limit (`router.rs:56`). `setup`, `confirm`, and `verify` accept JSON bodies; `challenge` has no request body. MFA challenge handles expire after 5 minutes and are single-purpose. Setup can be fetched repeatedly with the same pending enrollment challenge and returns the same secret.

## Login and Enrollment

### `POST /api/auth/register`

Registers a new username and password against the active storage backend (MongoDB or SQLite lite mode):

```json
{ "username": "alice", "password": "<password>" }
```

On success, returns HTTP `200 OK`:

```json
{ "ok": true }
```

**Account Approval & First-User Governance Invariant**:
Every newly registered account is created disabled (`is_enabled = 0` in SQLite; `isEnabled: false` in MongoDB) with role `user` and `auth_version = 0` (`authVersion: 0`). Registration **never** grants automatic first-user `admin` rights, and there is no public admin-promotion API. An operator must locally approve the account—and, when intended, promote it to `admin`—using the **Development profile** or **Deployment profile** in the canonical [Operator Account Approval and Role Promotion Runbook](../configuration/server-environment-auth.md#operator-account-approval-and-role-promotion-runbook) before login can proceed.

Attempting to call `POST /api/auth/login` on an unapproved account fails immediately with `HTTP 401 Unauthorized`:

```json
{
  "code": "ACCOUNT_DISABLED",
  "error": "Account is disabled. Contact an administrator."
}
```

After operator approval, the next `POST /api/auth/login` for an account without an enrolled factor returns `enrollmentRequired`, and the user completes MFA setup via `POST /api/auth/mfa/setup` and `POST /api/auth/mfa/confirm` below.

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

### Development Mode (`--no-auth`)

When `--no-auth` is enabled, login skips account and MFA challenge requirements, accepts an empty JSON body (`{}`), and returns the development session directly:

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

The development response also sets the auth cookie. `--no-auth` is a loopback-only development bypass—**never** authenticated SQLite lite mode (`DAM_HOPPER_LITE_MODE=true`, which enforces the full registration, operator approval, and TOTP MFA flow above). `--no-auth` is strictly rejected in production environments (`RUST_ENV=production` or `ENVIRONMENT=production`) and whenever an active authentication store is initialized (`AppState` verifies `auth_store.is_some()`). Server startup skips database initialization (both MongoDB and SQLite) under `--no-auth`, so database environment variables alone do not reject `--no-auth` unless production mode is set.

### `POST /api/auth/mfa/setup`

Use the enrollment challenge to retrieve authenticator configuration:

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

A successful `200` response confirms enrollment, creates the first session, sets the `damhopper-auth` HTTP-only cookie, and returns:

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

Roles serialize as lowercase `user` or `admin`. Session lifetime is 30 days (`SESSION_LIFETIME_SECS = 2_592_000`); `mfaDueAt` is 10 days after the latest successful verification (`MFA_VALIDITY_SECS = 864_000`), capped at `expiresAt`.

## Login Verification and Step-Up

### `POST /api/auth/mfa/verify`

The JSON body is identical for login MFA and step-up:

```json
{ "challengeToken": "<login or step-up challenge>", "code": "012345" }
```

A login-MFA challenge creates a new session and returns the authenticated-session response shown for `confirm`. A step-up challenge rotates the session credential and returns the same response shape; the old credential is superseded, `mfaDueAt` advances by 10 days, and the original absolute `expiresAt` is preserved. A fresh password login is required after absolute session expiry.

### `POST /api/auth/mfa/challenge`

Creates a single-use 5-minute step-up challenge for any unexpired, unrevoked session.

**Credential Admission:** Accepts either an `Authorization: Bearer <token>` header or the `damhopper-auth` HTTP-only cookie (falling back to the cookie when no parseable Bearer header is present). Does not require pre-existing full MFA freshness; it initiates the step-up flow.

Request body: none (empty body).

Success response (`200 OK`):

```json
{
  "challengeToken": "<opaque step-up challenge>",
  "challengeExpiresAt": "<RFC3339 timestamp>",
  "authProtocol": 2
}
```

The challenge is bound to the current session and credential revision. Complete it by submitting the TOTP code to `POST /api/auth/mfa/verify`.

## Session Status

### `GET /api/auth/status`

Send a bearer token in `Authorization: Bearer <token>` or the `damhopper-auth` cookie. Successful status is `200 OK`:

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

When MFA is due before absolute expiry, status returns `401 Unauthorized` with `code: "MFA_REQUIRED"`; the response includes the user and both deadlines so the client can request a step-up challenge:

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

Missing, invalid, expired, revoked, or disabled-account sessions also return `401` with `authenticated: false`, a machine-readable `code`, `error`, and protocol fields. A state-store failure returns `503 Service Unavailable` with `code: "AUTH_UNAVAILABLE"`.

In `--no-auth` mode, status reports authenticated development actor:

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

## Logout and Errors

### `POST /api/auth/logout`

Revokes the supplied session when valid, clears the `damhopper-auth` cookie, and returns:

```json
{ "ok": true, "token": null, "role": null }
```

Stale MFA freshness does not prevent logout.

### Error Handling

Authentication errors return a JSON envelope:

```json
{
  "error": "Human-readable error description",
  "code": "MACHINE_READABLE_CODE",
  "retryAfter": 60
}
```

When rate limits or lockout windows apply, `retryAfter` is included in seconds alongside a matching `Retry-After` HTTP response header. Common error codes:
- `AUTH_REQUIRED` (401): Missing or malformed authentication credentials
- `MFA_REQUIRED` (401): 10-day MFA freshness deadline elapsed
- `SESSION_EXPIRED` (401): 30-day absolute session lifetime elapsed
- `SESSION_REVOKED` (401): Session revoked or credentials rotated
- `ACCOUNT_DISABLED` (401): User account disabled (including newly registered accounts pending operator approval)
- `CHALLENGE_EXPIRED` (400): 5-minute challenge deadline elapsed
- `CHALLENGE_LIMIT_EXCEEDED` (429): Max 5 attempts exceeded for challenge
- `ACCOUNT_LOCKED` (429): 10 failed attempts triggered 10-minute cooldown
- `AUTH_UNAVAILABLE` (503): Database connection unavailable

## Protected REST and Live Transports

Protected REST routes evaluate signed V2 JWT claims against the current account and session state. Stale MFA, expired/revoked sessions, disabled accounts, legacy tokens, and unavailable auth state are denied.

The WebSocket handshake on `/ws` enforces the same session policy via query token or `damhopper-auth` cookie. An open socket checks the effective deadline before each inbound frame and before outbound writes. A background watcher checks persisted user and session state every 5 seconds with a 2-second database lookup timeout. The socket closes with:
- `4403`: `MFA_REQUIRED` (MFA due)
- `4401`: `SESSION_EXPIRED` or `SESSION_REVOKED`
- `1013`: `AUTH_UNAVAILABLE`
- `4001`: `CLOSE_OVERFLOW`

Revocation detected by the periodic watcher takes up to 7 seconds to close an existing socket. Local session lease and effective-deadline guards run before inbound dispatch/commit without per-frame database reads.

Image and video ticket issue routes (`/api/fs/{image,video}/tickets`) use the protected REST actor. Tickets and media sessions bind the auth session, account/credential versions, and effective deadline; absolute capability lifetimes are clamped to that deadline.

## Profile-Owned UI Client

The shared UI implements these routes through `packages/ui/src/api/auth-client.ts`, with typed protocol-v2 DTOs and `AuthClientError` in `packages/ui/src/api/auth-types.ts`. `connections.ts` maps `MFA_REQUIRED` status responses and WebSocket close `4403` to a profile-local `mfa-required` state, pausing reconnect until user interaction.

The UI keeps enrollment challenges and TOTP setup values in the current interaction memory rather than persistent storage.

## Related Documentation

- [Authentication State, Cryptography, and Session Policy](../architecture/authentication-state-and-cryptography.md) — Backend storage (MongoDB or SQLite lite mode), AES-256-GCM encryption, TOTP CAS, and policy bounds
- [API Reference](../api-reference.md#authentication) — Server-wide route index
- [Server Environment and Authentication](../configuration/server-environment-auth.md) — Configuration and operator recovery runbook
