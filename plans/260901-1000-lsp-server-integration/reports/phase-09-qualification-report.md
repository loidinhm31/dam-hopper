# Phase 09 Qualification Report: Linux x64 Server & Web Bundled TSLS

**Date:** 2026-10-24  
**Plan:** `plans/260901-1000-lsp-server-integration/phase-09-security-real-process-tests-and-performance-qualification.md`  
**Scope:** Linux x64 server and web host, bundled TS/JS language services (`node-24.16.0-ts-5.9.3-tsls-6.0.2-linux-x64`).  
**Mode:** Portable-only qualified; Hard cgroup v2 mode unavailable/unqualified on this host. Native Tauri, Windows, Android, Java, and Rust remain unqualified and deferred.

---

## 1. Executive Summary & Qualification Disposition

Phase 09 qualification is **COMPLETE and PASSED for portable-only Linux x64 server + web**.

All gates defined in the execution contract and predeclared budget (`reports/phase-09-qualification-budget-v1.json`) have been verified against real running child processes, live SQLite and MongoDB databases with non-reading consumers, and real Chromium browser Monaco integration over authenticated WebSocket.

| Area | Status | Evidence Summary |
|---|---|---|
| **Bundled Toolchain Integrity** | **PASS** | 11/11 tests pass. SHA-256 digest verification across all 18 transitive executable artifacts, lockfile, manifests, and licenses. Symlinks and writable permissions rejected. |
| **Adversarial Code-Loading Denial** | **PASS** | 4/4 tests pass. Positive controls confirm V1 plugin, V2 SDK decoy, V3 preload/ESM loader, and V4 ATA canaries execute when enabled. In production configuration, zero project code executes; root TSLS environment is sanitized (`PATH=/usr/bin:/bin`, `NODE_ENV=production`, `NODE_OPTIONS`/`NODE_PATH` stripped). Descendant `NODE_PATH` points exclusively to bundled `node_modules`. |
| **Settings & All-Write-Path Authorization** | **PASS** | 21/21 tests pass against temporary SQLite stores. Admin toggle ON starts zero children; dropped toggle request completes durable OFF; stale admin demotions, unauthenticated, `--no-auth` dev users, and non-admin roles denied. Atomic failure keeps durable intent with safe-disabled runtime. Protected aliases and workspace imports reject semantic injection. |
| **Live Auth Revocation (Non-reading Sockets)** | **PASS** | 20/20 cases pass (10 SQLite, 10 MongoDB). Under saturated backpressure and unread socket, admission cutoff is immediate (0ms), cancellation occurs out-of-band, and physical descendant tree reap completes in 506–510ms (budget <= 6000ms). Both real store timeout cases sustained exactly 2001ms. |
| **Deterministic Fault Process Matrix** | **PASS** | 18/18 tests pass. Fragmented/coalesced frames, oversized/malformed headers, duplicate replies, stderr flood, crash restart with replay, stubborn descendants (SIGKILL escalation), and nonleader worker-thread child discovery verified. |
| **Session Supervisor & Lifecycle** | **PASS** | 32/32 tests pass. Independent overlays, document-scoped close, saturation queue rejection (8 in-flight held, 9th rejected with exact `InFlightQueueFull`), cancellation recovery, and complete tree reap verified. |
| **Gateway Protocol & URI Containment** | **PASS** | 11/11 tests pass. Virtual URI containment, traversal (`..`) rejection, non-disclosing `outsideTarget: true` filtering, exact subprotocol negotiation, and clean disconnect reap verified. |
| **Browser Client Adaptive Sync & Freshness** | **PASS** | 21-step fixed union across 32/64/128 KiB boundaries verified in real Chromium against live server. Zero stale reveals observed during rapid pre-publication edits. Provider coexistence cleanly restored on OFF. |
| **Performance & Resource Qualification** | **PASS** | 3 repetitions of 60 warm navigations across small/medium/large tiers with concurrent core/terminal load. Cold ready p95 1.14s (<=15s); warm nav p95 10.08ms (small), 18.73ms (medium), 40.42ms (large); core p95 40.74ms (<=121.87ms relative ceiling); 0 terminal drops; 0 orphan processes. |

