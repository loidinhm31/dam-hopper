# Phase 01–04 lifecycle/admission review

## Scope and evidence
- Baseline `3f20a8a9` → requested HEAD `cdfa9c6b`; scoped diff examined. Source read-only; only this report written. No tests/build/lint/formatters/runtime probes run.
- Coverage: **01** process/endpoint/actor/budget; **02** config/profile/manager/reset/shutdown; **03** auth/session/tickets/policy/routes; **04** discovery/raw relay/native lifecycle. Read selected overview, architecture contracts and phase01–04 acceptance sections.
- Inspected `server/src/browser_host/{process,profile,manager,config,command_budget,cdp,auth,session,attachments,network_policy,cdp_gateway}.rs`, related API/router/state/main wiring; followed native create/close consumers into `media.rs:68–130`, `screencast.rs:178–184,229–254` and navigation watcher setup.
- Tests inspected: lifecycle, shutdown, process, admission, auth, gateway, adapter and security suites (relevant ranges cited below). Research support: `plans/reports/evc-researcher-261109-2251-cdp-security.md`; historical findings independently checked against current source, not adopted as proof.
- Findings below are source-backed execution traces; runtime outcomes/timing are **[INFERENCE]**, except explicitly attributed coordinator observations under L1/L9. This reviewer ran no runtime probes. No P0 identified. Stream/input reviewer owns geometry authority, stale socket tickets, half-pair/input admission; selection reviewer owns logout/artifact/UI qualification.

## Actionable findings, ranked

### L1 — P1: managed pages never install browser-initiated HTTP policy
- Evidence: `server/src/browser_host/media.rs:95–106` creates directly at requested URL; `screencast.rs:229–254` only attaches/enables Page. `cdp.rs:627–713` routes no Fetch request events. No Fetch/Network interception installation exists in the scoped production consumers.
- Trace: Admin opens an allowed public page → page redirects/loads an image/fetch to `http://169.254.169.254/` or an internal service → Chromium sends the request without invoking `validate_navigation_url`. This is ordinary page content, not the explicitly trusted raw-CDP bypass.
- Config is also bypassed: `api/browser_host.rs:418–426` passes **CORS origins**, not `allowed_target_origins`; `network_policy.rs:132–143` permits every localhost/127.0.0.1 port in dev; configured asset origins/denied destinations have no enforcement consumer. An explicitly configured project origin can be rejected while an unapproved loopback service is accepted.
- Coordinator runtime evidence: `plans/reports/review-261109-2251-host-browser-runtime.md:66–71` records actual no-auth guarded-dev REST creation at unapproved loopback port36191 →201 and one image request received at a second unapproved origin. Only backend origin was configured; no raw CDP created/injected these requests. This confirms ordinary-page dev policy bypass; production metadata fetch was **not** performed.
- Blind spot: `server/tests/browser_host_admission.rs:483–525` and policy unit tests only validate submitted strings; no actual redirect/subresource request is observed.
- Minimal fix: install central request interception before first navigation; use browser target/asset/denied-destination config and apply it to redirects/subresources. Retain the documented non-egress-boundary caveat. Confidence: high.

### L2 — P1: native pages/popups bypass global target admission and projection
- Evidence: `process.rs:267` launches an initial native blank page; `media.rs:100–106` creates another page per logical session. `session.rs:577–624` popup handler has no production caller. `cdp_gateway.rs:1063–1081` updates only manager telemetry, whose separate map allows 64 entries (`manager.rs:1210–1215`).
- Trace: two ordinary session creates retain initial blank + two managed native pages; `window.open` retains additional native pages without a logical session/OS window, overflow close or popupBlocked notice. Raw-created/destroyed pages likewise do not participate in SessionRegistry capacity.
- Lowered config is ignored too: `api/browser_host.rs:105–106` constructs the global registry with DEFAULT_MAX_TARGETS, not configured max_targets; max_targets=1 still admits two logical sessions.
- Blind spot: gateway tests `browser_host_gateway.rs:540–629` inject events into the telemetry helper and assert its 64-entry map, never native page count or logical/OS projection.
- Minimal fix: manager-owned native target observer/admission shared by all creation paths; adopt/close startup page, reserve native capacity, project admitted popups, close overflow and reconcile destruction. Raw authority is not a resource-cap exemption. Confidence: high.

