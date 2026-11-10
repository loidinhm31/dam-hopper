---
title: "Browser Cloudflare and Google login compatibility"
description: "Normalize Chromium identity and expose OAuth popups with reliable login input."
status: pending
priority: P2
effort: 14h
branch: feat/ai-os-redesign
tags: [bugfix, backend, frontend, auth]
created: 2026-11-11
---

# Browser Cloudflare and Google Login

## Outcome and scope
Improve interactive Cloudflare Turnstile/interstitial completion, direct `accounts.google.com` sign-in, and Google OAuth popup journeys in the existing streamed Browser App. Keep human challenge/MFA interaction; site acceptance is not guaranteed.

## Evidence and design
- Supplied repository investigation: commits `c1deabaa`, `08901a14`, `13de0468`, `588c44c6`; no new external research required.
- Reference implementation: `/home/loidinh/WS/aicoworker/electron/browser/chrome-identity.ts` and `anti-detection-preload.cjs`.
- Launch: `server/src/browser_host/process.rs` lacks the exact `--disable-blink-features=AutomationControlled` exception.
- Identity/focus/preload integrate through existing CDP actor, screencast producer and pre-navigation `build_producer`; iframe auto-attach stays separate from paused page admission.
- Reuse `NativePumpRequest::AdoptPopup` / `ProducerOrigin::Popup`; no new popup service. Registry publishes parent linkage only after existing `commit_running` succeeds.
- `BrowserSessionDto` keeps camelCase wire fields: optional `activePopupSessionId`, `parentSessionId`, `popupBlocked`; absent values clear stale UI state.
- Window-local popup switching retains its opener; session/owner fencing, viewer leases and root keep-alive semantics remain authoritative.

## Phases and ownership
| Phase | Status | Effort | Owner / dependency |
| --- | --- | --- | --- |
| [01 Backend stealth and popup state](./phase-01-backend-stealth-and-popup-state.md) | Completed | 8h | Backend implementer; existing server primitives |
| [02 UI OAuth popup and input focus](./phase-02-ui-oauth-popup-and-input-focus.md) | Completed | 6h | UI implementer; phase 01 DTO/lifecycle contract |

Backend owns `server/src/browser_host/`; UI owns named API, OS sync/app/keep-alive files and their existing tests. Integration owner runs final checks once after both phases, then updates existing browser architecture/code standards/changelog docs. Durable task contracts in phases define exact writes and dependencies; no execution state created.

## Acceptance
- Engine-level automation flag disabled without changing sandbox, TLS, web security, isolation, executable policy or network authorization.
- Consistent platform-accurate UA/client hints and document-start normalization on initial/reloaded pages and attached OOPIFs; worker HTTP headers sanitized only when required.
- Direct Google sign-in accepts typing immediately after successful toolbar control acquisition; local input/select focus, IME, privacy and view-only gating preserved.
- Admitted OAuth popup becomes visible automatically, supports Return to Page and reopening, then restores its live opener on `closed`/`lost`; blocked popup shows actionable feedback.
- Failed/closed/stale popups never steal unrelated sessions or inherit another session's input lease. Reconnect snapshots converge; opener survives popup close.
- Regression tests cover ordering, stale ownership, multiple popups, cleanup and header-policy preservation; live journeys recorded separately from automated results.

## Verification after implementation
Run once, sequentially, from repository root:
```sh
cargo test --manifest-path server/Cargo.toml
pnpm --filter @dam-hopper/ui test
pnpm --filter @dam-hopper/ui build
```
Then manually exercise Cloudflare standalone and cross-origin challenges; Google direct login and OAuth success/cancel/blocked popup, using a test account and without recording credentials or tokens. Record browser version/platform and actual result; network/risk-engine rejection is not a test pass.

## Constraints and delivery
No CAPTCHA solver, cookie/token export, proxy rotation, account-policy bypass, browser-engine replacement, new dependency, persistence migration or version bump. Create one focused `<200 LOC` `stealth.rs` module; reuse source techniques selectively rather than importing the Electron lifecycle.

Review/validation: delegated authoring only; independent challenge, related-plan overlap check, architecture gate and final validation remain coordinator-owned. Security/lifecycle review is required before ready-to-code handoff. Planning does not authorize implementation; no verification commands executed here.

## Unresolved questions
None for authoring. Coordinator-owned review/validation and live site qualification remain pending, not claimed complete.
