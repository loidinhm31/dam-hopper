# Phases 07–09: OS Browser, selection, logout, qualification review

## Scope / disposition
- Baseline `3f20a8a9` → `cdfa9c6b`; read-only product review. Only this report authored; plans/task state intentionally unchanged. No tests/build/lint/formatters run.
- Deep coverage: `packages/ui/src/os/{BrowserStreamKeepAliveHost,OsResourceHost,apps/BrowserApp}.tsx`, `window-store.ts`, persistence/launch integration; selection controller; account logout/client/profile/settings consumers; server selection, artifact store/routes/authority, logout, reset hooks; security/platform tests; phase09 fixture/specs/reports. Supporting native `agent.spec.ts`/`compatibility.spec.ts` and qualification fixture inspected at actual proof boundaries. Approximately 9,000 relevant source/test lines inspected, not whole-repository coverage.
- Read selected plan/contracts/phases07–09, README/PDR/standards, development rules and code-review skill. Memory portal guidance corroborated by current `MonacoKeepAliveHost.tsx:182–207,247–266` and architecture contract §9.
- **Technical acceptance incomplete.** No P0 established. Findings below are source-proven defects; unexercised execution outcomes/race schedules marked **[INFERENCE]**, not reviewer reproductions. Coordinator subsequently supplied real source-Vite + production-noauth OS observations for O1/O7, explicitly attributed below; reviewer ran no checks.

## Findings — P1

### O1 — Moving a React-owned host breaks deletion ownership
- **Evidence:** `packages/ui/src/os/BrowserStreamKeepAliveHost.tsx:303–312,558–570,632–667,690–723` renders the container as the parking div's React child, then moves it into another DOM parent with `appendChild`; removal cleanup is a passive effect.
- **Coordinator-observed trace/impact:** source Vite + production noauth backend; configure profile → Dock Browser → complete URL chooser → valid streamed JSON page → Control → canvas click → Close. Whole shell entered ErrorBoundary: `Failed to execute 'removeChild' ... not a child`; console stack included `commitDeletionEffectsOnFiber` / `ParkedBrowserStreamItem`. Target DELETE succeeded (`sessions: []`), isolating frontend deletion ownership from remote cleanup. Supplied screenshots: live `/tmp/omp-sshots-15c79051e9eef5aa.png`, crash `/tmp/omp-sshots-15c79059c4aef5ab.png`. Reported by Main, not executed by this reviewer.
- **Minimal fix:** create the movable host imperatively; portal stable React content into it, as Monaco already does. Existing lifecycle tests assert container disappearance, not an exception-free live connected teardown. **Confidence: high.**

### O2 — Persisted sessions cannot reconnect to their live target
- **Evidence:** `packages/ui/src/os/persistence.ts:56–61` saves logical session/URL only; host `BrowserStreamKeepAliveHost.tsx:409–418,478–485` never gets/lists that exact session and substitutes incarnation `"1"` / epoch `0`.
- **Trace/impact:** reload the SPA with a running target. The retained session ID bypasses creation, but missing runtime identity is sent to attachment admission; no valid pair can be negotiated. Missing/restarted targets also have no explicit Restore/reloaded path. Target remains live but the window is blank.
- **Minimal fix:** owner-bound exact get/list reconciliation before tickets; adopt authoritative runtime identity, or offer explicit URL restore for an absent session. Current idempotency REST test is not SPA reload/adoption evidence. **Confidence: high.**

### O3 — Suppression is not initialized or rechecked at attachment
- **Evidence:** host suppression/visibility layout effects `:317–331` precede controller construction `:333–401`; controller defaults are visible/nonprivate (`stream-controller.ts:88–90`). Main connection effect `:403–525` ignores demand; restore `:529–556` has no cancellation or post-await target/visibility check.
- **Trace/impact [INFERENCE]:** mount an already minimized/private Browser, or begin restore ticket mint and minimize/enable PIN/Cognito before it resolves. Controller can attach after pause, with no subsequent policy dependency change to detach it; initially private controllers can retain default nonprivate decode policy. Hidden sockets consume viewer capacity and violate no-demand/privacy fencing.
- **Minimal fix:** initialize controller policy before any attach; unify attachment reconciliation under owner/session/demand operation identity and recheck after awaits. CSS-only privacy assertions (`os-input-isolation.browser.tsx:217–239`) miss live sockets and late draws. **Confidence: high.**

