# Phase 04 — Three-hour coordinator, immediate consent and final handoff

## Context links
- [Overview](plan.md), [validated contract](contracts.md), [acceptance matrix](acceptance-matrix.md).
- Repository: `docs/agent-activity-automatic-admission.md`, `docs/terminal-idle-suspend-security.md`, `docs/api/idle-suspend.md`.
- Dependencies: Phase 02 qualified managed semantics + Phase 03 reliable presence + Phase 01 concurrency contract.

## Overview
- Date: 2026-10-10. Priority: P2. Estimated effort: 10h.
- Implementation status: completed. Review status: completed.
- User-validated arbitration: **first valid server-accepted decision wins; approval immediately starts fresh final checks**.

## Key Insights
- Current byte quiet/activity epoch is not continuous semantic free or refusal→repeat after three hours; new branch needed.
- Existing final ticket does not inspect semantic Working/Unknown; new policy cannot reuse byte-quiet authorization unchanged.
- Manual force is separate; automatic consent never invokes it or bypasses work/inventory checks.
- Current provisional claim-to-executor future gap needs final attempt-generation fence.

## Requirements
- All in-scope managed agents continuously free >10800s, monotonic scheduling; exact equality not eligible.
- Zero live/pending public clients -> automatic Final sample. Live clients -> one prompt. Pending-only upgrade temporarily blocks.
- First valid approve/deny latched atomically. Invalid answers do not settle; later contrary answers conflict, never veto accepted Yes or revive No.
- Approval immediately final-checks; no deliberate 60s wait, no quorum. Recommended 60s timer applies **only to unanswered** request.
- First denial/no answer/last disconnect -> another full >3h wait. Approver socket/session must still be valid before dispatch.
- Fresh semantic/lease/inventory/presence/timing/PTY fences and one existing helper request with unchanged automatic wake.

## Architecture
Coordinator owns free/wait/defer epoch, one consent request with nullable latched decision, unanswered deadline, single approval source, Final ticket, provisional claim and committed attempt. Watches managed evidence/lifecycle, public presence and timing; decisions use bounded existing command channel.

| Phase | Event / condition | Action / destination |
|---|---|---|
| Blocked/reconciling | Complete qualified in-scope free observation | New free anchor; Tracking |
| Tracking | Working/Unknown/lease loss/incomplete managed coverage/lifecycle-input invalidation | Clear continuity and request; Blocked |
| Tracking | Strict >3h, zero live/pending clients | Fresh Final sample; FinalCheck |
| Tracking | Strict >3h, positive live clients | One pending request with 60s unanswered timeout; AwaitingConsent |
| AwaitingConsent | First valid approve | Atomically latch Yes/close contrary answers; immediately revalidate/auth Final sample |
| AwaitingConsent | First valid deny | Atomically latch No; Deferred >3h |
| AwaitingConsent | Timeout with decision still null | Deferred >3h |
| Settled request | Later same decision | Idempotent outcome where still retained; no extra helper |
| Settled request | Later contrary decision | 409 decisionAlreadySettled; no state mutation |
| Pending/approved | Last client leaves or approver identity/session lost | Cancel authorization; Deferred >3h |
| Approved/FinalCheck | New client joins | Fresh presence fence; accepted Yes remains sufficient |
| No-client FinalCheck | New accepted upgrade/socket before commit | Reject stale zero-client ticket; require pending consent |
| FinalCheck | Current identity/lease/revision/safety mismatch | Reject/cancel, reconcile; zero helper |
| FinalCheck | All fences pass | Provisional PTY claim; pre-dispatch recheck |
| Provisional claim | Intervening safety/approver invalidation | Release claim; no helper |
| Provisional claim | Final gate passes | Irreversible commit, consume authorization, dispatch once |
| HandedOff | Resume/failure/inhibitor/helper rejection | Clear request/reconcile; new full qualified interval |
| Any uncommitted phase | Manual force/shutdown/timing mutation | Invalidate automatic intent; existing manual/shutdown behavior |

Existing top-level coordinator states remain; `agentFree.phase` names semantic phases and `scope:"managed-terminals"` makes coverage explicit. Do not present HTTP Yes acceptance as completed suspend.

## Related code files

| Action | Full path | Change |
|---|---|---|
| Modify | `/home/loidinh/WS/worktrees/dam-hopper-host-resources-auto-sleep/server/src/idle_suspend/coordinator.rs` | Semantic/free/defer epochs, first-decision latch, immediate final check |
| Modify | `/home/loidinh/WS/worktrees/dam-hopper-host-resources-auto-sleep/server/src/idle_suspend/status.rs` | Aggregate status and meaningful changes |
| Modify | `/home/loidinh/WS/worktrees/dam-hopper-host-resources-auto-sleep/server/src/idle_suspend/protocol.rs` | Consent DTO/outcomes/decisionAlreadySettled |
| Modify | `/home/loidinh/WS/worktrees/dam-hopper-host-resources-auto-sleep/server/src/idle_suspend/event.rs` | Privacy-safe decision/epoch/admission events |
| Modify | `/home/loidinh/WS/worktrees/dam-hopper-host-resources-auto-sleep/server/src/idle_suspend/server_audit.rs` | Audited decision/admission facts |
| Modify | `/home/loidinh/WS/worktrees/dam-hopper-host-resources-auto-sleep/server/src/pty/manager.rs` | Managed semantic final gate and provisional release |
| Modify | `/home/loidinh/WS/worktrees/dam-hopper-host-resources-auto-sleep/server/src/api/idle_suspend.rs` | Protected consent decision API, existing guards |
| Modify | `/home/loidinh/WS/worktrees/dam-hopper-host-resources-auto-sleep/server/src/api/router.rs` | Protected POST and body limit |
| Modify | `/home/loidinh/WS/worktrees/dam-hopper-host-resources-auto-sleep/server/src/api/ws.rs` | Revision hint and lag resync |
| Modify | `/home/loidinh/WS/worktrees/dam-hopper-host-resources-auto-sleep/server/src/state.rs` | Evidence/presence injection |
| Modify | `/home/loidinh/WS/worktrees/dam-hopper-host-resources-auto-sleep/server/src/main.rs` | Post-restore startup/shutdown order |

