# Phase 03 — Integrated Verification & Architecture Documentation

Priority: P2 · Status: Done (2026-11-16 09:04:55 EST) · Effort: 3h · Owner: Integration & Docs owner

## Context Links

- [Plan Overview](./plan.md)
- [Phase 01 — Backend DevTools Proxy & Native Host Downloads](./phase-01-backend-devtools-proxy.md)
- [Phase 02 — UI DevTools Dock & Download Banner](./phase-02-ui-devtools-dock.md)
- [Host Browser CDP Streaming Architecture](../../docs/architecture/host-browser-cdp-streaming.md)
- [Host Browser API Reference](../../docs/api/browser-host.md)
- [System Architecture](../../docs/system-architecture.md)

## Overview

Run end-to-end verification across the Rust backend and React UI package (including live host Chromium tests verifying both `devtools_app.html` over `/api/browser/devtools/{token}/ws` and native host file downloads into a temporary host Downloads directory), and update the maintained architecture and API documentation.

## Key Insights

1. **Real Host Chromium Verification:** With `/usr/bin/chromium` installed on the Linux host, `server/tests/browser_host_devtools.rs` can exercise a real headless Chromium instance to verify:
   - `devtools_app.html` and ES module proxy + CSP rewrite
   - Target-scoped DevTools WebSocket receiving `Runtime.consoleAPICalled` while rejecting `GEOMETRY_METHODS` and cross-target `Target.*` commands
   - Native file download (`<a download>`) writing the file to the configured host downloads directory and publishing `lastDownload.state == "completed"` with `filePath`.
2. **Gate 2 Architecture Sync:** `docs/architecture/host-browser-cdp-streaming.md`, `docs/api/browser-host.md`, and `docs/system-architecture.md` must document the new DevTools lease endpoints, target-scoped CDP filter rules, native host download behavior, and UI dock/banner lifecycle.

## Requirements

### Functional

1. Execute backend and UI test suites for the new DevTools endpoints, native host downloads, and UI dock/banner.
2. Update `docs/api/browser-host.md` with:
   - `POST /api/browser/sessions/{id}/devtools`
   - `DELETE /api/browser/sessions/{id}/devtools/{token}`
   - `GET /api/browser/devtools/{token}/{*path}`
   - `GET /api/browser/devtools/{token}/ws`
   - `lastDownload` field on `BrowserSessionDto`
3. Update `docs/architecture/host-browser-cdp-streaming.md` and `docs/system-architecture.md` to document the target-scoped native Chromium DevTools proxy, CDP command filtering, native host `Browser.setDownloadBehavior` pipeline, and privacy-mode unmount guarantees.

### Non-Functional

- Record only actually executed test commands and results.

## Architecture

Reconciles Gate 2 architecture documentation with the verified implementation from Phases 01 and 02.

## Related Code Files

- **Modify:** `docs/architecture/host-browser-cdp-streaming.md`
- **Modify:** `docs/api/browser-host.md`
- **Modify:** `docs/system-architecture.md`

## Implementation Steps

1. Run Rust backend tests (`cargo test --manifest-path server/Cargo.toml --test browser_host_devtools` and `cargo test --manifest-path server/Cargo.toml browser_host`) and UI unit/typecheck suites (`pnpm --filter @dam-hopper/ui test` and `pnpm --filter @dam-hopper/ui build`).
2. Update `docs/api/browser-host.md` with request/response schemas and security invariants for the DevTools routes and `lastDownload` DTO.
3. Update `docs/architecture/host-browser-cdp-streaming.md` and `docs/system-architecture.md` with the native Chromium DevTools dock and native host file download architecture.