---

## 2. Frozen Final Resource Policy

All three candidate thresholds (32 KiB, 64 KiB, 128 KiB) passed exploratory benchmarks with zero errors. 64 KiB (65536 bytes) was selected as the simplest evidence-supported baseline:

| Parameter | Frozen Value | Enforcement Scope |
|---|---|---|
| `adaptiveSyncThresholdBytes` | `65536` (64 KiB) | Wire synchronization: `< 64 KiB` sends full text; `>= 64 KiB` sends ranged incremental edits. |
| `maxDocumentBytes` | `1048576` (1 MiB) | Maximum single open document text size. |
| `maxOpenDocumentsPerSession` | `16` | Maximum concurrent open documents per session. |
| `maxSessionOverlayBytes` | `4194304` (4 MiB) | Maximum total unsaved overlay text per session. |
| `maxGlobalOverlayBytes` | `8388608` (8 MiB) | Server-wide unsaved overlay text ceiling. |
| `maxInFlightRequests` | `8` | Maximum concurrent pending navigation requests per session; 9th rejected. |
| `maxGlobalSemanticTrees` | `2` | Maximum concurrent semantic language server processes server-wide. |
| `maxTreesPerConnection` | `1` | Maximum semantic tree per client connection. |
| `maxProcessesPerTree` | `8` | Monitored process ceiling per semantic tree before triggering tree kill. |
| `v8MaxOldSpaceMb` | `256` | V8 heap constraint (`--max-old-space-size=256`). |
| `maxQueuedMessages` | `32` | Maximum queued messages per direction. |
| `maxQueuedBytes` | `4194304` (4 MiB) | Maximum queued payload bytes per direction. |
| `messageRatePerSec` / `burst` | `40` / `80` | Token-bucket rate limiter per session. |
| `startupTimeoutMs` | `30000` (30s) | Child spawn and initialize handshake deadline. |
| `navigationTimeoutMs` | `10000` (10s) | Individual navigation request deadline. |
| `idleShutdownTimeoutMs` | `60000` (60s) | Inactivity timeout when zero documents remain open. |
| `socketSendTimeoutMs` | `2000` (2s) | WebSocket send timeout. |
| `authStoreLookupTimeoutMs` | `2000` (2s) | Live authentication check and admission lookup deadline. |

---

## 3. Final Numerical Verification Against Canonical Budgets

Evaluated from `plans/260901-1000-lsp-server-integration/reports/qualification/attempts/2026-10-24T02-54-09-482Z-pid951108-final-aggregate.json`:

| Metric | Measured Fact | Predeclared Acceptance Budget | Margin / Outcome |
|---|---|---|---|
| **Cold-Ready p95** | **1,142.02 ms** | $\le 15,000\text{ ms}$ | **PASS** (13.1x margin) |
| **Small Tier Warm Nav p95** | **10.08 ms** | $\le 500\text{ ms}$ | **PASS** (49.6x margin) |
| **Medium Tier Warm Nav p95** | **18.73 ms** | $\le 1,500\text{ ms}$ | **PASS** (80.1x margin) |
| **Large Tier Warm Nav p95** | **40.42 ms** | $\le 3,000\text{ ms}$ | **PASS** (74.2x margin) |
| **Core & Terminal p95 (Absolute)** | **40.74 ms** | $\le 250\text{ ms}$ | **PASS** (6.1x margin) |
| **Core & Terminal p95 (Relative)** | **40.74 ms** | $\le 121.87\text{ ms}$ ($\min(250, \max(3 \times \text{OFF}, \text{OFF} + 50))$) | **PASS** (OFF p95: 40.62 ms) |
| **Tree Reap Duration Max** | **1,081.17 ms** | $\le 6,000\text{ ms}$ | **PASS** (5.5x margin) |
| **Terminal Output Drops** | **0** | **0** | **PASS** (Zero drops) |
| **Stale Monaco Reveals** | **0** | **0** | **PASS** (Zero stale reveals) |
| **Outside-Target Disclosures** | **0** | **0** | **PASS** (Zero disclosures) |
| **Canary Executions in Denied Runs** | **0** | **0** | **PASS** (Zero executions) |
| **Orphan Surviving Processes** | **0** | **0** | **PASS** (Zero orphans) |

