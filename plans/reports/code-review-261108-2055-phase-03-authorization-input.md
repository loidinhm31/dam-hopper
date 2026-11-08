# Code Review Summary: Phase 03 — Authorize sessions attachments and ordered input

### Scope
- **Files reviewed**:
  - `server/src/browser_host/network_policy.rs` (236 LOC)
  - `server/src/browser_host/auth.rs` (372 LOC)
  - `server/src/browser_host/session.rs` (752 LOC)
  - `server/src/browser_host/attachments.rs` (701 LOC)
  - `server/src/browser_host/input.rs` (607 LOC)
  - `server/src/browser_host/mod.rs` (12 LOC)
  - `server/src/api/browser_host.rs` (1090 LOC)
  - `server/src/api/mod.rs` (50 LOC)
  - `server/src/api/router.rs` (948 LOC)
  - `server/tests/browser_host_admission.rs` (516 LOC)
  - `server/tests/browser_host_auth.rs` (410 LOC)
  - `server/tests/browser_host_input.rs` (609 LOC)
- **Lines of code analyzed**: ~6,300 LOC (direct Phase 03 diff: ~3,800 LOC)
- **Review focus**: Security (OWASP, bypass, credentials, origin checks), Performance (bounded memory, leaks, concurrency), Architecture (contracts conformance), and YAGNI/KISS/DRY.
- **Updated plans**: `plans/261108-0237-host-browser-cdp-streaming/phase-03-admission-control.md`

---

### Overall Assessment
**Score**: **7.2 / 10** (Pending Cycle 2 remediation)

Phase 03 implementation delivers comprehensive admission control, ticket minting/atomic consumption, session idempotency, cooperative control leasing, and ordered input queues. All 38 unit and integration tests compile cleanly and pass with zero test failures.

However, several critical and high-priority issues require remediation before advancing to Phase 04 / Phase 05:
1. URL policy allows `localhost` and bracketed IPv6 `[::1]` to bypass private/metadata destination denial in production mode.
2. `SessionInputManager` lacks any dequeue or drain mechanism, guaranteeing that 128 keystrokes or mouse clicks will overflow the queue and revoke the active lease.
3. `ActiveAttachment` drops `auth_version`, `credential_version`, and `effective_deadline`, blinding the live supervisor check during active streaming.
4. Monotonic memory leak in `GLOBAL_INPUT_MANAGERS` because entries are never removed upon session deletion or reset.

---

### Critical Issues

#### 1. Unchecked `localhost` and Bracketed IPv6 in Production URL Policy (`network_policy.rs:146–162`)
- **Problem**: In `validate_navigation_url`, production mode denies cloud metadata and private IP ranges via `host_str.parse::<IpAddr>()`. However:
  1. `localhost` is a hostname and fails `parse::<IpAddr>()`; it is only checked in `is_dev` mode. Thus `http://localhost:<port>/` is permitted in production without being in `allowed_origins`.
  2. IPv6 hosts in URLs are bracketed (e.g. `[::1]` or `[fe80::1]`). In Rust, `"[::1]".parse::<IpAddr>()` returns `Err(AddrParseError(Ip))`. Consequently, IPv6 loopback (`[::1]`) and IPv6 link-local addresses completely bypass the private IP denial in production.
- **Impact**: Server-Side Request Forgery (SSRF) / Loopback policy bypass against local host services in production.
- **Correction**:
  ```rust
  // Check loopback hostnames
  if host_str.eq_ignore_ascii_case("localhost") && !is_allowed_project_origin {
      return Err(NetworkPolicyError::DeniedDestination("localhost (loopback)".to_string()));
  }

  // Parse IP (strip brackets if IPv6)
  let ip_candidate = host_str.trim_start_matches('[').trim_end_matches(']');
  if let Ok(ip) = ip_candidate.parse::<IpAddr>() {
      if is_private_or_metadata_ip(ip) && !is_allowed_project_origin {
          return Err(NetworkPolicyError::DeniedDestination(format!("{ip} (private/metadata IP)")));
      }
  }
  ```

---

### High Priority Findings