### O4 — Logout's generation fence is called after invalidating its generation
- **Evidence:** `ServerProfilesDialog.tsx:463–474` and `ServerSettingsDialog.tsx:1860–1871` call `disconnectProfile` before `fenceBrowserViewsForProfile(...captured.generation)`. `connections.ts:612–615` increments generation; host fence `:81–85` rejects that old generation. Host connection-effect cleanup `:513–516` aborts requests only, not existing sockets/pixels.
- **Trace/impact:** logout with a visible Browser. The intended synchronous local Browser fence always no-ops after disconnect; retained pixels remain, and live sockets rely on remote cancellation rather than local retirement. With failed/offline revocation, the old view can remain live after local signout. **[INFERENCE]**
- **Minimal fix:** fence/blacken the captured runtime before generation invalidation; also synchronously retire Browser runtime on owner loss. Add actual canvas/socket assertions to logout tests, not only token removal. **Confidence: high.**

### O5 — Control expires or is revoked while UI remains permanently “Controlling”
- **Evidence:** `BrowserApp.tsx:290–305,461–486` stores only the acquired token/controller flag. No OS consumer of renew/release helpers exists. Pause closes the old pair; restore replaces `viewerId` only (`BrowserStreamKeepAliveHost.tsx:539–548`). Backend revokes that viewer's lease on socket teardown (`media.rs:937–949`); normal lease TTL is 30s (`input.rs:296–305,332–333`).
- **Trace/impact:** acquire control, then wait 30s or minimize/restore. Input carries an expired/revoked token while the badge hides the only acquisition button. No native lease-revocation event is emitted by the current control loop to clear this state.
- **Minimal fix:** bind lease state/deadline/5s renewal to exact viewer lifetime; release and clear before pause, clear on socket loss, and fence acquisition completion. Existing component/REST tests do not hold real OS control beyond TTL or resume it. **Confidence: high.**

### O6 — Explicit close loses pending-create and failed-delete ownership
- **Evidence:** host `:436–468` generates/stores creationKey only on success and drops a cancelled success at `:453`; `window-store.ts:153–170` deletes only known session IDs, logs DELETE failure, and removes the window immediately.
- **Trace/impact [INFERENCE]:** server commits create while the user closes its window or response is lost. No retained creation key/close finalizer reconciles and deletes the target. Likewise a failed DELETE leaves a live target without retry UI; two such targets exhaust the global cap.
- **Minimal fix:** retain creation identity before dispatch and captured-owner finalization through ambiguous outcomes; retain visible pending/failed closure state. `host-browser-lifecycle.browser.tsx:119–172` never asserts DELETE or remote target state despite its title. **Confidence: high.**

### O7 — Canvas gesture never focuses the actual text proxy
- **Evidence:** `BrowserStreamKeepAliveHost.tsx:260,607–626,655–658` creates/assigns the proxy ref but never invokes its focus method. Canvas is not focusable (`canvas-view.tsx:92–101`); proxy is 1px, transparent, pointer-disabled, no autofocus (`text-input-proxy.tsx:26,155–174`).
- **Coordinator-observed focus failure:** in the same live source-Vite/production-noauth journey as O1, after Control and a canvas click `document.activeElement` was `DIV`, not the textarea. Main supplied this observation; reviewer did not execute it. Source consequence: remote pointer focus does not focus the local proxy, so ordinary keyboard/IME/paste and Android soft-keyboard entry lack a usable activation path; those typing/device consequences remain **[INFERENCE]**.
- **Minimal fix:** deliberately focus the proxy on an authorized canvas gesture/explicit keyboard control; suppress/blur under shell/modal/privacy policy. Android E2E programmatically focuses textarea (`android.spec.ts:63–90`), bypassing the missing production gesture. **Confidence: high.**

### O8 — Native JavaScript dialogs never reach the rendered dialog UI
- **Evidence:** host expects `dialogOpened/dialogClosed` (`BrowserStreamKeepAliveHost.tsx:342–350`), but actual CDP event projection only recognizes inspect/navigation (`server/src/browser_host/cdp.rs:627–633,707–711`); `media.rs:827–834,851–934` sends initial status, not dialog events. `ServerControlEvent` enum variants alone have no producer.
- **Trace/impact:** target runs `alert`, `confirm` or `prompt`. Chromium blocks page interaction, but the Browser never renders the response controls; a declared modal component cannot resolve the native dialog.
- **Minimal fix:** wire bounded native dialog events and exact holder/dialog identity through production control delivery, with shared focus-trapped modal/error handling. Require a real page-triggered dialog test. **Confidence: high.**

### S1 — Final handoff fence still permits stale navigation/auth writes
- **Evidence:** `server/src/browser_host/selection.rs:277–302` holds selection-read lock but releases the session-registry snapshot lock. `browser_debug/store.rs:634–640,647–675` checks admission once, then awaits artifact write lock `:685` before `write_if_incarnation` `:711–717`. Production fence `state.rs:722–752` checks profile/selection, not actor/session/deadline again.
- **Trace/impact [INFERENCE]:** after the fence snapshots revision N, block handoff on the entry lock; native navigation records N+1 (`selection.rs:1092–1095`) then waits for the held selection lock. Release entry lock: handoff writes the old artifact before invalidation can run. Similarly demotion/revocation/deadline expiry during these waits is not revalidated before PTY mutation. Terminal incarnation safety does not make Browser/auth authority current.
- **Minimal fix:** one ordered current session/navigation/reset fence spanning final validation and synchronous PTY write, with final live actor/deadline recheck. Existing navigation barrier (`browser_host_selection.rs:1003–1049`) pauses **before** fence acquisition; it misses the remaining post-fence wait. Sequential demotion test misses in-flight revocation. **Confidence: high.**

