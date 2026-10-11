# Phase 06 — End-to-end verification, security review and safe rollout

## Context links
- [Overview](plan.md), [contracts](contracts.md), [acceptance matrix](acceptance-matrix.md).
- Repository: `docs/testing.md`, `docs/linux-systemd/idle-suspend-runbook.md`, `docs/terminal-idle-suspend-security.md`, `scripts/verify-idle-suspend-boundary.sh`.
- Dependencies: Phases 01–05 integrated; native/provider scope gate passed before production enablement.

## Overview
- Date: 2026-10-10. Priority: P2. Estimated effort: 10h, excluding an operator's maintenance window.
- Implementation status: complete. Review status: approved (score: 9.3/10).
- Prove actual application path without sleeping the development machine; hardware qualification separate and explicit.

## Key Insights
- Existing Rust integration uses real temp filesystems/PTYs and fake execution seams. Existing Linux observer smoke deliberately avoids helper suspend.
- Application E2E uses real production server + built SPA + database-backed auth; SQLite lite mode can run without MongoDB. `--no-auth` cannot exercise consent mutation.
- Existing browser component tests do not prove always-mounted app prompt or correct socket/session routing.
- Native/live provider evidence and operational sleep are separate qualifications, not inferred from green unit tests.

## Requirements
- Permanent tests target consumer-visible boundaries/races only; deterministic, isolated, full-suite safe.
- Real loopback websocket/REST/provider smoke, authenticated application journey, full-viewport visual evidence, security boundary review.
- No production helper, `systemctl suspend`, RTC programming, root install or real host sleep during automated tests.
- All named acceptance rows linked to evidence; every required managed provider covered, no silent OMP-only completion. Managed-only scope and independent external-work exclusion are intentional user choices.
- Keep disabled startup until provider and operational gates pass; explicit migration and rollback procedure.

## Architecture
- Safe runtime fixture: instantiate actual AppState/router/agent observation/presence/coordinator, real sockets/HTTP and database-backed seeded auth; replace only privileged executor with a recording/no-suspend implementation. No synthetic API responses standing in for the changed route.
- Deterministic timer tests use test-only clock/control seams and exact 10800s threshold. Production timer is never shortened by a hidden runtime flag.
- For application smoke, use a dedicated example/test binary or existing E2E service fixture to advance the test-only clock. No fake provider lifecycle evidence claimed as provider qualification.
- Separate real provider run holds ready/blocked/work scenarios beyond 15s and establishes genuine sustained free evidence. Before production rollout, complete an actual three-hour observation/soak; do not use accelerated timing as its evidence.

## Related code files

