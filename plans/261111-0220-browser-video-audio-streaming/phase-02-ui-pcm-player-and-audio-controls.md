# Phase 02 — UI PCM Player and Audio Controls

## Overview and context
- Priority P2; status completed (2026-11-11); effort 8h; owner UI implementer (`main-agent`); prerequisite `backend-browser-video-audio-streaming` completed.
- Task: `ui-browser-pcm-player-and-controls`. Integrate the completed audio wire contract, one small player per root-owned viewer and BrowserApp toolbar control; preserve video/input/OS lifetime.
- [Overview](./plan.md), [backend contract](./phase-01-backend-video-audio-streaming.md), [planner evidence](./reports/planner-report.md), [code standards](../../docs/code-standards.md).
- Donor `/home/loidinh/WS/aicoworker/src/audio/pcm-player.ts`: 24 kHz PCM16 conversion, `nextStartTime`, pending-resume epoch and source cleanup. Do not port its WebRTC/AEC loopback, mic logic, ducking, debug taps or delayed fade-out.

## Key insights and requirements
- `BrowserStreamController.media.onmessage` currently ignores all text; add audio dispatch before the existing `ArrayBuffer` branch. Keep binary decoder and exact disposition/credit logic untouched.
- Root `ParkedBrowserStreamItem` owns persistent controllers across reparenting. `BrowserApp` only registers a visible slot and toolbar state; mounting an independent player in its transient visual subtree would break the existing keep-alive architecture.
- `isSuppressed` already combines Cognito, LockScreen and profile reset; `isEffectiveVisible` additionally requires a live visible slot. Reuse these guards, not new privacy stores or weaker window-only tests.
- All chunks and post-await work require current owner generation, browser session/incarnation/profile epoch, captured media socket/subscription and local playback epoch. A user mute is local playback policy, not a remote control mutation or principal-wide setting.

## Architecture

### Typed media boundary
Add `BrowserAudioChunk` (or a comparably explicit audio DTO name) in `api/browser-host-types.ts`, separate from `ServerControlEvent`. Match all phase 01 fields exactly: `kind`, `browserSessionId`, `browserIncarnation`, `profileEpoch`, `producerRun`, `subscriptionEpoch`, `audioSeq`, `sampleRate`, `channels`, `encoding`, `data`. Reuse existing canonical UUID/decimal sequence helpers where available; never convert `u64` sequence/epochs to unsafe JS numbers.

Extend `StreamControllerOptions` with `onAudioChunk(chunk, credentials)` and `onAudioReset()`; callbacks do not own a socket or alter video credits. Parse media strings once as `unknown`: require `audioChunk`, <=8 KiB, rate 24000, mono, PCM16LE, <=6,400 base64 chars, positive even decoded size <=4,800 bytes, canonical positive sequence and exact captured attachment identity/subscription. Ignore invalid/unknown text without touching video pending state, ACKs or status. Validate base64 before allocating large buffers; player also safely rejects malformed direct calls.

Use captured socket/credentials just as existing control-event callbacks do. Reject any retired media callback even if a successor shares session ID. Audio must be visible and non-private; muted data is discarded, never accumulated. Establish current producer run from validated BHJF frame authority on that attachment before playing its audio; flush on run change and reject audio for retired runs. Track monotonically increasing `audioSeq` per current run; drop duplicates/out-of-order and flush buffered sound on gaps to favor fresh low latency. Navigation identity changes and sessionUpdated closed/lost status retire playback even before later reconnection effects run.

Call `onAudioReset` synchronously on attach replacement, media/control disconnect that retires attachment authority, privacy activation, visibility false, socket detachment and dispose. Do not reset video unnecessarily for local user mute. Resetting audio must not wait for a socket close, next message, effect timer or remote ACK.

### Small gapless PcmPlayer
Create `packages/ui/src/browser-host/pcm-player.ts`, strictly <200 lines, no dependency or global singleton. Minimal API: `prime(): void`, `enqueue(base64Pcm16: string): void`, `flush(): void`, `dispose(): void`. Fixed format 24 kHz mono; use one lazy `AudioContext`, one master `GainNode`, one running `nextStartTime`, a set of scheduled sources and an internal monotonic playback epoch.

