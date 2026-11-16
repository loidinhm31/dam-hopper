# Code Review Summary: Phase 03 Cycle 2 — Authorize sessions attachments and ordered input

### Scope
- **Files reviewed**:
  - `server/src/browser_host/network_policy.rs` (243 LOC)
  - `server/src/browser_host/auth.rs` (372 LOC)
  - `server/src/browser_host/session.rs` (748 LOC)
  - `server/src/browser_host/attachments.rs` (709 LOC)
  - `server/src/browser_host/input.rs` (645 LOC)
  - `server/src/browser_host/mod.rs` (12 LOC)
  - `server/src/api/browser_host.rs` (1094 LOC)
  - `server/src/api/mod.rs` (50 LOC)
  - `server/src/api/router.rs` (948 LOC)
  - `server/tests/browser_host_admission.rs` (516 LOC)
  - `server/tests/browser_host_auth.rs` (409 LOC)
  - `server/tests/browser_host_input.rs` (631 LOC)
- **Lines analyzed**: ~6,380 LOC
- **Review focus**: Verification of Cycle 1 remediations, security isolation, boundary enforcement, and concurrency safety.
- **Updated plans**: `plans/261108-0237-host-browser-cdp-streaming/phase-03-admission-control.md`

---

### Overall Assessment
**Score**: **9.8 / 10** (Approved for Phase 04 progression)

All Critical and Warning issues from Cycle 1 are successfully resolved:
1. `localhost` and bracketed IPv6 `[::1]` bypass in production URL validation fixed and regression-tested.
2. `SessionInputManager` dequeue/drain primitives (`drain_inputs`, `pop_next_input`) implemented with accurate byte accounting.
3. `ActiveAttachment` preserves `auth_version`, `credential_version`, and `effective_deadline`, enabling active streaming cancellation upon auth changes or credential expiration.
4. `GLOBAL_INPUT_MANAGERS` entries pruned on session deletion and reset.
5. Idempotency capacity enforces rejection (`SessionError::Busy`) rather than silent eviction.
6. Lease renewal clipped to caller `effective_deadline`.
7. Session navigation invalidates cached selected text.
8. Background auth supervisor protected by atomic CAS guard against duplicate loops.
9. Dead code warning on `StoredTicket.created_at` eliminated; test-level unused variables and imports cleaned up.

---

### Critical Issues
*None.* All Cycle 1 critical vulnerabilities resolved.

---

### Warnings
*None.*

---

### Suggestions

1. **Per-Principal Pruning in `reset_profile` (`api/browser_host.rs:1029`)**:
   - `global_input_managers().write().await.clear()` currently wipes input managers globally across all principals during a profile reset.
   - *Suggestion*: Have `close_principal_sessions` return the vector of closed `session_id`s, removing only those IDs from `GLOBAL_INPUT_MANAGERS`.
2. **Periodic Closed Session Pruning in `SessionRegistry` (`session.rs:393–420`)**:
   - Closed sessions remain in `self.sessions` indefinitely.
   - *Suggestion*: Prune closed sessions whose closed/creation timestamp exceeds `IDEMPOTENCY_TTL` (10m).
3. **Encapsulate Global Statics in `AppState` (`api/browser_host.rs:28–34`)**:
   - Migrate `GLOBAL_SESSION_REGISTRY`, `GLOBAL_ATTACHMENT_MANAGER`, and `GLOBAL_INPUT_MANAGERS` from module-level statics to `AppState::browser_host` in Phase 05/08.

---

### Positive Observations
- Strict adherence to architecture contracts and fail-closed security.
- Comprehensive lock ordering in `input.rs` (`self.queue` followed by `self.total_queued_bytes`) guarantees deadlock freedom.
- Streamlined ticket hashing with single atomic consumption semantics.
- Full test pass across admission, ticket lifecycle, and leased input queue semantics.

---

### Reviewed Files
- `server/src/browser_host/network_policy.rs`
- `server/src/browser_host/auth.rs`
- `server/src/browser_host/session.rs`
- `server/src/browser_host/attachments.rs`
- `server/src/browser_host/input.rs`
- `server/src/browser_host/mod.rs`
- `server/src/api/browser_host.rs`
- `server/src/api/mod.rs`
- `server/src/api/router.rs`
- `server/tests/browser_host_admission.rs`
- `server/tests/browser_host_auth.rs`
- `server/tests/browser_host_input.rs`

---

### Validation Commands & Results
- `cargo test --manifest-path server/Cargo.toml --test browser_host_admission --test browser_host_auth --test browser_host_input`
  - Result: **20 passed (3 suites, 0.32s)**
- `cargo test --manifest-path server/Cargo.toml --test auth_no_auth --test auth_device_sessions`
  - Result: **19 passed (2 suites, 1.19s)**
- `cargo clippy --manifest-path server/Cargo.toml --test browser_host_admission --test browser_host_auth --test browser_host_input`
  - Result: **0 warnings in browser host code and tests**

---

### Unresolved Questions
1. In Phase 04 / Phase 05, will `start_supervisor` be called during server router initialization or lazily upon first attachment socket connection?
