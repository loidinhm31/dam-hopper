# Phase 3: Verification, Regression Gates & Rollout Notes

## Context Links
- [AGENTS.md](file:///home/loidinh/WS/dam-hopper/AGENTS.md)
- [README.md](file:///home/loidinh/WS/dam-hopper/README.md)

## Overview
- **Priority:** P1 | **Status:** Completed | **Effort:** 1h
- Run full backend and UI build, lint, unit, and browser regression suites after Phases 1–2, then document optional operator build/restart verification for `dam-hopper-api.service`.

## Key Insights
- `server/tests/browser_host_process.rs` exercises `ChromeIdentity`, launch allowlists, and `ANTI_DETECTION_SCRIPT` markers.
- `packages/ui` provides both Vitest jsdom unit tests and Playwright browser component tests (`test:browser`).
- Systemd unit files (`/etc/systemd/system/*`) are out of code scope; production deploy picks up the fix only after rebuilding release binary + web bundle and restarting `dam-hopper-api.service` / `dam-hopper-web.service` (if served statically).

## Requirements
- Verify zero regressions in Rust server tests, UI TypeScript build, ESLint, Vitest unit suite, and UI browser component suite.
- Confirm no security fences (`downscale_input_qualified`, `network_policy`, Origin/CORS, TLS, sandbox flags) were weakened.
- Provide concise operator rollout checklist without modifying `/etc/systemd/system/*`.

## Related Code Files
- Read-only verification across `server/` and `packages/ui/` (`allowed_files: []`).

## Implementation Steps
1. **Run Rust test & lint checks:**
   - `cd server && cargo test`
   - `cd server && cargo clippy --all-targets`
2. **Run UI typecheck, lint & test suites:**
   - `pnpm --filter @dam-hopper/ui build`
   - `pnpm --filter @dam-hopper/ui test`
   - `pnpm --filter @dam-hopper/ui test:browser`
   - `pnpm lint`
3. **Optional operator rollout & live smoke (outside automated code scope):**
   - Rebuild web assets (`pnpm build`) and release server (`pnpm build:server`).
   - Deploy/restart `dam-hopper-api.service` (and `dam-hopper-web.service` if applicable) on host.
   - Open DamHopper Browser at `https://app-hop.qm-hub-v001.cloud`, verify a Turnstile-protected site resolves without spinning/resetting checkbox loop, and verify `navigator.userAgent` / `navigator.userAgentData.getHighEntropyValues(['fullVersionList'])` inside a dedicated `Worker` and cross-origin `iframe`.

## Todo List
```evcrate-tasks
[
  {
    "id": "verify-turnstile-prod-fixes",
    "title": "Run Rust and UI regression suites and verify zero security boundary regressions",
    "blocked_by": [
      "fix-oopif-frame-tree-admission-race",
      "implement-preclick-hover-and-dwell"
    ],
    "allowed_files": [],
    "constraints": [
      "Do not modify /etc/systemd/system/* or weaken downscale_input_qualified, network_policy, CORS/Origin, TLS, or Chromium sandbox flags.",
      "Do not waive failing tests or assertions."
    ],
    "acceptance": [
      "Rust server test suite and clippy pass cleanly.",
      "UI TypeScript build, ESLint, Vitest unit tests, and Vitest browser tests pass cleanly."
    ],
    "verification": [
      "cd server && cargo test",
      "cd server && cargo clippy --all-targets",
      "pnpm --filter @dam-hopper/ui build && pnpm --filter @dam-hopper/ui test && pnpm lint"
    ]
  }
]
```

- [x] <!-- evcrate-task:verify-turnstile-prod-fixes --> Run Rust and UI regression suites and verify zero security boundary regressions

## Success Criteria & Risks
- **Success:** All verification commands exit 0 with new regression coverage for worker UA overrides, OOPIF admission during parent frame-tree fetch, pre-click hover replay, click dwell timing, and dwell cancellation.
- **Risk & Mitigation:** Remote production verification requires operator deploy/restart of `dam-hopper-api.service`; keep rollout steps explicitly documented.

## Unresolved Questions
1. Confirm `Browser.getVersion.product` token format on any non-standard Chromium builds (handled via fallback to `userAgent` then `DEFAULT_CHROME_VERSION`).
2. Confirm whether any Turnstile flow on `https://app-hop.qm-hub-v001.cloud` spawns nested dedicated workers inside a `Worker` (currently outside `Target.setAutoAttach` scope; revisit only if live smoke reveals nested worker checks).
