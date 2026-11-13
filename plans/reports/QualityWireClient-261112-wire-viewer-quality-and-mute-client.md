# QualityWireClient Implementation Report

## Executed Task
- Task: Phase 04 `wire-viewer-quality-and-mute` (client wire)
- Plan: `plans/261112-1205-browser-adaptive-stream-quality-and-performance/phase-04-viewer-quality-controls.md`
- Status: completed

## Files Modified
- `packages/ui/src/api/browser-host-types.ts` (+200 lines): Added `QualityPreference`, `StreamQualityTier`, `AudioSuppressionReason`, `StreamQualityStatus`, `StreamQualityEvent`; added `qualityPreference` and `muteState` to `MediaClientControl` with strict field/length validation; renamed `BrowserAudioChunk.producerRun` to `audioRun`; added `parseMediaServerText` tagged parser with exact bounds.
- `packages/ui/src/browser-host/stream-controller.ts` (+201 lines): Decoupled audio authority from video `producerRun` to `audioRun`; implemented `setQualityPreference` and `setAudioMuted` with 4 updates/s coalescing (latest-wins, `muted=true` immediate + synchronous `onAudioReset`); added `onStreamQuality` callback with stale version/run/privacy rejection; re-sent remembered preference/mute on socket open.
- `packages/ui/src/browser-host/pcm-player.ts` (+17 lines): Added `AudioIdentityFence` and fence checking on `enqueue`; ensured flush/mute drops all queued samples without reviving playback.
- `packages/ui/src/browser-host/pcm-player.test.ts` (+35 lines): Added tests for subscription, audioRun, and docEpoch identity fencing and flush-on-mute guarantees.
- `packages/ui/src/browser-host/stream-controller.test.ts` (+357 lines): Updated audio tests to `audioRun` and decoupled video runs; added full test suite covering client control serialization/validation, `streamQuality` parsing and boundary rejection, duplicate dropping, rate-limited coalescing, immediate mute, and reconnect persistence.

## Key Decisions
- Exhaustive tagged parsing (`parseMediaServerText`) rejects unknown kind and prevents `streamQuality` from ever reaching `onAudioChunk`.
- Video `producerRun` change (capture restart) preserves audio continuity without flushing or resetting sequence. Real `audioRun` change resets sequence and flushes audio.
- On media socket open, `qualityPreference` (default "auto") and `muteState` (default true) are transmitted immediately before heartbeat and audio.
- `setAudioMuted(true)` executes immediately and synchronously flushes audio, cancelling pending un-mute timers.

## Verification
- `pnpm --filter @dam-hopper/ui test src/browser-host`: 6 test files, 99 tests passed, 0 failures.
- `pnpm --filter @dam-hopper/ui exec tsc --noEmit -p tsconfig.json`: clean, 0 type errors.

## Open Issues / Handoff
- `packages/ui/src/os/BrowserStreamKeepAliveHost.test.tsx` line 1237 references `producerRun` in a mock audioChunk; to be updated to `audioRun` by the owner of `os/` files in `expose-browser-quality-tools`.
