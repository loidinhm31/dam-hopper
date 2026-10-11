# Acceptance matrix — evidence required during implementation

All scenarios **pending**. Validated scope: DamHopper-managed terminals only; immediate approval and first valid server-accepted answer wins. Planning executed no application/provider/hardware tests. Labels are requirements, not existing test names.

## Semantic inventory and free-state authority

| ID | Scenario | Required observable result | Evidence owner |
|---|---|---|---|
| A01 | One quiet agent remains Working >3h, no UI | No helper call; Working blocker visible | Phase 02/04 runtime |
| A02 | Idle plus Blocked approval/question/error | Continuous free interval advances; blocked still explicitly waiting | Phase 02 runtime/live providers |
| A03 | Idle↔Blocked or same-state actual heartbeat | Free anchor preserved; authority renews from real current evidence | Phase 02 runtime |
| A04 | Unknown, disconnected, expired authority; sweeper has not run | No automatic admission; lease checked at commit | Phase 02/04 runtime |
| A05 | Working→Idle occurs between sampler ticks | Previous interval invalidated, full new wait | Phase 02 runtime |
| A06 | Multiple agents in one terminal; one Working/Unknown | Host blocked independently of aggregated badge | Phase 02 runtime/live fixture |
| A07 | Managed/traditional agents plus independent external SSH/tmux/headless agent | All managed identities considered; independent external work deliberately excluded and warning visible | Phase 02 Linux discovery |
| A08 | Complete scan returns zero agents at startup | New interval starts without prior-work requirement | Phase 02/04 runtime |
| A09 | Zero apparent agents but scan/access/namespace/grammar incomplete | Unknown/incomplete, not zero/free | Phase 02 Linux discovery |
| A10 | Forged PID, PID reuse, image replacement, shared peer FD, wrong UID/ancestry | Association rejected; no stale authority | Phase 02 identity |
| A11 | Detached/nested/subagent process remains active | Retained/child coverage not lost; no parent-Idle shortcut | Phase 02 provider/identity |
| A12 | Native hook idle/blocked evidence lasts >15s | Expires Unknown unless genuinely refreshed qualified source exists | Phase 02 native live gate |
| A13 | OMP reporter traffic and harmless redraw continue | New semantic timer not reset by bytes; old agent-activity still resets | Phase 02/04 policy comparison |
| A14 | Unsupported provider/version or configured agy inside managed lineage | No fabricated free state; visible in-scope coverage blocker | Phase 02 live qualification |

## Clock, presence, consent and handoff

