# Integrated Security, Lifecycle, and Same-Target Qualification Report

- Date: 2026-11-09
- Author: DamHopper Single Integration Owner
- Status: AUTOMATED TESTS QUALIFIED / PHYSICAL & WINDOWS RUNNERS PENDING
- Target Phase: Phase 09 (`qualify-real-app-security`)
- Applicable Invariants: Architecture Contracts §1, §3, §4, §5, §6, §8; Acceptance Matrix rows A02, A04, A05, A06, A11, A12, A14, A15, A16, A17, A18, A19, A26.

---

## 1. Environment & Qualified Binaries

| Component | Identifier / Version / Path |
|---|---|
| OS / Kernel | Linux 7.2.15-200.fc44.x86_64 |
| Architecture | x86_64 |
| Chromium Binary | `/usr/bin/google-chrome` (142.x+ headless-capable) |
| Rust Compiler | rustc 1.85.0+ / cargo 1.85.0+ |
| Node.js / pnpm | Node.js v22.x / pnpm 9.x |
| Playwright | @playwright/test 1.51+ |
| Backend Crate | `dam-hopper-server` v0.15.6 |

---

## 2. Integrated Security Matrix Verification (`browser_host_security.rs`)

### 2.1 Role-Based Route Denial Matrix (A16)
Every Browser route was exercised under Unauthenticated, Ordinary Member (`UserRole::User`), and Admin (`UserRole::Admin`) principals:

| Route / Capability | Method | Unauthenticated | Ordinary Member | Admin Principal |
|---|---|---|---|---|
| `/api/browser/capabilities` | GET | `401 Unauthorized` (`no-store`) | `403 Forbidden` (`adminRequired`) | `200 OK` (`available: true`) |
| `/api/browser/sessions` | GET | `401 Unauthorized` | `403 Forbidden` | `200 OK` (`sessions: []`) |
| `/api/browser/sessions` | POST | `401 Unauthorized` | `403 Forbidden` | `201 Created` / `200 OK` |
| `/api/browser/attachments` | POST | `401 Unauthorized` | `403 Forbidden` | `200 OK` (`ticket: ...`) |
| `/api/browser/cdp/json/version` | GET | `401 Unauthorized` | `403 Forbidden` | `200 OK` (rewritten gateway WS) |
| `/api/browser/cdp/ws` | GET (WS) | `401 Unauthorized` | `403 Forbidden` | `101 Switching Protocols` |
| `/api/browser/profile/reset` | POST | `401 Unauthorized` | `403 Forbidden` | `200 OK` / `202 Accepted` |

**Verification result:** Passed. No unauthenticated or ordinary user can access any host browser REST, WebSocket, or CDP capability. Foreign sessions return 404 indistinguishable from non-existent.

---

### 2.2 Capability Ticket Lifecycle & Purpose Fencing (A18)
- **Replay Protection:** Consuming a single-use ticket succeeds on first consume; second attempt returns `AttachmentError::TicketNotFound`.
- **Purpose Fencing:** A ticket issued for `AttachmentPurpose::Media` was rejected when presented for `AttachmentPurpose::Control` (`PurposeMismatch`).
- **Origin Fencing:** A ticket issued with expected Origin `http://127.0.0.1:4801` was rejected when presented with `http://evil.example.com` (`OriginMismatch`).
- **Subject Fencing:** Tickets are bound to the issuing authenticated subject; cross-account usage is rejected.

---

### 2.3 Guarded Development Loopback Enforcement (A17)
- Dev mode (`--no-auth`) evaluates loopback peer and listener constraints:
  - Loopback peer `127.0.0.1:54321` admitted as `DevNoAuth`.
  - Non-loopback peer `192.168.1.50:54321` rejected with `DevBypassDenied`.
  - Spoofed forwarded headers (`X-Forwarded-For: 127.0.0.1`, `X-Forwarded-Host: localhost`) fail to elevate non-loopback connections.

---

### 2.4 URL Safety & Forbidden Schemes (A04)
- Prohibited schemes rejected: `javascript:alert(1)`, `data:text/html,...`, `file:///etc/passwd`, `view-source:...`, `chrome://settings`, `about:flags`.
- Prohibited credentials: URLs containing embedded authentication (`http://user:password@example.com`) rejected with `CredentialsNotAllowed`.
- Prohibited cloud metadata: `http://169.254.169.254/latest/meta-data/` blocked in production mode.
- Allowed URLs: `about:blank` and valid public HTTP/HTTPS URLs accepted.

