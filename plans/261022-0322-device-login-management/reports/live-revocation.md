# Live Device Revocation Runtime Qualification Report

- **Date**: 2026-10-22
- **Environment**: Linux x64, Docker engine, isolated container fixture (`localhost/dam-hopper:production-test`)
- **Backend Auth Store**: SQLite Lite Mode (`DAM_HOPPER_LITE_MODE=true`)
- **Status**: **PASS (Live Revocation Cutoffs & Survivor Semantics Qualified)**

---

## 1. Executive Summary

Live runtime revocation exercised against real containerized `dam-hopper-server` on loopback. Verified concurrent session isolation between two same-account sessions (A/B) and one foreign account (C). Before revoking Session B from Session A, live WebSocket, SSE (`/api/system/resources/v1/events`), and media stream tickets (25 MB file) established on both sessions. Following targeted revocation of B from A, measured exact cutoff times and codes across all channels.

- Existing WS B: closed at **4,990 ms** with code **`4401`** (`CLOSE_FULL_LOGIN_REQUIRED`), reason `"Session revoked or account modified"`.
- Existing SSE B: stream cutoff observed at **4,991 ms** with `event: host-resources-error` and payload `{"code":"AUTH_REQUIRED","error":"Session expired or revoked"}`, followed by stream termination.
- Media active read cutoff: throttled 25 MB stream resumed at **5,501 ms** (>5s revalidation boundary); stream terminated at **7,733,248 / 26,214,400 bytes** (`error: aborted`, premature cutoff confirmed).
- Post-revocation ticket admission: B2 ticket denied with **404 Not Found**.
- Survivor A: session inventory intact (1 session), WS A remained open, SSE A active, ticket A2 returned **200**, control transfer A1 completed **26,214,400 bytes** (100%) across 5.5s boundary.
- Self-revocation of A: returned **204** with header `Set-Cookie: damhopper-auth=; HttpOnly; SameSite=Strict; Path=/; Max-Age=0` (historical baseline behavior; see Section 6 note).
- Healthy isolated app fixture (`dam-hopper-app-def2dc62` at port 37457) retained with private credential file (mode `0600`) and subsequently verified and cleaned up by Parent.

---

## 2. Execution Chronology: Two Attempts & Outcome Breakdown

Live qualification required two consecutive executions due to an anti-replay collision on TOTP session creation:

### Attempt 1 (Background Job `bg_14`)
- **Container / Port**: `dam-hopper-app-1801775e` at port `36025`
- **Sessions**: Session A (`admin`), Session B (`5a6730a0-db5a-4f74-a810-d1d1d0e08ecf`, UA `ProbeDevice-B/1.0`), Session C (`foreign-device-user`).
- **Initial Progress Update**: Reported to Parent while `bg_14` executed Steps 1–10.
- **Observed Cutoffs (Steps 1–16)**:
  * DELETE B from A: **204 No Content**
  * Existing WS B: closed at **4,992 ms**, code **`4401`**, reason `"Session revoked or account modified"`
  * Existing SSE B: cutoff at **4,993 ms**, event `host-resources-error`
  * Media Stream B1: initial pause at 163,840 bytes, resumed at 5,500 ms, socket cutoff at **7,864,320 / 26,214,400 bytes** (`error: aborted`)
  * Ticket B2 admission: **404 Not Found**; Ticket A2 admission: **200 OK**
  * Control Transfer A1: completed **26,214,400 bytes** (100%)
  * Repeat DELETE B: **204 No Content** (idempotent)
- **Step 17 Termination**: Attempted to provision survivor Session S for parent hand-off via `POST /api/auth/mfa/verify` in the same 30-second time step as Step 3's enrollment. Server rejected the verification with `REPLAYED_MFA_CODE` (`TotpEngine::verify_code` anti-replay enforcement in `server/src/api/auth_mfa.rs:782`). The unhandled 401 response on session listing threw `TypeError: undefined is not an object`.
- **Disposition**: Container `dam-hopper-app-1801775e` stopped and removed.

### Attempt 2 (Settled Full Qualification Run)
- **Adjustment**: Added explicit window delay (`remainingMs = 30000 - (Date.now() % 30000) + 1500`) to advance into the next TOTP 30-second time step before creating survivor Session S.
- **Container / Port**: `dam-hopper-app-def2dc62` at port `37457`
- **Sessions**: Session A (`9d6183e1-67bd-4ac1-bb2b-ff1404bf7b67`), Session B (`b6a94971-0aac-4ebc-8d37-01351b1bdfeb`), Session C (`b4f3a0d2-2fa8-4c4c-80ca-ad5254540ea0`).
- **Results**: All 18 steps completed cleanly in **28.60s**. Cutoff timings and bytes replicated Attempt 1 within millisecond fidelity (WS B at 4,990 ms; SSE B at 4,991 ms; stream cutoff at 7,733,248 bytes; Step 17 created Session S; Step 18 verified self-revocation).

