# Authentication API

Protected session, login, and development-mode contract moved from the [API reference index](../api-reference.md).
## Authentication

REST requests generally use a Bearer token:

```
Authorization: Bearer {token}
```

The server also accepts an HttpOnly SameSite=Strict authentication cookie. `GET
/api/health` and authentication endpoints have public/flow-specific exceptions;
consult each route group below rather than assuming every request is protected.

Auth protocol 2 login returns a restricted challenge; enrollment or verification is required before a normal session is issued. `GET /api/auth/status` rejects legacy tokens. Protected REST routes evaluate each request against current account/session policy; WebSocket and media streams enforce the same deadlines and bounded revocation checks. See the [Authentication API](../authentication-api.md) for request/response schemas and the [security contract](../../plans/260926-2157-token-rotation-mfa/security-contract.md) for lifecycle and security details.

### Dev Mode (--no-auth)

The server supports a `--no-auth` authentication bypass mode for development. It
is unsafe on public networks and is rejected when MongoDB is configured or the
runtime environment is production. Public health/auth flow behavior and WS
origin/token policy still apply; do not infer response fields not shown by the
handler.

### Auth Endpoints

**POST /api/auth/login**

Normal mode body:

```json
{ "username": "user", "password": "pass" }
```

Returns a restricted, five-minute MFA challenge, not an authenticated session or cookie:

```json
{
  "state": "enrollmentRequired",
  "challengeToken": "...",
  "challengeExpiresAt": "...",
  "authProtocol": 2
}
```

For an enrolled account, `state` is `mfaRequired`. In `--no-auth` mode, send `{}`; development mode returns its development session directly.

**POST /api/auth/mfa/setup**

Body: `{ "challengeToken": "..." }`. Returns the pending TOTP secret, `otpauthUri`, issuer/account metadata, algorithm, digits, and period. Repeated setup fetches for the same challenge return the same secret. Keep setup values ephemeral.

**POST /api/auth/mfa/confirm** and **POST /api/auth/mfa/verify**

Body: `{ "challengeToken": "...", "code": "123456" }`. `confirm` completes first enrollment; `verify` completes login MFA or session step-up. Success creates the full session and auth cookie, and returns `state`, `token`, `expiresAt`, `mfaDueAt`, `user`, `role`, and `authProtocol`.

**POST /api/auth/mfa/challenge**

Creates a five-minute step-up challenge bound to the current unexpired session and credential revision. The security contract specifies Bearer authentication; code review flagged that cookie-only credentials are currently accepted and requires follow-up before release.

**GET /api/auth/status**

Returns the current session state without granting access. A fresh session includes `issuedAt`, `expiresAt`, and `mfaDueAt`:

```json
{
  "authenticated": true,
  "user": "username",
  "role": "user",
  "workbenchProtocol": 2,
  "authProtocol": 2,
  "issuedAt": "...",
  "expiresAt": "...",
  "mfaDueAt": "..."
}
```

When MFA is due, status returns `401` with `code: "MFA_REQUIRED"` and deadline metadata. At absolute expiry, full password login and TOTP are required. `--no-auth` continues to return its development-mode status.

**POST /api/auth/logout**

Revokes the supplied session when valid and clears the auth cookie; stale MFA does not prevent logout.

Auth challenge/session responses use `Cache-Control: no-store`. Authentication errors use `{ "error": "...", "code": "...", "retryAfter"?: number }`.


