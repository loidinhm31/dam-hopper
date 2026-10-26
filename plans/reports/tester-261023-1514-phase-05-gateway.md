# QA Test Report: Phase 05 — Authenticated Semantic WebSocket Gateway

- **Date**: 2026-10-23
- **Operation**: `run` (code validation)
- **Scope**: Phase 05 Authenticated Semantic WebSocket Gateway test suite execution & post-hardening re-verification:
  1. `cargo check --manifest-path server/Cargo.toml --all-targets`
  2. `cargo test --manifest-path server/Cargo.toml --lib semantic`
  3. `cargo test --manifest-path server/Cargo.toml --test semantic_websocket`
  4. `cargo test --manifest-path server/Cargo.toml --test semantic_supervisor`
  5. `cargo test --manifest-path server/Cargo.toml --test semantic_resources`
  6. `cargo test --manifest-path server/Cargo.toml --test semantic_tool_profile`
  7. `cargo test --manifest-path server/Cargo.toml --test semantic_child_process`
  8. `cargo test --manifest-path server/Cargo.toml --test ws_client_presence`
  9. Selected wider regression suites: `ws_fs_subscribe`, `auth_sqlite_store`, `auth_lite_mode`, `auth_no_auth`
- **Authority**: Execution and reporting only; zero code, test, or CI edits authorized.
- **Policy/Procedure Loaded**: `~/.omp/agent/skills/test/references/test-principles.md`, `code-validation.md`, `.omp/evcrate/AGENTS.md`.

---

## 1. Test Results Overview

### Cycle 2 (Post-Hardening Re-Verification)

| Target / Suite | Total Run | Passed | Failed | Skipped / Ignored | Not Selected (Filtered) | Duration | Status |
|---|---|---|---|---|---|---|---|
| `cargo check --all-targets` | 1 | 1 | 0 | 0 | 0 | 0.21s | **PASS** (0 warnings, 0 errors) |
| `semantic_websocket` | 6 | 6 | 0 | 0 | 0 | 5.89s | **PASS** |
| `semantic_supervisor` | 10 | 10 | 0 | 0 | 0 | 2.03s | **PASS** |
| `semantic_resources` | 8 | 8 | 0 | 0 | 0 | 0.00s | **PASS** |
| `semantic_tool_profile` | 11 | 11 | 0 | 0 | 0 | 0.00s | **PASS** |
| `semantic_child_process` | 11 | 11 | 0 | 0 | 0 | 9.10s | **PASS** |
| `ws_client_presence` | 5 | 5 | 0 | 0 | 0 | 1.30s | **PASS** |
| `--lib semantic` | 36 | 36 | 0 | 0 | 1,465 | 0.00s | **PASS** (35 semantic + 1 png variant) |
| **Subtotal Scoped Test Commands** | **87** | **87** | **0** | **0** | **1,465** | **18.32s** | **PASS (86 semantic/gateway checks)** |
| `ws_fs_subscribe` (wider gate) | 9 | 9 | 0 | 0 | 0 | 1.92s | **PASS** |
| `auth_sqlite_store` (wider gate) | 20 | 20 | 0 | 0 | 0 | 0.05s | **PASS** |
| `auth_lite_mode` (wider gate) | 11 | 11 | 0 | 0 | 0 | 12.74s | **PASS** |
| `auth_no_auth` (wider gate) | 14 | 14 | 0 | 0 | 0 | 2.01s | **PASS** |
| **Total Test Runs (Cycle 2)** | **141** | **141** | **0** | **0** | **1,465** | **35.04s** | **PASS (100% pass rate)** |

*Execution Notes:*
- `semantic_websocket.rs` is an untracked Phase 05 file. Hardening was verified by inspecting code and assertions in `test_handshake_subprotocol_and_auth_matrix` against the gaps recorded in Cycle 1.
- In `--lib semantic`, 1,465 filtered tests represent non-semantic unit tests from `src/lib.rs`.
- MongoDB-dependent suites (`auth_state_and_policy`, `transport_enforcement_phase03`) and the full server regression suite (`cargo test`, 60+ binaries) were not executed in this invocation (not selected).

---

## 2. Hardening Delta: Cycle 1 vs. Cycle 2

In Cycle 1, `test_handshake_subprotocol_and_auth_matrix` verified connection success on valid token and connection failure via generic `is_err()` without asserting HTTP response status codes, Origin rejection, or cookie isolation.

In Cycle 2 (post-hardening), the following explicit HTTP response status assertions were verified:
1. **Missing Subprotocol**: Rejection asserted with exact `http::StatusCode::BAD_REQUEST` (400).
2. **Wrong Subprotocol** (`generic-lsp`): Rejection asserted with exact `http::StatusCode::BAD_REQUEST` (400).
3. **Missing Token with Allowed Origin**: Rejection asserted with exact `http::StatusCode::UNAUTHORIZED` (401).
4. **Origin-less Request without Token**: Rejection asserted with exact `http::StatusCode::FORBIDDEN` (403).
5. **Origin Allowlist**: Allowed Origin (`http://trusted.local`) receives 101 Switching Protocols; disallowed Origin (`http://evil.com`) rejected with exact `http::StatusCode::FORBIDDEN` (403).
6. **Cookie-only Origin-less Request**: Rejection asserted with exact `http::StatusCode::FORBIDDEN` (403).

---

## 3. Requirement Coverage & Verification Mapping

