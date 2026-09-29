# Code Review: Phase 04 — Codex and Claude Native Event Adapters

Date: 2026-09-29  
Reviewer: Senior Software Engineer (ReviewPhase04)  
Target: `plans/260929-0140-agent-status-codex-claude/phase-04-native-event-adapters.md`  
Score: **9.5 / 10** (Approved)

---

## Code Review Summary

### Scope
- **Files reviewed**:
  - `server/src/agent_status/codex_hooks.rs`
  - `server/src/agent_status/claude_hooks.rs`
  - `server/src/agent_status/mod.rs`
  - `server/src/agent_status/hook_reporter.rs`
  - `server/src/agent_status/hook_ingress.rs`
  - `server/src/agent_status/reducer.rs`
  - `server/src/agent_status/codex_integration.rs`
  - `server/src/agent_status/claude_integration.rs`
  - `server/src/agent_status/tests.rs`
  - `server/tests/agent_status_hooks.rs`
- **Lines of code analyzed**: ~3,400 LOC
- **Review focus**: Phase 04 concrete native event adapters, static schema fidelity (Codex 0.158.0 / Claude 2.1.250), subagent isolation, turn/session fences, blocker correlation, continuation, deduplicated attention, KISS/YAGNI/DRY, and security.
- **Updated plans**:
  - `plans/260929-0140-agent-status-codex-claude/phase-04-native-event-adapters.md`
  - `plans/260929-0140-agent-status-codex-claude/plan.md`

### Overall Assessment
The implementation is an exceptionally high-quality, production-ready Rust integration adhering strictly to the design contract and Phase 01 static binary qualification:
1. **Schema fidelity & privacy**: Only qualified events are admitted into the pipeline. All prompts, assistant messages, model names, tool arguments/results, transcript paths, and error details are discarded without materialization.
2. **Subagent isolation**: Native events bearing `agent_id` or `agent_type` fail closed at reporter parsing and never modify root state.
3. **Turn & session fences**: Opaque turn IDs are strictly checked; late callbacks for retired/previous turns are ignored; ambiguous concurrent turns retire immediately to `Unknown`.
4. **Blocker correlation**: Parallel tool events correctly resolve only matching `tool_call_id` blockers; non-matching tools keep blockers active; missing correlation safely falls back to `Unknown`.
5. **Continuation**: `Stop` transitions to `Unknown` without false completion alerts, preserving the current turn ID so subsequent tool/compact continuation cleanly refreshes `Working`.
6. **Deduplicated attention**: `NeedsAttention` is emitted once upon entering `Blocked`; duplicate notification callbacks do not produce duplicate attention events.
7. **Codex status-only guarantee**: Codex never emits `Blocked` or attention events; `Interrupt` establishes `Idle` with `TurnOutcome::Interrupted` without completion alerts.

---

## Critical Issues
None.

---

## High Priority Findings
None.

---

## Medium Priority Improvements

### 1. Dead Code Warning in `hook_reporter.rs` Test Struct
- **Location**: `server/src/agent_status/hook_reporter.rs:65,74`
- **Problem**: When running `cargo check --all-targets`, compiler reports:
  ```
  warning: fields `tool_call_id` and `notification_type` are never read
    --> src/agent_status/hook_reporter.rs:65:5
  ```
  Following the extraction of parser logic into `codex_hooks.rs` and `claude_hooks.rs`, the legacy `NativeHookInput` struct remains only in `#[cfg(test)]` unit tests, where these two fields are not inspected.
- **Remedy**: Either test `CodexHookInput` / `ClaudeHookInput` directly in those tests, or read the fields in the test assertion, or remove the obsolete `NativeHookInput` struct.

### 2. Ingress Defense-in-Depth for Claude Reason Field
- **Location**: `server/src/agent_status/hook_ingress.rs:79-91`
- **Problem**: `hook_ingress.rs` strictly validates that Codex events carry neither `reason` nor `notification_type`. For Claude, it validates that `Notification` has `notification_type`, but does not check if an unexpected `reason` (e.g. `BlockedReason::Approval`) is attached to a non-blocking event like `UserPromptSubmit`. While `reducer.rs` overrides `self.blocked_reason = None` on prompt submit, validating this at ingress prevents invalid envelopes from reaching the reducer.
- **Remedy**: In `validate_hook_envelope`, assert:
  ```rust
  if envelope.reason.is_some() && envelope.event != "Notification" && envelope.event != "StopFailure" {
      return Err(AgentStatusError::AuthorityLost(
          "Claude hook events cannot carry blocked reasons outside Notification and StopFailure".to_string(),
      ));
  }
  ```

