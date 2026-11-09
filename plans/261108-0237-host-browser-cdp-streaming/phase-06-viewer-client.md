# Phase 06 — Build owner-fenced canvas decoder and Android-web input

## Context links
- [Overview](plan.md) · [Architecture contracts](architecture-contracts.md) · [Acceptance matrix](acceptance-matrix.md) · [Execution ownership](execution-ownership.md).
- [Backend evidence](reports/backend-boundaries.md) · [Viewer evidence](reports/viewer-boundaries.md) · [Protocol research](research/stream-protocol.md) · [Settled direction](reports/design-direction.md).
- Relevant bounded evidence: `reports/viewer-boundaries.md:35–74; reports/design-direction.md:43–54`. Research recommendations superseded by architecture contract where explicitly stated.

## Overview
- Priority: P2. Status: DONE (2026-11-09). Effort: not-estimated.
- Deliverable: Build owner-fenced canvas decoder and Android-web input. Marked DONE per user approval with noted issues after Cycle 3 (2026-11-09; score 4/10; 70 validation checks passing across unit [60/60 across browser-host-client, frame-protocol, stream-controller, input-controller], Chromium browser tests [8/8 across host-browser-decoder and host-browser-input], UI build, and E2E typecheck). Ready to proceed to Phase 07; Phase 07 unblocked. Technical carryovers C1, C3, and W1–W8 tracked into Phases 07, 08, and 09.

## Key insights
WebSocket has no receive backpressure; bounded server credits require explicit discarded dispositions and client decode limits. React per-frame state would create needless work.

## Requirements
Owner-scoped REST/tickets/sockets, strict binary parser,1 active decode+1 replaceable pending frame, synchronous privacy clearing and real browser text focus/IME including Android web.

## Architecture
Standalone client modules under browser-host are disjoint from phase05 Rust writers. Controller lifetime is root-owned later; here expose explicit attach/place/pause/dispose APIs with capture fences, never destroy target on component unmount.
- Follow exact API/envelope/limits/auth/reset ordering in architecture-contracts.md; no second protocol or undocumented task engine.

## Related code files / actions
Every path below is absolute; new/dependency-created files are explicitly classified. Task contracts carry the equivalent normalized repository-relative writable paths. No deletion of entire independent modules is authorized; obsolete Browser iframe symbols are removed only at the phase07 cutover.

### File map — bind-viewer-transport
| Action | Full path | Purpose |
|---|---|---|
| Create new (planned) | `/home/loidinh/WS/dam-hopper/packages/ui/src/api/browser-host-client.ts` | Implement typed Browser client identity tickets and parser; exact responsibilities in numbered steps below. |
| Create new (planned) | `/home/loidinh/WS/dam-hopper/packages/ui/src/api/browser-host-types.ts` | Implement typed Browser client identity tickets and parser; exact responsibilities in numbered steps below. |
| Create new (planned) | `/home/loidinh/WS/dam-hopper/packages/ui/src/api/browser-host-client.test.ts` | Implement typed Browser client identity tickets and parser; exact responsibilities in numbered steps below. |
| Create new (planned) | `/home/loidinh/WS/dam-hopper/packages/ui/src/browser-host/frame-protocol.ts` | Implement typed Browser client identity tickets and parser; exact responsibilities in numbered steps below. |
| Create new (planned) | `/home/loidinh/WS/dam-hopper/packages/ui/src/browser-host/frame-protocol.test.ts` | Implement typed Browser client identity tickets and parser; exact responsibilities in numbered steps below. |

