# Phase 01 — Backend authority and lifecycle

## Context links
[Overview](plan.md) · [LA report](../reports/evc-code-reviewer-261109-2251-lifecycle-admission.md) · [OSQ report](../reports/evc-code-reviewer-261109-2251-os-selection-qualification.md) · [Security research](../reports/evc-researcher-261109-2251-cdp-security.md) · [Original contracts §§1–5,9–11](../261108-0237-host-browser-cdp-streaming/architecture-contracts.md).

## Overview
Date: 2026-11-09 · Priority: P1, then P2 bounds/recovery · Status: in-progress/partial (4/5 tasks complete; Windows blocked) · Effort: not estimated. Single integration owner serializes shared writes.

## Key Insights
- Reproduced: LA:L1 dev target/subresource bypass and LA:L9 Host reflection. Remaining LA/OSQ findings below are static; their fault/race outcomes require execution. No production metadata access or bearer exfiltration claimed.
- Existing lock inode, pre-reserved actor commands and worker-before-async-reset order survive; fix current publication owners rather than duplicate registries. Native Windows is presently unavailable, not qualified containment.
- Finding map: `secure-browser-admission` ← LA:L1,L9,L11,L12,L14; `reconcile-native-targets` ← LA:L2,L3,L4,L5,L8,L13; `persist-reset-recovery` ← LA:L6,L7,L10; `secure-artifact-logout` ← OSQ:S1,S2,S3,S4,L1. OSQ:L2 is Phase 03. OSQ:Q5 Windows prerequisite → `implement-windows-containment` plus Phase 04 proof.

## Requirements
- Live enabled-Admin authority, exact Origin including empty/malformed denial, actual listener AND peer loopback for dev; forwarded headers never authority. Trusted parsed public http(s) origin only; derive ws(s), reject missing/invalid authority, userinfo/path/query/fragment.
- Install central configured target/asset/destination policy before first managed navigation; cover redirect/subresource requests, reject broad dev-loopback permission. Keep explicit raw-CDP/network-isolation caveats.
- One native/logical capacity owner covers startup blank page, REST/raw creates, popups, destruction and crash; configured global caps apply before retention. Preserve pending/failed/Closing identity through ambiguous outcomes and idempotent retries.
- Reset/logout cancel or drain in-flight creates and recheck live principal/epoch/incarnation at publication; no old-epoch resurrection. Retired sessions expire after required retry TTL, not while retry results remain promised.
- Under retained lock, reconcile persisted containment identity before launch; ambiguous ownership stays CleanupPending. Durable intent/epoch, credential deletion and completion require restrictive creation, file sync, atomic rename and directory durability barriers; never acknowledge unsynced success.
- Final artifact handoff must validate current navigation/reset/selection/auth/deadline immediately at synchronous incarnation-checked PTY write. Failed unlink retains charged cleanup ownership; artifact terminal paths retire selection registrations. Logout confirms only the exact identified credential actually revoked, without sending saved Bearer over insecure remote HTTP.
- Preserve V1 Cancel-first/no-preselected keep-or-clear, revoke FIRST, sibling warning, epoch/Origin/consent gates and cooperative artifact admission. Windows Job/DACL implementation and native proof remain required, not dropped scope.

## Architecture
Verified bound listener → admission/ticket authority → existing manager principal transaction → SessionRegistry/native target observation → producer/input/selection retirement. Native events update this same owner, not gateway-only telemetry. Create commits one producer/native identity; close releases capacity only after positive absence. Reset owns durable cleanup until completion; tombstone overrides stale completed metadata. Selection final authority and PTY mutation share ordered fences without await gaps after final validation.

## Related code files
Modify only task `allowed_files` below: existing Rust admission/manager/process/profile/session/CDP/API/artifact owners, auth client and their regressions. Planned new code only if needed inside listed existing domain directories; no parallel manager, sidecar or product docs created here. Native dependency edits confined to server Cargo manifest/lock. No unrelated deletions; remove only obsolete duplicated target bookkeeping after callers migrate. Maintained docs/changelog owned by Phase 04.

