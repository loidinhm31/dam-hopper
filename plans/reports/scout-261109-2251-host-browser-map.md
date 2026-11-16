# Verified review map — Host Browser phases 01–09

Scope: `3f20a8a9..cdfa9c6b`, selected `plans/261108-0237-host-browser-cdp-streaming/plan.md`. Scout located files; coordinator verified paths/current contracts and rejected stale historical claims. This map is navigation, not qualification evidence.

| Original phase | Primary source | Review evidence |
|---|---|---|
| 01 Compatibility | `server/src/browser_host/cdp.rs`, `command_budget.rs`, `process.rs`, `protocol.rs` | [Lifecycle/admission review](evc-code-reviewer-261109-2251-lifecycle-admission.md) |
| 02 Lifecycle | `server/src/browser_host/manager.rs`, `profile.rs`, `config.rs` | Same review L5–L8, L10 |
| 03 Admission | `server/src/browser_host/auth.rs`, `session.rs`, `attachments.rs`, `input.rs`, `network_policy.rs`; `server/src/api/browser_host.rs` | Same review L1–L5, L11–L14; [stream review](evc-code-reviewer-261109-2251-stream-input.md) SI-02,05,12 |
| 04 Raw CDP | `server/src/browser_host/cdp_gateway.rs` | Lifecycle review L9; stream SI-01 |
| 05 Producer/fanout | `server/src/browser_host/screencast.rs`, `media.rs`, `diagnostics.rs` | Stream review SI-01,04–07 |
| 06 Viewer/input | `packages/ui/src/browser-host/`; `packages/ui/src/api/browser-host-types.ts`, `browser-host-client.ts` | Stream review SI-03,08–11 |
| 07 OS cutover | `packages/ui/src/os/BrowserStreamKeepAliveHost.tsx`, `apps/BrowserApp.tsx`, `window-store.ts`, `persistence.ts` | [OS/selection review](evc-code-reviewer-261109-2251-os-selection-qualification.md) O1–O8 |
| 08 Selection/logout | `server/src/browser_host/selection.rs`, `server/src/browser_debug/store.rs`, `server/src/api/auth.rs`; UI selection/auth/dialog consumers | OS/selection review S1–S4,L1–L2,O4 |
| 09 Qualification | `server/tests/browser_host_security.rs`, `browser_host_platform.rs`; `packages/ui/e2e/fixtures/host-browser-app.ts`, `os-host-browser/`, `os-lifecycle/host-browser.spec.ts` | OS/selection Q1–Q5 |

## Current-repository corrections
- Fixture already passes `--web-dir`; seed calls do not pass unsupported `--role`. Those historical fixture findings are not current.
- Reset worker now owns async teardown and is spawned without an intervening await after reset intent. Historical pre-worker async cleanup finding is not current.
- Ordinary successful native target DELETE works. Failed/ambiguous close and concurrent allocation remain separate source findings.
- Actual API viewport updates set expected input epoch; raw-agent geometry reconciliation remains broken.
- Current numeric resize continued streaming in coordinator probe; blanket resize freeze not established.
- TOML config is `[server.browser]` with declared `BrowserHostConfig` fields. No invented browser-specific env keys or minimum engine support claim used.
- Root host currently uses unsafe imperative reparenting, not a completed createPortal cutover; real close crashed the shell.

## Checks and evidence
Fresh commands and actual-source UI/native probes: [runtime evidence](review-261109-2251-host-browser-runtime.md). Focused suites passed while real end-to-end defects reproduced. Windows, physical Android and empirical soak remain unexecuted release gates, not passing claims.

## Unresolved questions
None required to locate or review the nine phases.