| Phase 05 Requirement | Selected Check(s) | Observed Behavioral Evidence | Verification Boundary & Coverage Gaps |
|---|---|---|---|
| **Subprotocol & handshake auth** | `test_handshake_subprotocol_and_auth_matrix` | Valid token + subprotocol upgrades (101); missing/wrong subprotocol returns 400; missing token returns 401; evil origin returns 403; cookie-only origin-less returns 403. | **Gap**: Direct comparative assertions against core `/ws` parity not asserted. MFA-required, expired token, disabled account, and backend storage failure unexercised on `/ws/semantic/v1`. |
| **Strict lifecycle ordering & target attach** | `test_lifecycle_order_and_attach` | `initialize` before attach rejected (`ATTACH_REQUIRED`); unsupported descriptor rejected (`UNSUPPORTED_DESCRIPTOR`); valid TS descriptor attaches; duplicate attach rejected (`TARGET_ALREADY_ATTACHED`). | **Gap**: Does not assert supervisor zero-child process count on rejected attach. Multi-target / multi-connection concurrency not exercised in WS suite. |
| **Virtual URI containment & version fence** | `test_virtual_uri_containment_and_traversal_rejection`, `semantic::uri::tests::*` | In-target `textDocument/didOpen` notification sent; `..` traversal rejected (`INVALID_URI`); missing `damHopperDocumentVersion` rejected (`INVALID_PARAMS`). Absolute/drive/UNC paths and null bytes rejected in URI unit tests. | **Gap**: WS test does not assert response to `didOpen` (notification). Child-to-virtual URI mediation and `outsideTarget` location stripping not exercised over WS wire (tested only at unit layer in `semantic::uri`). |
| **Frame rejection & format validation** | `test_rate_limiting_and_binary_rejection` | Binary frame rejected with JSON-RPC error code -32700; non-object JSON array rejected with -32700. | **Gap**: Rate limits, 4 MiB frame limits, and in-flight queue byte limits not asserted over WS wire (test name mentions rate limiting, but tests only binary + array rejection). |
| **Adaptive sync & version fence** | `test_adaptive_sync_and_navigation_resolution`, `semantic::overlay::tests::*` | Advertises `textDocumentSync: 2`; definition response received with matching ID 100; stale version 1 rejected (`STALE_VERSION`); shutdown and exit notifications clean. | **Gap**: Navigation result payload contents not asserted (`id == 100` only; payload not inspected). Dynamic threshold crossing (>64 KiB) and in-flight stale-response discard only tested in supervisor, not over WS wire. |
| **Live auth teardown** | `test_cancellation_first_live_auth_cutoff` | Revocation in SQLite store detected by watcher; socket receives Close or drops (`None`) within 7.5s poll loop. | **Gap**: Accepts connection drop (`None`) without asserting Close frame; no target or child attached during test, so cancellation-first child teardown ordering is not observed. |
| **Child process management** | `semantic_child_process::*`, `semantic_resources::*` | Descendant reaping, sigkill escalation, stderr bounding, cgroup scope attach validated against synthetic binaries. | Validated at unit/integration layer with mock/synthetic processes; real Node/TSLS binaries deferred to G3-G5 spike gates. |

---

## 4. Coverage Gaps Requiring Authoring (Route to `create` / Maintenance)

1. **WS Wire Frame & Rate Limits**: Add live WebSocket tests asserting rejection of frames exceeding 4 MiB and rate-limit threshold enforcement (currently only binary frames and array JSON are asserted).
2. **Supervisor Process Count Assertion**: Assert zero child processes spawned when attach is rejected or unsupported.
3. **Location Mediation over Wire**: Assert definition response payloads and verify `outsideTarget` redaction for results outside target root over live WebSocket wire.
4. **Adaptive Sync Wire Crossing & In-Flight Discard**: Test dynamic >64 KiB threshold crossing over WebSocket wire frames; test stale-version discard of in-flight responses.
5. **Cancellation Timing & Child Reaping**: Instrument and assert exact watcher lookup/teardown durations and verify child process reaping on auth invalidation when an active target is attached.
6. **Doc Comment & Test Name Maintenance**: Update `semantic_websocket.rs` top-level doc comment and `test_rate_limiting_and_binary_rejection` test name to match actual assertions rather than claiming unexercised rate limiting and 4 MiB limits.

---

## 5. Disposition & Unmet Gates

- **Disposition**: **Scoped test commands PASS (87/87); handshake status-code gaps closed; Phase 05 behavioral validation still incomplete; full `cargo test` not executed; G3–G5 unresolved.**
- **Unmet Gates & Surfaces Not Executed**:
  - **Full Regression**: Full server regression suite (60+ integration test binaries) was not executed; only selected wider suites (`ws_fs_subscribe`, `auth_sqlite_store`, `auth_lite_mode`, `auth_no_auth`) were validated.
  - **MongoDB Integration**: MongoDB suites (`auth_state_and_policy`, `transport_enforcement_phase03`) were not selected/executed.
  - **Phase 01 Feasibility Spike Gates**: G3 (required TSLS child requests/responses), G4 (adaptive sync wire verification), and G5 (destination file freshness proof) remain unresolved STOP/GO prerequisites for production enablement.

---

## 6. Unresolved Questions

1. Should high-volume rate-limiting and 4 MiB frame size rejection over WebSocket wire be added to `semantic_websocket.rs` in addition to existing unit coverage in `semantic_resources`?
2. Does the live auth cutoff test require asserting child PID termination in the same test fixture, or does `semantic_supervisor::test_clean_shutdown_and_tree_reap` provide sufficient layer separation?
3. Will G3–G5 prerequisites require real Node/TSLS binaries in CI or will qualification remain isolated in dedicated spike gates?
