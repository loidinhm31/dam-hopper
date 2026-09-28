# Phase 05 — end-to-end and release qualification

## Context links

- [Plan](./plan.md), [architecture](../../docs/architecture/agent-status.md), [acceptance matrix](./acceptance-scenarios.md).
- Dependencies: phases 01–04 integrated. No implementation in this planning session.

## Overview

Date: 2026-09-28. Priority: P2. Implementation: pending. Review: pending release-evidence review.
Prove real Linux OMP behavior, actual browser surfaces and packaged server installation. Tests alone do not establish feature completion.

## Key Insights

- Prior Herdr harness proves upstream event logic only; it did not exercise this integration.
- OMP error/continuation/reload ordering and packaged profile paths need direct runtime evidence.
- User selected Linux-first server runtime and per-browser notifications. Preserve other platform builds without an unobserved runtime claim.

## Requirements

- Run every C01–C19 acceptance scenario or record exact missing external prerequisite; do not mark complete with an untested core path.
- Use isolated temporary server config/profile/workspace and real PTYs; no production profile mutation or credentials in evidence.
- Exercise UI in Chromium, including compact layout, inactive terminal, profile collision, reconnection and notification-permission denial.
- Package/start existing server artifact and use its installer; no source-tree-relative asset requirement or extra Herdr daemon.
- Status remains advisory; workflow/suspend/telemetry contracts unchanged.

## Architecture

Qualification crosses four real boundaries: OMP extension lifecycle -> authenticated local socket -> Rust snapshot/push -> profile-owned browser state and notification navigation. Test loss/duplication at boundaries, not merely callback forwarding.

Permanent tests should cover uncertain consumer-visible semantics: reducer transitions, credential/lifetime isolation, race handling, migration and reconnect dedupe. Use throwaway runtime probes for event inventory/transport/package smoke. Remove throwaway artifacts after evidence is recorded; retain no provider secrets or terminal transcripts.

## Related code files

Verify implementation files listed in phases 01–04 and existing suites:
- `server/tests/agent_status_runtime.rs`, `agent_status_integration.rs`, `omp-agent-status.test.ts` (planned).
- `server/src/pty/tests.rs`, `server/src/api/tests.rs`, relevant auth/WS tests.
- `packages/ui/src/stores/agent-status.test.ts` and focused new decoder/watcher tests (planned).
- Existing `terminal-agent-notification-integration.test.ts`, `browser-notification-service.test.ts`, `ui-config.test.ts`, settings/navigation/row tests.
Update after runtime proof:
- `docs/architecture/agent-status.md`, `docs/system-architecture.md` — actual implemented behavior/status only.
- `docs/api-reference.md`, `docs/ws-protocol-guide.md`, `docs/configuration-guide.md` — API, push, installer and compatibility contract.
- `docs/README.md`, `docs/CHANGELOG.md`, `docs/codebase-summary.md` — user entrypoint, delivered behavior and source map.
- This plan's phase status and evidence links; keep Windows qualification explicitly separate.

## Implementation Steps

1. Run focused backend/adapter/frontend contract suites after integration, once per changed implementation revision. Fix observed failures; do not repeatedly rerun unchanged checks to confirm known failures.
2. Launch isolated real server and web app; install embedded adapter into a disposable OMP profile as the PTY user. Record exact OMP/Bun/server versions without credentials.
3. Exercise real prompt start, tool approval/denial, ask/cancel, normal end, interrupt, continuation/retry, session switch, reload and nested OMP. Use a safe temporary workspace. Where provider outage/retry is difficult, combine real lifecycle baseline with deterministic fault injection; label boundary of proof.
4. Close OMP while parent shell stays live; force-kill reporter; pause heartbeat; replace terminal ID; disconnect/reconnect browser; verify no false completion and bounded unknown transition.
5. Inspect actual badges/history/toast/navigation on three surfaces and compact layout; two profiles with same terminal ID stay isolated. Browser denial must leave history/status working.
6. Build existing server release artifact; install/status/update/uninstall using that binary without repository tree. Confirm extension embedded, local listener loopback-only, public router cannot accept report tokens, no new daemon/process dependency.
7. Run broader existing backend/UI regression checks and web build/lint. Run Windows compile gate on supported CI/toolchain; do not substitute Linux success for Windows evidence.
8. Update implementation docs/changelog after smoke, record scenario results and limitations, and remove scratch artifacts. Default rollout requires matched server/UI and explicit OMP adapter install; preserve downgrade/uninstall procedure.

## Todo list

- [ ] Focused transition/security/reconnect/migration suites pass.
- [ ] Real Linux OMP runtime scenario evidence recorded.
- [ ] Actual browser surfaces and notification selection verified.
- [ ] Packaged server installer and privacy boundary proven.
- [ ] Existing behavior regressions checked; Windows compilation retained.
- [ ] Delivered architecture/docs/changelog and rollback instructions accurate.

## Success Criteria

C01–C19 evidence complete; no unqualified success claims. A user can deploy the server, install adapter once, launch ordinary OMP, observe semantic status while terminal inactive, receive opted-in notification and navigate to the correct profile/incarnation. OMP error/exit cannot falsely mark a task successful. No future Codex implementation required for acceptance.

## Risk Assessment

Live-provider availability, notification permissions and Windows toolchain are external prerequisites. Record blocked scenario precisely, finish reachable work, and do not mark feature ready if the missing scenario is a required Linux core behavior. No secrets or arbitrary approval commands in demonstrations.

## Security Considerations

Run safe local prompts and test-only credentials. Inspect public snapshots, diagnostics and persistence for secret leakage with generated canary values, never real credentials. Capture screenshots of status UI only; redact project/provider content.

## Next steps

Once all gates pass, implementation can be reviewed for release. Additional agent rollout is a separate request using the same contract; screen engine, closed-browser notifications and Windows runtime qualification are not implied by this phase.