### L3 — P1: native allocation is not single-flight and failed creation is committed as success
- Evidence: `media.rs:86–107,120` does separate get/create/set/register operations; `api/browser_host.rs:429–442` discards producer setup failure and returns the pre-created Running DTO/201. Registry retry returns existing DTO immediately (`session.rs:287–291`).
- Trace A: first POST inserts logical session; concurrent retry obtains its ID before native setup completes, then media upgrade and original POST both enter ensure_producer; both see no producer/native ID and issue Target.createTarget. Last registration overwrites the first producer, leaving an extra native page outside capacity accounting.
- Trace B: CDP connect/create fails or create response is lost → original POST still returns Running/201; same-key POST returns that result without retrying/reconciling native creation. A lost native response can leave an orphan plus a later duplicate.
- Blind spot: admission tests `browser_host_admission.rs:86–94,314–480` use a mock handle/no functioning native endpoint and assert HTTP success/UUIDs, not one reconciled native target.
- Minimal fix: one manager-owned in-flight creation record per key/session, explicit pending/failed state, native identity reconciliation before committed success; atomically publish one producer and close any proven surplus target. Confidence: high.

### L4 — P1: failed native close is reported closed and frees capacity irreversibly
- Evidence: `session.rs:433–438` marks Closed/decrements count before native work; `media.rs:68–76` removes producer before close; `screencast.rs:179–184` discards command failure/close result and always returns Ok; `api/browser_host.rs:515–522` returns closed/200.
- Trace: native close times out/errors while Chromium still owns the page → API frees slot and loses producer needed to retry → replacement create adds another live page; repeated DELETE cannot reconcile the old target. Normal successful create/DELETE does close correctly; finding is the failed/ambiguous branch only.
- Blind spot: admission delete assertions (`browser_host_admission.rs:448–480`) have no native close peer or injected failure.
- Minimal fix: retain Closing/native identity and capacity until positive target absence; inspect Target.closeTarget result, reconcile ambiguous outcome, make repeated DELETE resume cleanup. Confidence: high.

### L5 — P1: an already-admitted create can cross reset/logout's principal fence
- Evidence: `api/browser_host.rs:402–427` obtains incarnation/epoch separately from logical insertion; `manager.rs:827–846` advances reset epoch, while resource fencing snapshots/closes sessions only once (`api/browser_host.rs:1356–1379`). No epoch/live-auth recheck guards create commit or `media.rs:90–120` publication.
- Trace: request A gets old handle, pauses before registry insertion → reset B advances epoch and closes current sessions, then completes → A inserts old-epoch Running session; its producer helper can start a fresh process/target after the wipe. If A belonged to the login just revoked by logout, the completed admission is still used without revalidation.
- Impact: reset loses its no-resurrection guarantee; ghost sessions consume capacity and registry/producer identities can disagree.
- Blind spot: lifecycle reset tests serialize operations (`browser_host_lifecycle.rs:403–446`); no paused create-vs-reset/native completion interleaving.
- Minimal fix: principal lifecycle transaction/reservation fenced by captured epoch/incarnation and live admission at commit; reset cancels/waits in-flight creates and rejects late publications. Confidence: high.

### L6 — P1: ordinary restart ignores persisted containment identity before reopening profile
- Evidence: `manager.rs:231–245` loads metadata but chooses Dormant solely from tombstone presence; `ensure_running:409–430` acquires flock and launches without checking persisted process_pid/process_pgid. Death watcher waits 0.5s between TERM/KILL (`process.rs:397`).
- Trace: server SIGKILL releases flock immediately while watcher/Chromium descendants still exist → replacement server acquires flock and launches against the same user-data before proving the prior group empty. A stopped/delayed watcher extends this race; Singleton behavior is not a manager containment proof.
- Blind spot: parent-death test `browser_host_process.rs:464–490` waits for eventual absence; it never concurrently restarts a manager against the profile. Shutdown tombstone test writes a synthetic tombstone (`browser_host_shutdown.rs:208–219`).
- Minimal fix: under flock reconcile persisted process/container identity and prove absence before relaunch; ambiguous ownership stays CleanupPending, never arbitrary PID/group adoption or kill. Confidence: high.