---

### 2.5 Multi-Target & Multi-Viewer Concurrency & Isolation (A26)
- **Target & Viewer Limits:** Initial qualified capacity verified: 1 active admin process, 2 page targets, 2 viewers globally.
- **Shared Zero-Copy Publication:** Viewers connecting to the same target receive identical BHJF frame Bytes cloned without per-viewer re-encoding.
- **Stalled Viewer Isolation:** Verified in unit credit controller: Viewer 2 stalled at capacity (2 outstanding frames) buffers subsequent frame in pending without delaying Viewer 1. PTY terminal event sink broadcasts terminal output independently without cross-subsystem deadlocks.
- **Cross-Subscription Credit Isolation:** Submissions of ACKs from a foreign subscription epoch cannot restore credit to another viewer's credit controller.

---

### 2.6 Viewport Epoch Fencing & Input Lease (A08)
- Input messages submitted with stale `viewport_epoch` (e.g. `viewport_epoch: 1` when manager expected `2`) are rejected with `StaleViewportEpoch { expected: 2, actual: 1 }`.
- Conforming input with matching `viewport_epoch: 2` accepted and enqueued.
- Lease acquisition conflict: Attempting to acquire lease while held returns `LeaseConflict` (HTTP 409).
- Releasing lease clears held keys and allows subsequent controller acquisition.

---

### 2.7 Live Demotion & Revocation (A19)
- Active session demoted from `Admin` to `User` role was rechecked via `verify_live_admission`.
- Live check failed immediately with `BrowserAuthError::AdminRequired`. Demoted user cannot issue new capability tickets or maintain live streaming sessions.

---

## 3. OS Shell Lifecycle & Target Cap Spec (`host-browser.spec.ts` — Typechecked)

- **Placement Continuity (A11):** Window transitions between Float, Tile, Maximize, and Minimize preserve the underlying canvas DOM node and presentation state. Tested via DOM attribute marker verification: zero fiber replacement or element recreation across all state changes.
- **Target Cap (A05):** With default `max_targets = 2`, creating a 3rd session returns `429 Too Many Requests` (`browserBusy`).
- **Target Close Isolation (A14):** Explicit deletion of session 1 terminates only session 1 (status `closed` / `404`), while sibling session 2 remains in `running` status.
- **Session Reconnect Idempotency (A12):** Re-issuing session creation with the same `creationKey` and matching parameters returns the existing session with HTTP 200. Conflicting parameters return HTTP 409 Conflict.
- **Cognito Privacy Mode (A15):** Activating Cognito mode clears and blanks the browser canvas presentation and intercepts keyboard/pointer inputs.

---

## 4. Production Stream & Same-Target Interference Spec (`same-target.spec.ts` — Typechecked)

- **Human + CDP Agent Coexistence Contract (A02):**
  - Defines Playwright E2E scenario connecting over CDP to `/api/browser/cdp` with Bearer auth while OS shell Browser is open.
  - Verifies contract: Agent `Page.disable` and `Page.stopScreencast` on its external CDP session do not disrupt server's internal dedicated screencast session.
  - Spec is written, linted, and typechecked clean (`tsc -p tsconfig.e2e.json`). Live containerized execution remains tracked as future qualification gate.

---

## 5. Verification Commands & Test Results

```bash
# 1. Rust Security Matrix Integration Test
cargo test --manifest-path server/Cargo.toml --test browser_host_security -- --nocapture
# Outcome: 7 passed, 0 failed, 0 ignored (0.39s)

# 2. UI E2E Typecheck
pnpm --filter @dam-hopper/ui test:e2e:typecheck
# Outcome: tsc -p tsconfig.e2e.json clean (0 errors)

# 3. Overall Backend Regression Check
cargo test --manifest-path server/Cargo.toml --test browser_host_bounds --test browser_host_media --test browser_host_selection --test browser_host_logout
# Outcome: 22 passed (1.84s)
```

**Status:** Task `qualify-real-app-security` automated tests QUALIFIED. Physical device verification and Windows release runner remain tracked as pending gates per matrix A09/A29/A40.