---

## 4. Concurrent Core & Terminal Responsiveness

Core endpoints were sampled simultaneously during sustained semantic navigation across all 3 workload tiers (300 samples per endpoint per tier, 4,500 total probes):

| Endpoint | Small Tier p95 | Medium Tier p95 | Large Tier p95 | Relative Ceiling | Outcome |
|---|---|---|---|---|---|
| `health` | 0.24 ms | 0.26 ms | 0.26 ms | $\le 50.27\text{ ms}$ | **PASS** |
| `workspaceStatus` | 0.47 ms | 0.51 ms | 0.51 ms | $\le 50.73\text{ ms}$ | **PASS** |
| `fsList` | 0.53 ms | 0.59 ms | 0.58 ms | $\le 50.92\text{ ms}$ | **PASS** |
| `gitRoots` | 4.17 ms | 4.32 ms | 4.13 ms | $\le 54.26\text{ ms}$ | **PASS** |
| `ptyRoundTrip` | 41.60 ms | 41.56 ms | 41.60 ms | $\le 91.30\text{ ms}$ | **PASS** |

- Small tier overlap: 6,815 ms total window, 1,668 semantic navigations overlapping 1,500 core probes.
- Medium tier overlap: 7,070 ms total window, 885 semantic navigations overlapping 1,500 core probes.
- Large tier overlap: 7,107 ms total window, 382 semantic navigations overlapping 1,500 core probes.

---

## 5. Whole-Tree Resource Utilization

Sampled at 100 ms intervals across all discovered semantic descendant process trees via Linux procfs:

- **Total Sample Count:** 657 samples across 4 distinct phases (139 startup, 270 warm, 66 browser, 182 reap).
- **Peak Semantic Tree RSS:** 774.8 MiB (738.9 MiB).
- **p50 / p95 Tree RSS:** 298.3 MiB / 691.0 MiB.
- **Maximum Concurrent Processes Across Trees:** 4 (TSLS CLI + tsserver for main and peer trees).
- **Cumulative CPU Delta:** 31,250 ms across the entire 3-tier workload.
- **Interval CPU Delta (p50 / p95 / Max):** 98.4 ms / 182.1 ms / 210.0 ms per 100 ms interval.
- **Post-Cleanup Zero Observations:** 1 confirmed sample verifying 0 surviving owned processes, all PGIDs empty, and zero retained PID starttimes alive.

---

## 6. Session Pressure Diagnostics & Accounting Verification

Tracked transitions across 31 directly held session instances (`cold`, `warm_main`, `warm_peer`, `hostile`):

- **In-Flight Requests:** Peak 1 per session; 0 sampled concurrent residual.
- **Command Queue Slots:** Peak 3 reserved slots; 0 residual.
- **Child Outbound Queue Slots:** Peak 7 reserved slots; 0 residual.
- **Child Outbound Payload Bytes:** Peak 207,641 bytes buffered; 0 residual.
- **Open Documents / Overlay Bytes:** Peak 8 documents / 263,258 bytes per session; 0 residual.
- **Post-Reap Residual Cleanup:** 31/31 sessions reaped; `allClean: true`; exactly 0 residual bytes, open documents, in-flight requests, and queue slots.
- **Lifetime Totals:** 31 spawn attempts, 31 successful spawns, 0 restart attempts, 0 successful restarts.
- **Unexpected Error Counters:** 0 navigation timeouts, 0 navigation cancellations, 0 navigation overloads, 0 stale results.

