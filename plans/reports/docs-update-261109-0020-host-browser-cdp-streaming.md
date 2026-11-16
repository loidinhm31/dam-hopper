# Documentation Update Report: Host Browser CDP & Streaming (Phases 02–04)

**Date:** 2026-11-09  
**Identifier:** `docs-update-261109-0020-host-browser-cdp-streaming`  
**Status:** Work-in-Progress Architectural Remediation Under Roadmap (Finalization Approval Absent; Completion Claims Unverified)

---

## 1. Executive Summary

Documentation has been updated across architecture, API reference, system architecture, codebase summary, and project requirements for Phases 02, 03, and 04 of the Host Browser CDP & Streaming subsystem.

Per user instruction, finalization approval was not granted; the user selected "Execute remediation roadmap". All documentation reflects observed implementation and active architectural remediation under the roadmap; no phases are claimed final or qualified without supporting end-to-end evidence.

---

## 2. Updated Documentation Files

| File | Status / LOC | Scope of Changes |
| --- | --- | --- |
| `docs/architecture/host-browser-cdp-streaming.md` | 464 LOC | Added Section 5 (Authenticated Agent CDP Gateway & Upstream Relay); documented profile lock retention, non-positive PGID rejection, durable containment fencing, exact Origin enforcement, canonical `evaluate_claims`/MFA integration, capability tickets, foreign session checks, live auth cancellation racing with socket writes (`write_with_cancel`), fast teardown, open blockers, and updated source map. |
| `docs/api/browser-host.md` | 662 LOC | Added CDP discovery endpoints (`/api/browser/cdp/json/version`, `/json/list`, `/json`) and raw WebSocket routes (`/ws`, `/ws/{target_id}`, `/cdp`); added Section 6 on Agent CDP Gateway; documented single Origin header enforcement, canonical claims evaluation errors (`mfaRequired`, `invalidSession`, `forbiddenOrigin`), server-derived tickets, foreign session 404 isolation, live auth cancellation racing with writes, and capacity limits (max 2 global connections). |
| `docs/system-architecture.md` | 797 LOC | Updated Host Browser CDP Streaming section to cover Phases 01–04 as WIP architectural remediation under roadmap, preserving file size strictly below 800 LOC ceiling. |
| `docs/codebase-summary.md` | 426 LOC | Updated backend module inventory for `server/src/browser_host/` (15 files) and added summary of Agent CDP Gateway, discovery rewriting, live auth cancellation, and Phase 04 test targets based on Repomix compaction. |
| `docs/project-overview-pdr.md` | 178 LOC | Added requirement entry `PR-038` for Host Browser CDP Streaming (Phases 01–04) as WIP architectural remediation and added acceptance criteria subsection detailing key architectural invariants. |

---

## 3. Key Architectural Invariants Documented

### Profile Lock Retention
- Exclusive advisory OS `flock` (`manager.lock`) is acquired and retained on a stable file inode directly in `<profile_root>/<namespace>/<sha256(subject)>/manager.lock`.
- The lock file itself is never deleted during profile reset or credential wipe (only `user-data/` is purged and recreated), preventing file lock races, directory unlinking races, or concurrent process spawns during teardown.

### Non-Positive PGID Rejection
- During unmanaged prior process group cleanup after restart or crash recovery, any stored `process_pgid <= 1` (where `0` represents the current process group, `-1` all processes, and `1` init/systemd) is rejected fail-closed.
- The tombstone transitions to `ResetStage::Failed`, records `invalid non-positive PGID {pgid}`, and the instance transitions to `InstanceLifecycleState::CleanupPending`, refusing to signal host or init processes.

### Durable Containment Fencing
- Process containment state persists across daemon restarts via atomic `reset.json` tombstones (mode 0600, atomic temp file write + rename) recording `process_pid`, `process_pgid`, and stage (`Initiated`, `Terminating`, `DeletingUserData`, `RecreatingUserData`, `Failed`).
- If containment is unproven (`live_members(pgid) > 0` after 3s SIGTERM grace + 2s SIGKILL proof deadline), the instance enters `CleanupPending` and persists the tombstone, blocking new process launch (`ensure_running` fails closed) until confirmed reset under lock.

