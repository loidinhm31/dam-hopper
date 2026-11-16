# C3Client Cycle-3 Fixes
- C3-W2: Replaced scalar captureVersion with bounded (<=16) per-run `appliedCaptureVersionsByRun` map in `BrowserStreamController`; placeholder events do not touch fences; same-run rollback rejected across runs.
- C3-W5: Re-armed `streamQualityActive` latch on `attach`; `onStreamQualityReset` fires once on failed-open close/error (transitions to disconnected) and control close; pending preference remembered across close and re-attach; no double fires.
- Tests: Added regressions in `stream-controller.test.ts` (effective A/v2 -> warming B/v3 -> effective A/v1 rejected & B/v2 accepted; close-before-open + control close + no double fire).
- Validation: `pnpm --filter @dam-hopper/ui test src/browser-host` (104/104 passed), `pnpm --filter @dam-hopper/ui exec tsc --noEmit` clean.