### L7 — P1: reset's acknowledged durable state has no durability barriers
- Evidence: `profile.rs:322–332,354–364` uses write/rename without syncing file or parent directory; `367–372,383–392` removes tombstone/deletes/recreates user-data without directory durability ordering. `manager.rs:827–832` treats these writes as durable intent.
- Trace: reset is accepted/completed, then host power loss before filesystem flush → tombstone/epoch publication or credential deletion may not survive, allowing old credentials to reopen without a pending cleanup fence. Atomic rename alone does not guarantee crash durability.
- Blind spot: `browser_host_lifecycle.rs:85–144,283–352` reloads files within the same running OS; no crash/durable-write fault injection.
- Minimal fix: sync restrictive temp files, rename and sync principal directory before accepting intent; order/sync deletion and completion/tombstone removal, propagating failures instead of claiming completion. Confidence: high.

### L8 — P1: browser crash/native destruction never retires logical sessions or producers
- Evidence: crash path `manager.rs:357–384` clears only InnerInstance telemetry; raw Target.targetDestroyed handler (`cdp_gateway.rs:1075–1081`) likewise touches only that map. Registry list/get/retry retains Running sessions (`session.rs:287–291,372–412`); `media.rs:86–87` returns cached producer without incarnation/liveness check.
- Trace: page is closed through agent CDP, or browser dies and discovery/new create starts another incarnation → existing REST session still says Running with old identity, cached producer targets dead actor/native ID, and logical target slots remain occupied. Same-key retry cannot repair it.
- Blind spot: manager reconnect test only reuses a healthy process (`browser_host_lifecycle.rs:378–387`); gateway destruction test only verifies telemetry removal (`browser_host_gateway.rs:565–577`).
- Minimal fix: authoritative target/process lifecycle events retire exact sessions/producers/leases, free slots only after proven loss, expose lost/reloaded identity and never pretend DOM continuity. Confidence: high.

### L9 — P1: raw discovery falls back to insecure, request-controlled WS authority
- Evidence: `cdp_gateway.rs:145–167` accepts env prefixes without URL validation and otherwise uses `ws://` plus incoming Host; returned URLs use this base at `397–398,514–521`.
- Trace: HTTPS deployment without DAM_HOPPER_PUBLIC_SERVER_ORIGIN returns ws://host/...; a native CDP client following discovery can send its bearer over plaintext or fail behind a TLS-only proxy. Altered Host is also reflected as the destination for the next authenticated connection. Path/query/userinfo in the env value is accepted rather than rejected.
- Coordinator-supplied runtime observation (Main, not rerun here): real guarded-loopback no-auth GET `/api/browser/cdp/json/version`, approved Origin and `Host: review-attacker.example`, public-origin env unset → HTTP 200 with `webSocketDebuggerUrl: ws://review-attacker.example/api/browser/cdp/ws`. This confirms reflected authority, not authenticated production execution or actual bearer exfiltration.
- Blind spot: inspected gateway tests cover Origin/permits/helper calls, not HTTPS/public-origin discovery and the subsequent authenticated handshake.
- Minimal fix: one parsed, trusted configured public origin with scheme/authority validation; derive ws/wss correctly, reject unavailable/invalid authority rather than trust request Host. Confidence: high.

### L10 — P2: completed reset marker plus surviving tombstone permanently wedges recovery
- Evidence: worker writes last_reset_operation_id before clearing tombstone (`manager.rs:1084–1088`); retry returns Completed from marker before inspecting tombstone (`773–785`). Start rejects any tombstone (`307–311`).
- Trace: crash after metadata commit/before tombstone unlink, or unlink error → restart sees CleanupPending; retry same operation returns Completed without removing tombstone; different operation is blocked by existing tombstone. GET reports pending while POST reports completed and browser cannot restart.
- Blind spot: success retry test (`browser_host_lifecycle.rs:341–352`) assumes tombstone was already removed.
- Minimal fix: completed marker is sufficient only when no tombstone remains; same-operation retry must finish/resume cleanup under lock. Do not ignore final metadata persistence failure (`manager.rs:1087`). Confidence: high.