- Decode PCM16 explicitly little-endian with `DataView`; convert signed samples to Float32 (`sample / 32768`). Create an `AudioBuffer` with sample rate 24000 even when output context hardware rate differs.
- Schedule `startAt = Math.max(nextStartTime, context.currentTime + 0.02)` and advance by exact buffer duration; timely neighboring chunks are back-to-back, not each at `currentTime`. Track every source; onended disconnects/releases it.
- Bound total pending plus scheduled duration to 500 ms. If overflow or a discontinuity would retain stale sound, synchronously flush and admit the newest valid chunk only. No unbounded base64/Float32 queue while context is suspended.
- `prime()` creates/resumes from an actual BrowserApp gesture without awaiting through React/API work first. Share one in-flight resume promise; capture epoch/context and check both before draining pending data. Resume rejection remains non-playing/actionable, never falsely reports playback success or retries in a tight loop.
- `flush()` increments epoch, clears suspended pending chunks, sets master gain to zero synchronously, stops/disconnects all scheduled sources and resets nextStartTime. No donor's 12 ms fade or delayed audible tail: privacy/mute requires immediate silence. Later resume/onended callbacks cannot reschedule old data or restore suppressed gain.
- Fresh enqueue may restore gain only for a current unsuppressed playback epoch. `dispose()` first flushes and then closes its own context idempotently; a disposed player never recreates one.
- Output-browser autoplay restrictions still exist despite the host Chromium launch flag. If browser playback remains suspended, expose an accurate BrowserApp audio-unlock cue/button state, and use the Mute/Unmute user gesture to prime. Do not retain old sound while waiting for a gesture or introduce hidden autoplay loops.

### Root keep-alive ownership and toolbar bridge
`ParkedBrowserStreamItem` owns a single `PcmPlayer` ref for that root viewer. Connect controller's `onAudioChunk` to player enqueue only after checking live window/owner/attachment and fresh suppression state; connect `onAudioReset` to flush. Reparenting tile/float/maximize retains runtime identity; hiding/minimizing/desktop switch clears queued sound but never destroys the remote browser session.

Extend the existing per-window slot registry with viewer-local `audioMuted`, default false for a new BrowserApp viewer. `BrowserApp` owns `useState(false)` for user preference, passes it in registration/update, and renders toolbar toggle. Keep mute ephemeral, out of persisted OS appState/profile configuration; reset with viewer lifetime, not every reparent. Other windows viewing the same session keep independent mute state.

Reuse the existing proxy-focus listener pattern for a narrow synchronous user-gesture audio-unlock request in `BrowserStreamKeepAliveHost.tsx`. Scope by window ID plus captured owner/session, no ambient lookup fallback. The toolbar click updates the slot's mute state and invokes root playback suppression synchronously before React rerender; on unmute it primes only if all current gates permit playback. Slot listeners must apply the immediate audio gate from the updated registry before scheduling React state updates. Do not introduce another store or rely solely on a passive `useEffect` to flush.

Define one root playback predicate: current owner + current window/session/incarnation/profile epoch + running attachment + `isEffectiveVisible` + `!audioMuted` + no Cognito/LockScreen/reset fence. Re-evaluate in the chunk callback, gesture bridge, synchronous registry/store listeners and before asynchronous resume publication; layout effects also synchronize existing controller suppression/visibility. Fence listeners and relevant store subscriptions must flush already scheduled audio immediately when their source changes; merely blocking future chunks is insufficient. Unsubscribe only the creating owner/viewer during cleanup.

`BrowserApp.tsx` button:
- `data-testid="browser-audio-toggle-btn"`; visible in the existing Browser toolbar, independent of input-control lease.
- Accessible action label `Mute audio` when enabled, `Unmute audio` when muted; `aria-pressed={audioMuted}` with a stable meaning and corresponding volume icon/title.
- Disable or guard unavailable/no-session actions without preventing recovery once a live attachment exists. Privacy/hidden gates never unmute just because user preference is false.
- Click does not navigate, acquire a remote lease, send browser input, alter peer viewers or reconnect working video. Preserve keyboard/focus containment and existing toolbar behavior.

### Lifecycle matrix
| Transition | Required synchronous action | Restore behavior |
| --- | --- | --- |
| User mute | Close local gate; flush sources/pending/resume epoch | Unmute gesture primes; new chunks only |
| Cognito / LockScreen / reset fence | Close gate; flush; existing privacy socket retirement | Existing qualified fresh-attachment path; never replay |
| Minimize/hide/inactive desktop/missing slot | Close gate; flush; `setVisibility(false)` detaches socket pair | Visible slot obtains fresh credentials; retain mute preference |
| Owner generation/session/incarnation/profile epoch changes | Retire playback authority and flush before attach publication | New exact attachment only |
| Navigation or producer-run change | Flush old PCM/order state | Accept current document/run fresh sequence only |
| Media/control attachment close, auth error, dispose/window close | Flush; retire callbacks; dispose player when viewer closes | No automatic resurrection from old callbacks |
| Tile/float/maximize visible reparent | Keep controller/player identity; no duplicate graph | Continue only if effective gate stays true |

