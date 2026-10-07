---
title: Cloudflared persistence and three-hour reminders
description: Preserve explicit tunnels through origin and terminal lifecycle changes; remind after three hours without expiry.
status: completed
priority: P2
branch: feat/cloudflared-persistence-reminder
tags: [cloudflared, port-forwarding, reminders]
created: 2026-10-07
---

# Preflight contract

## Output and scope
- Feature branch `feat/cloudflared-persistence-reminder`; complete Rust/shared-React behavior, regression coverage, runtime/browser evidence, reviewed docs.
- Origin-port closure, temporary restart, PTY exit/removal, and detected-owner replacement never stop an explicitly started tunnel. Preserve connector PID, tunnel ID, URL, and `startedAt`.
- Explicit Stop, Cloudflared exit/startup failure, and DamHopper shutdown still stop/reap tunnels. No connector restart policy, named/custom-domain tunnel, or persistence across DamHopper restart/reboot.
- One server-owned reminder becomes due at three hours after creation. Reminder never stops the tunnel; downtime never resets its clock.
- Shared UI shows URL, port, and profile with Dismiss/Stop. Catch up from REST after reload/reconnect. Dismissal is per tunnel/profile/browser session and survives reconnect/reload in that session; another browser can show its own reminder.
- Tunnel-only entries remain visible after detection/terminal loss and say origin untracked rather than listening. This is not a health probe.

## Acceptance criteria
1. Same live Cloudflared child/ID/URL/start time survive both detected and manually entered origin-port loss/reopen.
2. PTY EOF/kill/replacement and another PTY reporting the same port preserve the tunnel. Detected-port cleanup and incarnation fences still work.
3. No obsolete tunnel-owner cancellation API, ownerless loss monitor, or PTY/tunnel coupling remains.
4. Three-hour boundary: no early reminder; exactly one reminder transition/event per active tunnel; `reminderDue` remains true in REST until terminal cleanup. Stop/exit cancels reminder and emits no late reminder.
5. Reminder visible globally in shared web/native app; accessible Dismiss/Stop, failed Stop visible/retryable, no automatic expiry. Dismiss does not stop connector.
6. Profile/generation-scoped snapshots, subscriptions, and captured Stop targets; equal IDs/ports across profiles remain independent; stale callbacks never stop on a replacement connection or ambient server.
7. Reminder due state survives browser disconnect in server memory; reconnect queries catch up. No browser-only three-hour timer.
8. Existing startup-cancellation/dispose races, duplicate-port checks, configuration isolation, and host-header behavior remain intact.
9. Compile/typecheck, targeted regression tests, real isolated connector/socket smoke, real browser visualization/actions, independent review. Only exercised verification reported.

## Risk/public contracts
- Public port exposure persists longer: a later service on the same port is exposed. State this in Ports UI/docs/reminder; Stop remains explicit.
- Quick Tunnel URL exists only while the connector exists; closed origin returns an origin error (normally 502), not working application content.
- Remove tunnel `sessionId`/`incarnation` ownership fields. Add required camelCase `reminderDue: boolean` to TunnelSession/TunnelInfo, initialized false.
- Add WebSocket kind `tunnel:reminder`, payload `{ id: string }`; due state in REST is authoritative for reconnect.
- Timer uses Tokio monotonic creation deadline and lives with the event watcher; serialization exposes UTC `startedAt` unchanged.
- No auth, firewall, CORS, release version, service-install, or existing user runtime changes.

## Affected systems and ownership
- Backend actor: `server/src/tunnel/`, `server/src/port_forward/`, `server/src/api/tunnel.rs`, `server/src/api/ws_protocol.rs`, required Rust callers in `server/src/main.rs`, `server/src/pty/manager.rs`, and backend test consumers. Own all Rust edits; no UI/docs edits.
- UI actor: `packages/ui/src/` and necessary browser regression files. Own all TS/TSX edits; no Rust/docs edits.
- Orchestrator: architecture/changelog/API docs, new plan files, integration, runtime/browser smoke, validation coordination, final approval/commit question. No source edits while actors own their files.
- Validation actor and review actor: read-only, after both implementation actors finish. Actors keep their configured models; no model overrides.

