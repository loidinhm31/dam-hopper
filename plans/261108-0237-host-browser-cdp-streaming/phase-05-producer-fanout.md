# Phase 05 — Stream bounded native JPEG with independent credits

## Context links
- [Overview](plan.md) · [Architecture contracts](architecture-contracts.md) · [Acceptance matrix](acceptance-matrix.md) · [Execution ownership](execution-ownership.md).
- [Backend evidence](reports/backend-boundaries.md) · [Viewer evidence](reports/viewer-boundaries.md) · [Protocol research](research/stream-protocol.md) · [Settled direction](reports/design-direction.md).
- Relevant bounded evidence: `research/stream-protocol.md:14–72; reports/design-direction.md:39–46 (prompt ACK overrides paced-ACK recommendation)`. Research recommendations superseded by architecture contract where explicitly stated.

## Overview
- Priority: P2. Status: DONE (2026-11-09). Effort: not-estimated.
- Deliverable: Stream bounded native JPEG with independent credits. Marked DONE per user approval with noted issues after Cycle 3 (2026-11-09; score 4/10; 70/70 checks passing across 8 targets: `browser_host_screencast` [3/3], `browser_host_media` [7/7], `browser_host_bounds` [3/3], regressions [57/57 across `gateway` 14/14, `admission` 7/7, `lifecycle` 10/10, UI E2E typecheck clean with 0 errors, and core unit checks `browser_host` 24/24]). Ready to proceed to Phase 06; Phase 06 unblocked.

## Key insights
Prompt exact-once CDP ACK avoids researched starvation/final-frame failure;10FPS is viewer governor only. Native compositor/encode rate and loopback CPU/bytes remain qualification risks.

## Requirements
One producer per watched target, one latest encoded mailbox, shared complete BHJF buffer cache, max2 outstanding+1 pending per viewer; atomic binary envelope, bounded recovery and no periodic screenshot engine.

## Architecture
Target actor drains native events with byte bounds and local run accounting; fanout owns subscription-specific credit entries and rate timers. Media writer never blocks auth cancellation or control/PTY transports.
- Follow exact API/envelope/limits/auth/reset ordering in architecture-contracts.md; no second protocol or undocumented task engine.

## Related code files / actions
Every path below is absolute; new/dependency-created files are explicitly classified. Task contracts carry the equivalent normalized repository-relative writable paths. No deletion of entire independent modules is authorized; obsolete Browser iframe symbols are removed only at the phase07 cutover.

### File map — produce-native-jpeg
| Action | Full path | Purpose |
|---|---|---|
| Create new (planned) | `/home/loidinh/WS/dam-hopper/server/src/browser_host/screencast.rs` | Implement native screencast producer and bounded recovery; exact responsibilities in numbered steps below. |
| Modify dependency-created | `/home/loidinh/WS/dam-hopper/server/src/browser_host/mod.rs` | Implement native screencast producer and bounded recovery; exact responsibilities in numbered steps below. |
| Create new (planned) | `/home/loidinh/WS/dam-hopper/server/tests/browser_host_screencast.rs` | Implement native screencast producer and bounded recovery; exact responsibilities in numbered steps below. |

### File map — fanout-binary-media
| Action | Full path | Purpose |
|---|---|---|
| Create new (planned) | `/home/loidinh/WS/dam-hopper/server/src/browser_host/media.rs` | Implement atomic envelopes bounded credits and media writer; exact responsibilities in numbered steps below. |
| Modify dependency-created | `/home/loidinh/WS/dam-hopper/server/src/browser_host/protocol.rs` | Implement atomic envelopes bounded credits and media writer; exact responsibilities in numbered steps below. |
| Modify dependency-created | `/home/loidinh/WS/dam-hopper/server/src/browser_host/mod.rs` | Implement atomic envelopes bounded credits and media writer; exact responsibilities in numbered steps below. |
| Modify dependency-created | `/home/loidinh/WS/dam-hopper/server/src/api/browser_host.rs` | Implement atomic envelopes bounded credits and media writer; exact responsibilities in numbered steps below. |
| Modify existing | `/home/loidinh/WS/dam-hopper/server/src/api/router.rs` | Implement atomic envelopes bounded credits and media writer; exact responsibilities in numbered steps below. |
| Create new (planned) | `/home/loidinh/WS/dam-hopper/server/tests/browser_host_media.rs` | Implement atomic envelopes bounded credits and media writer; exact responsibilities in numbered steps below. |