## Related code files
| Action | Absolute file | Changes |
| --- | --- | --- |
| Modify | `/home/loidinh/WS/dam-hopper/packages/ui/src/api/browser-host-types.ts` | Separate audio wire DTO |
| Create | `/home/loidinh/WS/dam-hopper/packages/ui/src/browser-host/pcm-player.ts` | Dependency-free <200-line player |
| Create | `/home/loidinh/WS/dam-hopper/packages/ui/src/browser-host/pcm-player.test.ts` | Sample conversion, scheduling, flush/resume and bounds tests |
| Modify | `/home/loidinh/WS/dam-hopper/packages/ui/src/browser-host/stream-controller.ts` | Validated text dispatch, audio callbacks and retirement |
| Modify | `/home/loidinh/WS/dam-hopper/packages/ui/src/browser-host/stream-controller.test.ts` | Mixed wire, stale authority, reset and unchanged video credits |
| Modify | `/home/loidinh/WS/dam-hopper/packages/ui/src/os/BrowserStreamKeepAliveHost.tsx` | Root player ownership, gate/gesture integration, cleanup |
| Modify | `/home/loidinh/WS/dam-hopper/packages/ui/src/os/BrowserStreamKeepAliveHost.test.tsx` | Suppression, identity, race and keep-alive regressions |
| Modify | `/home/loidinh/WS/dam-hopper/packages/ui/src/os/apps/BrowserApp.tsx` | Ephemeral mute state and accessible toolbar button |
| Modify | `/home/loidinh/WS/dam-hopper/packages/ui/src/os/apps/BrowserApp.test.tsx` | Toggle, local ownership, unlock and toolbar regression tests |

No file deletions, new package/config/dependencies or changes to frame protocol/input-controller/store internals. Escalate essential out-of-allowlist writes before editing.

## Implementation steps — ui-browser-pcm-player-and-controls
1. Consume backend's final DTO/bounds without independently renaming fields; add typed media event and controller boundary tests before wiring playback.
2. Implement only donor's gapless scheduling/resume/flush essentials in the new small player; cover little-endian signed samples, timing, queue bounds and no delayed privacy tail.
3. Route validated current-run text chunks and synchronous reset callbacks through the controller. Preserve binary paths, heartbeat, exact native frame dispositions and socket authority checks.
4. Integrate root-owned player and narrow slot/gesture bridge. Apply mute/suppression gates both synchronously on policy changes and at every callback; own cleanup and context lifetime in the parked item.
5. Add BrowserApp toolbar toggle with false default, ephemeral per-viewer preference, required test ID, accessible state and real gesture priming. Muting must not require browser control or remount/reconnect video.
6. Add permanent races and lifecycle tests in listed files. Return to coordinator for one coherent integration verification, independent review and maintained-doc finalization; do not claim live audio from AudioContext mocks alone.

## Durable task contract
```evcrate-tasks
[
  {
    "id": "ui-browser-pcm-player-and-controls",
    "title": "Integrate privacy-fenced gapless PCM playback and BrowserApp mute controls",
    "blocked_by": ["backend-browser-video-audio-streaming"],
    "allowed_files": ["packages/ui/src/api/browser-host-types.ts", "packages/ui/src/browser-host/pcm-player.ts", "packages/ui/src/browser-host/pcm-player.test.ts", "packages/ui/src/browser-host/stream-controller.ts", "packages/ui/src/browser-host/stream-controller.test.ts", "packages/ui/src/os/BrowserStreamKeepAliveHost.tsx", "packages/ui/src/os/BrowserStreamKeepAliveHost.test.tsx", "packages/ui/src/os/apps/BrowserApp.tsx", "packages/ui/src/os/apps/BrowserApp.test.tsx"],
    "constraints": [
      "Consume phase 01's exact authenticated media text contract; preserve BHJF/video credits and captured owner/socket/subscription authority.",
      "New pcm-player.ts must stay under 200 lines; no WebRTC/AEC, mic capture, dependency, persistence or new global store.",
      "Immediately silence and flush scheduled/pending audio on user mute, Cognito, LockScreen, profile reset fence, !isEffectiveVisible, authority retirement and disposal; late async completions cannot resume old sound.",
      "Keep runtime player/controller root-owned across OS reparenting; BrowserApp owns only viewer-local mute intent and toolbar/gesture interaction.",
      "Only listed files are writable; coordinator owns integrated verification, review, maintained docs and finalization."
    ],
    "acceptance": [
      "Valid current-subscription 24 kHz mono PCM16 audioChunk text messages play gaplessly in BrowserApp while binary video behavior remains unchanged; invalid or stale audio is ignored safely.",
      "The toolbar exposes data-testid browser-audio-toggle-btn, accessible Mute/Unmute action and pressed state, per-viewer ephemeral mute, no control-lease requirement and gesture-based autoplay recovery.",
      "All suppression and retirement paths synchronously zero gain, stop sources, clear pending PCM and fence deferred resume; restoring visibility or unmuting cannot replay suppressed audio.",
      "The dependency-free player is under 200 lines, bounded to 500 ms pending/scheduled audio, uses exact sample duration scheduling and releases sources/context on teardown.",
      "Tests cover mixed media parsing, PCM scheduling, malformed/bounded input, late promise/socket callbacks, all privacy gates, independent viewers and keep-alive reparenting."
    ],
    "verification": [
      "Coordinator runs pnpm --filter @dam-hopper/ui exec vitest run src/browser-host/pcm-player.test.ts src/browser-host/stream-controller.test.ts src/os/BrowserStreamKeepAliveHost.test.tsx src/os/apps/BrowserApp.test.tsx, then pnpm --filter @dam-hopper/ui build; record exact results.",
      "Confirm pcm-player.ts has fewer than 200 physical lines; test scheduled start times and synchronous source-stop/gain-zero behavior with controlled AudioContext boundary doubles, including unresolved resume promises.",
      "With real host Chromium and output browser, exercise ordinary video/audio and WebAudio playback, adjacent chunks, mute/unmute, Cognito, LockScreen, reset, hide/minimize/desktop switch, navigation, reconnect, owner change and two viewers; record audible behavior, bounded latency and actual autoplay restrictions separately from unit results."
    ]
  }
]
```