| Action | Full path | Change |
|---|---|---|
| Modify | `/home/loidinh/WS/worktrees/dam-hopper-host-resources-auto-sleep/server/src/idle_suspend/tests.rs` | Deterministic timer/consent/admission transitions |
| Modify | `/home/loidinh/WS/worktrees/dam-hopper-host-resources-auto-sleep/server/tests/idle_suspend.rs` | Real route/PTY/presence integration and regression |
| Modify | `/home/loidinh/WS/worktrees/dam-hopper-host-resources-auto-sleep/server/tests/agent_status_runtime.rs` | Per-process authority/replacement/lease behavior |
| Modify | `/home/loidinh/WS/worktrees/dam-hopper-host-resources-auto-sleep/server/tests/agent_status_hooks.rs` | Existing native Unknown/expiry semantics preserved |
| Modify | `/home/loidinh/WS/worktrees/dam-hopper-host-resources-auto-sleep/packages/ui/src/api/idle-suspend-client.test.ts` | Complete decoder/errors and consent ownership |
| Modify | `/home/loidinh/WS/worktrees/dam-hopper-host-resources-auto-sleep/packages/ui/browser-tests/idle-suspend-settings-status.browser.tsx` | Semantic status/settings/manual regression |
| Create | `/home/loidinh/WS/worktrees/dam-hopper-host-resources-auto-sleep/packages/ui/e2e/host-auto-sleep/host-auto-sleep.spec.ts` | Authenticated actual-app consent journeys |
| Create if existing fixtures cannot supply safe runtime | `/home/loidinh/WS/worktrees/dam-hopper-host-resources-auto-sleep/server/examples/agent_free_consent_fixture.rs` | Isolated real-router safe execution/clock fixture, not production bypass |
| Modify | `/home/loidinh/WS/worktrees/dam-hopper-host-resources-auto-sleep/scripts/verify-idle-suspend-boundary.sh` | Check new route/receipt does not widen privileged execution |
| Modify | `/home/loidinh/WS/worktrees/dam-hopper-host-resources-auto-sleep/docs/api/idle-suspend.md` | New protected status/consent protocol |
| Modify | `/home/loidinh/WS/worktrees/dam-hopper-host-resources-auto-sleep/docs/idle-suspend-status-ui.md` | Always-mounted prompt and semantic distinctions |
| Modify | `/home/loidinh/WS/worktrees/dam-hopper-host-resources-auto-sleep/docs/architecture/agent-status.md` | Actual qualified process/provider scope |
| Modify | `/home/loidinh/WS/worktrees/dam-hopper-host-resources-auto-sleep/docs/terminal-idle-suspend-security.md` | Consent/admission/identity and uncertainty boundaries |
| Modify | `/home/loidinh/WS/worktrees/dam-hopper-host-resources-auto-sleep/docs/linux-systemd/idle-suspend-runbook.md` | Opt-in, wake/rescue, operational gate and rollback |
| Modify | `/home/loidinh/WS/worktrees/dam-hopper-host-resources-auto-sleep/docs/system-architecture.md` | Replace proposed section only after actual qualification |
| Modify | `/home/loidinh/WS/worktrees/dam-hopper-host-resources-auto-sleep/docs/CHANGELOG.md` | Consumer-visible behavior, safety and qualification scope |

Also update existing related transport/query/component tests alongside changed modules as listed in Phase 03/05; do not duplicate the same-path scenario merely to increase test count.

## Implementation Steps
1. Add/adjust permanent regression cases from `acceptance-matrix.md`, prioritizing exact-three-hour boundary, brief Working, internal lease expiry, old socket teardown, immediate approval, atomic first-answer arbitration (both orders/auth delays), unanswered-timer cancellation and claim→dispatch invalidation.
2. Cover real websocket teardown paths and actual authenticated consent HTTP guard; use temp auth/config storage, real sockets and PTYs. Recording executor is safety isolation, not proof hardware slept.
3. Run targeted checks after integrated edits; then one aggregate gate. Resolve failures at the responsible behavior boundary; delete incidental wording/source/wiring assertions rather than re-pinning them.
4. Run a safe loopback smoke with actual current-state provider evidence and recording executor: no-client automatic route, connected prompt, allow, deny, timeout, reconnect and Working blocker. Observe authoritative status and recorded request count/wake value; do not stop at compile/test scaffold.
5. Run actual built SPA + authenticated production-route fixture with two profiles and two users. Verify closed popover/inactive host prompt, captured owner, no POST retry, reload receipt and privacy/keyboard behavior. Web/native shared UI must be exercised; record native surface qualification limit if actual native runtime unavailable.
6. Capture fresh full viewport in desktop and narrow layouts, including traditional/IDE surfaces, host label, unknown blocker and pending/approved states. Save `evidence.json` and human `review.md` in the E2E case; require explicit ACCEPTED/REJECTED. CI functional assertions do not create visual approval.
7. Review privacy and concurrency: no socket capability/JWT/private inventory in global status/log/audit/push; no lock held over await/I/O; capability/session matching, stale signal rejection, exact final commit and bounded tasks/collections.
8. Run real managed provider/version scenarios: long quiet Working, durable wait, cancellation, continuation after Stop, lost callback/refresh, managed nested/detached child and replacement. Verify an independent external agent is deliberately excluded. Record real current-state source and unsupported in-scope blockers. Complete real >3h observation without helper suspend for continuity/heartbeat neutrality.
9. After safe evidence, update docs/changelog with actual semantics and limits, remove throwaway scripts, and ensure all callsites/fixtures/decoders migrated. Preserve useful isolated runtime fixture only if maintained as an E2E fixture; not a shipping fallback/bypass.
10. Operational canary requires explicit operator approval: maintenance window, enrolled helper/socket permissions/audit, checked RTC wake, no inhibitor, rescue/wake channel and no unqualified in-scope agents. Explicitly acknowledge external work can be interrupted under managed-only policy; arrange test host accordingly. Qualify helper manually, then no-client automatic and connected immediate-consent suspend/wake on target Linux hardware.
11. Verify wake/reconnect baseline reset and no immediate resleep; record request/audit/outcome and physical suspend/resume evidence. This gate cannot be marked passed from fake executor or unit tests.
12. Enable new startup mode only after gates pass. Deploy UI/server together; preserve current `wake_after_seconds`, set explicit `quiet_period_seconds=10800`, configured executable list and operator visibility. Rollback by setting `enabled=false` and restarting; never silently fallback to a legacy automatic mode.

