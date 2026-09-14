# Phase 01 — Policy, Config, Security Gate, and Protocol

## Context links

- [Parent plan](./plan.md)
- [System architecture](../../docs/system-architecture.md#server-authoritative-terminal-idle-suspend-planned-security-gate-required)
- [Configuration guide](../../docs/configuration-guide.md)
- [API reference](../../docs/api-reference.md)
- [Suspend safety research](./research/researcher-01-suspend-safety-report.md)
- [Host/config scout](./scout/scout-03-host-config-report.md)

## Overview

- Date: 2026-08-24
- Description: Lock startup ownership, bounded live timing contract, persistence/audit transaction, fixed helper protocol, and approval evidence before privileged work.
- Priority: P1
- Implementation status: Done (2026-09-05)
- Review status: Approved (2026-09-05)

## Key Insights

- Startup resolves one authoritative `DamHopperConfig.config_path`; capture it as the immutable policy registry path so workspace switch/reload cannot replace enablement or helper enrollment.
- Existing `PUT /api/config` is unrestricted full-config replacement. It must preserve/reject idle-suspend changes and cannot authorize timing writes.
- Existing auth middleware inserts `AuthenticatedActor`; the timing route must additionally reject `--no-auth` and verify the subject is an enabled account, without a role or re-auth flow.
- Timing and helper handoff need one coordinator command order. API-side writes followed by notification would leave a suspend race.
- Atomic TOML replacement can persist both values as one pair. Audit availability is an admission prerequisite; runtime changes only after audit admission and successful replacement.
- Fixed helper request remains materially safer than sudo, shell parsing, password forwarding, or browser-selected arguments.

## Requirements

### Functional

- Add `[server.idle_suspend]` with `enabled = false`, bounded `quiet_period_seconds`, bounded `wake_after_seconds`, and startup-only enrollment reference/capability selection. `600` seconds remains only a proposed wake default.
- Capture startup enablement, enrollment, and registry path immutably. Config reload, workspace switch, full-config update, import, or browser-selected registry cannot enable/disable/re-enroll the running service.
- Make the dedicated v1 timing mutation the only browser authority. Full config/import paths preserve the startup-owned subsection and reject attempted idle-suspend deltas with the dedicated-route/operator guidance.
- Contract: `PATCH /api/system/idle-suspend/v1/timing`, exact JSON `{ "quietPeriodSeconds": integer, "wakeAfterSeconds": integer }`; both required, unknown fields rejected, request body capped.
- Success `200`: `{ "version": 1, "changed": boolean, "statusRevision": integer, "quietPeriodSeconds": integer, "wakeAfterSeconds": integer }`. Same-pair request is an idempotent `changed: false` with no cancel, disk write, audit, or revision bump.
- Errors use existing `{ "error": string, "code": string }`: `400 invalidIdleSuspendTiming`; `401 unauthorized`; `403 invalidOrigin|idleSuspendTimingDisabledNoAuth|actorDisabled`; `409 idleSuspendHandoffInProgress`; `415 invalidContentType`; `503 authenticationUnavailable|idleSuspendTimingUnavailable|idleSuspendTimingAuditUnavailable|idleSuspendTimingPersistenceUnavailable|idleSuspendTimingReconciliationRequired`.
- Require application/json and same-origin protection for cookie-auth mutation. Require a normal authenticated enabled actor; no separate role, password, or re-authentication.
- On an admitted pre-handoff change: cancel current arm; durably record bounded actor/before/after audit; atomically replace both canonical TOML values; update both runtime values; re-evaluate current fleet; increment status revision and re-arm if applicable.
- If audit or atomic persistence fails, retain prior runtime pair and re-evaluate/re-arm under it. If file state cannot be proven after a write error, latch reconciliation-required/unavailable; never continue with an ambiguous pair.
- After helper handoff acceptance, return `409 idleSuspendHandoffInProgress` with no audit, memory, or disk change. Retry only after execution outcome/resume reconciliation releases admission.
- Define fixed helper request `SuspendWithRtcWake { request_id, wake_after_seconds }`, capability/outcome enums, support matrix, inhibitor policy, retention, peer proof, and residual-risk gate.
- Force mutation unavailable in `--no-auth`; force execution disabled/unavailable for unsupported platform, unapproved enrollment, missing helper, invalid config, or unknown state.

### Non-functional

- No command, shell, executable path, RTC device/mode, environment, password, terminal/helper content, or per-request override in config/API/protocol/audit.
- Strict integer/field/body/version bounds; reject zero, negative, float, overflow, out-of-range, missing, duplicate, and unknown input.
- TOML stays snake_case; API stays camelCase. Actor is the enabled account subject, validated and capped before audit; audit stores version, timestamp, actor, before/after pair, transaction ID, and bounded result code only.
- Serialize timing mutations and handoff admission without holding PTY/config locks across await. One coordinator command owns decision and completion.
- Keep v1 narrow: no trigger, cancel, enable/disable, absolute schedule, keep-awake lease, batch, partial patch, or generic remediation.

## Architecture

- `StartupIdleSuspendPolicy` owns immutable `enabled`, enrollment identity, and captured startup registry path. `RuntimeIdleSuspendTiming` owns the mutable pair and revision.
- `IdleSuspendTimingStore` edits only `[server.idle_suspend].quiet_period_seconds` and `.wake_after_seconds` in the captured registry document, then performs one mode-preserving atomic replacement. It never serializes a browser-supplied full config.
- `IdleSuspendTimingAudit` must accept a bounded authorized-attempt record before registry replacement. Atomic write failure leaves the old file/pair; runtime commit is synchronous after replacement. Startup reads the committed pair and reports any malformed/ambiguous state unavailable.
- Coordinator command queue orders `UpdateTiming` against the deadline/final-check `AcceptHandoff`. Acceptance cancels an arm before I/O; completion re-reads latest fleet state before choosing watching/armed. Handoff acceptance closes timing admission until outcome/resume reconciliation.
- `state.config` mirrors the committed timing pair for truthful status/config reads, but reload cannot replace startup ownership. Status revision change publishes one bounded invalidation hint.
- Protocol exposes one fixed helper mutation plus read-only capability. `UnavailableExecutor`/`FakeExecutor` only in this phase; Phase 3 remains gated.

## Related code files

| Absolute path | Action | Purpose | Dependencies |
|---|---|---|---|
| `/home/loidinh/WS/dam-hopper-ws/feat-terminal-idle-suspend/server/src/config/schema.rs` | Modify | Add config shape and unresolved validation constants | Approved bounds/defaults |
| `/home/loidinh/WS/dam-hopper-ws/feat-terminal-idle-suspend/server/src/config/parser.rs` | Modify | Validate/round-trip snake_case TOML pair | Config schema |
| `/home/loidinh/WS/dam-hopper-ws/feat-terminal-idle-suspend/server/src/config/tests.rs` | Modify | Default-off, bounds, round-trip, startup-path tests | Schema/parser |
| `/home/loidinh/WS/dam-hopper-ws/feat-terminal-idle-suspend/server/src/api/config.rs` | Modify | Preserve/reject idle-suspend changes through full config | Startup policy |
| `/home/loidinh/WS/dam-hopper-ws/feat-terminal-idle-suspend/server/src/api/settings.rs` | Modify | Prevent import from bypassing dedicated timing authority | Startup policy |
| `/home/loidinh/WS/dam-hopper-ws/feat-terminal-idle-suspend/server/src/idle_suspend/policy.rs` | Create | Startup ownership, timing validation, support policy | Approved decisions |
| `/home/loidinh/WS/dam-hopper-ws/feat-terminal-idle-suspend/server/src/idle_suspend/timing_store.rs` | Create | Narrow atomic canonical-registry pair update | Captured registry path |
| `/home/loidinh/WS/dam-hopper-ws/feat-terminal-idle-suspend/server/src/idle_suspend/timing_audit.rs` | Create | Bounded actor/before/after audit admission | Retention/path decision |
| `/home/loidinh/WS/dam-hopper-ws/feat-terminal-idle-suspend/server/src/idle_suspend/protocol.rs` | Create | Versioned helper request and bounded outcomes | Security review |
| `/home/loidinh/WS/dam-hopper-ws/feat-terminal-idle-suspend/server/src/idle_suspend/executor.rs` | Create | Trait plus unavailable/fake executors | Protocol |
| `/home/loidinh/WS/dam-hopper-ws/feat-terminal-idle-suspend/server/src/state.rs` | Modify | Capture startup policy/registry path and audit/store seams | New modules |
| `/home/loidinh/WS/dam-hopper-ws/feat-terminal-idle-suspend/docs/terminal-idle-suspend-security.md` | Create | Threat model, approvers, support/retention decisions | Security/operator owners |
| `/home/loidinh/WS/dam-hopper-ws/feat-terminal-idle-suspend/docs/configuration-guide.md` | Modify | Operator ownership plus dedicated live timing semantics | Final contract |

## Implementation Steps

1. Revalidate defaults/min/max, matrix, inhibitors, registry ownership, timing audit path/retention, helper peer proof, residual risk, and rollback owner. Keep Phase 3 blocked until signed.
2. Define config types and validation constants after approval. Capture startup registry path/policy independently from workspace reload.
3. Define exact timing DTO/result/error and helper protocol types; deny unknown fields and cap request/audit data.
4. Add preservation/rejection guards to full config, project reload/import, and workspace switch boundaries so none become idle-policy authority.
5. Implement narrow pair store using read-validate-edit and one mode-preserving atomic write; test unrelated TOML preservation and failure recovery.
6. Implement bounded timing audit admission. Prove audit failure prevents registry/runtime mutation and no sensitive fields serialize.
7. Define coordinator `UpdateTiming` command/result and shared handoff admission order for Phase 2; document same-pair and post-handoff behavior.
8. Add unavailable/fake executor seams and negative dependency checks proving resource alerts cannot invoke idle suspend.
9. Update config/security/API docs after decisions; review architecture before Phase 2.

## Todo list

- [x] Revalidate bounds/defaults and support/security decisions
- [x] Add startup-owned config and canonical path capture
- [x] Freeze exact timing and helper contracts
- [x] Protect full-config/import/workspace paths
- [x] Add atomic pair store and bounded timing audit
- [x] Define ordered coordinator timing command
- [x] Add unavailable/fake executor only
- [x] Update config/security/API documentation

## Success Criteria

- Default/missing config cannot arm suspend; browser routes cannot enable, disable, enroll, trigger, cancel, or select helper behavior.
- Only exact authenticated v1 pair mutation can tune timing; `--no-auth`, disabled actor, malformed/partial/unknown/out-of-range input fail with bounded codes.
- Pair persistence uses captured startup registry and is atomic. Audit/persistence failure leaves prior runtime; ambiguous disk state latches unavailable.
- Pre-handoff update contract cancels/re-evaluates/re-arms. Post-acceptance request returns exact 409 with zero memory/disk change.
- Protocol contains no generic command/browser execution field; timing audit contains only bounded actor/before/after metadata.
- Config/API/protocol/audit tests, formatting, and negative dependency checks pass.

## Risk Assessment

| Risk | Impact | Mitigation |
|---|---|---|
| Full config/import changes host policy | Critical | Preserve/reject subsection; dedicated narrow mutation only |
| Workspace switch changes startup policy | Critical | Immutable startup registry path/enablement/enrollment |
| Timing update races final handoff | Critical | One coordinator admission order; 409 after acceptance |
| Disk/runtime/audit diverge | Critical | Audit admission, atomic pair write, commit ordering, reconciliation latch |
| Bounds permit abuse/overflow | High | Approved shared constants; server/helper revalidation |
| Actor/audit leaks data | High | Enabled-subject check; capped closed record; no content/raw errors |

## Security Considerations

- Never plan literal sudo/shell execution, password transport, arbitrary argv/path/device, or browser-supplied wake override.
- Cookie mutations require same-origin JSON; bearer callers still require authenticated enabled account. `--no-auth` is always forbidden.
- No role escalation or re-auth flow is added. Access is intentionally the normal enabled Settings actor limited to two validated integers.
- Timing audit is server-private and excludes tokens, IP unless separately approved, helper identity/details, terminal IDs/output/commands/cwd/env, and inhibitor text.
- Phase 3 still requires explicit security-owner/operator sign-off; revised planning validation is not that approval.

## Next steps

- Proceed to [Phase 02](./phase-02-pty-fleet-coordinator.md) with ordered timing commands and fake/unavailable execution only after second plan validation.
- Open Phase 3 only after the signed gate artifact is complete.

## Unresolved questions

- Exact quiet/wake defaults/min/max; retain proposed `wakeAfterSeconds = 600`?
- Required Linux/kernel/systemd/RTC matrix and precise inhibitor classes?
- Exact timing-audit path/retention and actor-length policy?
- Exact peer-enrollment proof, helper backend, and root audit retention?
- Which canonical-registry ownership/mode checks are mandatory when startup uses `--config` or a legacy workspace file?
