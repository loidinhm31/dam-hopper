# Phase 01: Semantic Contract and Reducer — Code Review Report

## Score: 8.5 / 10

### Scope
- Files reviewed:
  - `server/src/lib.rs`
  - `server/src/agent_status/mod.rs`
  - `server/src/agent_status/types.rs`
  - `server/src/agent_status/reducer.rs`
  - `server/src/agent_status/tests.rs`
  - `packages/ui/src/api/client.ts`
  - `packages/ui/src/api/agent-status-types.ts`
  - `packages/ui/src/api/agent-status-types.test.ts`
- Approximate lines analyzed: ~1,500 LOC
- Focus: Phase 01 semantic contract, types, pure reducer state machine, tests, security, performance, architecture, YAGNI/KISS/DRY.
- Updated plans: `plans/260928-0318-agent-status-omp-first/phase-01-semantic-contract-and-reducer.md`

---

## Overall Assessment
High-quality, focused implementation of the canonical v1 semantic contract and pure state reducer. Architecture adheres strictly to pure state-transition principles without hidden I/O or background timers. Epoch fencing, attention revision management, and safe integer boundaries are rigorously enforced across Rust and TypeScript. Clean DTO separation prevents capability, session path, or prompt leakage into public channels.

A few notable edge cases were identified around initial report sequence zero handling, same-epoch reconnection gating, and `terminal_id` string validation.

---

## Critical Issues
None. No security vulnerabilities or data loss conditions identified.

---

## High Priority Findings

### 1. `seq == 0` Rejected on First Report Due to Uninitialized Fence Comparison
- **Location**: `server/src/agent_status/reducer.rs:195-210`
- **Issue**: `TerminalAgentReducer::new` initializes `last_accepted_seq` to `0` and `last_report` to `None`. When a reporter submits its very first report with sequence `0` (a valid non-negative integer under the spec), `report.seq == self.last_accepted_seq` evaluates to `true`. Because `self.last_report` is `None`, execution falls into `else { return Err(AgentStatusError::ConflictingDuplicateSequence { seq: 0 }); }`.
- **Impact**: Any reporter implementation that 0-indexes report sequences is rejected immediately upon sending its first report.
- **Recommended Fix**: Check for duplicate sequences only when at least one prior report exists (`self.last_report.is_some()`) or define `last_accepted_seq: Option<u64>`.
```rust
if let Some(last_report) = &self.last_report {
    if report.seq < self.last_accepted_seq {
        return Ok(ReducerOutput {
            state_changed: false,
            row: Some(self.to_row()),
            attention: None,
        });
    }
    if report.seq == self.last_accepted_seq {
        if last_report == &report {
            return Ok(ReducerOutput {
                state_changed: false,
                row: Some(self.to_row()),
                attention: None,
            });
        } else {
            return Err(AgentStatusError::ConflictingDuplicateSequence { seq: report.seq });
        }
    }
}
```

### 2. `reconnect` Allows Same `reporter_epoch`
- **Location**: `server/src/agent_status/reducer.rs:133-137`
- **Issue**: `reconnect` checks `if reporter_epoch < self.reporter_epoch`. If a reconnect occurs with the exact same epoch (`reporter_epoch == self.reporter_epoch`), it is admitted, resetting `last_accepted_seq = 0`, `last_report = None`, and state to `Unknown`.
- **Impact**: A stale or duplicate connection handshake could reset sequence history within the current active epoch.
- **Recommended Fix**: Enforce strictly increasing reporter epochs across connections (`if reporter_epoch <= self.reporter_epoch`).

---

## Warnings (Medium Priority)

### 1. Unvalidated `terminal_id` in `TerminalAgentReducer::new`
- **Location**: `server/src/agent_status/reducer.rs:52-74`
- **Issue**: While `reporter_id`, `agent_session_id`, and `adapter_version` are validated via `validate_opaque_id`, `terminal_id` is passed without identifier validation.
- **Impact**: An unvalidated `terminal_id` (e.g. containing non-ASCII graphic characters or excessive length) could cause `AgentAttentionEvent::format_id` to generate malformed or oversized attention IDs that fail TypeScript client decoding (`isBoundedString(obj.id, 256)`).
- **Recommended Fix**: Add `validate_opaque_id("terminal_id", &terminal_id)?;` to `TerminalAgentReducer::new`.

### 2. `report.kind` Not Validated in Reducer
- **Location**: `server/src/agent_status/reducer.rs:454-564`
- **Issue**: `ReporterReport` contains `pub kind: String`, but `validate_report_consistency` does not assert `report.kind == "report"`.
- **Impact**: If non-report wire frames bypass transport routing, reducer accepts them as reports.
- **Recommended Fix**: Assert `if report.kind != "report"` in `validate_report_consistency`.

---

## Suggestions (Low Priority)

### 1. Dead Code: `AgentStatusError::StaleSequence`
- **Location**: `server/src/agent_status/types.rs:321`
- **Observation**: Spec dictates stale sequence reports are silently ignored (implemented in `reducer.rs:188`). `AgentStatusError::StaleSequence` is never instantiated.
- **Recommendation**: Retain only if needed by wire framing; otherwise remove to adhere to DRY/clean code principles.

### 2. Parity in TS `decodeTerminalAgentStatusRow` for Blocked State
- **Location**: `packages/ui/src/api/agent-status-types.ts:176-185`
- **Observation**: Server guarantees `reason.is_some()` when `state == AgentState::Blocked`. TypeScript decoder allows `reason` to be undefined even if `state === "blocked"`.
- **Recommendation**: Consider optional assertion `if (obj.state === "blocked" && !reason)` to fail closed on malformed blocked rows.

---

## Positive Observations
1. **Deterministic State Machine**: Complete isolation from OS, I/O, or asynchronous timers. Clock injection via `now_ms` facilitates clean, 100% reproducible testing.
2. **Strict Identity & Epoch Boundaries**: Robust distinction between `server_epoch`, `incarnation`, and `reporter_epoch`.
3. **Safe Integer & Opaque String Guarantees**: Strict checks against JS `Number.MAX_SAFE_INTEGER` preventing precision loss across boundaries.
4. **Data Privacy**: Public DTOs omit internal session paths, raw tokens, capabilities, and agent stdout/transcripts.
5. **No Regressions**: Full frontend test suite (275 files, 1,923 tests) and all server unit tests pass cleanly.

---

## Validation Commands and Results
- `cargo test --manifest-path server/Cargo.toml agent_status --lib`
  - Result: **PASS** (8 passed; 0 failed; finished in 0.00s)
- `cargo check --manifest-path server/Cargo.toml --lib`
  - Result: **PASS** (0 warnings, 0 errors; finished in 0.27s)
- `pnpm --filter @dam-hopper/ui test src/api/agent-status-types.test.ts`
  - Result: **PASS** (8 passed; 0 failed; finished in 123ms)
- `pnpm --filter @dam-hopper/ui build`
  - Result: **PASS** (`tsc -p tsconfig.json` clean, 0 errors)

---

## Unresolved Questions
None. Phase 01 requirements are fully met and verified.