### 3. DRY Consolidation of Tool Blocker Resolution in `reducer.rs`
- **Location**: `server/src/agent_status/reducer.rs:484-507` and `525-548`
- **Problem**: Identical 24-line blocks handle parallel tool resolution in both `PreToolUse` and `PostToolUse` / `PostToolUseFailure`.
- **Remedy**: Extract to a helper method on `TerminalAgentReducer`:
  ```rust
  fn resolve_tool_blocker(&mut self, tool_call_id: Option<&str>) {
      if !self.blocked_tool_call_ids.is_empty() {
          if let Some(tool_id) = tool_call_id {
              if self.blocked_tool_call_ids.iter().any(|id| id == tool_id) {
                  self.blocked_tool_call_ids.retain(|id| id != tool_id);
                  if self.blocked_tool_call_ids.is_empty() {
                      self.state = AgentState::Working;
                      self.blocked_reason = None;
                  }
              }
          } else {
              self.state = AgentState::Unknown;
              self.blocked_reason = None;
              self.blocked_tool_call_ids.clear();
          }
      } else if tool_call_id.is_some() {
          self.state = AgentState::Working;
          self.blocked_reason = None;
      } else {
          self.state = AgentState::Unknown;
          self.blocked_reason = None;
      }
  }
  ```

---

## Low Priority Suggestions

### 1. Bounding `blocked_tool_call_ids`
- **Location**: `server/src/agent_status/reducer.rs:600-604, 632-636`
- **Observation**: `retired_turn_ids`, `retired_session_ids`, and `retired_native_roots` are all ring-bounded via FIFO eviction (`MAX_RETIRED_*`). `blocked_tool_call_ids` is currently unbounded. Under an adversarial or malfunctioning loop emitting distinct `tool_call_id` notifications without resolving them, the queue could grow.
- **Suggestion**: Add a constant `pub const MAX_BLOCKED_TOOL_IDS: usize = 32;` and pop front if capacity is exceeded.

### 2. Resilient Matching for `AskUserQuestion`
- **Location**: `server/src/agent_status/claude_hooks.rs:227`
- **Observation**: Checks `name.eq_ignore_ascii_case("askuserquestion") || name.eq_ignore_ascii_case("ask_user_question")`.
- **Suggestion**: Also support `"ask-user-question"` or normalize separators to prevent edge cases with kebab-case tool names.

---

## Positive Observations
- **Single Source of Truth**: `CLAUDE_MANAGED_EVENTS` and `CODEX_MANAGED_EVENTS` in the integration modules directly reference `CLAUDE_QUALIFIED_EVENTS` and `CODEX_QUALIFIED_EVENTS` from `claude_hooks` and `codex_hooks`, eliminating any chance of hook registration drifting from event qualification.
- **Zero Content Leakage**: Serde ignore-by-default behavior guarantees that prompt text, tool inputs/results, error stack traces, and transcript paths are discarded immediately during streaming deserialization.
- **Subprocess Smoke Verification**: `agent_status_hooks.rs` tests full real CLI subprocess invocations (`report-hook`) over private loopback Unix domain sockets with real `/proc` ancestry qualification.
- **Exhaustive Edge-Case Test Suite**: 74 unit tests and 7 integration tests cover race conditions, duplicate delivery, quiet gaps, lease expiry, ambiguous concurrent turns, parallel blocker resolution, and subagent rejection.

---

## Recommended Actions
1. Remove or update `NativeHookInput` in `server/src/agent_status/hook_reporter.rs` to eliminate the compiler warning.
2. Add the ingress check in `hook_ingress.rs` to validate `envelope.reason` validity for Claude events.
3. Extract `resolve_tool_blocker` in `reducer.rs` to reduce repetition.
4. Proceed with Phase 05: Agent Settings and notification ownership cutover.

---

## Validation Results
- `cargo test --manifest-path server/Cargo.toml --lib agent_status::`: **74 passed; 0 failed** (0.27s)
- `cargo test --manifest-path server/Cargo.toml --test agent_status_hooks`: **7 passed; 0 failed** (0.25s)
- `cargo check --manifest-path server/Cargo.toml --all-targets`: **Passed** (1 warning in hook_reporter test code)

---

## Unresolved Questions
None.