### File map — instrument-stream-bounds
| Action | Full path | Purpose |
|---|---|---|
| Create new (planned) | `/home/loidinh/WS/dam-hopper/server/src/browser_host/diagnostics.rs` | Expose bounded operational counters and enforce memory admission; exact responsibilities in numbered steps below. |
| Modify dependency-created | `/home/loidinh/WS/dam-hopper/server/src/browser_host/media.rs` | Expose bounded operational counters and enforce memory admission; exact responsibilities in numbered steps below. |
| Modify dependency-created | `/home/loidinh/WS/dam-hopper/server/src/browser_host/screencast.rs` | Expose bounded operational counters and enforce memory admission; exact responsibilities in numbered steps below. |
| Modify dependency-created | `/home/loidinh/WS/dam-hopper/server/src/browser_host/mod.rs` | Expose bounded operational counters and enforce memory admission; exact responsibilities in numbered steps below. |
| Create new (planned) | `/home/loidinh/WS/dam-hopper/server/tests/browser_host_bounds.rs` | Expose bounded operational counters and enforce memory admission; exact responsibilities in numbered steps below. |

## Numbered implementation steps

### produce-native-jpeg
- Dependencies: qualify-agent-interoperability.
- Bounded outcome: Implement native screencast producer and bounded recovery.
1. Subscribe dedicated Page session before start; serial start/stop/reconfigure with producerRun UUID and native sessionId learned from current ordered run. Enqueue exactly one ACK for each received current-run event after bounded admission or explicit drop. No replay/retry of ambiguously written ACK; connection failure restarts run.
2. Drain event ingress into one replaceable encoded candidate without task-per-event; enforce CDP/base64 bounds first, ACK even dropped valid-current-run candidates, select latest at governor boundary and decode base64 only selected candidate once. Parse JPEG SOF checked dimensions; no decode/re-encode.
3. Manage viewport signature and geometry epoch before publishing. At first attach/resize/restart, use current cached frame if valid; after250ms without native frame allow one captureScreenshot bracketed by layout metrics and epoch checks. Uncertain snapshot is display-only. No post-input/static periodic screenshot.
4. Stop screencast at zero visible demand; exercise real native engine with an owned bounded Rust test viewer in browser_host_screencast.rs (not future SPA) supplying visible/pause/heartbeat demand. Heartbeats5s/expiry15s, agents continue; keep final frame without withholding ACK. Production media controls repeat demand proof after fanout, full SPA later09.
- Consumer-visible acceptance:
  - Real engine plus owned bounded Rust test viewer proves first/resize/final frame,0periodic screenshots and zero-demand/heartbeat-expiry stop before SPA exists.
  - Burst events/old runs/ACK write failures cannot over-ACK or create unbounded retained frames; each target independently recovers.
- Future verification (from repository root; new targets above are planned):
  - `cargo test --manifest-path server/Cargo.toml --test browser_host_screencast -- --nocapture`
  - Smoke: real native engine+bounded Rust test viewer demand (no future SPA) animate/settle/attach/pause/heartbeat-expire/resize; inspect final frame, ACK ledger, stop and screenshot counts.

### fanout-binary-media
- Dependencies: produce-native-jpeg.
- Bounded outcome: Implement atomic envelopes bounded credits and media writer.
1. Serialize full immutable BHJF prefix+target/process/profile/producer/viewport/publication-only header+JPEG once/publication (no viewer/subscription values). Send identical contiguous Bytes clones through locked Axum0.8.8/tungstenite0.28.0 Binary(Bytes); no app-level per-viewer JPEG copy/custom WS stack. Reserve outstanding before send; failed send closes subscription, but its buffer reservation survives until LAST active-writer/cache/outstanding/pending clone drops.
2. At max10 deliveries/s,2outstanding+1latest pending, key by immutable admitted media socket subscription+producerRun/viewportEpoch/frameSeq. Require ACK/discard subscription from originating captured socket to equal that socket admission before exact removal; duplicate/future/foreign/old-socket traffic cannot add credit or clear replacement entries. Binary header never supplies subscription authority.
3. Implement bounded small media ACK/pause/heartbeat controls,30s outstanding timeout and5s physical send deadline. Pause detaches old demand/credits, requires fresh media socket+ticket+new subscription and matching new control pair on resume/rebind; never retag old socket.
4. Implement separate /api/browser/control WS ordered bounded writer for input/events, paired with media viewer identity but no JPEG bytes; both use independent auth supervisor cancellation and bounded event traffic.
- Consumer-visible acceptance:
  - Stalled viewer never blocks second viewer/target or terminal/control; per-viewer outstanding is never>2 and pending never>1.
  - Identical full BHJF Bytes buffer shared across viewers without app-level per-viewer JPEG copies; originating socket-bound ACK/discard frees only real credit, old/foreign sockets cannot alter replacement credit.