#### 2. `SessionInputManager` Queue Missing Dequeue/Drain Causes Guaranteed Lease Revocation (`input.rs:360–464`)
- **Problem**: `enqueue_input` appends non-coalesced `InputMessage`s to `self.queue` (`q_guard.push_back(msg.clone())`) and increments `total_queued_bytes`. However, `SessionInputManager` exposes no method to pop, dequeue, or drain messages from `self.queue`.
- **Impact**: During interactive usage (typing or clicking), `q_guard.len()` monotonically increases until it reaches `MAX_RELIABLE_RECORDS` (128). At message 129, `InputError::QueueOverflow` triggers `self.revoke_lease().await`, revoking the user's control lease and dropping all active keys/buttons.
- **Correction**: Expose a drain or pop method:
  ```rust
  pub async fn drain_inputs(&self) -> Vec<InputMessage> {
      let mut q = self.queue.lock().await;
      let mut bytes = self.total_queued_bytes.lock().await;
      *bytes = 0;
      q.drain(..).collect()
  }
  ```

#### 3. `ActiveAttachment` Discards Auth & Credential Versions and Deadline (`attachments.rs:135–145, 425–435, 520–536`)
- **Problem**: `AdmittedAttachment` has `auth_version`, `credential_version`, and `effective_deadline`. When `register_connection` creates `ActiveAttachment`, it discards these three fields. When `start_supervisor` runs `verify_live_admission`, it constructs `BrowserAdmission` with `None` for all three.
- **Impact**: If a user changes their password or credentials (incrementing `auth_version` or `credential_version`), or when their JWT token expires past its `effective_deadline`, the background supervisor will never cancel the active streaming attachment socket.
- **Correction**: Add `auth_version: Option<i64>`, `credential_version: Option<i64>`, and `effective_deadline: Option<DateTime<Utc>>` to `ActiveAttachment`, copy them in `register_connection`, and pass them to `BrowserAdmission` in `start_supervisor`.

#### 4. Monotonic Memory Leak in `GLOBAL_INPUT_MANAGERS` (`api/browser_host.rs:48–53, 384–395, 1022–1025`)
- **Problem**: `get_or_create_input_manager(&id)` creates and inserts an `Arc<SessionInputManager>` into `GLOBAL_INPUT_MANAGERS` for every session accessed. When `delete_session` is called, it calls `mgr.revoke_lease().await`, but never removes `id` from `GLOBAL_INPUT_MANAGERS`. `reset_profile` also never cleans it up.
- **Impact**: Every browser session created over the server's uptime permanently leaks an entry in `GLOBAL_INPUT_MANAGERS`.
- **Correction**:
  In `delete_session`:
  ```rust
  if let Some(mgr) = global_input_managers().write().await.remove(&id) {
      mgr.revoke_lease().await;
  }
  ```
  And in `reset_profile`, remove input managers for all principal sessions.

---

### Medium Priority Improvements

#### 5. Idempotency Record Capacity Evicts Instead of Rejecting (`session.rs:305–315`)
- **Problem**: When `principal_recs.len() >= MAX_IDEMPOTENCY_RECORDS_PER_PRINCIPAL` (128), `session.rs` evicts the oldest idempotency record. Architecture contracts Section 3 Table line 38 explicitly mandates: *"admission rejects rather than evicts live retry record"*.
- **Impact**: Silent eviction allows retry collisions or unbounded creation churn.
- **Correction**: Return `Err(SessionError::Busy("idempotency capacity reached".to_string()))` when unexpired records exceed 128.

#### 6. Lease Renewal Not Clipped to Auth Deadline (`api/browser_host.rs:624–659`, `input.rs:300–317`)
- **Problem**: `renew_lease` always extends the lease by `LEASE_TTL` (30s). Architecture contract Section 4 line 66 requires: *"no renewal after auth deadline"*.
- **Impact**: A user with an auth deadline in 2 seconds can renew their control lease for 30 seconds.
- **Correction**: Pass `admission.effective_deadline` to `renew_lease` and clip `expires_at = min(now + LEASE_TTL, deadline)`. If `now >= deadline`, return `Err(InputError::LeaseExpired)`.

#### 7. Session Navigation Does Not Invalidate Cached Selection (`api/browser_host.rs:406–439`)
- **Problem**: In `navigate_session`, `navigation_revision` is incremented and the new URL is set, but `SessionInputManager::selected_text` is not cleared. Contract Section 4 line 61 and Section 8 line 128 require: *"new revision invalidates selection"*.
- **Impact**: Stale text selected on the previous page is accessible after navigating to an unrelated target.
- **Correction**: Call `input_mgr.set_selected_text("").await` in `navigate_session`.

#### 8. `start_supervisor` Lacks Idempotency Guard (`attachments.rs:511–552`)
- **Problem**: `start_supervisor` spawns a background tokio task with an infinite loop without checking if a supervisor is already running. If called multiple times, duplicate supervisor tasks run concurrently.
- **Correction**: Guard with `std::sync::atomic::AtomicBool` (`supervisor_started.compare_exchange(...)`).

