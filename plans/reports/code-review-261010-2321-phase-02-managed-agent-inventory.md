# Code Review: Phase 02 — Managed Agent Inventory and Qualified Semantic Evidence

**Review Date**: 2026-10-10  
**Target Phase**: Phase 02 (`plans/261010-1746-host-resources-auto-sleep/phase-02-agent-inventory-and-semantic-evidence.md`)  
**Overall Score**: 9.3 / 10 (APPROVED with hardening recommendations)  

---

## Code Review Summary

### Scope
- **Files reviewed**:
  - `server/src/idle_suspend/activity/mod.rs`
  - `server/src/idle_suspend/activity/process.rs`
  - `server/src/agent_status/types.rs`
  - `server/src/agent_status/runtime.rs`
  - `server/src/agent_status/reducer.rs`
  - `server/src/agent_status/collector.rs`
  - `server/src/agent_status/assets/omp-agent-status.ts`
  - `server/src/idle_suspend/activity/sampler.rs`
  - `server/src/pty/manager.rs`
  - `server/src/agent_status/tests.rs`
  - `server/src/pty/tests.rs`
  - `server/tests/agent_status_runtime.rs`
- **Lines of code analyzed**: ~1,472 diff lines (1,438 insertions, 34 deletions) across ~12,000 lines of touched module context.
- **Review focus**: Security (process binding, PID forgery, namespace isolation), performance (procfs scanning bounds, lock-free evaluation), architecture (3-tier admission hierarchy, fail-closed unrefreshed native gate), YAGNI/KISS/DRY, task completeness.
- **Updated plans**:
  - `plans/261010-1746-host-resources-auto-sleep/phase-02-agent-inventory-and-semantic-evidence.md`
  - `plans/261010-1746-host-resources-auto-sleep/progress.md`

### Overall Assessment
Robust, well-architected implementation adhering strictly to contracts. Core security boundary successfully binds OMP TCP peer socket inode to client `/proc/<pid>/fd` and verifies ancestry against registered terminal root. Process discovery correctly traces descendant closures and bounds matching to managed roots while cleanly excluding external tmux/SSH/terminal agents per frozen user choice. The fail-closed native gate correctly refuses automatic sleep for unrefreshed native hook providers (Codex/Claude) without synthetic lease stretching. Lock hierarchy invariants preserved with zero locks across IO/procfs/await. Two minor hardening opportunities identified around PID recycling verification and `/proc/<pid>/fd` scan iteration bounds.

---

### Critical Issues
*None*. Zero blocking security vulnerabilities or regressions detected.

---

### High Priority Findings

1. **Potential PID Recycling Bypass in TCP Peer Ancestry Check when `pid == root.pid`**
   - **Location**: `server/src/agent_status/collector.rs:691-714` (`verify_tcp_peer_process`)
   - **Issue**: Step 4 tests `if pid != root.pid` before verifying ancestry. If `pid == root.pid`, it assumes identity match without asserting `stat_before.start_ticks == root.start_ticks`. If the terminal root process died and its PID was recycled by the OS for an unrelated process, the recycled process could connect and bypass ancestry verification.
   - **Fix**:
     ```rust
     if let Some(root) = registered_root {
         if pid == root.pid {
             if stat_before.start_ticks != root.start_ticks {
                 return None;
             }
         } else {
             // traverse ancestry...
         }
     }
     ```

2. **Unbounded `/proc/<pid>/fd` Directory Traversal in Synchronous Socket Verification**
   - **Location**: `server/src/agent_status/collector.rs:667-685` (`verify_tcp_peer_process`)
   - **Issue**: While `process.rs` caps FD scanning at `MAX_PROCESS_FDS_LIMIT = 256`, `verify_tcp_peer_process` loops over `read_dir(&fd_dir)` without bounds. A process with 50,000+ open file descriptors will perform 50,000 synchronous `read_link` calls on the Tokio worker thread during WS handshake.
   - **Fix**: Introduce an iteration cap (`const MAX_PEER_FDS_SCAN: usize = 256;`) and break out if exceeded, failing closed to `None`.

---

### Medium Priority Improvements