- Future verification (from repository root; new targets above are planned):
  - `cargo test --manifest-path server/Cargo.toml --test browser_host_media -- --nocapture`
  - Smoke: two viewers with different subscriptions receive identical shared full buffer; block writer, pause/rebind fresh socket and replay captured old ACK/discard;2outstanding1pending and last-clone buffer charges hold, separate control/PTY responds.

### instrument-stream-bounds
- Dependencies: fanout-binary-media.
- Bounded outcome: Expose bounded operational counters and enforce memory admission.
1. Report bounded-label counters/histograms: producer received/admitted/dropped/ACK attempted, base64 decoded, JPEG bytes, delivered/ACK/discard, writer/ACK age, pending/decode/command depths, screenshot reason/count and memory reservations. Never retain per-frame traces unbounded.
2. Enforce128MiB global Browser payload/queue reservation across actor ingress, commands, raw gateway and encoded/JPEG references with unique COMPLETE BHJF prefix+header+JPEG allocation accounting until last clone drops, including old outstanding/slow-writer clones after credits close; reject/reap on exhaustion. Track allocated bytes vs clone count and unavoidable WS/TLS buffers separately.
3. Provide opt-in synthetic qualification event timestamps with bounded ring/export; production logs omit payloads, tickets, full URLs and selection text. Document engine capture can exceed10FPS despite bounded viewer delivery.
- Consumer-visible acceptance:
  - Two targets/two viewers/stalled gateway respect hard caps; unique complete BHJF buffers stay charged until last clone drops, including slow-writer/old-outstanding buffers after subscription cleanup.
  - Operational counters distinguish producer capture work from viewer delivery rate and reveal zero-viewer stop/periodic-screenshot violations.
- Future verification (from repository root; new targets above are planned):
  - `cargo test --manifest-path server/Cargo.toml --test browser_host_bounds -- --nocapture`
  - Smoke: sustain animation+slow ACK for60s, close credits while writer retains old clone, verify complete-buffer reservation remains until final drop; record highwater/queue depths/busy, not only RSS.

## Durable task contracts / todo
Exactly one fence; task IDs/markers stable across revisions. No tasks.json or hydration in this planning assignment.