## Implementation Steps
### secure-browser-admission
1. Capture real bound listener in AppState/main; unify REST/discovery/upgrade Origin checks and parsed trusted public authority. Wire Fetch/Network policy before navigation using Browser config, not CORS.
2. Prune/check/insert tickets atomically; deduplicate auth checks by login and bound independent cancellation so slow identities cannot serialize beyond 5s healthy / 7s error guarantees; supervise setup too.
### reconcile-native-targets
3. Route startup/raw/REST/popup allocation through existing manager-owned observation/reservation; coalesce same-key create through native reconciliation, expose pending/failed truth, close proven surplus only. Emit admitted-popup/blocked/lost events for Phase 03.
4. Keep Closing identity/producer/capacity until absence; repeated DELETE resumes cleanup. Retire exact sessions/producers/leases/tickets on native loss/crash; fence late create commit against reset/logout; TTL-reap retired state.
### persist-reset-recovery
5. Reconcile persisted process identity under flock before reopening profile; do not kill/adopt arbitrary reused PID/PGID. Implement durable write/delete/completion ordering and resumable same-operation marker+tombstone recovery; propagate final persistence failures.
### secure-artifact-logout
6. Serialize final selection/navigation/reset validation with terminal write and current admission/deadline check; remove exact watcher registration on every exit, restore observation or deny selection. Track failed unlink/retry/quota and retire registrations on delete/expiry/reset. Correct anonymous/unsent-token logout truth in server and client.
### implement-windows-containment
7. Implement existing Windows branch with suspended spawn → kill-on-close Job assignment → resume, nested Chromium sandbox compatibility, restricted principal-root/child DACL, stable lock and durable reset equivalents. Remove fail-closed guard only with native proof; no runner means blocked, never crosscompile-as-proof or no-sandbox workaround.