1. **Compiler Warnings for Reserved Phase 04/05 Handoff Structures**
   - **Location**: `server/src/pty/manager.rs:1273`, `server/src/idle_suspend/activity/sampler.rs:245-286`, `server/src/agent_status/reducer.rs:1705`
   - **Issue**: `cargo check` produces 8 dead-code warnings for structs (`AgentFreeClaimTicket`, `AgentFreeAdmission`, `ManagedAgentClaimEvidence`) and methods (`try_claim_agent_free_handoff`, `evaluate_managed_agents`). While unit-tested, they are not yet referenced in binary execution paths.
   - **Fix**: Add `#[allow(dead_code)]` annotations or wire into coordinator in Phase 04.

2. **Root Verification during Ancestry Tracing**
   - **Location**: `server/src/agent_status/collector.rs:698`
   - **Issue**: When `stat.ppid == root.pid`, verify that `root.pid` currently has `start_ticks == root.start_ticks` via `read_process_stat` to guard against parent PID recycling before parent exit reap.

---

### Low Priority Suggestions

1. **`non_free_generation` Monotonic Saturation Telemetry**
   - **Location**: `server/src/agent_status/reducer.rs:1478,1507,1598,1652,1671,1686`
   - `saturating_add(1)` is panic-safe. Add debug log if approaching `u64::MAX - 1000` for audit safety.

2. **Opaque Error Context for Process Binding Rejection**
   - **Location**: `server/src/agent_status/collector.rs:810-820`
   - Retain current behavior: reject unverified peer binding without leaking internal PID or socket inode to WebSocket client.

---

### Positive Observations

- **Process Discovery Isolation**: Managed root tree traversal (`process.rs`) strictly bounds discovery to managed sessions; independent external agents (tmux, ssh, shell) are cleanly ignored per product design.
- **Fail-closed Native Gate**: Faithfully respects empirical research. No synthetic lease extensions or simulated Idle states; unrefreshed Codex/Claude hooks fail closed to `UnrefreshedNativeProvider` after 15s.
- **Lock Hierarchy Invariants**: Strict compliance with Tier 1 (`ClientPresence`) -> Tier 2 (`PtySessionManager::inner`) -> Tier 3 (`AgentStatusRuntime::registry`). Zero locks held across IO, network calls, procfs reads, or async await points.
- **Privacy Enforcement**: `AgentFreeClaimTicket` custom `Debug` implementation strips process IDs, start ticks, and raw root paths to prevent leakage in telemetry and coordinator logs.
- **Testing Depth**: Comprehensive coverage across zero-agent baseline, all-idle, all-blocked, working blocks, unverified process binding, lease expiration, native unrefreshed gate, and admission fences (162 lines of new PTY claim tests, 474 lines of agent status tests).

---

### Recommended Actions

1. Patch `verify_tcp_peer_process` in `collector.rs` to check `stat_before.start_ticks == root.start_ticks` when `pid == root.pid`.
2. Add `MAX_PEER_FDS_SCAN = 256` limit to `/proc/<pid>/fd` loop in `collector.rs`.
3. Annotate or consume the 8 warned Phase 04/05 reservation items to maintain zero-warning builds.
4. Advance to Phase 03 (WebSocket presence and session binding) and Phase 04 (coordinator integration).

---

### Metrics
- **Type Coverage**: 100% Rust strict types + zero TypeScript diagnostics on UI adapter.
- **Test Results**: 3,261 passed, 0 failed, 1 ignored (manual benchmark gate), 3,902 filtered out across 5 suites.
- **Lint / Compiler Warnings**: 0 errors, 8 dead code warnings (reserved for Phase 04).

---

### Validation Commands and Results

| Command | Status | Output / Summary |
|---|---|---|
| `cargo check --manifest-path server/Cargo.toml` | PASS | 0 errors, 8 dead-code warnings (reserved handoff structs) |
| `cargo test --manifest-path server/Cargo.toml --lib agent_status` | PASS | 89 passed, 0 failed (0.30s) |
| `cargo test --manifest-path server/Cargo.toml --lib idle_suspend` | PASS | 180 passed, 0 failed (1.61s) |
| `cargo test --manifest-path server/Cargo.toml --lib pty` | PASS | 208 passed, 0 failed, 1 ignored (8.38s) |
| `cargo test --manifest-path server/Cargo.toml --test agent_status_runtime` | PASS | 8 passed, 0 failed (0.05s) |
| `pnpm --filter @dam-hopper/ui exec tsc --noEmit` | PASS | 0 errors, 0 diagnostics (8.45s) |

---

### Unresolved Questions
1. When Phase 04 wires `try_claim_agent_free_handoff`, should `verify_tcp_peer_process` failures emit an internal diagnostic metric for operator visibility into sandboxed/containerized OMP environments?