```evcrate-tasks
[
  {
    "id": "produce-native-jpeg",
    "title": "Implement native screencast producer and bounded recovery",
    "blocked_by": [
      "qualify-agent-interoperability"
    ],
    "allowed_files": [
      "server/src/browser_host/screencast.rs",
      "server/src/browser_host/mod.rs",
      "server/tests/browser_host_screencast.rs"
    ],
    "constraints": [
      "Follow architecture-contracts.md; preserve unrelated workflows; escalate any required write outside this literal file set."
    ],
    "acceptance": [
      "Real engine plus owned bounded Rust test viewer proves first/resize/final frame,0periodic screenshots and zero-demand/heartbeat-expiry stop before SPA exists.",
      "Burst events/old runs/ACK write failures cannot over-ACK or create unbounded retained frames; each target independently recovers."
    ],
    "verification": [
      "cargo test --manifest-path server/Cargo.toml --test browser_host_screencast -- --nocapture",
      "Smoke: real native engine+bounded Rust test viewer demand (no future SPA) animate/settle/attach/pause/heartbeat-expire/resize; inspect final frame, ACK ledger, stop and screenshot counts."
    ]
  },
  {
    "id": "fanout-binary-media",
    "title": "Implement atomic envelopes bounded credits and media writer",
    "blocked_by": [
      "produce-native-jpeg"
    ],
    "allowed_files": [
      "server/src/browser_host/media.rs",
      "server/src/browser_host/protocol.rs",
      "server/src/browser_host/mod.rs",
      "server/src/api/browser_host.rs",
      "server/src/api/router.rs",
      "server/tests/browser_host_media.rs"
    ],
    "constraints": [
      "Follow architecture-contracts.md; preserve unrelated workflows; escalate any required write outside this literal file set."
    ],
    "acceptance": [
      "Stalled viewer never blocks second viewer/target or terminal/control; per-viewer outstanding is never>2 and pending never>1.",
      "Identical full BHJF Bytes buffer shared across viewers without app-level per-viewer JPEG copies; originating socket-bound ACK/discard frees only real credit, old/foreign sockets cannot alter replacement credit."
    ],
    "verification": [
      "cargo test --manifest-path server/Cargo.toml --test browser_host_media -- --nocapture",
      "Smoke: two viewers with different subscriptions receive identical shared full buffer; block writer, pause/rebind fresh socket and replay captured old ACK/discard;2outstanding1pending and last-clone buffer charges hold, separate control/PTY responds."
    ]
  },
  {
    "id": "instrument-stream-bounds",
    "title": "Expose bounded operational counters and enforce memory admission",
    "blocked_by": [
      "fanout-binary-media"
    ],
    "allowed_files": [
      "server/src/browser_host/diagnostics.rs",
      "server/src/browser_host/media.rs",
      "server/src/browser_host/screencast.rs",
      "server/src/browser_host/mod.rs",
      "server/tests/browser_host_bounds.rs"
    ],
    "constraints": [
      "Follow architecture-contracts.md; preserve unrelated workflows; escalate any required write outside this literal file set."
    ],
    "acceptance": [
      "Two targets/two viewers/stalled gateway respect hard caps; unique complete BHJF buffers stay charged until last clone drops, including slow-writer/old-outstanding buffers after subscription cleanup.",
      "Operational counters distinguish producer capture work from viewer delivery rate and reveal zero-viewer stop/periodic-screenshot violations."
    ],
    "verification": [
      "cargo test --manifest-path server/Cargo.toml --test browser_host_bounds -- --nocapture",
      "Smoke: sustain animation+slow ACK for60s, close credits while writer retains old clone, verify complete-buffer reservation remains until final drop; record highwater/queue depths/busy, not only RSS."
    ]
  }
]
```

- [x] <!-- evcrate-task:produce-native-jpeg --> Implement native screencast producer and bounded recovery
- [x] <!-- evcrate-task:fanout-binary-media --> Implement atomic envelopes bounded credits and media writer
- [x] <!-- evcrate-task:instrument-stream-bounds --> Expose bounded operational counters and enforce memory admission

## Success criteria
- Every task acceptance above is observed with applicable compile/typecheck, behavioral tests and real smoke evidence; missing or failed proof keeps task incomplete.
- Acceptance matrix rows owned by this phase have precise observations, not source-text assertions or mocked-only feature success.
- Writable scope and prerequisite outputs match execution-ownership.md; no competing shared-file writers or product verification storms.

## Risk assessment / failure and rollback
Prompt ACK can spend substantial encode/loopback CPU; measure later and stop release if budgets fail, do not silently add screenshot polling or ACK pacing.
- On a defect, stop dependent work, reopen the producing task and rerun impacted behavioral checks under the single integration owner; do not narrow acceptance. Disable Browser capability if safe operation cannot be established, never restore iframe fallback.

## Security considerations
JPEG/header lengths checked before allocation; abusive ACK/control traffic disconnects. Frame metadata contains only bounded geometry/identity, not browser secrets.
- Do not store/log bearer/tickets/raw loopback endpoints, real site credentials or sensitive page/selection payload in diagnostics/evidence.

## Next steps
Phase 05 is DONE (2026-11-09). Phase 06 is unblocked. Phase 06 (owner-fenced canvas decoder and Android-web input) may proceed using isolated component and input harnesses. Phase 07 joins completed producer and viewer branches; no root OS cutover before both are coherent.
- Parent owns independent plan review/optional validation and implementation permission. This phase text neither executes tasks nor supplies approval.

## Unresolved questions
- No additional product interview here. Exact compatibility/platform/performance and human observations remain future gates where applicable; their absence is not a pass.
