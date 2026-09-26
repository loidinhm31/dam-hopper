# Code Review: Phase 03 — REST/Live Transport Enforcement

**Plan:** `plans/260926-2157-token-rotation-mfa/phase-03-transport-enforcement.md`  
**Date:** 2026-09-27  
**Score:** 8.8 / 10  
**Status:** Approved with Warnings (non-blocking for Phase 04, fix before Phase 05 qualification)

---

## Executive Summary

Phase 03 implements comprehensive server-side access enforcement across all transport mechanisms (REST, WebSockets, media streaming, and plugin capabilities). Legacy V1 tokens and signature-only checks are eliminated in favor of full session policy evaluation against MongoDB with zero-grace 10-day MFA freshness and 30-day absolute expiration. WebSockets and media streams are continuously policed via background watchers and per-frame/per-chunk deadline guards with bounded timeouts (2s) and fail-closed semantics.

All 5 new end-to-end integration tests in `transport_enforcement_phase03.rs` pass, and existing suites remain 100% green (1529/1529 passed).

---

## Critical Issues (MUST FIX)

*None.* No security bypasses, data loss bugs, or fatal flaws identified.

---

## Warnings (SHOULD FIX)

1. **Unintentional Cross-Session Media Revocation in `revoke_by_actor_or_session`**
   - **File:** `server/src/fs/media_ticket.rs:980-990`
   - **Impact:** The retain condition `!(matches_actor || matches_session)` evaluates to `false` for any ticket belonging to `actor`, regardless of `session_id`. When a user with multiple devices logs out on one device, media tickets on all other active devices are prematurely invalidated in memory.
   - **Recommended Fix:**
     ```rust
     let should_revoke = if let Some(sid) = session_id {
         ticket.auth_session_id.as_deref() == Some(sid)
     } else {
         ticket.binding.as_ref().is_some_and(|b| b.actor_subject == actor)
     };
     !should_revoke
     ```
     Apply identical logic for `inner.sessions`.

2. **Race Condition During WebSocket Server-Initiated Close in `handle_socket`**
   - **File:** `server/src/api/ws.rs:1916-1927`
   - **Impact:** When `auth_watcher` or the reader loop detects deadline expiration or revocation, it sends `WireMsg::CloseAuth` on `alert_tx` and fires `cancel_tx.send(true)`. The reader loop breaks immediately and executes `writer.abort()`. If the writer task is waiting to acquire `ws_tx` or has not yet processed `alert_rx`, it is killed before the WebSocket `CloseFrame` (code `4401` or `4403`) is flushed to the network. The client may experience an ungraceful TCP reset (RST / connection drop) instead of the explicit close code.
   - **Recommended Fix:** Replace unconditional `writer.abort()` with a brief timeout:
     ```rust
     let _ = tokio::time::timeout(std::time::Duration::from_millis(500), writer).await;
     ```

3. **Inconsistent Environment Variable Detection for Production Mode**
   - **File:** `server/src/main.rs:344-345` vs `server/src/state.rs:365-366`
   - **Impact:** `main.rs` checks `RUST_ENV` and `ENVIRONMENT`, whereas `server/src/state.rs` checks `DAM_HOPPER_ENV` and `APP_ENV`. If a deployment configures `RUST_ENV=production`, `AppState::new` will not detect production mode and could fall back to mock auth when `db` is missing.
   - **Recommended Fix:** Centralize production environment checks into a shared helper function checking all four variables consistently.

---

## Suggestions (NICE TO HAVE)

1. **DRY: Extract `FullLoginRequired` Reason-to-Code Mapping**
   - **File:** `server/src/api/auth.rs:215-226`, `server/src/api/auth.rs:794-805`, `server/src/api/ws.rs:209-220`
   - **Note:** The exact same string pattern matching mapping `reason` to `"SESSION_EXPIRED"`, `"SESSION_REVOKED"`, `"ACCOUNT_DISABLED"`, or `"AUTH_REQUIRED"` is duplicated three times. Extract into a helper function (e.g. `AuthDecision::error_code(&self)`).

2. **Dead Code Cleanup: `websocket_auth_ok`**
   - **File:** `server/src/api/ws.rs:258-265`
   - **Note:** Marked `#[allow(dead_code)]`. Only tests signature without session evaluation. Production `ws_handler` does not use it. Remove or mark `#[cfg(test)]`.

3. **Immediate Ticket Revocation in Media Chunk Guard**
   - **File:** `server/src/api/media_stream_response.rs:444`
   - **Note:** When `stream_body` terminates a stream due to MongoDB session revocation mid-transfer, it returns `None` without explicitly calling `state.media_tickets.revoke(...)`. While subsequent requests hitting `respond` will revoke the ticket on their initial check, explicitly revoking upon detecting revocation would immediately free the ticket in memory.

---

## Positive Observations

- **Fail-Closed Design:** MongoDB lookups in `ws.rs` and `media_stream_response.rs` enforce 2-second timeouts and close connections with `CLOSE_AUTH_UNAVAILABLE` (1013) on timeout or error rather than allowing cached access.
- **Priority Queue Bypassing Backpressure:** `WireMsg::CloseAuth` is sent via `alert_tx` with `biased;` selection in the writer loop, ensuring close signals bypass massive PTY and FS backpressure queues.
- **Zero Grace Period:** 10-day MFA freshness and 30-day session expiry use exact `>=` zero-grace checks in `policy.rs`.
- **PTY Session Preservation:** WS teardown aborts subscribers, pumps, and plugin epochs while deliberately keeping PTY processes alive in `PtySessionManager` for client reattachment after re-authentication.
- **404 Concealment:** Media tickets conceal existence on authorization failure or expiry by returning `404 NOT_FOUND` across all checks.

---

## Reviewed Files

- `server/src/api/auth.rs`
- `server/src/api/ws.rs`
- `server/src/api/ws_protocol.rs`
- `server/src/fs/media_ticket.rs`
- `server/src/fs/video_ticket.rs`
- `server/src/fs/image_ticket.rs`
- `server/src/api/fs_video.rs`
- `server/src/api/fs_image.rs`
- `server/src/api/media_stream_response.rs`
- `server/src/auth/mod.rs`
- `server/src/state.rs`
- `server/src/api/tests.rs`
- `server/tests/transport_enforcement_phase03.rs`
- `plans/260926-2157-token-rotation-mfa/phase-03-transport-enforcement.md`
- `plans/260926-2157-token-rotation-mfa/plan.md`

---

## Validation Commands and Results

- `cargo test --test transport_enforcement_phase03`: 5 passed; 0 failed (7.97s)
  - `test_shared_policy_admission_and_legacy_token_rejection`: OK
  - `test_out_of_band_reset_and_disabled_account`: OK
  - `test_websocket_admission_and_close_code_invariants`: OK
  - `test_logout_revokes_session_durable`: OK
  - `test_websocket_live_revocation_closes_connection`: OK
- `cargo test media_ticket`: 16 passed; 0 failed (0.75s)
- `cargo test api::tests`: 160 passed; 0 failed (8.13s)
- Full test suite: 1529 passed; 0 failed

---

## Unresolved Questions

*None.*