#### 9. Dead Code Warning on `StoredTicket.created_at` (`attachments.rs:114`)
- **Problem**: Clippy warning `field created_at is never read` in `StoredTicket`.
- **Correction**: Remove or utilize in ticket pruning diagnostics.

---

### Low Priority Suggestions

1. **Encapsulate Global Statics in `BrowserHostManager` / `AppState`**:
   `GLOBAL_SESSION_REGISTRY`, `GLOBAL_ATTACHMENT_MANAGER`, and `GLOBAL_INPUT_MANAGERS` are currently static `LazyLock`s in `api/browser_host.rs` to satisfy Phase 03's allowed file constraints. In Phase 05/08, migrate them to `BrowserHostManager` on `AppState`.
2. **Periodic Closed Session Pruning in `SessionRegistry`**:
   `SessionRegistry` retains closed sessions indefinitely in `self.sessions`. Closed sessions older than 10 minutes (`IDEMPOTENCY_TTL`) should be pruned periodically to prevent memory accumulation in long-running deployments.
3. **Check Bound Listener in `evaluate_browser_admission`**:
   Dev bypass validates peer loopback, but should also ensure the server's listener is bound to loopback via `state.config`.

---

### Positive Observations
- **Strict Role Verification**: Production admission independently queries the live database store (`store.get_user(&actor.subject)`) to ensure the user has the active, enabled `UserRole::Admin`. Cached claims and UI assertions are never trusted as authority.
- **Dev Bypass Security**: Dev bypass strictly enforces `state.no_auth`, peer IP loopback (`127.0.0.1` / `::1`), and exact match against configured `cors_origins`. Forwarded headers are explicitly ignored.
- **Single-Use Capability Tickets**: Tickets are 256-bit random cryptographic tokens. Only SHA-256 hashes are persisted in memory, and consume operations are atomic (`remove(&hash)`), preventing replay attacks and token probing.
- **Ordered Input & Barrier Integrity**: Strict decimal sequence enforcement with automatic lease revocation on sequence gaps. Coalescing is correctly applied only between ordering barriers (modifier changes, button/key down/up).
- **Comprehensive Test Harness**: Excellent integration test coverage across admission (`browser_host_admission.rs`), auth & tickets (`browser_host_auth.rs`), and leased input/epochs (`browser_host_input.rs`).

---

### Recommended Actions (Cycle 2 Remediation)
1. In `network_policy.rs`, add loopback check for `localhost` in production, and strip IPv6 brackets `[ ]` before parsing IP addresses.
2. In `input.rs`, add `pub async fn drain_inputs(&self) -> Vec<InputMessage>` to pop messages and decrement `total_queued_bytes`.
3. In `attachments.rs`, store `auth_version`, `credential_version`, and `effective_deadline` in `ActiveAttachment`, and pass them to `verify_live_admission`.
4. In `api/browser_host.rs`, remove input managers from `GLOBAL_INPUT_MANAGERS` on `delete_session` and `reset_profile`.
5. In `session.rs`, reject admission when idempotency capacity is reached instead of evicting existing records.
6. In `api/browser_host.rs` / `input.rs`, clip control lease renewal to `effective_deadline` and clear selected text on `navigate_session`.
7. Remove unused `created_at` field from `StoredTicket` in `attachments.rs`.

---

### Metrics
- **Tests**: 38 passed across 5 test suites (`browser_host_admission`, `browser_host_auth`, `browser_host_input`, `auth_no_auth`, `auth_device_sessions`).
- **Phase 03 direct warnings**: 1 Clippy warning (`created_at` in `StoredTicket`).
- **Security / Architecture Conformance**: 1 Critical issue, 3 High priority issues, 5 Medium priority improvements.

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
  - Result: **19 passed (3 suites, 0.34s)**
- `cargo test --manifest-path server/Cargo.toml --test auth_no_auth --test auth_device_sessions`
  - Result: **19 passed (2 suites, 1.18s)**
- Total: **38 passed (5 suites, 1.52s)**

---

### Unresolved Questions
1. Should `SessionRegistry` enforce a maximum lifetime for retained closed sessions (e.g. 10 minutes matching `IDEMPOTENCY_TTL`) before pruning from memory?
2. Will Phase 04 / Phase 05 mount the supervisor loop during WebSocket upgrade connection registration, or will it be initiated on server startup?
