# QualityWireClient Cycle 2 Fixes Report

- **C2-W4 (CaptureVersion Fence)**: `stream-controller.ts`: Restricted monotonic captureVersion fence to `effective` and `switching` events for the same `producerRun`. `warming` and `unavailable` placeholder events neither advance the fence nor are rejected by it; later proven effective events with lower versions than earlier warming placeholders are accepted. Regression tested: warming v3 -> effective v2 accepted; effective v3 -> effective v2 (same run) rejected.
- **C2-W5 (Disconnect / Reset Callback)**: `stream-controller.ts`: Added optional `onStreamQualityReset?: () => void` to `StreamControllerOptions`, notified once per transition when media socket closes, errors, or detaches (never for individual events dropped under privacy). Tested close/error/detach once-per-transition behavior.
- **Verification**: `pnpm --filter @dam-hopper/ui test src/browser-host` passed (6 files, 102 passed, 0 failed); 0 type errors in owned files.