---

## 7. Security & Authorization Evidence Summary

1. **Adversarial Code Loading Denial:**
   - Exercised V1 malicious TS plugin (`malicious-ts-plugin/index.js`), V2 workspace SDK decoy (`node_modules/typescript/lib/tsserver.js`), V3a CommonJS preload (`NODE_OPTIONS=--require`), V3b ESM loader (`NODE_OPTIONS=--import`), and V4 automatic type acquisition shim (`bin/npm`).
   - Positive controls confirm all 4 canaries execute when probes are enabled.
   - In production configuration, 0 canary files are created. Descendant command lines confirm `--disableAutomaticTypingAcquisition`, no `--allowLocalPluginLoads`, no `--globalPlugins`, and no `--pluginProbeLocations`.
2. **Actor & All-Write-Path Authorization:**
   - 21/21 settings tests passed. GET and PATCH `/api/semantic/settings` enforce a 2-second admission deadline against the live user/session store, failing closed with HTTP 503 `AUTH_UNAVAILABLE` on stalled locks.
   - Demoted admins, non-admin users, `--no-auth` dev users, and unauthenticated requests are denied.
   - Workspace config PUT and settings import reject embedded `[semantic]` or `[server.semantic]` payloads with HTTP 400.
3. **Live Auth Invalidation Under Slow Consumers:**
   - 20/20 non-reading socket cases passed across real SQLite and MongoDB stores.
   - Measured blocked-output overlap at cutoff: 892–902 ms.
   - Immediate admission cutoff: 0 ms.
   - Out-of-band cancellation signal and physical tree reap: 506–510 ms (well within 6,000 ms budget).
   - Real backend store timeouts (simulated via WAL reader lock and blackholed TCP proxy): exactly 2,001 ms before fail-closed teardown.
4. **Virtual URI Containment & Result Sanitization:**
   - Traversal attempts (`../outside.ts`, percent-encoded `%2e%2e`, NUL bytes) rejected with JSON-RPC error `-32002` (`INVALID_URI`).
   - Results outside target root return non-disclosing `outsideTarget: true` with zero disclosure of host paths, release paths, or TypeScript stdlib paths.

---

## 8. Platform Scope & Documented Limitations

1. **Portable-Only Qualified on Linux x64:**
   - Qualified for Linux x64 server (Axum) and web host (React 19 / Monaco) using the pinned bundled tuple.
   - Portable application limits (16 documents, 4 MiB overlays, 8 processes per tree, 2 trees globally) and sampled procfs termination are enforced.
2. **Hard Cgroup Mode Unqualified:**
   - Although the host provides unified cgroup v2, the production supervisor does not wire child-tree cgroup controller adapters during session spawn. Hard cgroup mode is explicitly recorded as **UNAVAILABLE_UNQUALIFIED** (`status: "NOT_SELECTED"`).
   - Portable sampled RSS observations and V8 heap limits are NOT hard OS memory ceilings or OS sandboxes.
3. **Trusted Workspaces Only:**
   - Semantic children execute under the daemon account's OS user authority. Application URI containment protects client navigation and prevents unauthorized path disclosure, but does not provide kernel-level OS filesystem isolation against arbitrary file reads by the language server.
4. **Deferred Platforms:**
   - Native desktop hosts (Linux Tauri, Windows, macOS, Android) remain unqualified and non-blocking.
   - Java and Rust language engines remain unsupported with zero plugin fallback.
5. **Phase 10 Prerequisite:**
   - This phase qualifies protocol semantics, process lifecycles, and performance budgets. Full end-to-end user journey acceptance in the built web SPA and human visual inspection are governed by Phase 10.