## Skills/workflow
- Loaded directly from HOME: planning, debugging, backend-development, frontend-development, web-testing, code-review. Repository patterns override generic framework examples.
- `/cmd-plan` → fast-plan workflow followed directly using available tools; no slash-command execution tool exposed. `/cmd-code` owns implementation/finalization in this session.
- Advice `off`, validated native cook/auto context and child code helper result; no advisor/controller/checkpoints. Ordinary new plan: this `plan.md` is overview; no progress.md or historical-plan mutations.

# Implementation phases

| Phase | Status | Actor / role | Contract |
| --- | --- | --- | --- |
| 1. Backend lifetime and reminder | Completed | evcrate-astra-high / Rust lifecycle implementation | [Phase 1](phase-01-backend-lifetime-reminder.md) |
| 2. Shared UI reminder and retained port | Completed | ui-ux-designer / React UI implementation | [Phase 2](phase-02-shared-ui-reminder.md) |
| 3. Integration, verification, review | Completed; user approved commit | Orchestrator + tester + code-reviewer | [Phase 3](phase-03-verification-review.md) |

Phases 1 and 2 independent under the frozen wire contract; dispatch together. No build/lint/test/formatter during actor work. Phase 3 starts after both terminal reports and source review. Parent waits for all actors before validation.

## Testing strategy
- Rust: deterministic paused-clock tests for deadline, no early/duplicate/late reminder; observable lifecycle/persistence regression tests, retain consumer behavior/race tests. Replace obsolete auto-stop assertions; delete wording/copy/source-text tests, never re-pin them.
- UI: behavior tests for reconnect catch-up, Dismiss/Stop, cross-profile equal IDs and stale-generation actions. Reuse existing Vitest/browser setup; no incidental implementation-default assertions.
- Compile/typecheck: `cargo check --all-targets`, UI `pnpm --filter @dam-hopper/ui build`, web `pnpm build`; targeted Rust and UI tests and lint/format checks restricted to changes.
- Smoke: freshly built server with isolated HOME/config and loopback API; real Cloudflared only to throwaway sockets. Close/reopen socket, end/change PTY, verify unchanged live connector and tunnel identity, explicit Stop and shutdown reap children. Never expose user's services or change active installation.
- Browser: built/current shared app backed by isolated server; observe retained tunnel entry, reminder and its Dismiss/Stop path. Accelerate elapsed time in a throwaway clock-controlled runtime/browser boundary without permanent debug flags; report acceleration and edge HTTP qualification explicitly. Capture visual evidence; close managed browser and cleanup probes.
- Review: one code-reviewer per cycle, full requirements/security/lifecycle/profile audit, report all findings. Fix verified issues, revalidate. User approval gate and explicit commit question; no automatic commit.

## Unresolved questions
None blocking. Persistence means origin/PTY independence while DamHopper and Cloudflared remain alive. Three-hour reminder is one due transition, not expiry or recurring nag.

# Evidence and final status
Implementation and exercised verification complete. Branch `feat/cloudflared-persistence-reminder`; user approved implementation and scoped commit. No deployment or installed-runtime change.

- Rust check/build pass; tunnel20 + port15 + protocol11 + PTY172 tests pass, one PTY test ignored.
- UI TypeScript/web build pass; focused57 tests and full324 files /2560 tests pass. Scoped ESLint0 errors/12 warnings.
- Real public edge HTTP200 → closed-origin502 → reopened-origin200, unchanged PID/ID/URL/start time. PTY exit/Kill/reuse/owner replacement and manual listener loss preserve connector. Explicit Stop and shutdown reap children.
- Real server monotonic clock advanced +10800 in isolated temporary shim; one observed reminder event and retained REST due=true, no expiry. Fresh run verified two due connectors.
- Actual shared app: reload/fresh-session catch-up, Dismiss without Stop and retained session dismissal, Cognito isolation, retained-origin rows and banner/row Stop, desktop1440×900/narrow320×800 no outer overflow or clipped route bottom.
- Independent reviewer: no unresolved important source findings after corrections; parent exercised rebuilt browser geometry afterward.
- Existing strict Clippy and rustfmt diagnostics remain, no blanket all-gates-green claim. Native desktop/Windows, Docker E2E, full Rust suite, and human visual acceptance not qualified.

Detailed evidence, review corrections, probe cleanup, and captures: [runtime/review report](reports/runtime-and-review.md). [Tester report](../reports/tester-261007-1140-cloudflared-persistence-reminder.md) records initial root-mock failure; parent correction and full-suite pass supersede it.

User approved implementation and commit via approval/Git decision prompt. Scoped conventional commit follows; no push or deployment.