---

## 3. Runtime Topology & Seeded Identities (Settled Run)

- **Container Engine**: Docker
- **Container ID**: `dam-hopper-app-def2dc62`
- **Network ID**: `dam-hopper-net-def2dc62`
- **Container Port / Origin**: `127.0.0.1:37457` -> `0.0.0.0:4800` (`http://127.0.0.1:37457`)
- **Image Provenance**: `localhost/dam-hopper:production-test` (inspect label `dam-hopper.source-fingerprint: 4e78d8c85b0d02ec103138cb12fef244f70798e114db41dabfdd5b12f87a1a8b`, matching repo source fingerprint)
- **Identities**:
  * **Session A** (`admin`): Initial seeded session (`9d6183e1-67bd-4ac1-bb2b-ff1404bf7b67`)
  * **Session B** (`admin`): Issued via real full MFA challenge (`POST /api/auth/login` -> challenge -> `mfa/setup` -> `mfa/confirm` with TOTP), session ID `b6a94971-0aac-4ebc-8d37-01351b1bdfeb`, User-Agent captured: `ProbeDevice-B/1.0`
  * **Session C** (`foreign-device-user`): Pre-seeded foreign account (`b4f3a0d2-2fa8-4c4c-80ca-ad5254540ea0`)

---

## 4. Pre-Revocation & Foreign Isolation Baseline

| Check | Action | Result | Notes |
|---|---|---|---|
| Foreign Session List | `GET /api/auth/sessions` (Bearer C) | **200 OK** | Returned 1 session (C only); zero visibility of admin sessions A/B |
| Foreign Revoke Mutation | `DELETE /api/auth/sessions/{sessionIdB}` (Bearer C) | **404 Not Found** | Code `SESSION_NOT_FOUND`; foreign deletion rejected without side effects |
| Sibling Verification | `GET /api/auth/sessions` (Bearer A) | **200 OK** | Returned 2 sessions (A and B); B tagged with `ProbeDevice-B/1.0` |
| WebSocket Establishment | `GET /ws?token={token}` for A and B | **OPEN** | Both WebSockets connected concurrently |
| Resource SSE Establishment | `GET /api/system/resources/v1/events` for A and B | **200 OK** | Text event-streams connected; initial basis received (4,456 bytes each) |
| Media File Staging | `dd if=/dev/zero of=media-probe.png bs=1M count=25` | **Created** | Size: 26,214,400 bytes in `fixture-project` workspace |
| Media Tickets Issued | `POST /api/fs/image/tickets` | **201 Created** | A1, A2, B1, B2 issued with distinct `MediaClientId` UUIDs and session cookies |
| Throttled B1 Stream Start | `GET /api/fs/image/stream/{ticketB1}` | **200 OK** | Header `content-length: 26214400`; read initial 208,384 bytes and paused |

---

## 5. Targeted Revocation of Session B & Cutoff Timings

Targeted revocation executed via Session A:
`DELETE /api/auth/sessions/b6a94971-0aac-4ebc-8d37-01351b1bdfeb` (Bearer A) -> **204 No Content** (`t_revoke = 1792618299875`).

| Surface | Exercise / Protocol | Measured Elapsed | Result / Code | Acceptance Bound & Behavior |
|---|---|---|---|---|
| **B Protected HTTP** | `GET /api/auth/sessions` (Bearer B) | < 50 ms | **401 Unauthorized** | Body: `{"error":"Session was explicitly revoked or logged out","code":"SESSION_REVOKED"}` |
| **B New WebSocket** | Handshake `ws://.../ws?token={tokenB}` | 1,000 ms poll | **Closed (Code 1002)** | Client observed close code 1002 on revoked connection attempt |
| **B Existing WebSocket** | Auth watcher poll loop (`server/src/api/ws.rs`) | **4,990 ms** | **Closed (Code 4401)** | Reason: `"Session revoked or account modified"`; within 5s poll + 2s DB timeout acceptance window |
| **B Existing SSE Stream** | Host resource supervisor (`server/src/api/resource_events.rs`) | **4,991 ms** | **Cutoff & EOF** | Event: `host-resources-error`<br>Data: `{"code":"AUTH_REQUIRED","error":"Session expired or revoked"}`<br>Stream terminated (`done: true`) |
| **B Throttled Media Stream** | Body read across 5s boundary (`server/src/api/media_stream_response.rs`) | Resumed at **5,501 ms**; cutoff at **5,602 ms** | **Aborted Cutoff** | Expected: 26,214,400 bytes<br>Received: 7,733,248 bytes (~7.37 MB)<br>Socket closed prematurely (`error: aborted`); read-driven revalidation boundary confirmed |
| **B Post-Revocation Ticket Admission** | `GET /api/fs/image/stream/{ticketB2}` (Cookie B2) | Post-revoke | **404 Not Found** | Unused pre-issued ticket admission revoked upon session invalidation |

