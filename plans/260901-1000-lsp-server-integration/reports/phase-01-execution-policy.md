# Phase 01 — Gate G0: Bounded Execution Policy & Fixture Corpus

**Artifact:** `plans/260901-1000-lsp-server-integration/reports/phase-01-execution-policy.md`  
**Phase:** 01 — Protocol, Dependency, and Real-Process Spike  
**Gate:** G0 — Bounded Execution Policy  
**Status:** ESTABLISHED & RECORDED (Pre-Execution Invariant)  
**Date:** 2026-10-23  

---

## 1. Executive Summary & Purpose

Before launching any child process (Node, TSLS, or tsserver descendants) or opening loopback exposure, this document formally records all finite bounds, memory/time limits, fixture corpus definitions, process-tree ownership rules, and watchdog mechanisms.

In accordance with Phase 01 requirements and Advisor consultation guidance:
1. **Concrete bounds precede execution**: No process runs under unconstrained resources.
2. **Portable-only mode is baseline**: Application-level timeouts, queue limits, and PID tracking are mandatory; OS cgroups are treated as optional defense-in-depth, not hard guarantees.
3. **No-exposure / default-OFF invariant**: Semantic engine remains strictly OFF during server initialization; zero child processes spawn without explicit, authenticated target attachment.

---

## 2. Finite Candidate Policy Matrix

| Dimension | Policy Boundary | Enforcement Mechanism |
|---|---|---|
| **Global Concurrency** | Max 2 active semantic trees across server; 1 child per semantic connection | Supervisor admission permit counter |
| **Descendant Trigger** | Max 8 observed processes per tree | Tree poller; immediate SIGTERM tree if exceeded |
| **Stdio Framing** | Header max 8 KiB; Body max 4 MiB | Framed reader buffer cap with fail-close error |
| **WebSocket Framing** | Max 4 MiB frame/message | Axum WS frame limit |
| **Channel Queues** | 32 queued messages / 4 MiB queued bytes per direction | Bounded `tokio::sync::mpsc::channel(32)` |
| **In-Flight Requests** | Max 8 concurrent navigation requests per session | Active request ID slot tracking |
| **Document Size** | Max 1 MiB UTF-8 text per document | Reject `didOpen`/`didChange` exceeding limit |
| **Document Count** | Max 16 concurrently open documents per session | Session document table capacity |
| **Overlay Memory** | Max 4 MiB overlay text per session; 8 MiB global | Session & global overlay byte counters |
| **Rate Limiting** | 40 msg/sec per session, burst 80 | Token bucket rate limiter |
| **Adaptive Sync** | Full replacement < 64 KiB UTF-8; Ranged Incremental >= 64 KiB | Post-edit buffer inspection before wire dispatch |
| **Startup Budget** | 30s child initialization deadline | `tokio::time::timeout` on handshake sequence |
| **Navigation Budget** | 10s request deadline | Per-request timeout with automatic cancellation |
| **Shutdown Budget** | 2s graceful (SIGTERM/shutdown RPC) + 3s force-kill (SIGKILL) | Two-phase reaper with reap verification |
| **Idle Eviction** | 60s idle timeout (only when 0 open docs and 0 pending work) | Idle timer task |
| **Crash Backoff** | Max 2 restarts within 5 min window; 1s then 3s backoff | Supervisor restart history token bucket |
| **Stderr Retention** | Ring buffer max 64 KiB sanitized output per session | Circular drain buffer with credential redaction |
| **Socket & Store Deadlines** | 2s socket send deadline; 2s auth store lookup deadline | Timeout wrappers on I/O futures |
| **V8 Heap Hint** | `--max-old-space-size=256` passed to Node binary | Absolute argv on spawn |
| **Spike Run Envelope** | 15 min wall-clock per harness run; 2h aggregate workload | Test harness runner watchdog timer |

---

## 3. Fixture Corpus Limits

All spike tests run strictly against isolated, synthesized temporary directories (`tempfile::TempDir`) within the following size ceilings:

| Corpus ID | Purpose | File Count | Aggregate Size | Key Characteristics |
|---|---|---|---|---|
| **Corpus-Clean-TS** | Basic definition & implementation | 5 files | < 50 KiB | Cross-file imports, interface implementation, class hierarchy |
| **Corpus-Sync-Crossing** | Adaptive sync & Unicode edge cases | 4 files | < 120 KiB | Contains 1 file at 60 KiB and 1 file at 70 KiB (crossing 64 KiB boundary), BMP + non-BMP emoji, astral plane characters, UTF-16 surrogates |
| **Corpus-Hostile-Sentinels** | Security & plugin suppression | 6 files | < 30 KiB | Malicious `tsconfig.json` plugins, fake local `typescript` decoy, `package.json` scripts, auto-type acquisition trigger |

---

## 4. Process Tree Ownership & Reaper Contract

1. **Process Group Isolation**: Every spawned child is created in its own process group (`setpgid(0, 0)` on POSIX / `process_group(0)` in Rust Command).
2. **Descending Process Tracking**: The supervisor probes `/proc/<pid>/task/<pid>/children` or equivalent tree inspection every 1 second to register all child PIDs.
3. **Two-Phase Termination**:
   - Phase 1: Send LSP `shutdown` request followed by `exit` notification, or SIGTERM to child PGID. Await exit for up to 2,000 ms.
   - Phase 2: If any process in PGID remains alive after 2,000 ms, send SIGKILL to the entire PGID (`kill(-pgid, SIGKILL)`).
   - Reaping: The parent task calls `waitpid` / Tokio `Child::wait` to consume exit status and prevent zombie accumulation.
4. **Failure Recovery**: On supervisor or harness panic, a dedicated cleanup guard ensures process group cleanup runs during unwind.

---

## 5. Pre-Execution Validation Check

- [x] All 20 candidate limit dimensions defined with exact numbers.
- [x] Fixture corpus scoped and sized.
- [x] Process group and two-phase reap sequence defined.
- [x] Baseline execution environment verified (Linux x64, loopback only, zero public exposure).
- [x] Gate G0 status: **PASSED / READY FOR G1**.