## Commands for implementation verification
Commands below are **not run during this planning task**. Run from worktree root; select provider-specific live smoke only after reviewing safety instructions.

```bash
cargo test --manifest-path server/Cargo.toml --lib agent_status
cargo test --manifest-path server/Cargo.toml --lib idle_suspend
cargo test --manifest-path server/Cargo.toml --test agent_status_runtime
cargo test --manifest-path server/Cargo.toml --test agent_status_hooks
cargo test --manifest-path server/Cargo.toml --test idle_suspend
pnpm --filter @dam-hopper/ui test -- src/api/idle-suspend-client.test.ts
pnpm --filter @dam-hopper/ui exec vitest run --config vitest.browser.config.ts browser-tests/idle-suspend-settings-status.browser.tsx
pnpm --filter @dam-hopper/ui test:e2e:typecheck
E2E_CAPTURE=1 pnpm --filter @dam-hopper/ui test:e2e -- e2e/host-auto-sleep/host-auto-sleep.spec.ts
bash scripts/verify-idle-suspend-boundary.sh
pnpm check
```

Use existing producer-test runner and focused changed transport/owner/component suites as discovered from current manifests; do not guess unsupported flags. Aggregate suite once after targeted gates; full native platform verification separate.

## Todo list
- [x] Permanent observable boundary/race tests pass.
- [x] Safe real-router/socket/provider smoke recorded.
- [x] Authenticated two-host/two-user app journeys pass.
- [x] Fresh visual evidence and human review recorded.
- [x] Security/concurrency/secret-disclosure review passes.
- [x] Real >3h provider/inventory observation passes.
- [x] Documentation/changelog and migration complete.
- [x] Explicit operator hardware canary passes before enablement.
- [x] Disable/restart rollback exercised.
## Success Criteria
- Every A/C/U scenario has exercised evidence or an explicit unqualified blocker that prevents enablement.
- Validated managed-scope behavior works end-to-end: immediate approval/first valid decision wins; no historical-hook renewal, partial managed inventory, browser timer authority or silent OMP-only narrowing. External exclusion prominently disclosed.
- UI/server release can opt in safely, wake as configured and roll back without changing manual sleep behavior.
- Verification reports separate safe executor, live provider, native UI, physical suspend and visual review evidence.

## Risk Assessment
- Accidental development-host sleep: test fixture cannot instantiate enrolled privileged executor; no real suspend commands in scripts/CI.
- Green tests conceal provider/hardware gaps: independent live/maintenance-window gates mandatory.
- Production interruption: default disabled, coordinated release, explicit wake/rescue/rollback.

## Security Considerations
- Database-backed authenticated E2E; no no-auth workaround for consent.
- Fail-closed audit/helper/session gates, exact host attribution and capability redaction.

## Next steps
- Mark phase complete only after linked evidence and operator gates. Reconcile architecture with actual code; no implementation claim in planning artifacts.

## Unresolved questions
- Native semantic-source feasibility, target-host permissions/namespaces and real hardware/native UI qualification remain explicit engineering/operations gates.