### File map — render-bounded-canvas
| Action | Full path | Purpose |
|---|---|---|
| Create new (planned) | `/home/loidinh/WS/dam-hopper/packages/ui/src/browser-host/stream-controller.ts` | Implement persistent canvas controller and exact frame dispositions; exact responsibilities in numbered steps below. |
| Create new (planned) | `/home/loidinh/WS/dam-hopper/packages/ui/src/browser-host/canvas-view.tsx` | Implement persistent canvas controller and exact frame dispositions; exact responsibilities in numbered steps below. |
| Create new (planned) | `/home/loidinh/WS/dam-hopper/packages/ui/src/browser-host/stream-controller.test.ts` | Implement persistent canvas controller and exact frame dispositions; exact responsibilities in numbered steps below. |
| Create new (planned) | `/home/loidinh/WS/dam-hopper/packages/ui/browser-tests/host-browser-decoder.browser.tsx` | Implement persistent canvas controller and exact frame dispositions; exact responsibilities in numbered steps below. |

### File map — implement-web-input
| Action | Full path | Purpose |
|---|---|---|
| Create new (planned) | `/home/loidinh/WS/dam-hopper/packages/ui/src/browser-host/input-controller.ts` | Implement precise pointer keyboard IME copy and find controls; exact responsibilities in numbered steps below. |
| Create new (planned) | `/home/loidinh/WS/dam-hopper/packages/ui/src/browser-host/text-input-proxy.tsx` | Implement precise pointer keyboard IME copy and find controls; exact responsibilities in numbered steps below. |
| Create new (planned) | `/home/loidinh/WS/dam-hopper/packages/ui/src/browser-host/input-controller.test.ts` | Implement precise pointer keyboard IME copy and find controls; exact responsibilities in numbered steps below. |
| Create new (planned) | `/home/loidinh/WS/dam-hopper/packages/ui/browser-tests/host-browser-input.browser.tsx` | Implement precise pointer keyboard IME copy and find controls; exact responsibilities in numbered steps below. |

## Numbered implementation steps

### bind-viewer-transport
- Dependencies: dispatch-leased-input.
- Bounded outcome: Implement typed Browser client identity tickets and parser.
1. Reuse server-config/connections ownership capture and secure bearer helpers; every asynchronous REST/attachment completion rechecks profileId+generation+session/incarnation/profileEpoch. Expose capabilities/session/lease/selection/reset DTOs without extending generic transport.
2. Mint exact matching media/control pair tickets in memory. Capture immutable originating socket+subscription in callbacks; resume/rebind/reconnect creates fresh media socket+one-use ticket/new subscription and matching new control pair, never updates epoch on an old socket. Fixed protocol+ticket only, never secrets in URL/storage. Re-list exact session; ambiguous create reuses key.
3. Parse target-scoped BHJF prefix/header/JPEG only (no subscription/viewer fields), checked lengths/version/UUID/decimal/dimensions/process/producer/viewport identity before decode. Associate parsed frame locally with callback-captured originating media socket/subscription; reject stale context without reassigning ambient epoch. New protocol mismatch gives actionable unavailable/reload state; never iframe fallback.
- Consumer-visible acceptance:
  - Target-scoped shared BHJF parser rejects malformed/oversized/foreign identity before decode; callback captures immutable originating socket subscription outside header, fresh media/control pair required on resume/rebind; secrets never persisted.
  - Reconnect targets exact current server session even when another window has identical URL.
- Future verification (from repository root; new targets above are planned):
  - `pnpm --filter @dam-hopper/ui test -- src/api/browser-host-client.test.ts src/browser-host/frame-protocol.test.ts`
  - `pnpm --filter @dam-hopper/ui build`
  - Smoke: switch server profile during pending ticket and receive old generation frame; neither connection nor frame reaches current canvas.