## Todo list
```evcrate-tasks
[
  {
    "id": "secure-browser-admission", "title": "Enforce trusted admission, request policy and bounded live authority", "blocked_by": [],
    "allowed_files": ["server/src/browser_host/auth.rs", "server/src/browser_host/attachments.rs", "server/src/browser_host/network_policy.rs", "server/src/browser_host/cdp_gateway.rs", "server/src/browser_host/cdp.rs", "server/src/browser_host/config.rs", "server/src/browser_host/media.rs", "server/src/browser_host/screencast.rs", "server/src/api/browser_host.rs", "server/src/state.rs", "server/src/main.rs", "server/tests/browser_host_admission.rs", "server/tests/browser_host_auth.rs", "server/tests/browser_host_gateway.rs"],
    "constraints": ["Single integration owner; reuse current authority/config and bounded actor; no CORS-as-target-policy, Host fallback or new registry."],
    "acceptance": ["LA:L1,L9,L11,L12,L14 addressed: actual listener guard and exact Origin fail closed; trusted wss discovery; configured redirect/assets policy; ticket saturation recovers atomically; auth cancellation meets bounded independent windows."],
    "verification": ["Future: cargo test --manifest-path server/Cargo.toml --test browser_host_admission --test browser_host_auth --test browser_host_gateway; real HTTPS configured-origin discovery plus both authenticated connectOverCDP paths; real forbidden redirect/subresource observations, wildcard-listener denial, concurrent ticket expiry and slow-store cancellation timing."]
  },
  {
    "id": "reconcile-native-targets", "title": "Unify native target allocation, close, loss and reset publication", "blocked_by": ["secure-browser-admission"],
    "allowed_files": ["server/src/browser_host/manager.rs", "server/src/browser_host/session.rs", "server/src/browser_host/media.rs", "server/src/browser_host/screencast.rs", "server/src/browser_host/cdp.rs", "server/src/browser_host/cdp_gateway.rs", "server/src/browser_host/attachments.rs", "server/src/browser_host/input.rs", "server/src/api/browser_host.rs", "server/tests/browser_host_admission.rs", "server/tests/browser_host_lifecycle.rs", "server/tests/browser_host_gateway.rs", "server/tests/browser_host_media.rs"],
    "constraints": ["Single manager-owned publication path; migrate/remove telemetry-only duplicates; retain retry identity and capacity until positively reconciled."],
    "acceptance": ["LA:L2,L3,L4,L5,L8,L13 addressed: startup/raw/popups honor reduced/global caps; one native create per key; failed create never Running/201; ambiguous close stays owned; no reset/logout resurrection; crash/destruction retires exact state and TTL bounds history."],
    "verification": ["Future: cargo test --manifest-path server/Cargo.toml --test browser_host_admission --test browser_host_lifecycle --test browser_host_gateway --test browser_host_media; native page inventory under concurrent create/retry, delayed/lost CDP responses, popup overflow, failed close, crash/raw destruction and paused create-versus-reset/logout; verify exact slots and surviving sibling identities."]
  },
  {
    "id": "persist-reset-recovery", "title": "Make profile recovery and reset completion durably truthful", "blocked_by": ["reconcile-native-targets"],
    "allowed_files": ["server/src/browser_host/profile.rs", "server/src/browser_host/manager.rs", "server/src/browser_host/process.rs", "server/src/api/browser_host.rs", "server/tests/browser_host_lifecycle.rs", "server/tests/browser_host_shutdown.rs", "server/tests/browser_host_process.rs", "server/tests/browser_host_platform.rs"],
    "constraints": ["Retain manager.lock inode/ownership through reset; all descendants absent before credential deletion; uncertain identity or durability stays CleanupPending."],
    "acceptance": ["LA:L6,L7,L10 addressed: replacement manager cannot race surviving old tree; synced intent/epoch precedes acceptance; durable deletion precedes cleared; surviving tombstone resumes even with completed marker; same operation advances epoch once."],
    "verification": ["Future: cargo test --manifest-path server/Cargo.toml --test browser_host_lifecycle --test browser_host_shutdown --test browser_host_process --test browser_host_platform; inject sync/rename/unlink/delete failures and restart at each persisted boundary, including completed marker plus tombstone and concurrent parent-death replacement; assert no dirty relaunch or false cleared."]
  },
  {
    "id": "secure-artifact-logout", "title": "Close final artifact authority gaps and report logout truth", "blocked_by": ["persist-reset-recovery"],
    "allowed_files": ["server/src/browser_host/selection.rs", "server/src/browser_debug", "server/src/state.rs", "server/src/api/browser_debug.rs", "server/src/api/browser_host.rs", "server/src/api/auth.rs", "packages/ui/src/api/auth-client.ts", "packages/ui/src/api/auth-client.test.ts", "server/tests/browser_host_selection.rs", "server/tests/browser_host_logout.rs", "server/tests/browser_debug_artifacts.rs"],
    "constraints": ["Preserve immutable source/owner, bounded extraction, cooperative callers and write_if_incarnation; no insecure token transmission or success inferred from anonymous logout."],
    "acceptance": ["OSQ:S1-S4,L1 addressed: post-entry-lock navigation/revoke/deadline cannot write stale handoff; watcher overflow fails closed/restarts; denied unlink remains charged/retryable and prevents purge completion; artifact terminal paths bound registrations; unsent token revocation never falsely confirmed."],
    "verification": ["Future: cargo test --manifest-path server/Cargo.toml --test browser_host_selection --test browser_host_logout --test browser_debug_artifacts; pnpm --filter @dam-hopper/ui test src/api/auth-client.test.ts; deterministic post-fence entry-lock barriers, navigation/demotion/deadline, watcher lag, denied unlink, repeated artifact delete/expiry and real anonymous public-logout response with saved unsent token."]
  },
  {
    "id": "implement-windows-containment", "title": "Implement and natively prove the retained Windows containment contract", "blocked_by": ["secure-artifact-logout"],
    "allowed_files": ["server/src/browser_host/process.rs", "server/src/browser_host/profile.rs", "server/src/browser_host/manager.rs", "server/src/browser_host/config.rs", "server/Cargo.toml", "server/Cargo.lock", "server/tests/browser_host_process.rs", "server/tests/browser_host_lifecycle.rs", "server/tests/browser_host_platform.rs", "server/examples/browser_host_qualification.rs"],
    "constraints": ["Current unsupported Windows stays fail-closed until real implementation and native proof; no stub, sandbox bypass or scope waiver; unavailable native host is a blocking prerequisite."],
    "acceptance": ["Windows suspended child is contained before resume, full descendant tree dies with owning Job, profile DACL/lock/durability/reset are enforced, sandbox remains enabled and unrelated PTY survives; Linux behavior unchanged."],
    "verification": ["Future on native Windows: cargo test --manifest-path server/Cargo.toml --test browser_host_process --test browser_host_lifecycle --test browser_host_platform; prove Job assignment failure, nested sandbox Job behavior, owner death, denied delete, reset restart, DACL and real PTY survival with exact OS/engine/hash receipts; crosscompilation alone cannot pass."]
  }
]
```
- [x] <!-- evcrate-task:secure-browser-admission --> Secure admission and policy (done 2026-11-10)
- [x] <!-- evcrate-task:reconcile-native-targets --> Reconcile native target lifecycle (done 2026-11-10)
- [x] <!-- evcrate-task:persist-reset-recovery --> Persist recoverable reset state (done 2026-11-10)
- [x] <!-- evcrate-task:secure-artifact-logout --> Secure artifacts and logout truth (done 2026-11-10)
- [ ] <!-- evcrate-task:implement-windows-containment --> Implement/prove Windows containment (BLOCKED: no native Windows runner; Windows stays fail-closed)

## Success Criteria
All mapped defects repaired with production-owner regressions, not predicate-only proof. Native identity/capacity and durable cleanup remain consistent across injected failures; Windows unsupported status changes only after native evidence. Phase 04 repeats integrated proof; no pass claimed here.

