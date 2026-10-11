# Automatic sleep — validated product and technical contract

Status: planning only. User choices below override earlier research proposals. No application implementation.

## Frozen decisions

| Decision | Contract | Authority |
|---|---|---|
| Free agent | `idle` or `blocked` (approval/question/error) | User selection |
| Busy / uncertain | `working`, Unknown, expired, disconnected, unavailable or ambiguous evidence blocks | User request and selected free-state rule |
| Threshold | Continuous qualified free interval strictly **greater than 10,800 seconds** | User request |
| Agent scope | **DamHopper-managed terminals only**, including traditional UI terminals and retained descendants from those terminals | Validation selection |
| External agents | Independent SSH/tmux/headless/OS-terminal agents outside managed lineage **do not prevent sleep** | Explicit narrower scope selected by user |
| No public client | Automatic final check/helper suspend | User request |
| Connected client | Explicit UI prompt; any enabled authenticated user may approve | User selection |
| Approval delay | **Proceed immediately to final checks after approval**; no intentional denial window | Validation selection |
| Conflicting answers | **First valid decision accepted by the server wins**; later contrary answer cannot override it | Validation selection |
| Refusal / unanswered | Another full three-hour wait; no immediate sleep after last client disconnects | User selection plus safe disconnect rule |
| Wake | Existing automatic `wakeAfterSeconds`; manual choices unchanged | User selection |

Recommended engineering constants, not user-selected settings: unanswered prompt expires after 60s; server Ping every 30s / matching-Pong deadline 90s. Approval does not wait for the unanswered timeout.

## Scope and enablement

- Add startup `automatic_policy = "agent-free"`; reuse `enabled`, enrollment, capability and executable matching. Default stays disabled / `empty-fleet`. Existing `agent-activity` is a different heuristic mode, not an alias.
- New mode requires `quiet_period_seconds=10800`; reject other values at startup and dedicated timing PATCH. Do not silently use existing 900s default or overwrite wake. UI quiet is read-only 3h; current bounded wake pair remains mutable.
- Reload/import/workspace changes preserve startup-owned policy. No new runtime policy toggle, sleep daemon, database table or browser scheduler.
- Coverage is every backend managed PTY, independent of open tabs, UI mode, profile presentation or terminal mounts. Reuse existing managed-root discovery and retained exact-identity lineage. Ordinary shells are not Unknown agents.
- Recognize configured agent executables in managed lineage; evaluate every independent live matching agent and any unresolved semantic owner. Unsupported/unobserved matching agents block. A complete zero-agent scan in this scope qualifies, including startup without prior work.
- **No host-wide matching/enrollment** and no external agent credentials in this feature. Clearly label status/prompt/runbook: “Tracks DamHopper terminals only; external work does not block sleep.” A global topology scan used for managed ancestry does not expand eligibility scope.
- Managed background/subagent work must be covered by verified parent semantic state or independent evidence; retained managed descendants remain covered until validated exit. Do not drop them solely because shell/tab disappears.
- Native Codex/Claude continuous semantic authority is still a hard gate. Existing 15s hook observations cannot prove three hours free. No lease stretching, cached-state heartbeat, delayed Stop=>Idle, CPU/byte quiet, screen/transcript or task-success inference.

## Semantic evidence and timer

- Private agent key: exact PID/start_ticks/image identity, managed terminal/incarnation, provider session/reporter epoch and accepted sequence. Terminal capability alone does not prove which matching process owns a report.
- Preserve existing public badge/notification semantics and short evidence leases. Add private suspend-specific per-process evidence; public aggregate terminal rows are not admission authority.
- OMP needs verified process association and real current-state refresh. Multiple agents in one terminal cannot share a single Idle row as proof. Native refresh must use a real provider current-state source, not stored hooks.
- Update private non-Free generation at mutation time: a brief Working→Idle transition between sampler polls resets the full interval. Check internal freshness at admission even if sweeper has not run.
- Working, Unknown, owner loss/replacement, incomplete inventory, restart, accepted nonempty PTY input or managed lifecycle uncertainty clears `freeSince` and cancels uncommitted consent/tickets. New interval begins only when scope is qualified again.
- Idle↔Blocked and genuinely renewed same-state authority preserve free interval. Raw output/TCP reporter heartbeat is not semantic Working and cannot itself reset the new timer; byte rules remain in legacy `agent-activity`.
- Monotonic clocks authorize leases/free/defer/response timeout. Epoch timestamps display only. Require `now > freeSince + 10800s`; exact equality cannot arm handoff, and next-tick scheduling must avoid a ready-deadline busy loop.