### render-bounded-canvas
- Dependencies: bind-viewer-transport.
- Bounded outcome: Implement persistent canvas controller and exact frame dispositions.
1. Controller owns canvas DOM and decoder, not BrowserApp render. Keep one decode active and one latest pending ArrayBuffer; replacing pending sends frameDiscarded for replaced actual outstanding key. Close every ImageBitmap including late error/privacy/unmount paths.
2. Recheck owner/captured originating socket+subscription/privacy/viewport after decode and before draw. ACK/discard always includes captured originating subscription and uses captured media socket if still open; if closed send nothing, server socket cleanup owns credits. Never relabel late decode with ambient new subscription. Draw then ACK exact key; record rAF/application-present, no React per-frame state.
3. On privacy activation synchronously clear/black canvas, cancel demand/input and invalidate decode token so late completion cannot repaint. Injected hidden/privacy signal closes/detaches old subscription sockets while preserving logical target; resume/rebind always fresh media socket+ticket+subscription+matching control and valid cache. Full Cognito/PIN/minimize/OS wiring is phase07, not established by this harness.
4. Bound socket bufferedAmount/control queue, heartbeat5s, release/dispose callbacks. Decode worker is optional only if measurement justifies it; no additional transport framework.
- Consumer-visible acceptance:
  - Decode concurrency never exceeds1, compressed pending never exceeds1, every accepted frame eventually ACKs/discards or subscription closes.
  - Real isolated browser component harness injects privacy/visibility signal: immediate black canvas, late old-socket decode cannot repaint or ACK replacement subscription; retained canvas survives attachment changes, full OS privacy proof phase07/09.
- Future verification (from repository root; new targets above are planned):
  - `pnpm --filter @dam-hopper/ui test -- src/browser-host/stream-controller.test.ts`
  - `pnpm --filter @dam-hopper/ui test:browser -- browser-tests/host-browser-decoder.browser.tsx`
  - Smoke: real mounted decoder browser harness injects delayed decode/privacy, then rebinds fresh socket; assert black canvas/no bitmap leak and ACK/discard only captured originating subscription, never replacement; phase07/09 owns actual Cognito/PIN wiring.

### implement-web-input
- Dependencies: render-bounded-canvas.
- Bounded outcome: Implement precise pointer keyboard IME copy and find controls.
1. Use letterbox fractions and authoritative cached geometry, reject outside image or uncertain epochs, and send strict lease-bound sequence on control socket. Preserve barriers/releases/modifiers and coalesce only eligible pointer/wheel neighbors.
2. Provide focusable textarea/input proxy with compositionstart/update/end,beforeinput,input and paste-text rules; commit text once, never key+insertText duplicates. Explicit soft-keyboard focus; Android web tap/drag/scroll/cancel and clipboard text-only. Do not revive terminal keyboard policy.
3. Clear input on owner/lease change, blur, modal, privacy, hidden, disconnect or queue saturation using original target identity. View-only users letterbox and show controller/unsupported geometry reason.
4. Implement explicit bounded selected-text copy and find controls (query<=256chars, result count bounded); pixels do not imply DOM accessibility/native copy. Verify required zoom/DPR mapping from phase01 rather than introducing guessed scaling.
5. Own real isolated component/input harness in host-browser-input.browser.tsx: mount actual canvas/controller/text proxy, browser DOM focus/pointer/composition APIs, record transport command boundaries without fake successful backend responses. Use prerequisite phase03 real native-CDP input tests for dispatch correctness; this is component proof, never full SPA/physical Android success. Later phase09 full-SPA zoom/IME failures reopen implement-web-input/render-bounded-canvas as appropriate and impacted dependents.
- Consumer-visible acceptance:
  - Real isolated browser harness mounts actual input controller/text proxy and exercises pointer/modifier/composition/paste/cancel on qualified mapping with exact emitted commands and no duplicate commits; phase03 real CDP dispatch proof prerequisite, physical Android full-SPA/human mandatory only phase09.
  - Controller loss/cancel leaves no stuck key or touch, and copy/find operate through explicit bounded commands.