### L11 — P2: full expired ticket table cannot recover; global cap check also races
- Evidence: `attachments.rs:210–215` rejects before expiry pruning at `264–281`; no supervisor expiry pruning. Global count is checked outside the insertion lock.
- Trace: four principals issue 16 tickets each without consuming → 64 expire → every future issue returns capacityExceeded before pruning, indefinitely until explicit revoke/consume/restart. Concurrent issuers below 64 can all pass the pre-lock check and exceed the global bound.
- Blind spot: auth expiry test (`browser_host_auth.rs:266–294`) only checks a single ticket's clipped TTL; no saturated expired table/concurrent global admission.
- Minimal fix: under one write lock prune expired tickets, check both limits, then insert/update count. Confidence: high.

### L12 — P2: serial attachment auth checks exceed the bounded revocation window
- Evidence: `attachments.rs:568–597` snapshots every socket then awaits each check serially; each check has a 2s database timeout (`auth.rs:315–324`). No principal/login deduplication.
- Trace: two paired viewers yield four entries; store calls each consume nearly 2s → last socket's cancellation can occur about 8s after tick, plus up to 5s before tick. Even cancelling a pair does not remove its other check from the existing snapshot. Unbounded control-only admission makes delay grow further.
- Blind spot: `browser_host_auth.rs:399–427` calls verify_live_admission directly against a mock, not the real supervisor with several sockets/slow store.
- Minimal fix: deduplicate by auth identity and perform bounded independent checks/cancellation so other logins cannot postpone the 5s/7s guarantees. Confidence: high.

### L13 — P2: retired logical sessions accumulate without any lifetime bound
- Evidence: `session.rs:270–272` prunes only creation records; `415–441` keeps every Closed BrowserSession in the sessions HashMap. Registry reads/inserts have no retired-session eviction path.
- Trace: one Admin repeatedly creates/deletes targets; after each 10min idempotency window it can allocate another 128 records while all historical sessions remain. Active cap bounds live sessions, not retained memory; long-lived server memory grows indefinitely.
- Blind spot: admission test performs only a few creates/deletes; no expired-record/retired-session soak.
- Minimal fix: retain closed retry result only through required TTL, then remove corresponding retired session/native metadata; preserve live records and required idempotent result semantics. Confidence: high.

### L14 — P2: Browser admission omits the actual-listener guard and fails open on empty Origin allowlist
- Evidence: `auth.rs:113–158` checks peer, not bound listener; AppState has no actual listener authority; main binds configurable/default 0.0.0.0 (`main.rs:47–49,1223–1226`). Production Origin rejection is conditional on nonempty CORS origins (`auth.rs:165–175`).
- Trace: --no-auth on wildcard listener still admits a loopback Browser caller, contrary to the required no_auth AND bound-loopback AND peer-loopback boundary; production with empty origins accepts valid bearer + arbitrary Origin on REST while raw discovery correctly denies it.
- Blind spot: `browser_host_admission.rs:252–310` supplies synthetic peer addresses and tests a nonempty Origin list, never actual bind metadata/empty-list rejection.
- Minimal fix: capture verified bound-listener address into admission authority and require loopback in dev; consistently reject Origin-bearing requests without an exact approved match (including malformed/non-UTF8 headers), rather than interpreting an empty list as unrestricted. Confidence: high.

## Qualification blockers / disposition
- Phase01–04 acceptance is incomplete despite DONE markers: live request interception, native popup/target admission, reset/create ordering, restart recovery and bounded auth observation lack the production guarantees above. Reopen the owning tasks before rollout.
- Windows remains deliberately fail-closed (`process.rs:436–440`), not a demonstrated Job/DACL implementation or native qualification. Engine/platform/human proof is separate from these source findings; this reviewer supplied no new runtime proof.
- Positive source evidence: command pre-reservation/RAII budget and non-waiting enqueue are wired (`cdp.rs:347–395`, `command_budget.rs:31–112`); lock inode is outside deletable user-data; current reset spawns its worker before waiting and performs async hooks inside it (`manager.rs:841–884`). Historical pre-worker async-fence finding is not repeated.
- Coordinator validation targets: real Chromium target-count/popup/close-failure tests; delayed CDP create-vs-reset/crash interleavings; persisted marker+tombstone recovery; ticket saturation/time advance; real slow-store revocation timings; HTTPS discovery through configured proxy origin. Checks intentionally not run here.

## Unresolved questions
- None needed to establish the source findings. Exact runtime timing/engine outcomes and native platform availability remain coordinator-owned qualification evidence.