### L1 — Uncredentialed public logout falsely confirms revocation of an unsent saved token
- **Evidence:** server `api/auth.rs:766–795` initializes success from absence of a revoke failure even when no token/claims exist. Client correctly strips Bearer on remote cleartext HTTP (`auth-client.ts:627–630`) but trusts response `sessionRevoked:true` at `:701–710`.
- **Trace/impact:** saved Bearer profile on remote HTTP, no auth cookie: logout sends no credential; public handler revokes nothing and returns `sessionRevoked:true`. UI clears local credentials and says server login revoked, while that exact saved token remains valid. No insecure token transmission is needed for this bug.
- **Minimal fix:** track whether the requested credential/session was actually identified/revoked; a token deliberately not sent cannot be confirmed by an unrelated anonymous/cookie logout response. Current insecure-client test omits the production server's explicit `sessionRevoked:true` response. **Confidence: high.**

## Findings — P2

### S2 — Navigation watcher cannot restart after overflow/lag
- **Evidence:** `selection.rs:1042–1045` returns on map membership; lag/Overflow breaks at `:1072–1083`; cleanup removes only an already-cancelled token (`:1114–1117`), but those error branches never cancel it.
- **Trace/impact:** lifecycle overload invalidates one selection, then permanently leaves a dead watcher registered. A later picker can prepare another artifact while subsequent native navigation never updates the revision/invalidation fence; stale handoff becomes possible. **[INFERENCE]**
- **Minimal fix:** remove the exact watcher entry on every exit and either restore observation or keep target selection unavailable until observation is restored. Tests cover ordinary navigation, not overflow → new picker → navigation. **Confidence: high.**

### S3 — Artifact unlink failure is forgotten during confirmed reset
- **Evidence:** `browser_debug/store.rs:745–800` removes metadata/releases quota before `delete_fenced_artifacts`; deletion uses `remove_or_log` (`:1200–1203`) and returns no failure. Reset hooks (`api/browser_host.rs:1425–1432`) continue after that call.
- **Trace/impact [INFERENCE]:** denied unlink/I/O failure leaves private managed JSON/PNG files behind, untracked and outside TTL/quota, while shared-profile reset can report completion. This is retention/cleanup failure, not a claimed remote file-read exploit.
- **Minimal fix:** retain charged cleanup ownership and propagate/retry failed removal before claiming the required artifact purge complete. Current reset/profile-delete fault tests do not fail artifact unlink. **Confidence: high.**

### S4 — Deleted/expired artifacts accumulate unbounded selection bookkeeping
- **Evidence:** each successful prepare pushes `(artifactUUID, full actor)` to `selection.rs:674–677`; `remove_pending_artifact` is called on capture failures only. Normal `store.rs:541–588` delete / `:815–835` expiry never removes that selection entry.
- **Trace/impact:** repeatedly prepare/discard one unchanged selection: artifact quota returns to zero but the selection's vector grows without bound until navigation/cancel/close. Later handoff/reset scans also grow. This bypasses the intended bounded artifact metadata footprint.
- **Minimal fix:** remove live-registration entries on every artifact terminal path, or use bounded registration owned by the artifact lifecycle. Add repeated prepare/delete and TTL bookkeeping assertions. **Confidence: high.**

### L2 — Reset/status responses still mutate replacement-owner pending context
- **Evidence:** `ServerSettingsDialog.tsx:986–997` checks dialog/op/URL/prop profile only, not captured token/generation. Global profile-keyed pending context is changed before/without that guard (`:1088–1094,1127–1135,1155–1156,1178–1183,1238–1244`). Generation-aware view fence protects pixels, not this context.
- **Trace/impact [INFERENCE]:** same profile/URL reconnects/relogs in and starts another reset while old status/reset request completes; old result can clear/replace the new pending operation, and old outcome can be shown as current, losing authenticated cleanup reconciliation.
- **Minimal fix:** qualify pending reset context by owner/auth session and operation; verify token/generation plus dialog/request currency before every mutation. Existing tests of dialog reopen/URL changes do not cover same-profile replacement login. **Confidence: high.**

## Qualification blockers / test defects — separate from production findings