## Public client presence

- Track authenticated public `/ws` only. Private OMP reporter WS, hook UDS, REST polling, resource SSE, tunnels and PTY attachments do not count.
- Reserve authenticated pending upgrade under admission fence; count live only after successful upgrade. Pending-only admission blocks direct no-client handoff until bounded success/failure. Failed/abandoned upgrade releases reservation.
- Every accepted public client counts, including old versions, hidden tabs, non-subscribed clients and authorized non-browser clients. No `isUi` body flag or broadcast subscriber count is authority.
- Bounded memory registry owns opaque socket ID, capability digest, actor subject/session/auth versions/deadline and liveness/closing state. Public projection: live/pending counts, availability, membership revision only.
- Send fresh high-entropy decision capability **only to that socket**. Never global status/broadcast, URL, logs, persistence or localStorage. Bind it to exact socket + authenticated subject/session/version.
- RAII pending/live guards retire exactly once on failed upgrade, reader/writer failure, Close, auth cancellation, heartbeat timeout, task cancellation or shutdown. Reconnect replaces identity; old cleanup cannot remove replacement/sibling socket.
- Proposed protocol Ping/Pong deadline uses monotonic time and browser automatic Pong; long application handler dispatch must not starve control reading. Uncertain/overflow presence is a blocker, never zero.

## Consent lifecycle — immediate, first valid decision wins

1. At qualified >3h eligibility, zero live/pending sockets selects automatic Final check; positive live sockets opens one request retained in authoritative GET. Pending-only upgrades temporarily block without prompting nobody.
2. Recommended unanswered timeout: 60s from request opening. Display it as response deadline, **not approval delay**. New joining sockets read the same pending request and do not extend it.
3. The first valid `approve` or `deny` is latched atomically at serialized coordinator admission. “First” means server acceptance order, not click time or HTTP arrival before asynchronous authentication completes. Invalid/stale/unauthorized answers do not settle anything.
4. First approve: close request for contrary decisions, record its single approving socket/session, publish approved/final-check phase and **immediately** obtain fresh semantic/auth/presence evidence. No quorum and no waiting for other users or remaining 60s.
5. First deny: close request, clear authorization and defer another full >10800s qualified-free wait. Later approve cannot revive it. First approve likewise cannot be overturned by a later deny, even before irreversible helper dispatch.
6. Subsequent same-action retry may return idempotent current outcome; contrary action returns `409 decisionAlreadySettled` and current status. No automatic POST retries; lost response reconciles GET. No indefinite replay/tombstone store.
7. Timeout while still unanswered cancels and defers another >3h. Last client leaving while pending/approved also cancels/defer; never unanswered→no-client immediate suspend. Approving socket/session loss before dispatch invalidates authorization and requires new interval/request, not migration to replacement socket.
8. Joins after approval do not require more approvals or reopen request; refresh final presence ticket. A join racing **no-client** Final check invalidates that route and forces pending consent before dispatch.
9. Working/Unknown/lease expiry, relevant lifecycle/input/timing mutation, manual force/shutdown or helper claim conflict cancels uncommitted automatic intent regardless of approved decision. First-answer arbitration never bypasses safety.
10. Explicit X/Escape/outside dismissal sends deny only while request is pending. After settled approval it merely closes presentation; no misleading “cancel sleep” action. Failed delivery cannot fabricate denial/approval. Unmount/visibility/Cognito/disconnect never sends approve.
11. Irreversible dispatch is explicit. Post-dispatch socket/decision arrives too late and reports host-suspending/handoff-in-progress; UI never promises cancellation of helper already sent.

## Wire contract

Keep current protected status/timing/manual-force routes and top-level coordinator state enum. New `agent-free` policy is an intentional closed-enum extension requiring coordinated UI/server upgrade. Never project it as old policy or normalize malformed new data to eligible.