No new helper protocol/action/daemon/database table. Existing executor/helper remain side-effect authority.

## Implementation Steps
1. Use LSP references before exported edits and preserve legacy policy/manual branches. Introduce explicit new managed-semantic branch, not an old admission alias.
2. Track free/non-Free and wait/defer epochs. Complete in-scope zero can start at boot without seen_non_quiescent. Brief non-Free mutation resets even between polls; restart/resume reestablishes baseline.
3. Use monotonic deadlines/skipped ticks. Exact 10800s reschedules next observation tick; no ready sleep_until spin. Epoch-ms values display only.
4. On eligibility read live/pending presence under current revision. Pending-only waits for bounded upgrade resolution; zero both obtains Final sample; positive live opens one request with immutable issuance revision and current wake/timing generation.
5. Retain pending request in protected GET and broadcast revision-only hint. On lag emit bounded invalidation/resync; no credentials/actor/process inventory in push.
6. Add protected `/api/system/idle-suspend/v1/consent/decision`: strict 16KiB JSON, enabled production actor/session, existing cookie Origin/Bearer guards, exact current socket/capability binding. No no-auth workaround.
7. Serialize decision admission under coordinator/shared gate. Recheck pending UUID/issuance revision/deadline after asynchronous auth; atomically latch exactly one valid answer. First means actual acceptance order. Invalid or stale earlier calls cannot reserve the decision.
8. First Yes: close request to contrary decisions, record only accepting socket/session and immediately start fresh auth/managed-semantic Final preparation. Do not wait for unanswered timeout or collect further approvals.
9. First No: clear intent and start full >10800s defer. Later Yes returns already-settled conflict. Later No after Yes likewise cannot override it. Current exact duplicate may return idempotent outcome; one dispatch only. No automatic POST retry.
10. Unanswered timer fires only while decision=null. At deadline reject newly processed answers and defer >3h. Cancel timeout once Yes/No is accepted; it must not invalidate an approved request during final checks.
11. Last client loss/approver session or socket loss before dispatch clears authorization and defers; no request transfer to reconnected socket or second “approval set”. New clients after Yes refresh presence ticket, not quorum or decision. New clients before no-client dispatch force prompt.
12. Safety changes (Working/Unknown/lease/input/lifecycle/timing/manual/shutdown) cancel approved intent independently of arbitration. Timing change invalidates old request and restarts full interval; current wake used only in new request.
13. Obtain fresh Final evidence with bounded preparation/age (existing 1s/5s seams where appropriate). Revalidate approving account/session asynchronously then recheck current in-memory auth/socket fences; exact managed identities/current states/leases, strict epoch, inventory/presence/timing/input/fleet/consent revisions under canonical shared gate.
14. Take provisional PTY claim, recheck attempt generation immediately before first executor dispatch and release if invalidated. A later contrary consent is rejected, not a safety invalidation. Commit irreversible dispatch atomically with authorization consumption; no gate over helper I/O/await.
15. Use existing required audit ordering before side effects; semantic event writer alone is not audit authorization. One existing SuspendWithRtcWakeRequest with current automatic wake; preserve helper/peer/dedup/inhibitor/RTC checks. Approval is not force=true.
16. Reconcile every outcome/exit, clear decision/authorization/ticket, release lifecycle and start new full interval after baseline. No immediate retry/resleep. Preserve manual conflicts/force confirmation.
17. Add deterministic clocks/races and actual HTTP+public socket integration with recording executor. Test both answer orderings, simultaneous server acceptance CAS, auth delay reordering, late contrary conflicts, and approved-timeout cancellation.

## Todo list
- [x] Strict free/defer epochs and zero-agent startup.
- [x] Correct zero/pending/connected branch.
- [x] Atomic first-valid decision latch and protected API.
- [x] Immediate approval final checks; unanswered-only timeout.
- [x] Refusal/disconnect/auth-loss cooldown.
- [x] Fresh managed/presence/session final and dispatch fences.
- [x] Audit/helper/wake/manual preservation and recovery.
- [x] Deterministic race plus real-route/socket proof.

## Success Criteria
- C01–C29 have proof; invalid/refused/unanswered/Unknown/stale paths dispatch no helper.
- First Yes immediately starts Final check despite silent clients; late No conflicts. First No prevents later Yes; no waiting for 60s after approval.
- Exactly 3h does not qualify; transient work/lease loss before dispatch wins over prior free evidence.
- One helper request uses existing wake; resume/failure cannot loop; accepted REST decision is not hardware completion.

## Risk Assessment
- Faster approval is host-wide and cannot be withdrawn by another client; intentional user choice, explicit UI warning.
- Claim→dispatch gap: provisional/irreversible distinction and race tests, not just state strings.
- Local work after irreversible dispatch cannot be prevented by server locks; disclose/qualify signal boundary.

## Security Considerations
- Current account/session + exact socket capability/request revision; no browser-supplied eligibility/wake or ambient transport.
- Privacy-safe audit and bounded concurrency; no secret/raw provider content.

## Next steps
- Phase 05 immediate first-answer UI; Phase 06 integrated proof/rollout. No production opt-in until managed provider gates pass.

## Unresolved questions
- No user-policy questions. Native current-state source and reviewed concurrency/session fences remain engineering prerequisites.
