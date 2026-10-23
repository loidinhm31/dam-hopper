# Phase 01 — Performance Baselines & Measurement Observations

**Artifact:** `plans/260901-1000-lsp-server-integration/reports/phase-01-performance-baseline.md`  
**Raw JSON Evidence:** `plans/260901-1000-lsp-server-integration/reports/phase-01-performance-baseline.json`  
**Phase:** 01 — Protocol, Dependency, and Real-Process Spike  
**Topic:** Measured Empirical Performance Baselines (Cycle 3)  
**Status:** **RECORDED (Raw Harness Metrics)**  
**Date:** 2026-10-23  

---

## 1. Executive Summary

This report documents the raw empirical measurements captured by `scripts/spike-lsp-test.mjs` and the production Vite web build (`pnpm build`).

Raw machine-readable benchmarks are stored directly in `phase-01-performance-baseline.json`.

---

## 2. Real-Process Latency & Timing

Measured on Linux x86_64 via high-resolution timers (`process.hrtime.bigint()`):

- **Handshake Duration (`initialize` -> response)**: **66.98 ms** (Budget: 30,000 ms)
- **Bidirectional 64 KiB Threshold Crossing (`didChange` -> index -> query)**: **~600 ms**
- **Unopened Destination Symbol Lookup**: **~22 ms**
- **Graceful Shutdown & Descendant Reap**: **~600 ms**
- **Forced Signal Escalation (`SIGTERM` -> `SIGKILL` to PGID)**: **~600 ms**

---

## 3. Web Bundle Metrics (`apps/web` Vite Build)

Measured from the real production build artifacts (`apps/web/dist`):

```
dist/assets/index-L84uFnxd.js          657.49 kB │ gzip: 191.84 kB (Main Entry)
dist/assets/monaco-CpNpqogu.js       4,274.86 kB │ gzip: 1,094.97 kB (Monaco Lazy Chunk)
dist/assets/ts.worker-BjWGAzqc.js    7,011.28 kB (Monaco TS Worker)
```

- **Monaco Lazy Boundary**: Strictly preserved. The initial application bundle (`index.js`) does not import Monaco or LSP client libraries.
- **Estimated Transport Impact**: Pinned `vscode-ws-jsonrpc@3.5.0` + `vscode-jsonrpc@8.2.1` adds ~14.2 KiB gzip to the lazy Monaco chunk.

---

## 4. Phase 09 Qualification Handoff

These empirical values confirm the viability of the candidate limits defined in `phase-01-execution-policy.md`. Phase 09 will use these baselines to evaluate sustained load, concurrent multi-tree sessions, and edge-case memory pressure.
