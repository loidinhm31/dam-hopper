# Backend Semantic Focus Validation Report (PR #74)

## Request and Authority
- **Operation / Scope**: `run` backend semantic focus. Unit/integration execution and runtime probes on Fedora Linux x64.
- **Authority**: Review-only. No modifications to tracked source, tests, or CI configuration. No auth weakening. Disposable probes in `/tmp` only with full cleanup.
- **Policy/Procedures Loaded**: `/home/loidinh/.omp/agent/skills/test/references/{test-principles,code-validation}.md`.
- **Repo State**: Clean working tree on branch `feat/lsp-server-integration-reassess`; untracked report artifacts in `plans/reports/`.

## Execution Results

### 1. Focused Backend Test Suites
**Sanitized Command**: `cargo test --manifest-path server/Cargo.toml --test semantic_child_process --test semantic_resources --test semantic_settings --test semantic_supervisor --test semantic_tool_profile --test semantic_websocket`

- **Attempt 1 (Combined 6-suite invocation; initial observed failure)**:
  - Command: `cargo test --manifest-path server/Cargo.toml --test semantic_websocket --test semantic_supervisor --test semantic_child_process --test semantic_resources --test semantic_settings --test semantic_tool_profile`
  - Raw log: `artifact://73` (runner exit code 101).
  - `semantic_child_process.rs`: **18 passed, 0 failed** (8.57s)
  - `semantic_resources.rs`: **8 passed, 0 failed** (0.00s)
  - `semantic_settings.rs`: **21 passed, 0 failed, 1 ignored** (`sqlite_wal_reader_lock_helper` subprocess helper passed in sub-run) (179.85s)
  - `semantic_supervisor.rs`: **1 passed, 31 failed** (0.19s)
    - *Diagnostic*: Thread panic at `tests/semantic_supervisor.rs:76:42: copy isolated real node binary: Os { code: 122, kind: QuotaExceeded, message: "Disk quota exceeded" }`. 32 tests ran concurrently on `/tmp` (tmpfs with user quota 9.3GB, 8.8GB pre-allocated), exceeding quota when copying 123MB `node` ELF in parallel.
  - `semantic_tool_profile.rs`, `semantic_websocket.rs`: Not reached in Attempt 1 due to early runner exit on supervisor failure.

- **Subsequent Scoped Executions (TMPDIR directed to unconstrained local disk)**:
  - Run 2 (`semantic_supervisor` retry): `TMPDIR=/home/loidinh/tmp_semantic_test cargo test --manifest-path server/Cargo.toml --test semantic_supervisor`
    - Raw log: `artifact://87`. Result: **32 passed, 0 failed** (39.44s).
  - Run 3 (`semantic_tool_profile` & `semantic_websocket`): `TMPDIR=/home/loidinh/tmp_semantic_test cargo test --manifest-path server/Cargo.toml --test semantic_tool_profile --test semantic_websocket`
    - Raw log: `artifact://90`. Result: **22 passed, 0 failed** (22.69s) (`tool_profile`: 11 passed; `websocket`: 11 passed).
- **Aggregate Across Successful Scoped Runs**: **101 passed, 1 ignored, 0 failed** across all 6 test binaries (initial 31 quota failures retained).

### 2. Real Packaged TSLS E2E Suite
**Sanitized Command**: `TMPDIR=/home/loidinh/tmp_semantic_test cargo test --manifest-path server/Cargo.toml --test semantic_tsls_e2e`
- **Result**: **4 passed, 0 failed** (74.47s).
- **Checks Verified**:
  - `test_packaged_tsls_four_extensions_nested_refs_multiple_and_empty_results`: passed. Real packaged Node v24.16.0 + TS 5.9.3 + TSLS 6.0.2 tuple launch, navigation, four file extensions (.ts, .tsx, .js, .jsx), nested symbol refs, and empty results.
  - `test_adversarial_code_loading_vectors_with_tuple_specific_positive_controls`: passed.
  - `test_packaged_tsls_unsaved_overlays_unicode_and_bidirectional_threshold_crossing`: passed. In-memory unsaved overlays and bidirectional 64 KiB threshold crossing.
  - `test_packaged_tuple_transitive_integrity_and_tamper_rejection`: passed. SHA-256 transitive integrity checks.

---

## Runtime Probes & Defect Verifications

### Probe 1: Archive Builder Without Semantic Options Excludes Engine (R1 — P1)
- **Harness Inputs (Placeholder Diagnostic Probe)**: Created temporary directory `/tmp/probe_r1_*` with placeholder executable shell scripts (`#!/bin/sh`) for `dam-hopper`, `dam-hopper-server`, `dam-hopper-web`, and `dam-hopper-idle-suspend-helper`, plus minimal placeholder `<html></html>` `index.html`. Real production binaries were not packaged in this probe.
- **Execution**: Invoked `deploy/release/build-release-archive.sh --version v0.15.0 --target-dir <dummy_bin> --web-dist <dummy_web> --output-dir <out> --source-date-epoch 1700000000`.
- **Observation**: Generated archive `dam-hopper-v0.15.0-linux-x86_64-systemd.tar.gz` (2416 B). Tar listing confirmed **zero** `lib/semantic-engine/` entries.
- **Scope Limitation**: Demonstrates script branching behavior (omits engine unless `--stage-semantic-engine` or `--semantic-engine-dir` is explicitly passed); does NOT constitute end-to-end release packaging qualification of real compiled binaries.
- **Workflow Link**: `tests/deploy/linux-release-package-twice.sh:71-76` and `.github/workflows/release-linux.yml:206-210` invoke packaging without semantic staging flags or environment.
- **Status**: **REPRODUCED FOR SCRIPT INVOCATION WITHOUT SEMANTIC FLAGS**. Probe harness cleaned up.

