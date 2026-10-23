# Phase 01 — Gate G7: Process Tree Lifecycle & Reaper Controls

**Artifact:** `plans/260901-1000-lsp-server-integration/reports/phase-01-process-tree.md`  
**Phase:** 01 — Protocol, Dependency, and Real-Process Spike  
**Gate:** G7 — Process Tree Lifecycle & Descendant Reaping  
**Status:** **BOUNDED PASS (Tested Runs Verified; Crash/Reparenting Scenarios Deferred)**  
**Date:** 2026-10-23  

---

## 1. Executive Summary

This report establishes the process ownership, descendant tree tracking, and multi-stage termination contracts for the semantic engine. Real-process observations in `scripts/spike-lsp-test.mjs` confirm:
- TSLS spawns multiple background child processes (specifically `tsserver.js` instances, including partialSemantic workers).
- In the tested Linux x86_64 environment, auditing pre-recorded descendant PIDs verified **zero surviving descendants and zero test-generated zombies** across both graceful protocol exit and forced process-group signal escalation.
- Advanced lifecycle scenarios (abrupt supervisor crash, reparenting under hung parents, and SIGSTOP resistance) remain to be qualified in the Rust backend implementation under Phase 02.

---

## 2. Real-Process Descendant Observations

During our hardened real-process spike test:
```
[Harness Parent PID: 1133750]
  └── [TSLS PID: 1133775] (Node.js cli.mjs --stdio) [PGID: 1133775]
        ├── [Child PID 1133798]: node .../typescript/lib/tsserver.js
        └── [Child PID 1133799]: node .../typescript/lib/tsserver.js
```

### Process Group Isolation
In Linux/POSIX systems, each semantic child is spawned with its own Process Group ID (`Command::process_group(0)` in Rust / `detached: true` in Node). This ensures all descendant processes spawned by TSLS share the child's PGID.

---

## 3. Two-Phase Termination & Reaper Contract

Because OS cgroups or systemd delegation may not be present in containerized or non-root development environments, portable application-level ownership is mandatory:

### Stage 1: Graceful RPC Termination (Budget: 2,000 ms)
1. Supervisor sends LSP `shutdown` request over child stdio.
2. Awaits JSON-RPC response with a 1,500 ms timeout.
3. Upon response or timeout, sends `exit` notification and closes child stdin.
4. Awaits child exit via Tokio `Child::wait`.

### Stage 2: Forceful Signal Escalation (Budget: 3,000 ms)
If any process remains alive after Stage 1 or if the child is uncooperative:
1. Issue `kill(-pgid, SIGTERM)` to signal the entire process group.
2. Await process exit for up to 1,000 ms.
3. If processes persist, issue `kill(-pgid, SIGKILL)` to immediately terminate all remaining descendants in the process group.
4. **Reaping Contract**: The supervisor's dedicated Tokio reaper task calls `Child::wait().await` to collect exit status and prevent zombie entries (`<defunct>`). Global `waitpid(-1)` is explicitly forbidden to prevent stealing exit statuses from PTY or helper child processes.

### Real-Process Test Results
1. **Graceful Shutdown**:
   - `shutdown` RPC + `exit` notification sent to active TSLS PID.
   - Pre-recorded descendant PIDs audited via `kill(pid, 0)`: **0 survivors**.
2. **Forced Signal Escalation**:
   - Independent child process spawned in separate PGID with verified active `tsserver` workers.
   - Signals `SIGTERM` followed by `SIGKILL` sent to `-forcedPgid`.
   - Pre-recorded descendant PIDs audited via `kill(pid, 0)`: **0 survivors**.

---

## 4. Phase 02 Implementation Requirements

1. Implement Tokio `Command::process_group(0)` for child isolation.
2. Ensure dedicated child task reap loops avoid global `waitpid(-1)`.
3. Test abrupt parent failure and hung process (SIGSTOP) recovery in Rust unit tests.
