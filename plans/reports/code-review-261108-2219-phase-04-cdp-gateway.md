# Code Review: Phase 04 — Authenticated Instance-Scoped Raw CDP Gateway

**Target Phase:** Phase 04 (`plans/261108-0237-host-browser-cdp-streaming/phase-04-agent-cdp-gateway.md`)  
**Score:** 9.2/10  
**Status:** Approved with minor suggestions

---

## 1. Scope & Reviewed Files
- `server/src/browser_host/cdp_gateway.rs` (793 LOC, created)
- `server/src/browser_host/mod.rs` (modified)
- `server/src/api/browser_host.rs` (modified)
- `server/src/api/router.rs` (modified)
- `server/tests/browser_host_gateway.rs` (357 LOC, created)
- `packages/ui/e2e/os-host-browser/agent.spec.ts` (217 LOC, created)
- `server/examples/browser_host_qualification.rs` (modified)
- `packages/ui/e2e/fixtures/browser-host-qualification.ts` (modified)

Total lines analyzed: ~1,500 LOC.

---

## 2. Assessment Summary
Implementation strictly satisfies Phase 04 and `architecture-contracts.md` §1–§5:
- Authenticated discovery (`/json/version`, `/json/list`, `/json`) against principal instance with rewritten gateway URLs.
- Zero leakage of raw Chromium loopback endpoints (`127.0.0.1:{chrome_port}`) in discovery responses and `devtoolsFrontendUrl`.
- Strict Origin validation: exact case-sensitive byte match, rejected on `null`, trailing slashes, or comma/multi-origins.
- Origin-less requests permitted ONLY for Bearer-authenticated clients; capability-only (ticket) upgrades without Origin rejected.
- Single-use ticket capability support (`damhopper.ticket.<base64url>`) in `Sec-WebSocket-Protocol`, returning only `damhopper.browser.cdp.v1`.
- Dedicated upstream WebSocket per agent with 4 MiB frame/message caps and 5s per-write deadline.
- Periodic 5s live auth admission rechecks with automatic disconnection upon role demotion or session revocation.
- Global concurrency limiter enforced (default 2 connections, immediate 429 response when busy).
- Clean RAII drop on permits preventing capacity leaks on disconnect or cancellation.
- Complete qualification test coverage (8 Rust integration tests + 7 Playwright E2E tests, 100% pass).

---

## 3. Issues & Findings

### Critical Issues (0)
*None.*

### Warnings (2)
1. **Inline Live Auth Recheck Stalls Message Forwarding Under DB Load**
   - **File & Line:** `server/src/browser_host/cdp_gateway.rs:712-720`
   - **Details:** `verify_live_admission(&state, &admission).await` executes directly inside the primary relay `tokio::select!` branch. It performs SQLite user/session queries with a 2-second timeout. If the database is under load or blocked, bidirectional message relay between client and browser is completely stalled for up to 2 seconds every 5 seconds.
   - **Recommendation:** Decouple live auth checking into a background task or watcher that triggers an atomic cancellation token, or ensure the check doesn't block forwarding in `tokio::select!`.

2. **Unvalidated `target_id` Segment in Upstream Target Routing**
   - **File & Line:** `server/src/browser_host/cdp_gateway.rs:628-643`
   - **Details:** `target_id` from the path parameter is interpolated directly into `ws://127.0.0.1:{chrome_port}/devtools/page/{tid}` without verifying format against expected hexadecimal/alphanumeric target IDs.
   - **Recommendation:** Validate `tid.chars().all(|c| c.is_ascii_alphanumeric() || c == '-' || c == '_')` and bound its length before constructing the upstream URL.

### Suggestions (4)
1. **Hardcoded Capacity Ignores Configured Budget**
   - **File & Line:** `server/src/browser_host/cdp_gateway.rs:32,38-39`
   - **Details:** `GLOBAL_CDP_GATEWAY` is a static `LazyLock` initialized to `DEFAULT_MAX_AGENT_CDP_CONNECTIONS = 2`. `BrowserBudgetsConfig::max_raw_cdp_connections` exists in configuration (allowing 1..8), but is bypassed.
   - **Recommendation:** Associate `CdpGatewayManager` with `BrowserHostManager` or initialize it with `config.budgets.max_raw_cdp_connections`.

2. **Per-Request `reqwest::Client` Construction in Discovery Endpoints**
   - **File & Line:** `server/src/browser_host/cdp_gateway.rs:294-297, 411-414`
   - **Details:** A new `reqwest::Client` is built on every invocation of `get_cdp_version` and `get_cdp_list`.
   - **Recommendation:** Cache a shared client in `LazyLock` or `AppState` to eliminate repetitive allocator overhead.

3. **Immediate First Tick on Auth Recheck Interval**
   - **File & Line:** `server/src/browser_host/cdp_gateway.rs:707, 712`
   - **Details:** Tokio's `interval` ticks immediately on the first iteration, causing a redundant immediate database query right after initial connection admission.
   - **Recommendation:** Call `auth_check_interval.tick().await` once before the loop, or use `interval_at`.

4. **Minor Clippy Lints**
   - **File & Line:** `server/src/browser_host/cdp_gateway.rs:355, 478, 731, 737, 743, 763, 769, 775`
   - **Details:** Redundant borrow on `trim_start_matches` and useless `b.into()` on existing `Bytes` instances.

---

## 4. Verification Results
- **Rust Integration Tests:**
  `cargo test --manifest-path server/Cargo.toml --test browser_host_gateway -- --nocapture`
  Result: 8 passed; 0 failed (0.68s)
- **Playwright E2E Tests:**
  `pnpm --filter @dam-hopper/ui exec playwright test e2e/os-host-browser/agent.spec.ts`
  Result: 7 passed (7.0s)
- **Regression Suites:**
  `cargo test --manifest-path server/Cargo.toml --test browser_host_admission --test browser_host_auth --test browser_host_input --test browser_host_lifecycle --test browser_host_shutdown -- --nocapture`
  Result: 33 passed across 5 test suites (0.51s)
- **TypeScript Typecheck:**
  `pnpm --filter @dam-hopper/ui run test:e2e:typecheck`
  Result: 0 errors (1.26s)

---

## 5. Unresolved Questions
None.