## Risk Assessment
Ordering/lock changes can deadlock or free capacity prematurely; use one transition owner, documented lock order, no async gap after final authority. Never delete credentials or signal unverifiable process identities. Rollback disables/drains Browser, retains lock/profile/tombstone, and cannot restore wiped credentials.

## Security Considerations
Admin/raw CDP remains instance-wide trusted host authority; HTTP request checks are not an egress sandbox. Log no tickets, endpoints, credentials or page payloads. Anonymous logout cannot authorize wipe; filesystem failures cannot silently forget private artifacts.

## Next steps
Phase 02 begins after the four backend-core tasks close. Windows implementation may remain blocked awaiting native access while reachable Linux repairs proceed; it remains mandatory before Phase 04 platform qualification. Serialize its shared writes with other tasks. Coordinator retains execution authorization; no prerequisite silently omitted.

## Open follow-ups from review
Status: in-progress/partial (not DONE). User approved Cycle 4 review with noted issues (score 7/10; 4 review cycles: 6, 7, 7, 7/10; server suite 2285 pass [+1 flaky geometry test passes isolated], browser_host suites stable x4, UI 3720 pass, clippy 0 errors).
References: [Cycle 4 report](../reports/evc-code-reviewer-261110-phase01-cycle4.md), [Cycle 3 report](../reports/evc-code-reviewer-261110-phase01-cycle3.md), [Cycle 2 report](../reports/evc-code-reviewer-261110-phase01-cycle2.md).

### Critical issues / merge blockers
- **C1 / P1 — Recycled-group race from stale leader evidence in supervisor/recovery inventory**: `server/src/browser_host/process.rs:1233-1346`. Lazy `procfs` iterator can capture replacement group members after leader exits.
- **C2 / P1 — MFA rotation fence cancellation sensitivity**: `server/src/api/auth_mfa.rs:939-969`. DB commit precedes epoch publish; dropped StepUp future can lose epoch publication while handoff waits on PTY.
- **C3 / P1 — Failed live containment releases capacity prematurely**: `server/src/browser_host/manager.rs:1947-1999`. Failed termination in `contain_incarnation` preserves tombstone but reuses `reap_dead_instance`, undercounting surviving native capacity.

### Warnings
- **W1 / P2 — Cleanup IDs lack hard bound**: `selection.rs:338-405,1142-1147`. Queued pending vector retains historical IDs on repeated navigate/delete.
- **W2 / P2 — Shutdown does not join every cleanup/escalation task**: `selection.rs`, `main.rs`, `manager.rs`, `screencast.rs`. Navigation producers active after drain snapshot; detached JoinHandle on timeout.
- **W3 / P2 — Observer overlay mutations bypass generation gate**: `selection.rs:1627-1635,1693-1716`. Cancellation and inspect-result teardown/highlight bypass generation gate.

### Accepted limits
- DB-direct demotion has no synchronous publisher (supervisor poll catches it).
- Cancelled handoff worker blocked on std Mutex releases without writing.
- Page-session Overflow loses worker identity.

### Product decisions and documented behavior changes
- Browser launch requires Linux 6.9+ (pidfd `PIDFD_SIGNAL_PROCESS_GROUP` + `close_range` 5.9+); fails closed on older kernels (pre-6.9 fallback deleted).
- Dev (`--no-auth`) Browser admission requires actual bound loopback listener + loopback peer; Origin must exactly match configured allowlist.
- Raw CDP discovery requires trusted `DAM_HOPPER_PUBLIC_SERVER_ORIGIN` (wss for https) else 503 `publicOriginUnavailable`; request Host never reflected.
- Fetch request-policy interception installed before first navigation; targets created at `about:blank` then navigated; workers/child sessions intercepted (fail closed).
- `max_targets` honored by shared native target capacity; session DTO statuses include `closing` and `lost`; failed native close returns 502 `nativeCloseUnconfirmed` and keeps `Closing`.
- Durable reset reconciles persisted process identity (`pid`, `pgid`, `start_time`, `boot_id`, `launch_token`) under flock before relaunch; 0600 temp+fsync+rename+dir fsync; tombstone/marker recovery.
- Logout reports `sessionRevoked: true` only when request's own credential was identified and revoked (`sessionIdentified`); client never trusts it for unsent Bearer.
- Artifact handoff authority checked inside PTY mutation (`publish_revocation`, browser incarnation, navigation, deadline); unlink failures retained in pending cleanup set; logout may report `cleanupPending`.
- Windows containment remains blocked (no native Windows runner; stays fail-closed per contract).
