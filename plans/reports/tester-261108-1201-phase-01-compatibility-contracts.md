# Phase 01 Test Suite Execution Report: Compatibility & Contracts

## 1. Request & Scope
- **Operation:** `run` (code & contract validation)
- **Target Suite:** Plan phase `phase-01-compatibility-contracts`
- **Scope / Targets:**
  1. `cargo test --manifest-path server/Cargo.toml --test browser_host_adapter -- --nocapture`
  2. `cargo test --manifest-path server/Cargo.toml --test browser_host_process -- --nocapture`
  3. `cargo test --manifest-path server/Cargo.toml --test browser_host_compatibility -- --nocapture`
  4. `pnpm --filter @dam-hopper/ui exec playwright test e2e/os-host-browser/compatibility.spec.ts`
- **Working Directory:** `/home/loidinh/WS/dam-hopper`
- **Environment:** Linux 7.2.15-200.fc44.x86_64, Node v24.16.0, Cargo 1.91.0, Google Chrome 157.0.8103.38 (`/usr/bin/google-chrome`)

---

## 2. Execution Summary & Exact Test Counts

| # | Test Target | Exit Code | Duration | Passed | Failed | Skipped | Status |
|---|---|:---:|:---:|:---:|:---:|:---:|:---:|
| 1 | `browser_host_adapter` | 0 | 0.10s | 11 | 0 | 0 | **PASS** |
| 2 | `browser_host_process` | 0 | 0.51s | 3 | 0 | 0 | **PASS** |
| 3 | `browser_host_compatibility` | 0 | 0.39s | 1 | 0 | 0 | **PASS** |
| 4 | `compatibility.spec.ts` | 0 | 1.28s | 4 | 0 | 0 | **PASS** |
| **Total** | **4 Targets** | **0** | **~2.28s** | **19** | **0** | **0** | **PASS (Requested Scope)** |

Auxiliary Check:
- `cargo check --manifest-path server/Cargo.toml --all-targets`: Passed (0 errors, pre-existing warnings in unrelated `api/fs` and `api/ws`). Confirms `tokio-tungstenite` 0.28 upgrade does not break other server targets.

---

## 3. Detailed Execution Evidence

### Target 1: `browser_host_adapter` (11 tests)
- **Command:** `cargo test --manifest-path server/Cargo.toml --test browser_host_adapter -- --nocapture`
- **Result:** `test result: ok. 11 passed; 0 failed; 0 ignored; 0 measured; 0 filtered out; finished in 0.10s`
- **Per-Test Breakdown:**
  1. `test_bhjf_rejects_dimension_mismatch` — `ok`
  2. `test_bhjf_frame_roundtrip` — `ok`
  3. `test_bhjf_rejects_malformed_framing` — `ok`
  4. `test_decimal_sequence_validation` — `ok`
  5. `test_geometry_limits` — `ok`
  6. `test_cdp_screencast_frame_routing` — `ok`
  7. `test_cdp_command_dispatch_and_response` — `ok`
  8. `test_cdp_command_too_large_rejection` — `ok`
  9. `test_cdp_unknown_event_ignore_counter` — `ok`
  10. `test_cdp_pending_commands_bound_enforcement` — `ok`
  11. `test_cdp_oversized_incoming_message_closes_actor` — `ok`

### Target 2: `browser_host_process` (3 tests)
- **Command:** `cargo test --manifest-path server/Cargo.toml --test browser_host_process -- --nocapture`
- **Result:** `test result: ok. 3 passed; 0 failed; 0 ignored; 0 measured; 0 filtered out; finished in 0.51s`
- **Per-Test Breakdown:**
  1. `test_loopback_validation` — `ok` (verifies loopback vs non-loopback rejections: 0.0.0.0, 10.0.0.1, 192.168.1.100, remote domain)
  2. `test_reject_insecure_flags` — `ok` (verifies `--no-sandbox` and `--disable-web-security` rejection)
  3. `test_browser_lifecycle_and_descendant_cleanup` — `ok` (real browser execution: `Found browser executable: /usr/bin/google-chrome`, PID launched, loopback ws endpoint validated, termination signal sent, process group descendant cleanup verified via `killpg`)