| ID | Scenario | Required observable result | Evidence owner |
|---|---|---|---|
| C01 | 10799s, exactly 10800s, then >10800s | First two never eligible; only third can proceed | Phase 04 deterministic clock |
| C02 | Wall clock jumps forward/back | Scheduling/leases unchanged; display may shift only | Phase 04 clock |
| C03 | Qualified free >3h, zero live/pending clients | Fresh final sample then one automatic helper request | Phase 04 safe executor smoke |
| C04 | Public websocket connected, Host Resources closed | Request visible through always-mounted host; no premature helper | Phase 05 actual app |
| C05 | Private OMP websocket / hook UDS / SSE only | Not public client presence; no false consent requirement | Phase 03 real sockets |
| C06 | Failed/abandoned authenticated upgrade | Reservation released; no leaked live count or zero-client race | Phase 03 real sockets |
| C07 | Reader EOF, writer failure, panic/cancel, auth expiry/revoke, shutdown | Exact socket retired once; receipt and its approval revoked | Phase 03 real sockets |
| C08 | Hidden/old browser protocol Pong | Remains counted; JS visibility not used | Phase 03 browser |
| C09 | Blackholed peer, server 30s Ping / 90s deadline | Definite teardown, no stale count; long FS work not false timeout | Phase 03 real sockets |
| C10 | Two connected users, only one approves, other silent | Immediate fresh final checks with no 60s wait; unanswered timer cancelled | Phase 04/05 app |
| C11 | Decision still null at 60s deadline | No helper; another full >3h wait even if agents stay free | Phase 04 clock |
| C12 | No→Yes, Yes→No and simultaneous answers/auth-delay reordering | First valid server acceptance latched; later contrary answer 409 without override | Phase 04 race |
| C13 | Deny after irreversible dispatch | Conflict/handoff-in-progress; no fake cancellation claim | Phase 04 race |
| C14 | Last live client disconnects during pending/approved prompt | No immediate zero-client suspend; full >3h defer | Phase 04 real sockets |
| C15 | First approving socket disconnects while another socket stays live | Accepted source invalidated, no helper; full new wait/request, no approval transfer | Phase 04 real sockets |
| C16 | Approving user disabled/session revoked/auth store unavailable | Cannot authorize handoff; no stale Yes | Phase 04 auth integration |
| C17 | New socket joins pending request or after first approval | Pending same deadline/receipt; settled Yes stays sufficient while final presence rechecked | Phase 03/04 integration |
| C18 | Socket joins between zero-client sample and commit | Stale ticket rejected; consent branch selected before dispatch | Phase 04 controlled race |
| C19 | Reload/reconnect same login session | New receipt; old connection decision rejected; current GET catches request | Phase 03/05 app |
| C20 | Stale UUID/revision, wrong actor/session/socket/capability | 403/409 and zero helper calls; no cross-socket approval | Phase 04 API |
| C21 | Malformed/oversized body, cookie wrong Origin, no-auth | Guarded 4xx; mutation never enters coordinator | Phase 04 API |
| C22 | Duplicate current action, lost HTTP response | No duplicate helper; no automatic POST retry; GET reconciles | Phase 04/05 app |
| C23 | Working/Unknown/lease expiry during scan, claim, pre-dispatch gap | Pending consent/ticket/claim cancelled; zero helper dispatch | Phase 04 controlled race |
| C24 | Timing update/manual force/shutdown races automatic request | Old consent invalidated; existing manual conflict/admission preserved | Phase 04 integration |
| C25 | All fences pass | Exactly one helper request with existing automatic wake duration | Phase 04 recording executor |
| C26 | Audit unavailable, capability unsupported, inhibitor/helper/RTC rejection | Fail closed; no alternate shell suspend path | Phase 04 boundary |
| C27 | Resume/failure then agents remain free | Reconcile baseline, new full interval; no immediate resleep loop | Phase 04 clock/integration |
| C28 | New-mode config with quiet 900; reload/import/workspace change | Invalid duration rejected; startup-owned policy preserved | Phase 01 config |
| C29 | Old policy and manual ForceSleepDialog regression | Legacy quiet/output/TCP and force confirmation/wake unchanged | Phase 04/05 regression |

## Shared UI, ownership and privacy

| ID | Scenario | Required observable result | Evidence owner |
|---|---|---|---|
| U01 | Two servers with same project/request-looking IDs; inactive profile prompt | Correct host labeled; actions route exact captured owner | Phase 05 authenticated app |
| U02 | Switch/remove profile or replace generation during POST | Late result discarded; no replacement/ambient POST | Phase 05 ownership |
| U03 | Prompt before UI subscription or broadcast lag | Stored receipt + authoritative GET/resync recovers request | Phase 03/05 app |
| U04 | Desktop/compact, IDE/traditional, web/native shared UI | One prompt host, no dependency on open popover or mounted terminal | Phase 05/06 actual surfaces |
| U05 | Escape/X/outside click before/after settled answer; focus | Pending deny once; settled dismissal sends no contrary answer; no terminal leakage | Phase 05 Chromium |
| U06 | Cognito active or hidden tab | No content/input leakage and no synthesized answer; server handles timeout | Phase 05 Chromium |
| U07 | Unknown/null counts, malformed or partial DTO | Unknown rendered truthfully or decoder error; never zero/free | Phase 01/05 decoder/UI |
| U08 | Multiple different host requests/duplicate aliases | Deterministic queue; no shared approval without proven server identity | Phase 05 app |
| U09 | Secrets/protected process data in logs/audit/global GET/broadcast | Socket capabilities/JWT/argv/transcripts never disclosed | Phase 06 security review |
| U10 | Full-viewport fresh captures plus human review | Recorded ACCEPTED/REJECTED; green CI not a substitute | Phase 06 visual gate |

## Unresolved questions
- Managed native continuous semantic authority and managed-root/retained visibility remain qualification gates. Synthetic state/HTTP tests cannot satisfy A11/A12/A14 or certify hardware suspend. Independent external agents are intentionally excluded, not an unresolved discovery requirement.