### Exact Origin Enforcement (Single Header Check)
- Multiple `Origin` headers (`get_all(ORIGIN).count() > 1`) fail closed with HTTP 403 Forbidden (`kind: "forbiddenOrigin"`).
- Origins containing `"null"`, ending in a trailing slash (`/`), or containing commas (`,`) fail closed with HTTP 403.
- Values must match byte-for-byte against configured `server.cors_origins` or `browser.allowed_dev_origins`.
- Origin-less requests are permitted strictly for loopback dev bypass or clients presenting `Authorization: Bearer <token>`.
- Discovery endpoints evaluate authentication before validating Origin headers to prevent Origin probing / oracle leaks.

### Canonical `evaluate_claims` & MFA Integration
- Authenticates incoming requests via canonical `state.auth_service.evaluate_claims(&claims)` and `compute_mfa_due_at(mfa_verified_at, expires_at)`.
- Revalidates database state: active session not revoked (`revoked_at.is_none()`), `auth_version` and `credential_version` match user records, and caller holds enabled `Admin` role (`UserRole::Admin`).
- Error mapping: `MfaRequired` returns 401 `mfaRequired`, `FullLoginRequired` returns 401 `invalidSession` or 403 `accountDisabled`, `Unavailable` returns 503 `authUnavailable`.

### Server-Derived Capability Tickets & Foreign Session Checks
- Capability tickets are issued exclusively by the server via `POST /api/browser/attachments` using 256-bit random entropy (`rand::rngs::OsRng`), URL-safe unpadded Base64 encoded.
- The server stores only the 32-byte SHA-256 hash in memory (`HashMap<[u8; 32], StoredTicket>`); raw tokens are never persisted or logged.
- Single-use atomic consumption during WebSocket upgrade (`Sec-WebSocket-Protocol: damhopper.ticket.<base64url>`); expires after 30s clipped to auth session deadline.
- Foreign session isolation: requesting, mutating, or closing a session owned by another principal returns HTTP 404 `sessionNotFound` indistinguishable from absent.

### Live Auth Cancellation Racing with Socket Writes & Fast Teardown
- Live supervisor checks `verify_live_admission` every 5 seconds (`LIVE_CHECK_INTERVAL`) with a 2-second database timeout (`LIVE_CHECK_TIMEOUT`).
- Outgoing socket writes wrap send futures with `write_with_cancel`, which uses `tokio::select!` to race the write future against the auth abort channel (`auth_abort_rx`).
- Stalled or in-flight writes are aborted immediately upon auth revocation without waiting for the 5-second `WRITE_DEADLINE`.
- Fast teardown: if aborted due to auth failure (`aborted_by_auth == true`), the relay skips the 500ms cooperative WebSocket close handshake (`close(None)`), dropping client and upstream sockets immediately.
- Instance authority warning: raw CDP grants instance-wide authority, bypassing cooperative input leases and target fences; registered with manager (`register_agent_cdp`) and logged as a security warning.

---

## 4. Open Blockers and Remediation Roadmap Status

1. **Finalization Approval Absent:** The operator selected "Execute remediation roadmap". Phase signoff and finalization claims remain unverified.
2. **End-to-End Multi-Client Qualification Open:** While 41 unit and integration tests pass across `browser_host_gateway.rs`, `browser_host_lifecycle.rs`, and `browser_host_shutdown.rs`, full platform qualification under concurrent human viewers and screencast streaming (Phases 05/06/09) remains open.
3. **Windows Containment Unqualified:** Windows process containment remains unimplemented and fails closed with `ContainmentUnavailable`.
4. **Native Browser Zoom Unverified:** Headless Chromium zoom cannot be verified via standard CDP without layout distortion; non-unit zoom geometry remains flagged `inputTrusted: false`.
5. **Teardown Timing Under Congestion:** Bounded cancellation is subject to operating system socket buffer draining and scheduler latency; immediate teardown is a runtime abort, not a physical network guarantee.
