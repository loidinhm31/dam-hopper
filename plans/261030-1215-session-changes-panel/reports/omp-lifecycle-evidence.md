# OMP/PT​Y lifecycle evidence

Status: complete scout `OmpLifecycleEvidence`; terminal collected. Parent rechecked runtime.rs:380-425,535-585, collector.rs:1-145, adapter:440-490,730-805, installed OMP runner:130-155,1780-1820. Read-only source evidence; no runtime qualification.

## Ordering
- Installed local OMP source package versions 18.13.3. DamHopper docs/architecture/agent-status.md currently qualifies 18.4.1; do not equate source applicability with runtime backward compatibility.
- `/home/loidinh/WS/oh-my-pi/packages/coding-agent/src/modes/controllers/extension-ui-controller.ts:395-397`, interactive-mode.ts:2664,2728, main.ts:715-718,835-852: init awaits session_start before startup prompts and getUserInput loop.
- `src/session/agent-session.ts:5959-5963,11333,11454,12948,13111,13240`: new/fork/resume await session_switch while a session transition blocks prompts; switches do not emit session_start. Cancel/rollback paths exist.
- `src/session/agent-session.ts:8635,8680-8750,8978` and `src/extensibility/extensions/runner.ts:2366-2415`: prompt preflight awaits before_agent_start (prompt/revive), useful identity/failure fence, not permission to silently recapture an old session.
- `runner.ts:136,1757-1820`: handler budget 30 seconds; timeout/throws are reported and converted to failure result, not a guaranteed stop of the model turn. A Promise alone cannot guarantee tracking. Need explicit failure latch and stale/late capture publication fence. A timed-out registration must never later appear as complete original coverage.

## Current DamHopper seams
- `server/src/agent_status/assets/omp-agent-status.ts:738-767`: current root-interactive session_start/session_switch callbacks are synchronous and connect background WebSocket. They do not await snapshot readiness. Child agents/hasUI false are excluded.
- Adapter:354-410,454-487 uses 250ms settle delay, skips continuing/retry/compaction and sends semantic turn-ended with turnId/outcome. Use this settled callback rather than raw agent_end; blocked/error settled outcomes also need refresh. Never infer task success.
- `server/src/agent_status/runtime.rs:27,550-576`: current private collector path constant and `authenticate_bearer` returns terminal/incarnation only for active exact credential; no user JWT. New tracking control route can reuse this credential family on the same private listener, NOT public API middleware.
- `server/src/agent_status/collector.rs:30-41,54-72`: private loopback listener, strict host validation helper, router currently only status WS; semantic frames remain 4KiB and source-free. Separate bounded authenticated HTTP tracking controls; never send file bytes through status.
- `runtime.rs:398-414`: remove_terminal revokes producer credential/removes semantic row. **Do not blindly attach baseline deletion here**: PTY process-exit callers also use it, whereas approved baseline retention lasts until terminal removal/server lifetime. Separate process exit/status lease expiry from explicit terminal destruction or incarnation replacement.
- `server/src/pty/manager.rs:1520-1585,1737`: PTY create reserves incarnation/producer credential and injects collector URL/token. Retirement callers include remove_session:2660, shutdown:2775, kill_all:2815, kill_session:2957 and supervisor exit:3454; implementation must classify them by actual metadata removal/replacement semantics before cleanup wiring.
- `server/src/api/terminal.rs:175-235`: canonical target/cwd validation; extension cwd can select only inside validated bound target, not establish authority. Bind target at terminal creation, and revalidate if workspace changes.
- No existing explicit from-now tracking API. Required new operation with `origin: fromNow`; never overwrite an existing original or silently rebase expired/missing records.

## Required plan decisions
1. Readiness protocol must specify bounded registration nonce/deadline, no automatic retry after terminal failure, switched-session ordering, idempotent reconnect, late-capture invalidation and unavailable presentation when runner fails open.
2. Service ownership must span AppState/private producer collector/PT​Y lifecycle without locks over filesystem I/O; private controls derive terminal/incarnation from credential, public queries require normal authenticated account policy.
3. Settled refresh must cover any settled turn (not only idle), deduplicate exact turn ID, and reconcile after browser reconnect/open without source in status.
4. Baseline retained for exited-but-retained terminal; remove on actual terminal removal, workspace destruction or incarnation replacement. Browser generation replacement never deletes baseline.
5. Runtime acceptance must provision actual installed OMP 18.13.3 in managed PTY and prove first-turn bytes, timeout/unavailable and live browser Monaco flow. Local hook source inspection is not that receipt.

## Unresolved questions
No product decision. Protocol late-publication safety, resource defaults, exact storage/authorization DTOs and cross-shell host become explicit selected-plan contracts, subject to independent review.