---

## 6. Survivor Session A & Idempotency Verification

| Surface | Exercise | Result | Notes |
|---|---|---|---|
| **Session Inventory** | `GET /api/auth/sessions` (Bearer A) | **200 OK** | Exactly 1 session remaining (A); B eradicated from active inventory |
| **Live WebSocket A** | Inspected `wsA.readyState` | **OPEN** | Surviving connection remained active, unaffected by peer revocation |
| **Live SSE Stream A** | Inspected reader stream | **Active** | Reader stream remained open; received subsequent chunks |
| **Ticket Admission A2** | `GET /api/fs/image/stream/{ticketA2}` | **200 OK** | Unused pre-issued ticket admitted and streamable |
| **Control Media Transfer A1** | `GET /api/fs/image/stream/{ticketA1}`, paused 5.5s across boundary | **Completed (100%)** | Full **26,214,400 / 26,214,400 bytes** received; completed without cutoff |
| **Revocation Idempotency** | Repeat `DELETE /api/auth/sessions/{sessionIdB}` (Bearer A) | **204 No Content** | Idempotent repeat revocation returns 204 without modifying store state |

---

## 7. Self-Revocation & Cookie Clearing Verification

1. **Pre-requisite Survivor Session S Provisioning**:
   - Advanced TOTP anti-replay time step (10,287 ms delay) to prevent `REPLAYED_MFA_CODE`.
   - Created Session S via `POST /api/auth/login` + `POST /api/auth/mfa/verify`.
   - Verified Session S active (`34204b2d-b268-4d1d-8115-3dbbdb5dfcee`).
   - Saved private credentials for Parent browser verification into `/tmp/dam-hopper-browser-credential.json` (mode `0600`).
2. **Self-Revocation of Session A**:
   - `DELETE /api/auth/sessions/9d6183e1-67bd-4ac1-bb2b-ff1404bf7b67` with `Cookie: damhopper-auth=...`
   - Response: **204 No Content**
   - Header verified: `Set-Cookie: damhopper-auth=; HttpOnly; SameSite=Strict; Path=/; Max-Age=0`
3. **Subsequent Session A Bearer Check**:
   - `GET /api/auth/sessions` (Bearer A) -> **401 Unauthorized** (revoked).
4. **Survivor Session S Integrity**:
   - `GET /api/auth/sessions` (Bearer S) -> **200 OK** (1 session remaining: Session S).

> **Architectural Note on Cookie Clearing Semantics**:
> The observed `Set-Cookie: damhopper-auth=; HttpOnly; SameSite=Strict; Path=/; Max-Age=0` on bearer-authenticated self-revocation represents historical baseline evidence of the current implementation. As planned in the safe design review, future adjustments will omit `Set-Cookie` on bearer-authenticated mutations to prevent clearing replacement cookies during cross-tab profile transitions. The test above confirms exact current-build behavior.

---

## 8. Parent Interactive Browser Verification Hand-off & Disposal

The isolated SQLite container service was preserved and handed off to Parent for interactive browser verification:

- **Service Origin**: `http://127.0.0.1:37457`
- **Private Credential File**: `/tmp/dam-hopper-browser-credential.json` (file mode `0600`)
- **Active Session ID**: `34204b2d-b268-4d1d-8115-3dbbdb5dfcee` (`admin`)
- **Raw Evidence Artifact**: `/tmp/live-revocation-results.json`

**Post-Verification Cleanup Confirmation**:
Parent successfully executed interactive browser verification, validated UI behavior, and cleaned up the running container (`dam-hopper-app-def2dc62`), network (`dam-hopper-net-def2dc62`), and temporary credential/evidence artifacts (`/tmp/dam-hopper-browser-credential.json`, `/tmp/live-revocation-results.json`).

---

## 9. Unresolved Questions

1. None. All live cutoff behaviors and timings adhere strictly to system contracts and acceptance criteria.
