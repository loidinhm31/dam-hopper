---
title: "Browser adaptive stream quality and performance"
description: "Adapt shared Browser image fidelity and per-viewer pacing to measured delivery while preserving layout, input and audio safety."
status: in-progress
priority: P2
effort: 82h
branch: feat/ai-os-redesign
tags: [feature, backend, frontend, api, tech-debt]
created: 2026-11-12
---
# Browser adaptive stream quality and performance

## Outcome
Improve existing server Chromium → CDP JPEG → BHJF/WebSocket → React canvas. Auto uses measured application delivery, ACK service and decoder pressure—not a claimed internet-speed test. Keep one encoder, existing admission/credits and owner fences.

## Phases
| Phase | Status / progress | Effort |
| --- | --- | --- |
| [01 Measurement and feedback](phase-01-measurement-and-feedback.md) | Completed (2026-11-12) · 2/2 tasks | 10h |
| [02 Hot-path and client performance](phase-02-hot-path-and-client-performance.md) | Pending · 0/7 tasks | 20h |
| [03 Server adaptive capture tiers](phase-03-server-adaptive-capture-tiers.md) | Pending · 0/2 tasks | 20h |
| [04 Viewer quality controls](phase-04-viewer-quality-controls.md) | Pending · 0/2 tasks | 10h |
| [05 Calibration, qualification and docs](phase-05-calibration-qualification-and-docs.md) | Pending · 0/2 tasks | 12h |
| [06 Input interaction defects](phase-06-input-interaction-defects.md) | Pending · 0/4 tasks | 10h |

<!-- evcrate-progress:start -->
Tasks: 2/19 completed; remaining: 17.
<!-- evcrate-progress:end -->

## Settled design
- Slowest **visible, non-stalled, non-expired** viewer sets shared JPEG quality/resolution; delivery FPS independent per viewer. No per-viewer re-encode; faster viewers see the shared fidelity limitation.
- Degrade FPS → JPEG quality → resolution (0.75x, 0.5x); recover resolution → quality → FPS. Network adaptation never changes CSS viewport/DPR or calls the viewport API.
- Four internal tiers, calibrated thresholds, bounded hysteresis/dwell. Admin configuration remains a hard ceiling; no measurement is an entitlement to increase resource caps.
- Tools selector Auto / High / Medium / Low; Auto default, session-only memory keyed by profile/generation/window/tab; no control lease required. Show actual shared tier and local FPS.
- Muted or lowest-tier viewers receive no new audio chunks; show suppression reason. Preserve audio document authority across capture-only changes; resume fresh audio, never backlog.
- Approved input extension: bounded whole-paste admission/chunking with visible rejection/interruption, accepted-pointer capture, CSS-pixel wheel normalization and small update/input fairness repair; no native release/dispatch duplication.

## Dependencies and ownership
- Read-only prerequisite: [Host Browser remediation](../261109-2251-host-browser-review-remediation/plan.md), currently in-progress; phases 02–04 pending. Required existing tasks: `unify-geometry-counters`, `enforce-paired-input-lifecycle`, `recover-screencast-runs`, `bound-browser-payloads`, `repair-browser-portals`, `reconcile-browser-ownership`, `fence-client-input-decoding`, `wire-browser-interaction`.
- Each phase names its exact external gates; they are **not** imported into this plan's task DAG. Coordinator verifies upstream evidence before scheduling; unchecked upstream work blocks the relevant task, not its duplication here.
- One integration owner serializes shared-file tasks and other active Browser plans. Internal tasks use only this plan's IDs in `blocked_by`; literal writable paths in each phase are authoritative. New focused Rust snake_case / TS kebab-case modules aim <200 lines each.
- Phase 06 follows `pace-client-input` plus external `fence-client-input-decoding`, `wire-browser-interaction`, `enforce-paired-input-lifecycle`; it does not block Phases 03–05. Integration owner serializes overlapping files; no concurrent input/host/media writers.
- Architecture design recorded here under scoped authoring; maintained architecture publication remains coordinator-owned before implementation, final reconciliation in Phase 05. Preferred `docs/architecture.md` / root `ARCHITECTURE.md` absent; [current subsystem architecture](../../docs/architecture/host-browser-cdp-streaming.md) is baseline.

## Evidence
- [Network adaptation research](../reports/researcher-261112-1205-network-adaptive-screencast-quality.md)
- [CDP performance research](../reports/researcher-261112-1205-cdp-screencast-performance-best-practices.md)
- [Browser streaming map](../reports/scout-261112-1205-browser-host-streaming-map.md)
- [Frame pipeline review](../reports/code-reviewer-261112-1205-browser-server-frame-pipeline.md)
- [Media transport review](../reports/code-reviewer-261112-1205-browser-server-media-transport.md)
- [UI client review](../reports/code-reviewer-261112-1205-browser-ui-client.md)
- [Planner decisions, complete dedupe map and deferrals](../reports/planner-261112-1205-browser-adaptive-stream-quality.md)

## Acceptance and handoff
Every phase's observable gates plus throttled-link/two-viewer/text/input/audio qualification must pass; no raw-link-capacity, performance gain or deployed-Chromium compatibility claimed from source. Commands are future checks from repository guidance, not executed receipts.
Planning only: no builds/tests, product/docs edits, activation or task hydration. Independent plan challenge and final validation remain coordinator-owned/pending; this authoring result grants no implementation or release approval.
Rollback: drain Browser pairs, deploy matched previous backend/UI, preserve profiles/credentials/locks/tombstones; do not revert completed remediation or revive unsafe transport/input paths.

## Non-goals
Defer WebRTC/tabCapture, H.264/WebCodecs encode, WebP, tile/delta protocol, worker/OffscreenCanvas/ImageDecoder, per-viewer re-encode and synthetic speed tests. `navigator.connection` may be an optional start hint only, never authority. No new service, persistence or unauthenticated surface.

## Unresolved questions
No unsettled product decision. Tier thresholds, legibility floors, deployed-engine switch/metadata behavior and measured latency objectives are Phase 05 qualification gates, not known results.
