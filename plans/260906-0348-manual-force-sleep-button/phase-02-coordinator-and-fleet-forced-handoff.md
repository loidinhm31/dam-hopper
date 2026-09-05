# Phase 02 — Coordinator and Fleet Forced Handoff

## Context Links

- [Parent plan](./plan.md)
- [Phase 01 protocol/helper semantics](./phase-01-protocol-and-helper-indefinite-sleep.md)
- [Existing fleet/coordinator phase](../260824-0312-terminal-idle-suspend/phase-02-pty-fleet-coordinator.md)
- [System architecture](../../docs/system-architecture.md#server-authoritative-terminal-idle-suspend-architecture)
- [Code standards: async locks](../../docs/code-standards.md#async-patterns)

## Overview

- Date: 2026-09-06
- Priority: P1
- Status: Pending
- Effort: 8h
- Description: Add an audited coordinator command and a narrowly scoped forced fleet claim so explicit users may suspend with active managed terminals without weakening automatic quiescence safety.

## Key Insights

- `PtyFleetState::try_claim_handoff` correctly requires quiescence and a matching generation. Altering it globally would make automatic idle suspend unsafe.
- The forced path must bypass only the quiescence predicate. Closing, disposal, existing handoff, generation mismatch, audit, helper capability, inhibitor, and RTC checks remain mandatory.
- Active work is content-free `live + creating + restartPending`; it includes builds run in managed PTYs but does not claim to discover arbitrary host processes.
- The coordinator already serializes timing commands, automatic deadline claims, fleet changes, and in-flight outcomes. Manual admission belongs in that task to define one winner.
- Manual suspend must work when automatic idle policy is disabled. Executor enrollment therefore depends on helper enrollment/socket, not `idle_suspend.enabled`; the automatic state machine still stays disabled.
- A durable actor intent record must precede handoff. Audit failure is authorization failure and causes no gate or executor side effect.

## Requirements

### Functional

- Add `try_claim_forced_handoff(expected_generation)` beside the existing normal claim. Require matching generation and deny closing, disposal, or an active handoff.
- Add the corresponding `PtySessionManager` wrapper; do not expose it to PTY APIs, browser events, host-resource alerts, or generic host actions.
- Add `ForceSuspendCommand { actor, wake_after_seconds, force }` and a one-shot reply through the existing bounded coordinator channel.
- Validate manual wake seconds as `0 | 60..=86400` in the coordinator even if the API already validated.
- For active fleet plus `force == false`, return `ActiveFleetRequiresConfirmation` with the authoritative content-free snapshot and no handoff/executor call.
- For `force == true`, permit active fleet but use the snapshotted generation. A changed generation returns a conflict; never silently apply force to a different reviewed fleet state.
- For quiescent fleet, use the ordinary handoff claim even if `force` was supplied; audit the requested and effective force values.
- Cancel any automatic arm only after manual admission is ready to claim. Automatic deadline, timing update, and manual command ordering must have one deterministic winner.
- On accepted claim, publish `HandedOff`, reply with request ID/revision/snapshot, then run exactly one immutable helper request. Outcome releases the handoff and emits the existing revision hint.
- Permit later explicit manual requests after outcome/resume; do not change automatic one-attempt-per-empty-epoch behavior.
- Record bounded server audit events for admission attempt, accepted handoff, rejection code, and terminal outcome. Include actor, request ID, wake seconds, requested/effective force, generation, count breakdown, and typed result only.

### Non-functional

- Never hold the PTY manager lock across capability probe, audit I/O, executor await, or any `.await`.
- Use generation fencing after audit I/O. If state changes, return conflict or updated confirmation; do not retry automatically.
- Keep coordinator channel bounded and single-flight. Concurrent manual actions/timing updates receive deterministic typed results.
- Server audit and root helper audit stay separate. Neither stores terminal IDs/content, commands, cwd, env, browser credentials, raw helper errors, or inhibitor identity not already approved.
- Manual execution is production-routed but remains unavailable under missing helper/capability; no local fallback.

## Architecture

```text
ForceSuspendCommand
  -> validate wake domain and coordinator/shutdown state
  -> bounded capability probe
  -> snapshot fleet generation/counts
  -> active && !force => confirmation-required(snapshot)
  -> durable actor admission audit
  -> claim(expected generation):
       quiescent => try_claim_handoff
       active && force => try_claim_forced_handoff
  -> cancel automatic arm; publish HandedOff/revision
  -> reply Accepted (202 adapter can return)
  -> execute immutable helper request once
  -> record terminal outcome; release handoff; publish revision hint
```

Use a separate forced method rather than an optional flag on the existing normal claim. This preserves a mechanically reviewable call graph: automatic deadline code cannot accidentally import the bypass.

## Preflight Contract

1. Coordinator exists and is not shutting down; helper capability probe succeeds within a bounded timeout.
2. Manual wake domain is valid; actor and request ID are bounded.
3. Capture one authoritative snapshot and derive active count from its three counters.
4. Require `force` when that snapshot is active.
5. Sync the server actor audit for that exact generation before claiming.
6. Claim the same generation through normal or forced method; reject any race.
7. Publish handoff before dispatch so new create/restart admission is blocked.
8. Delegate peer/inhibitor/RTC/audit preflight to the helper; release on every outcome/failure.

## Related Code Files

| Path | Action | Purpose |
|---|---|---|
| `server/src/pty/fleet_state.rs` | Modify | Add generation-fenced forced claim that bypasses only quiescence |
| `server/src/pty/manager.rs` | Modify | Add narrow coordinator-only wrapper and release coverage |
| `server/src/idle_suspend/coordinator.rs` | Modify | Add force command/result, ordering, admission, dispatch, and outcome reconciliation |
| `server/src/idle_suspend/status.rs` | Modify | Represent manual handoff/outcome detail without exposing actor or terminal identity |
| `server/src/idle_suspend/timing_audit.rs` | Move/replace | Generalize server-side idle-suspend audit storage without duplicating secure JSONL code |
| `server/src/idle_suspend/server_audit.rs` | Create | Tagged timing/manual records with shared bounded actor and durable append policy |
| `server/src/idle_suspend/mod.rs` | Modify | Clean-cutover exports for command/result/audit types |
| `server/src/state.rs` | Modify | Own and inject the generalized server audit into coordinator |
| `server/src/main.rs` | Modify | Enroll helper executor independently of automatic idle-policy enablement |
| `server/src/idle_suspend/tests.rs` | Modify | Unit-test fleet claims, command races, audit failure, and state transitions |
| `server/tests/idle_suspend.rs` | Modify | Cross-module command/fleet/executor integration coverage |

## Implementation Steps

1. Add a shared internal claim precheck for closing/disposal/handoff/generation, then keep distinct public `try_claim_handoff` and `try_claim_forced_handoff` entrypoints.
2. Preserve the normal claim’s quiescence check unchanged. Add tests proving automatic callers cannot use the forced path.
3. Define `ForceSuspendCommand`, `CoordinatorForceSuspendResult`, and `CommandMessage::ForceSuspend { command, reply }` with closed variants.
4. Generate a server-side `manual-<uuid>` request ID; never accept request IDs from the browser.
5. Generalize the existing server audit writer into `server_audit.rs`, migrate timing callers, and add tagged manual records. Preserve the existing root helper audit boundary.
6. Implement coordinator preflight and generation-fenced claim. Return the latest counts on active/no-force or changed-to-active conflicts.
7. After claim, clear automatic arm metadata, set `HandedOff`, increment/publish status revision, install the in-flight executor future, and reply accepted without awaiting resume.
8. Reuse outcome reconciliation to record completion, release the gate, and invalidate status. Ensure all early/error branches leave or restore the prior automatic arm safely.
9. Change startup executor selection so a valid enrolled helper can serve manual actions when automatic scheduling is disabled; missing socket always selects `UnavailableExecutor`.
10. Add deterministic tests for quiescent/manual, active/no-force, active/force, generation race, audit failure, capability failure, concurrent timing/manual, automatic deadline/manual, duplicate clicks, shutdown, and outcome release.

## Todo List

- [ ] Add separate forced fleet claim
- [ ] Add manager wrapper and negative dependency coverage
- [ ] Define coordinator force command/result contract
- [ ] Generalize server idle-suspend audit writer
- [ ] Implement active-count confirmation result
- [ ] Serialize manual action with timing and automatic deadline
- [ ] Enroll executor independently of automatic enablement
- [ ] Publish accepted handoff and reconcile every outcome
- [ ] Add fake-time/fake-executor race tests

## Success Criteria

- Existing automatic deadline code still fails unless the fleet is quiescent and generation matches.
- Active/no-force returns exact counts and performs no handoff, executor call, RTC action, or automatic retry.
- Active/force can claim only the reviewed generation and blocks subsequent terminal starts until outcome release.
- Audit write failure and capability failure produce zero claims/executor calls.
- Exactly one helper request is emitted for one accepted command; repeated UI/network behavior cannot duplicate it.
- Manual action remains available with automatic policy disabled when the helper is enrolled, while automatic arming remains disabled.
- Timing/manual/deadline races have deterministic winners and never leave `handoff_active` stuck.

## Risk Assessment

| Risk | Impact | Mitigation |
|---|---|---|
| Automatic flow gains force bypass | Critical | Separate method, restricted callsite, negative dependency test |
| User confirms stale fleet count | High | Generation fence and explicit conflict; no automatic retry |
| Audit claims action that never occurred | High | Tagged attempt/accepted/outcome states tied by request ID |
| Accepted action lacks actor audit | Critical | Sync pre-action audit before claim; audit failure blocks dispatch |
| Disabled automatic policy prevents manual action | High | Decouple helper enrollment from automatic arming |
| Gate remains active after error | Critical | One outcome/release path; tests for every result and shutdown |

## Security Considerations

- `force` authorizes only active-fleet override for this one request. It never bypasses authentication, origin, audit, capability, inhibitors, RTC policy, peer identity, or fixed action shape.
- Never copy session IDs or other PTY maps into the command, result, status, or audit.
- Do not expose the forced claim wrapper through generic public APIs.
- Do not allow automatic retry after generation conflict, executor failure, or lost response.
- Cap actor/request/detail fields and store no session cookie, bearer token, IP-derived secret, terminal content, or raw IPC.

## Side-Effect Review Checklist

- [ ] Automatic arm/deadline semantics unchanged outside explicit command ordering.
- [ ] Forced claim does not kill, restart, detach, or inspect active terminals.
- [ ] New create/restart rejection exists only during accepted handoff.
- [ ] Every failure before claim leaves `handoff_active == false`.
- [ ] Every outcome after claim releases the gate exactly once.
- [ ] Status hints remain invalidation-only and contain no actor/action payload.

## Next Steps

- Expose the closed authenticated transport adapter in [Phase 03](./phase-03-rest-api-force-suspend-endpoint.md).