- Future verification (from repository root; new targets above are planned):
  - `pnpm --filter @dam-hopper/ui test -- src/browser-host/input-controller.test.ts`
  - `pnpm --filter @dam-hopper/ui test:browser -- browser-tests/host-browser-input.browser.tsx`
  - Smoke: real isolated browser-mounted input/text proxy harness exercises Vietnamese/Japanese composition events, paste, drag, scroll, cancel and text focus with observed command boundaries; combine phase03 actual native dispatch evidence, no future SPA/human/physical-device prerequisite. Phase09 must prove actual physical Android SPA.

## Durable task contracts / todo
Exactly one fence; task IDs/markers stable across revisions. No tasks.json or hydration in this planning assignment.

```evcrate-tasks
[
  {
    "id": "bind-viewer-transport",
    "title": "Implement typed Browser client identity tickets and parser",
    "blocked_by": [
      "dispatch-leased-input"
    ],
    "allowed_files": [
      "packages/ui/src/api/browser-host-client.ts",
      "packages/ui/src/api/browser-host-types.ts",
      "packages/ui/src/api/browser-host-client.test.ts",
      "packages/ui/src/browser-host/frame-protocol.ts",
      "packages/ui/src/browser-host/frame-protocol.test.ts"
    ],
    "constraints": [
      "Follow architecture-contracts.md; preserve unrelated workflows; escalate any required write outside this literal file set."
    ],
    "acceptance": [
      "Target-scoped shared BHJF parser rejects malformed/oversized/foreign identity before decode; callback captures immutable originating socket subscription outside header, fresh media/control pair required on resume/rebind; secrets never persisted.",
      "Reconnect targets exact current server session even when another window has identical URL."
    ],
    "verification": [
      "pnpm --filter @dam-hopper/ui test -- src/api/browser-host-client.test.ts src/browser-host/frame-protocol.test.ts",
      "pnpm --filter @dam-hopper/ui build",
      "Smoke: switch server profile during pending ticket and receive old generation frame; neither connection nor frame reaches current canvas."
    ]
  },
  {
    "id": "render-bounded-canvas",
    "title": "Implement persistent canvas controller and exact frame dispositions",
    "blocked_by": [
      "bind-viewer-transport"
    ],
    "allowed_files": [
      "packages/ui/src/browser-host/stream-controller.ts",
      "packages/ui/src/browser-host/canvas-view.tsx",
      "packages/ui/src/browser-host/stream-controller.test.ts",
      "packages/ui/browser-tests/host-browser-decoder.browser.tsx"
    ],
    "constraints": [
      "Follow architecture-contracts.md; preserve unrelated workflows; escalate any required write outside this literal file set."
    ],
    "acceptance": [
      "Decode concurrency never exceeds1, compressed pending never exceeds1, every accepted frame eventually ACKs/discards or subscription closes.",
      "Real isolated browser component harness injects privacy/visibility signal: immediate black canvas, late old-socket decode cannot repaint or ACK replacement subscription; retained canvas survives attachment changes, full OS privacy proof phase07/09."
    ],
    "verification": [
      "pnpm --filter @dam-hopper/ui test -- src/browser-host/stream-controller.test.ts",
      "pnpm --filter @dam-hopper/ui test:browser -- browser-tests/host-browser-decoder.browser.tsx",
      "Smoke: real mounted decoder browser harness injects delayed decode/privacy, then rebinds fresh socket; assert black canvas/no bitmap leak and ACK/discard only captured originating subscription, never replacement; phase07/09 owns actual Cognito/PIN wiring."
    ]
  },
  {
    "id": "implement-web-input",
    "title": "Implement precise pointer keyboard IME copy and find controls",
    "blocked_by": [
      "render-bounded-canvas"
    ],
    "allowed_files": [
      "packages/ui/src/browser-host/input-controller.ts",
      "packages/ui/src/browser-host/text-input-proxy.tsx",
      "packages/ui/src/browser-host/input-controller.test.ts",
      "packages/ui/browser-tests/host-browser-input.browser.tsx"
    ],
    "constraints": [
      "Follow architecture-contracts.md; preserve unrelated workflows; escalate any required write outside this literal file set."
    ],
    "acceptance": [
      "Real isolated browser harness mounts actual input controller/text proxy and exercises pointer/modifier/composition/paste/cancel on qualified mapping with exact emitted commands and no duplicate commits; phase03 real CDP dispatch proof prerequisite, physical Android full-SPA/human mandatory only phase09.",
      "Controller loss/cancel leaves no stuck key or touch, and copy/find operate through explicit bounded commands."
    ],
    "verification": [
      "pnpm --filter @dam-hopper/ui test -- src/browser-host/input-controller.test.ts",
      "pnpm --filter @dam-hopper/ui test:browser -- browser-tests/host-browser-input.browser.tsx",
      "Smoke: real isolated browser-mounted input/text proxy harness exercises Vietnamese/Japanese composition events, paste, drag, scroll, cancel and text focus with observed command boundaries; combine phase03 actual native dispatch evidence, no future SPA/human/physical-device prerequisite. Phase09 must prove actual physical Android SPA."
    ]
  }
]
```

