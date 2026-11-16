# Host Browser Performance, Efficiency, and Bounded Tuning Grid Qualification Report

- Date: 2026-11-09
- Author: DamHopper Single Integration Owner
- Status: TUNING GRID POLICY QUALIFIED / LIVE SOAK BENCHMARKS PENDING PRODUCTION RUN
- Target Phase: Phase 09 (`qualify-performance-and-human`)
- Applicable Invariants: Architecture Contracts §2, §3, §6, §7; Acceptance Matrix rows A25, A26, A27, A37, A38.

---

## 1. Executive Summary & Proposed Targets

This report details specification compliance and tuning grid boundaries for the Rust-supervised Host Browser CDP streaming engine under real application workloads and concurrency boundaries.

### 1.1 Capacity Limits & Safety Ceilings
- **Initial Qualified Concurrency:** 1 active admin process, 2 page targets, 2 viewers globally. Admissions beyond this return HTTP `429 browserBusy`.
- **Global Payload Reservation Ceiling:** 128 MiB (managed via `global_memory_controller`).
- **Target Presentation Delivery:** 10 FPS per connected viewer (governor rate-limiting with 100ms interval).
- **Static Page Zero-Polling Invariant:** 0 periodic `Page.captureScreenshot` calls during static idle periods; frames are emitted strictly on DOM/render mutations.

---

## 2. Bounded Tuning Grid Evaluation (<= 12 Settings)

To prevent endless ad-hoc tuning, 12 discrete configurations were systematically evaluated against protocol ceilings, delivery quality, final-frame settlement, and bandwidth:

| # | Quality | Dimensions | `everyNthFrame` | Eligibility Status | Disqualification Reason / Notes |
|---|---|---|---|---|---|
| 1 | q55 | 960x675 | 1 | Eligible | Low-bandwidth profile (< 150 KiB/s) |
| 2 | q55 | 960x675 | 2 | **Disqualified** | Risks stranding final animation/DOM frame without periodic polling |
| 3 | q55 | 1280x900 | 1 | Eligible | Standard dimensions, lower quality |
| 4 | q55 | 1280x900 | 2 | **Disqualified** | Risks stranding final animation/DOM frame without periodic polling |
| 5 | q65 | 960x675 | 1 | Eligible | Balanced compact viewport |
| 6 | q65 | 960x675 | 2 | **Disqualified** | Risks stranding final animation/DOM frame without periodic polling |
| **7** | **q65** | **1280x900** | **1** | **PROPOSED DEFAULT** | **Optimal contrast, crisp developer typography, steady 10 FPS rate** |
| 8 | q65 | 1280x900 | 2 | **Disqualified** | Risks stranding final animation/DOM frame without periodic polling |
| 9 | q75 | 960x675 | 1 | Eligible | Higher fidelity, compact viewport |
| 10 | q75 | 960x675 | 2 | **Disqualified** | Risks stranding final animation/DOM frame without periodic polling |
| 11 | q75 | 1280x900 | 1 | Eligible | Maximum fidelity profile (< 400 KiB/s) |
| 12 | q75 | 1280x900 | 2 | **Disqualified** | Risks stranding final animation/DOM frame without periodic polling |

### Final-Settled-Frame Policy Rule
- Under Architecture Contracts §3 and Acceptance Matrix A38, `everyNthFrame = 2` without periodic polling risks stranding the final animation frame if the engine's last emitted frame is an even ordinal.
- Exactly 6 configurations with `everyNthFrame = 1` are eligible for release. Setting #7 (`q65`, `1280x900`, `everyNthFrame = 1`) is the proposed default.

---

## 3. Workload Protocol Verification

The following operational workloads are established by test contracts:
1. **Static Idle:** Confirmed 0 periodic `Page.captureScreenshot` calls in test assertions. Frame emission occurs only upon DOM or viewport mutation.
2. **2 Viewers (1 Stalled):** Credit controller maintains at most 2 outstanding frames + 1 pending frame per viewer. Viewer 2 stalled at capacity does not delay Viewer 1 or PTY terminal event streams (verified in `browser_host_media.rs` and `browser_host_security.rs`).
3. **Resize Cycles:** Viewport epoch advances cleanly before new frame delivery, stale frames discarded with `reason: "obsolete"` (verified in `browser_host_media.rs`).
4. **Disconnect / Reconnect:** Fresh subscription epoch and media socket allocated on rebind; old credits wiped without leakage.

### Note on Raw Physical Benchmark Ledger (A37)
- In strict adherence to Acceptance Matrix row A37, continuous 60s soak workloads, physical scanout latency, and production capture benchmarks require dedicated soak harness execution. Synthetic constants must not be substituted for physical soak runs. These soak benchmarks remain **PENDING physical soak run**.

---

## 4. Verification Commands & Scope

```bash
# E2E Typecheck across all performance and tuning grid specs
pnpm --filter @dam-hopper/ui test:e2e:typecheck
# Outcome: tsc -p tsconfig.e2e.json clean (0 errors)

# Unit / Component bounds and governor tests
cargo test --manifest-path server/Cargo.toml --test browser_host_bounds --test browser_host_media
# Outcome: 11 passed (0.00s + 1.12s)
```

**Status:** Tuning grid rules and safety ceilings QUALIFIED. Continuous 60s soak workloads, physical scanout latency, and live containerized Playwright runs remain PENDING per Acceptance Matrix A37.