- **Non-vacuity note:** Did not skip; detected and executed `/usr/bin/google-chrome`.

### Target 3: `browser_host_compatibility` (1 test)
- **Command:** `cargo test --manifest-path server/Cargo.toml --test browser_host_compatibility -- --nocapture`
- **Result:** `test result: ok. 1 passed; 0 failed; 0 ignored; 0 measured; 0 filtered out; finished in 0.39s`
- **Observed Runtime Diagnostics:**
  - `[Engine Qualification] Target browser: /usr/bin/google-chrome`
  - `[Engine Qualification] Product: Chrome/157.0.8103.38, Protocol: 1.3, User-Agent: Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) HeadlessChrome/157.0.0.0 Safari/537.36`
  - `[Engine Qualification] Created target: TargetId("551635BFD16D065BA8278B8B064D4D10")`
  - `[Engine Qualification] Attached session: 2F7C4E44F19821F4FD498EED3AD8910E`
  - `[Engine Qualification] Received frame #1 for session 2F7C4E44F19821F4FD498EED3AD8910E (base64 len: 3416)`
  - `[Engine Qualification] Screencast JPEG SOF dimensions: 780x493`
  - `[Engine Qualification] Layout metrics: cssLayoutViewSize=LayoutViewport { page_x: 0, page_y: 0, client_width: 780, client_height: 493 }`
  - `[Engine Qualification] Recovery screenshot dimensions: 780x493`
  - `[Engine Qualification] Real-engine qualification completed successfully!`
- **Non-vacuity note:** Did not skip; executed against live Google Chrome 157.0.8103.38.

### Target 4: `compatibility.spec.ts` (4 tests)
- **Command:** `pnpm --filter @dam-hopper/ui exec playwright test e2e/os-host-browser/compatibility.spec.ts`
- **Execution Run 1 (Default Reporter):** 4 passed (746ms), wall time 1.30s
- **Execution Run 2 (List Reporter):** 4 passed (725ms), wall time 1.28s
- **Per-Test Breakdown (List Reporter):**
  1. `Host Browser Engine Qualification — CDP and Auth Compatibility › rejects unauthenticated discovery request with HTTP 401 (15ms)`
  2. `Host Browser Engine Qualification — CDP and Auth Compatibility › accepts authenticated discovery request with Bearer token (8ms)`
  3. `Host Browser Engine Qualification — CDP and Auth Compatibility › accepts authenticated WebSocket upgrade with Bearer token (12ms)`
  4. `Host Browser Engine Qualification — CDP and Auth Compatibility › proves Playwright Authorization reached BOTH discovery and WebSocket upgrade (5ms)`

---

## 4. Assessment & Remaining Risk Boundaries

1. **Requested 4 targets:** **PASS (19/19 passed, 0 failures, 0 skips)**.
2. **Phase 01 Global Qualification Status:** **PARTIAL / NOT FULLY ESTABLISHED**. The following items defined in the full Phase 01 specification were out of scope or not exercised by these 4 targets:
   - **Native Windows platform execution:** Windows Job object assignment, kill-on-close, restricted profile ACL containment, and Windows compatibility spec were not run (Linux-only test host).
   - **Extended DPR & Zoom mapping:** Probing DPR 1/2, zoom 80/125/200%, page/pinch scale, and visual viewport offsets.
   - **Process failure-mode cases:** Startup timeout, stderr flood, parent death supervision, and root crash survival tests.
   - **Negative WS Auth:** Discovery 401 is tested; rejection of unauthenticated WebSocket upgrade was not tested in the e2e spec.
   - **Provisioned Engine vs Discovered Engine:** Auto-discovered `/usr/bin/google-chrome` was used; explicit `DAM_HOPPER_BROWSER_EXECUTABLE` / `DAM_HOPPER_BROWSER_QUALIFY=1` provisioned workflow remains a separate validation step.