- [x] <!-- evcrate-task:bind-viewer-transport --> Implement typed Browser client identity tickets and parser
- [x] <!-- evcrate-task:render-bounded-canvas --> Implement persistent canvas controller and exact frame dispositions
- [x] <!-- evcrate-task:implement-web-input --> Implement precise pointer keyboard IME copy and find controls

## Success criteria
- Every task acceptance above is observed with applicable compile/typecheck, behavioral tests and real smoke evidence; missing or failed proof keeps task incomplete.
- Acceptance matrix rows owned by this phase have precise observations, not source-text assertions or mocked-only feature success.
- Writable scope and prerequisite outputs match execution-ownership.md; no competing shared-file writers or product verification storms.

## Risk assessment / failure and rollback
Android virtual keyboard behavior requires a physical-device/human gate later; desktop emulation is supplementary. Input disables explicitly while geometry is untrusted.
- On a defect, stop dependent work, reopen the producing task and rerun impacted behavioral checks under the single integration owner; do not narrow acceptance. Disable Browser capability if safe operation cannot be established, never restore iframe fallback.

## Security considerations
No target HTML/form/password value capture; clipboard paste text only; canvas late completions fenced by owner and privacy.
- Do not store/log bearer/tickets/raw loopback endpoints, real site credentials or sensitive page/selection payload in diagnostics/evidence.

## Next steps
Phase 06 is DONE (2026-11-09). Phase 07 is unblocked. Phase 07 (Integrate root Browser lifecycle and retire iframe path) joins completed producer and viewer streams.
- User approved Phase 06 after Cycle 3 (score 4/10; 70 validation checks passing). Technical carryovers for subsequent phases:
  - **Phase 07 (Integrate root Browser lifecycle and retire iframe path):** C1 owner/target/session identity lifecycle and cache blackening on window/profile change; C3 input release ordering and queue flushing before teardown; W1 input trust gating; W2 counter precision/DTO alignment; W3 IME/text commit deduplication; W4 decode/draw error discard handling; W5 REST capability/reset schema normalization; W7 strict protocol error teardown; W8 half-pair lifecycle teardown.
  - **Phase 08 (Secure selection artifacts and confirmed logout reset):** W5 completed reset DTO verification; W6 selection artifacts / copy / find integration; confirmed logout reset flow.
  - **Phase 09 (Qualify full app security platforms and efficiency):** Full multi-target soak testing; real physical Android SPA verification (IME virtual keyboard, touch gestures, letterbox mapping); complete end-to-end OS privacy proof; global memory ceiling validation across backend and client.
- Parent owns independent plan review/optional validation and implementation permission. This phase text neither executes tasks nor supplies approval.
## Unresolved questions
- No additional product interview here. Exact compatibility/platform/performance and human observations remain future gates where applicable; their absence is not a pass.
