# QualityWireClient Review Cycle 1 Fixes Report

## Changes Made
- **W1 (Document Floor)**: `packages/ui/src/browser-host/stream-controller.ts`: Preserved subscription-wide document floor (`lastAudioDocEpoch`, `retiredAudioDocEpoch`) across audio source changes. `docEpochVal` is validated against the floor before adopting a new `audioRun`. Added regression test verifying run A/doc 1 -> `resetAudioAuthority("2")` -> run B/doc 1 rejected and run B/doc 2 accepted.
- **W5 (Preference Field)**: `packages/ui/src/api/browser-host-types.ts` & `stream-controller.ts`: Added 15th field `preference` to `StreamQualityEvent` and `STREAM_QUALITY_KEYS` in `parseMediaServerText` (now exactly 15 keys required). Duplicate-drop compares `preference`.
- **W6 (Validation Parity & Canonical Base64)**: `packages/ui/src/api/browser-host-types.ts`: Added canonical base64 padding check `btoa(atob(b64)) === b64` rejecting noncanonical padding (e.g. `AAAAAB==`). Added explicit check for required `audioReason` key. Added negative test fixtures for noncanonical padding, legacy `producerRun` on audioChunk, missing `audioReason`, extra key, and oversize (>8192 bytes).
- **Suggestion (PcmPlayer Simplification)**: `packages/ui/src/browser-host/pcm-player.ts` & `.test.ts`: Removed unused optional `AudioIdentityFence` from `pcm-player.ts`, retaining controller as sole authority while preserving and testing flush/mute queue-drop guarantee.

## Verification
- `pnpm --filter @dam-hopper/ui test src/browser-host`: 6 test files, 100 tests passed, 0 failures.
- `pnpm --filter @dam-hopper/ui exec tsc --noEmit -p tsconfig.json`: 0 errors in owned files (errors in `src/os/` files belong to UI agent).

## Unresolved Questions
None.