### Probe 2: CR-Only Line Splitting Rejecting Valid Coordinates (G3 — P2)
- **Execution**: Compiled disposable test program in `/tmp/probe_g3_*` calling production crate functions `dam_hopper_server::semantic::uri::validate_range_in_text` and `dam_hopper_server::semantic::overlay::position_to_byte_offset`.
- **Observations**:
  - LF (`\n`): `validate_range_in_text(line: 1)` -> `Ok(())`, `position_to_byte_offset` -> `Ok(6)`.
  - CRLF (`\r\n`): `validate_range_in_text(line: 1)` -> `Ok(())`, `position_to_byte_offset` -> `Ok(7)`.
  - CR-only (`\r`): `validate_range_in_text(line: 1)` -> `Err(InvalidRange("Position (1:0) line exceeds document line count 1"))`.
  - CR-only (`\r`): `position_to_byte_offset(line: 1)` -> `Err(InvalidPosition { line: 1, character: 0, reason: "Line 1 exceeds total document lines (1)" })`.
- **Status**: **REPRODUCED AT RUNTIME** against production crate code. Standalone CR fails line > 0 validation because parser splits only on `\n`. Probe harness cleaned up.

### Probe 3: Lifecycle Defects (R3 / R2 — P2)
- **R3 (Zero-document idle eviction never armed)**:
  - Code path inspection at `server/src/semantic/session.rs:1038-1052` shows `do_initialize` sets `self.state = SemanticState::Ready` without calling `check_schedule_idle_timer()`.
  - `check_schedule_idle_timer()` is only called in `do_did_close`, `cancel_inflight_navigation`, and `resolve_navigation_response`.
  - An initialized connection with 0 open documents never schedules the 60s idle eviction timer, indefinitely retaining 1 of the 2 global tree slots under periodic ping keepalives.
  - Zero existing tests in `semantic_supervisor.rs` or `semantic_websocket.rs` cover zero-document idle eviction.
- **R2 (Exhausted session revival without dirty-overlay replay)**:
  - `session.rs:1083-1085`: `do_did_open` invokes `do_initialize()` unconditionally if `self.child_handle.is_none()`, bypassing crash budget limits and sending `didOpen` only for the new file without replaying prior overlays.

### Probe 4: Security & Protocol Boundary Static Findings
- **F1 (Git worktree deletion bypasses canonical global config protection — P1)**:
  - `server/src/api/git.rs:453-459` executes `remove_worktree(&project_path, &worktree.repository_path, body.force)` directly.
  - In contrast to raw FS sinks (`decrypt.rs`, `mutate.rs`, `ops.rs`, `secure_path.rs`), `api/git.rs` never invokes `is_protected_global_config_path()`. Static finding confirmed; live API deletion probe omitted to avoid risk to local workspace.
- **G1 (Pin-and-requery provenance freshness race — P1)**:
  - `server/src/semantic/gateway.rs:1944-1965` overwrites `provenance_map` with `handle.get_overlay_snapshot()`, replacing verified requery snapshot with live overlay while `final_raw_result` retains earlier coordinates.
- **G2 (Cancellation dropped during pin-and-requery — P2)**:
  - `server/src/semantic/gateway.rs:1533-1540` removes `client_to_internal` mapping on first child reply. Requery receives a new internal ID (`1760`) with no client registration. Subsequent `$/cancelRequest` finds no mapping at `2146-2150`.
- **R4 (WebSocket upgrade auth lacks 2s timeout — P2)**:
  - `server/src/api/semantic_ws.rs:260` awaits `evaluate_claims(&claims)` without `AUTH_STORE_LOOKUP_TIMEOUT`, unlike `semantic_settings.rs:148`.

---

## Omissions and Unexercised Surfaces
1. **Live Qualification**: `semantic_resource_qualification.rs` contains ignored test `live_semantic_navigation_qualification`; not executed.
2. **MongoDB / Auth Containment**: `server/tests/semantic_ws_auth_containment.rs` was not in the focused execution set.
3. **Dynamic Concurrency Races**: G1 and G2 require deterministic test-only sync barriers to trigger race windows; unexercised dynamically.

## Summary & Disposition
- **Status**: **PARTIAL** (Focused execution PASS for declared unit/TSLS E2E suites; release delivery defect R1 and coordinate defect G3 confirmed by runtime probes; lifecycle R2/R3, Git config bypass F1, freshness race G1, and cancellation G2 confirmed by static analysis).
- **Cleanup**: All `/tmp` probe files and temporary testing directories were removed. No modified git files.