- [x] <!-- evcrate-task:ui-browser-pcm-player-and-controls --> Integrate privacy-fenced gapless PCM playback and BrowserApp mute controls

> Completion note (2026-11-11): Cycle 13 QA PASS (`reports/qa-report.md`: 89/89 UI Vitest tests across 4 files — `pcm-player.test.ts` [5], `stream-controller.test.ts` [31], `BrowserStreamKeepAliveHost.test.tsx` [39], `BrowserApp.test.tsx` [14]; clean `pnpm --filter @dam-hopper/ui build` [`tsc -p tsconfig.json`]; `packages/ui/src/browser-host/pcm-player.ts` verified at 199 physical lines, `< 200` LOC). Cycle 13 Code Review (`reports/code-review-report.md`): 9/10 APPROVED WITH NOTES (0 critical/high/medium). Manual interactive output-browser audible/gapless playback, privacy-gate silence, two-viewer independence, and live FPS/audio-latency qualification remain an interactive user runtime check.

## Success criteria and verification design
- Player unit tests: 0, minimum/maximum signed PCM16LE samples; exact adjacent start times; hardware/context-rate distinction; late chunks; invalid base64/odd bytes; 500 ms cap; rejection/suspension; flush-before-resume-resolves; stale onended; repeated flush/dispose; no recreation after disposal.
- Controller tests: current mixed binary/text handling; audio-first-before-valid-video run guard; wrong session/incarnation/profile/subscription/run; duplicate/old audioSeq; unknown/oversized/malformed JSON; old socket after attach replacement; all reset callbacks; video ACK/discard keys and outstanding behavior unchanged.
- Root/BrowserApp tests: queue multiple sources before each suppression, then assert every source stopped/gain zero immediately; new chunks and delayed resumes stay blocked. Restore accepts only fresh data. Cover every matrix row, cross-profile fences, click without control lease, viewer-local mute and listener cleanup/reparent identity.
- Real smoke: allowed ordinary media element with audio, audio-only element, WebAudio tone, simultaneous sources and embedded media. Observe nonzero PCM at 24 kHz mono, actual sound, contiguous playout under timely input, no duplicate output, silence at every guard, no old-audio burst after restoring. Use test media only; never record user credentials/raw tab audio.
- Measure delivered/presented FPS and audio latency/queue duration on the same fixture/configuration before/after; report actual engine/platform/network conditions. No invented performance threshold, unsupported platform pass or source-only audio claim.

## Risks, security and rollback
- Output-browser autoplay can require a gesture; host launch policy does not unlock the user's browser. Preserve explicit non-playing state/recovery, bounded suspended queues and epoch checks.
- Main-thread stalls/network loss can underflow PCM; bounded flush favors low latency rather than delayed replay. This is gapless scheduling for contiguous timely chunks, not guaranteed sample-perfect A/V synchronization or a new jitter-buffer framework.
- Root lifetime can outlive visual BrowserApp; source subscriptions and imperative mute/gesture handlers must be owner-bound and removed on actual viewer disposal. Do not persist PCM, mute state or credentials.
- Revert backend/UI as a coordinated cutover after draining subscriptions; preserve unrelated changes, root browser identity and remote sessions/profiles.

## Next steps
UI implementation, Cycle 13 QA gates (89 UI tests + `tsc` build + 199 LOC check), and Cycle 13 Code Review (9/10 APPROVED WITH NOTES) are complete; see [PM report](./reports/project-manager-report.md).

## Unresolved questions
None requiring a product or code choice. Manual interactive output-browser audible, privacy-silence, two-viewer, and live FPS/audio-latency qualification remains an interactive user runtime check.