- `activity` remains non-null only for `agent-activity`.
- `agentFree`: nullable object for new mode with `{phase, scope:"managed-terminals", inventoryState, inventoryRevision, semanticRevision, idleCount, blockedCount, workingCount, unknownCount, freeSinceMs, eligibleAtMs, deferredUntilMs, reasonCode}`. Unknown counts null. Phases: blocked/tracking/awaitingConsent/approved/finalCheck/handedOff/deferred/reconciling. Disabled never arms.
- `clientPresence`: `{connectionCount,pendingUpgradeCount,revision,available}`.
- `consent`: nullable `{requestId,requestRevision,state,requestedAtMs,expiresAtMs,decision,wakeAfterSeconds}`. Decision null until accepted, then approve/deny; no actor/socket secret in GET.
- Valid old-server legacy response with all new structures absent retains unavailable facts, not fabricated zero/approval. New mode requires complete consistent structures; partial/malformed fields error. No fallback after network/auth failure.
- Per-socket frame `{"kind":"host:uiConnection","version":1,"connectionId":"opaque-id","decisionCapability":"socket-secret"}`; receipt retained only in exact transport memory/generation.
- `host:idleSuspendChanged` remains revision-only hint. Protected GET on mount/connect/receipt/invalidation/lag-resync is authoritative; no extra browser eligibility scheduler.
- `POST /api/system/idle-suspend/v1/consent/decision`: strict JSON `{requestId,requestRevision,connectionId,decisionCapability,decision:"approve"|"deny"}`. Require safe revision, bounded 16KiB body, application/json, current enabled authenticated actor/session, live capability binding and existing cookie Origin/Bearer guards. Deny no-auth.
- `200` means accepted decision/current outcome, not completed physical suspend. `409` stale/expired/cancelled/contrary-settled/replaced-socket/handoff conflict; generic `403` invalid binding/capability; reuse 401/403/415/503 guard/unavailable patterns. All no-store.
- Client profileId/generation remain local ownership selectors, never server identity fields. Capture request/socket/profile generation at render and recheck after every await.

## Final admission and irreversible dispatch

1. Obtain fresh bounded managed-inventory/semantic sample and internal lease proof; do not reuse prompt-creation sample. Require strict >3h, complete scope, every matching agent free, current timing/capability.
2. If approved, revalidate original approving account/session asynchronously; then recheck its in-memory revocation/socket fences at commit. No database/network/procfs work under synchronous lock.
3. Use one short admission gate shared by authoritative semantic mutations, public socket admission/removal and automatic final commit. Check exact identities, inventory/semantic/non-Free/free-wait/presence/consent/timing/PTY/input revisions, evidence age and lifecycle; take existing PTY handoff provisionally.
4. Audit canonical lock order in Phase 01; remove inversions. No locks across await/I/O, no try-lock-assume-free, no independent boolean reads passed off as transaction.
5. Current code queues executor future after claim. Recheck attempt generation immediately before first dispatch; invalidate/release on intervening Working/Unknown/lease/input/lifecycle/presence/approver loss. Contrary late consent is rejected under settled-decision rule, not an invalidation.
6. Commit irreversible dispatch and consume authorization once; send exactly one existing `SuspendWithRtcWakeRequest` with current automatic wake. Approved consent is not force=true and bypasses no audit/helper/peer/inhibitor/RTC safety gate.
7. Define safety linearization: accepted Working before commit always prevents dispatch; local/provider work beginning after irreversible OS handoff cannot be prevented by server locks. Do not overclaim this boundary.
8. Resume/failure clears request/authorization, releases/reconciles actual scope/presence and starts new full qualified interval. No immediate retry/resleep loop. Legacy once-per-activity-epoch rules remain unchanged.

## Operational boundaries and unresolved prerequisites

- Plan/tests never call real helper, RTC/root installer or systemctl suspend. Safe runtime uses real routes/sockets/auth/provider observations plus recording executor. Hardware qualification needs explicit operator maintenance window and rescue/wake access.
- Keep new mode disabled until native managed-provider current-state source/freshness, managed child coverage, process peer identity and admission/session fences qualify. Existing Codex/Claude 15s hooks alone are insufficient; no silent OMP-only completion claim.
- Managed proc permissions/namespace visibility must be qualified. Independent external agents are deliberately excluded, not an unknown blocker or missing implementation item; operator owns this machine-safety tradeoff.
- Rollback: disable startup auto sleep and restart. Preserve current wake/manual actions; never silently fallback to legacy automatic mode after a safety failure. Consent is memory-only.