- Updated the three architecture/API documents. With user authorization, also updated `server/tests/browser_host_devtools.rs` and `server/src/browser_host/selection.rs`: a real Chromium regression exposed that Page completion removed a download GUID before the browser completion event supplied `filePath`; correlation now retains the GUID until the browser event.
- Previously recorded verification: `cargo test --manifest-path server/Cargo.toml --test browser_host_devtools` passed 5/5, including real Chromium asset, WebSocket and download verification; `cargo test --manifest-path server/Cargo.toml browser_host` passed 149 tests. An earlier broader post-fix attempt timed out during compilation; a subsequent attempt completed.
- Previously recorded UI verification: `pnpm --filter @dam-hopper/ui test` passed 4050 tests in 405 files and `pnpm --filter @dam-hopper/ui build` passed. The UI test runner reported jsdom navigation warnings. No full-application visual review is claimed.
- The added `filePath` regression failed before the fix and passed after it. Exact host-path assertion is exercised in the real-Chromium qualification lane when Linux Chromium is installed; CDP documents `filePath` as optional on some platforms.
- Fresh verification in the finalization session: `cargo test --manifest-path server/Cargo.toml download_progress` passed (2 tests); `cargo test --manifest-path server/Cargo.toml --test browser_host_devtools` passed (5 tests), exercising `/usr/bin/chromium`; `cargo test --manifest-path server/Cargo.toml canceled_browser_download_retires_guid_and_unrelated_events_are_ignored` passed (1 test).
- Independent code review cycle 2 approved 10/10, with 0 critical issues, 0 warnings, and 0 suggestions. Review fixes added deterministic event-order/cancellation/pathless-path-preservation tests and documented Linux Chromium path qualification.
- Integrated verification and maintained API/architecture documentation are complete. No visual review was performed or is claimed.

## Todo List

```evcrate-tasks
[
  {
    "id": "verify-and-document-browser-devtools",
    "title": "Run integrated backend/UI verification and update Browser architecture and API docs",
    "blocked_by": ["backend-devtools-proxy", "ui-devtools-dock"],
    "allowed_files": [
      "docs/architecture/host-browser-cdp-streaming.md",
      "docs/api/browser-host.md",
      "docs/system-architecture.md"
    ],
    "constraints": [
      "Record only actually executed test commands and results; do not fabricate visual or manual receipts.",
      "Ensure documented routes, error kinds, CDP filter rules, and lastDownload DTO fields match implemented source."
    ],
    "acceptance": [
      "All backend DevTools/download tests and UI BrowserApp/DevTools dock tests pass with zero regressions and clean TypeScript build.",
      "docs/api/browser-host.md, docs/architecture/host-browser-cdp-streaming.md, and docs/system-architecture.md accurately document the native Chromium DevTools proxy, UI dock, and native host file downloads."
    ],
    "verification": [
      "cargo test --manifest-path server/Cargo.toml --test browser_host_devtools",
      "pnpm --filter @dam-hopper/ui test src/api/browser-host-client.test.ts src/os/browser/browser-devtools-dock.test.tsx src/os/browser/browser-tools.test.tsx src/os/apps/BrowserApp.test.tsx",
      "pnpm --filter @dam-hopper/ui build"
    ]
  }
]
```

- [x] <!-- evcrate-task:verify-and-document-browser-devtools --> Run integrated backend/UI verification and update Browser architecture and API docs

## Success Criteria

- All automated Rust and UI tests and TypeScript builds pass.
- Maintained documentation in `docs/` matches the implemented routes and lifecycle contracts.

## Risk Assessment

- **Documentation drift:** Mitigated by verifying exact route signatures and DTO field names against `server/src/api/browser_host.rs` and `packages/ui/src/api/browser-host-types.ts`.

## Security Considerations

- Document clearly that target-scoped DevTools grants DOM/JS/Network inspection of the bound browser tab while blocking browser-wide, cross-tab, and geometry-mutating CDP commands, and that native downloads write to the host machine's `Downloads` folder under `Browser.setDownloadBehavior`.

## Next Steps

- Hand off plan for `/evc-cmd-code /home/loidinh/WS/dam-hopper/plans/261116-0223-browser-native-chromium-devtools/plan.md`.