### Q1 — P1: phase09 application specs do not bind a live Browser journey
- `same-target.spec.ts:16–45` creates a REST session then opens the Dock's URL chooser without completing it; launcher actually produces choose-target (`action-executor.ts:534–542`). Lifecycle/privacy specs likewise never choose a URL (`host-browser.spec.ts:16–37,333–340`). A canvas assertion either fails or observes the wrong presentation.
- `performance.spec.ts:22` and `android.spec.ts:24` use non-UUID creation keys, rejected by `session.rs:258–260` before their expected 201. Fixture manually creates contexts without propagating mobile/touch/user-agent options (`host-browser-app.ts:509–520`), so `android.spec.ts:6–12` does not configure `adminPage`.
- **Correction:** launch/adopt one exact real window/session through supported UI, use valid UUID keys, and propagate context options. These are executable spec defects, not missing physical hardware.

### Q2 — P1: same-target/static/privacy assertions cannot establish their named behavior
- `same-target.spec.ts:68–74` substitutes another target; `:91–127` swallows commands/checks only REST running + attached canvas, no post-interference frame marker/epoch/stale-input assertion. A frozen stream passes those oracles.
- `performance.spec.ts:49–63` checks only GET status after 3s; `:67–136` enumerates configuration constants, never runs a measured baseline/workload. `host-browser.spec.ts:354–368` makes privacy assertion optional and checks neither pixels nor remote input. `android.spec.ts:63–91` makes IME/paste optional and never checks remote text.
- **Correction:** mandatory correlated production frame/remote-DOM/input/demand observations, exact target identity, actual counters and numeric workloads. Earlier `agent.spec.ts:221–267` genuinely observes independent **native** frame advancement; it is not production SPA/BHJF qualification.

### Q3 — P1: qualification claims exceed the actual security/performance tests
- `integrated-qualification.md:28–40` says every route exercised; `browser_host_security.rs:227–368` covers a subset and no successful live WS upgrade. Its “multi-target” `:520–581` is two credit-controller objects + local event sink, no targets/media sockets/PTY process; `:645–697` swaps mock auth and calls one predicate, no live revocation/deadline/DB failure journey.
- `performance-qualification.md:25–40,51` still claims systematic evaluation, bandwidth/fidelity and static screenshot observations unsupported by the authored specs; raw matched 10Hz polling/CPU/RSS/latency records are absent from this ledger.
- **Correction:** label precise unit/predicate scope; remove unobserved empirical claims; require the actual integrated scenarios and matched raw measurements before technical acceptance. The integrated ledger already honestly calls lifecycle/same-target E2Es **typechecked-only** (`:90–105`); do not misreport them as executed passes.

### Q4 — P2: fixture can exercise stale SPA bytes and leak failed setup resources
- `host-browser-app.ts:176–180` accepts any existing dist `index.html`, not necessarily HEAD; target HTTP starts `:274–276` before later failure-prone setup, but cleanup finally exists only after startup resolves (`:499–506`). Server stdout is piped but undrained; stderr is unbounded (`:421–429`); cleanup signals/sleeps without awaiting exit before profile removal (`:458–470`).
- **Correction:** build/pin exact matching SPA in setup, register cleanup immediately, bound/drain subprocess output, and await contained shutdown before deleting profiles. These flaws differ from the earlier bounded native qualification fixture.

### Q5 — Unexecuted release gates, not source-proven platform failures
- `browser_host_platform.rs:96–146` uses orderly terminate/relaunch and manual event-sink sends, not crash injection or a live PTY; `:190–238` manually writes/clears a tombstone, not restart during actual reset. No-browser branch returns success (`:97–100`). Linux 5/5 is scoped test evidence, not service-user/orphan/full-disk/denied-delete/rollback qualification.
- Native Windows remains intentionally unsupported/fail-closed (`:87–92`); physical Android/desktop human receipts and measured soak remain explicitly pending in the current ledgers. Absence of those receipts is a release blocker, not proof those executions failed. No requested human observations fabricated here.

## Minimal improvement order / retained good behavior
1. Fix logout truth/local owner retirement and final artifact authority/retention fences; add deterministic post-fence and denied-unlink regressions.
2. Repair root portal ownership, exact session adoption, demand/lease/focus lifecycle and pending create/close finalization. Preserve current owner-reactive snapshot subscription, immutable artifact source/owner, incarnation-checked PTY write, revoke-before-reset server flow and Cancel-first logout UI.
3. Repair actual app fixtures/oracles, then coordinator performs one coherent validation pass and targeted runtime probes. Keep unsupported/hardware/soak gates separate; do not infer them from test counts or administratively DONE phases.

## Unresolved evidence
- Runtime reproductions for the marked interleavings, real app reload/close/privacy/lease/dialog journeys, artifact unlink failure, and unsent-token logout against the real public endpoint.
- Exact matching SPA/native binary identity, raw matched benchmark records, native service-user/Windows failure-injection receipts, and authentic human/physical-device observations remain unestablished in the inspected phase09 evidence.
