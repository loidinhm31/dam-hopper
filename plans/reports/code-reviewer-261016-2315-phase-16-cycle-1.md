# Code Review — Phase 16 (Ports, Tunnels, Idle Consent, Host Controls) — Cycle 1

Reviewer: ReviewPhase16Cycle1 | Date: 2026-10-16 | Branch: feat/android-native-app (base 9c9badd7, uncommitted Phase 16 tree)

## Score: 7/10

Critical: **0** | High: **5** | Medium/Warn: **9** | Suggestions: **8**

Security core solid (redaction, live-receipt fail-closed, no auto-retry on force-suspend, TLS-only netsec config, 0 FAB/0 WebView). Score dragged by truthfulness gaps + consent-state bugs + weak consent-lag test. No merge-blocking security hole; server independently enforces capability/revision so UI bugs are UX/safety-of-intent, not auth bypass.

## Scope
- Files reviewed (all read in full unless noted): `PortModels/TunnelModels/IdleSuspendModels/SshModels/HostActionModels/DiagnosticsModels.kt`, `PortRepository/TunnelRepository/IdleSuspendRepository/SshRepository/HostControlRepository/DiagnosticsRepository.kt`, `IdleConsentController.kt`, `PortsDialogs.kt`, `PortsPanelScreen.kt`, `IdleSuspendDialogs.kt`, `HostControlScreens.kt`, `ServerMsg.kt` diff, `WorkbenchScreen.kt` diff (+108), tests (`PortsAndTunnelsRepositoryTest`, `IdleConsentControllerTest`, `SshAndDiagnosticsRepositoryTest`, `PortsAndHostControlsPhase16Test`), `tests/test-phase-16-ports-tunnels-host-controls.sh` (skimmed header + result).
- Cross-checked against server: `server/src/api/ssh.rs`, `server/src/api/ws.rs` (idleSuspendChanged lag hint), `docs/api/idle-suspend.md`, `docs/api/rest-endpoints.md` (SSH).
- Base: `native-app/shared/src/commonMain/kotlin/dev/damhopper/nativeapp/features/host/*` etc.

## Validation (commands/results)
| Check | Result | Source |
|---|---|---|
| `bash tests/test-phase-16-ports-tunnels-host-controls.sh` | 194/194 pass, exit 0 | run by me |
| `:shared:jvmTest` + `:androidApp:testDebugUnitTest` + `:androidApp:testReleaseUnitTest` = 417/417 | pass | tester report `plans/reports/tester-261016-2245-phase-16-ports-tunnels-host-controls.md` (not re-run by me; avoid CPU storm w/ peer) |
| `test-phase-02..16.sh` = 1228 assertions | pass | tester report; phase-16 re-verified by me |
| `:androidApp:assembleDebug` | pass (65 tasks) | tester report |
| grep FAB / WebView in `features/host` + `WorkbenchScreen.kt` | 0 hits | run by me |
| Wire shape `host:idleSuspendChanged {payload:{version,revision}}`, lag hint `revision:0` | matches `server/src/api/ws.rs:3222` | verified |
| `network_security_config.xml` | `cleartextTrafficPermitted=false`, system CAs only | verified |

Caveat: 1228/417 counts are static-grep / pass counts; many Phase 16 static assertions are string-presence checks (`grep -F`), not behavioural.

## Critical
None.

## High (fix before phase sign-off)

**H1. Stale consent banner when same requestId turns non-pending** — `IdleConsentController.refreshStatus` (L~50-58).
```kotlin
if (consent != null && consent.state == PENDING) _pendingConsent = consent
else if (_pendingConsent.value?.requestId != consent?.requestId) _pendingConsent = null
```
If server returns same `requestId` with `approved/denied/expired/cancelled` (decided on other device, timed out), 2nd branch false → `_pendingConsent` stays → banner persists with Approve/Deny enabled. Fix: `else _pendingConsent.value = null` (any non-pending ⇒ clear). No test covers it.

**H2. Force-suspend not re-entrancy guarded** — `requestForceSuspend` sets `_isSubmittingForceSuspend` but never checks it. Double-tap before recomposition = 2 host-suspend POSTs; violates "non-retrying" admission invariant at controller level (only UI `canSubmit` protects). Fix: `if (!_isSubmittingForceSuspend.compareAndSet(false,true)) return Result.failure(...)`. Same for `submitConsent` (`_isSubmittingDecision`).

**H3. No status bootstrap / reconnect reconcile → consent banner can be missed** — Workbench creates `IdleConsentController` but never calls `refreshStatus()` (only `IdleSuspendTabScreen` does `LaunchedEffect(Unit)`), and `handleServerMsg` reacts only to `IdleSuspendChanged` with `rev > lastRevision || rev == 0`. Consent pending before WS connect/after reconnect/after server restart (revision regress) never surfaces unless user opens SSH_HOST panel. Banner is documented as "ALL panels". Fix: refresh once on controller creation and on each WsState→Connected / new receipt; accept `rev != lastRevision` (not just `>`) or force refresh on receipt change.

**H4. Host-control UI reports success it didn't verify (truthfulness)** — `HostControlScreens.kt`:
- Forget credential: `forgetCredential().onSuccess { "Saved passphrase removed" }` ignores `success=false` / `forgotten=false` / `error` (server returns HTTP 200 with `success:false`, see `ssh.rs do_forget_credential`). Shows false confirmation. Failure path shows nothing.
- Load key: if `success=true` but `error!=null` (persist skipped, per `rest-endpoints.md`) the error is dropped; dialog closes even on `success=false` (wrong passphrase → user loses input).
- Diagnostics export: "Diagnostics exported successfully" but bundle only held in `exportResult` and never saved/shared; only a version/timestamp line rendered. Nothing is actually exported to user.
- `listKeys/checkAgent/getCredentialStatus` failures silently ignored → UI falsely shows "No private SSH keys found" / "No SSH passphrase saved" on network error.

**H5. Credential status/forget is not per-key** — API is `keyPath=basename` (docs/ssh.rs) but UI always calls with `null` (server resolves to default key), while keys list shows many keys. Credentials saved for non-default keys can neither be seen nor forgotten; label implies generic "saved passphrase".

## Warnings (medium)

W1. **WS reader backpressure** — Workbench `incomingMessages.collect { p.handle; t.handle; ic.handleServerMsg }`; `handleServerMsg` → `refreshStatus()` awaits an HTTP GET inside the collector. `_incomingMessages = MutableSharedFlow(extraBufferCapacity=64)` default SUSPEND → slow HTTP stalls `emit` in `WsConnection.handleServerMsg` → blocks terminal/fs events for all consumers. Fix: `scope.launch` (conflated) refresh, or make `handleServerMsg` non-suspending w/ a `Channel(CONFLATED)` refresh trigger.

W2. **Controller/repo retirement leak on profile re-create** — in the non-null branch, `agentStoreController?.retire()`, `hostResourceController?.dispose()` etc. are called before rebuild, but `idleConsentController?.retire()`, `portRepo?.clear()`, `tunnelRepo?.clear()` only run in the null (`else`) branch. Switching profile A→B leaves old controller un-retired (its in-flight refresh can still write to its own flows; old pending consent/receiptProvider closure retains old `WsConnection`). Add retire/clear before L~362 construction.

W3. **Consent banner countdown is static & unbounded** — `remember(consent.expiresAtMs)` computes once; never ticks, never expires; uses device clock vs server ms. Expired request still shows enabled Approve/Deny. Needs ticker (`LaunchedEffect` + `delay(1s)`), disable at 0, and clear in controller.

W4. **Recomposition boundary** — `WorkbenchScreen` body does `controller?.pendingConsent?.collectAsState() ?: remember{…}` ×3 (conditional composable calls; also state reads live in the 1346-line root composable so every consent/receipt tick recomposes the whole Workbench scope). Extract `SleepConsentBannerHost(controller, ws)` composable owning its collection.

W5. **Non-atomic StateFlow read-modify-write** — `PortRepository.handleServerMsg`, `TunnelRepository.*` do `toMutableList()` + assign; WS collector thread races with UI-thread `createTunnel/stopTunnel/refresh*` → lost updates. Use `_x.update { }`.

W6. **refreshPorts()/refreshTunnels() overwrite w/o fencing** — HTTP snapshot assigned wholesale; an older GET response can clobber newer WS `PortDiscovered/PortLost` (incarnation fence bypassed). Also `TunnelCreated` event overwrites Ready/url with `url=null, reminderDue=false` if delivered after `TunnelReady`. Merge by incarnation / status rank.

W7. **Swallowed failures in Ports panel** — `createTunnel`, `stopTunnel`, `installCloudflared` results ignored by UI (no error surface; repo `_errorMessage` never rendered). Install: no poll after POST → `Installing…` stays until manual refresh; if `refreshInstallStatus` fails `_isInstalling` sticks true.

W8. **Dead "Copy" control** — `PortsPanelScreen(onCopyToClipboard=null)`; Workbench doesn't pass it → Copy button renders but no-ops. Truthful-controls violation. Wire platform clipboard or hide button. `QrCodeDialog` renders no QR (name misleading).

W9. **Passphrase handling** — `LoadSshKeyDialog` / password field: no `KeyboardOptions(keyboardType = KeyboardType.Password, autoCorrectEnabled=false)` → IME may cache/suggest. Passphrase is immutable `String` in Compose state + request body; JVM strings cannot be zeroized, so "zeroization" is only logical clearing (dialog dismissal). Acceptable if documented; consider `CharArray` field + `FLAG_SECURE` on dialog window. Server custody claim in dialog copy is accurate (`ssh.rs` keyring / `state.ssh_creds`).

## Suggestions
S1. `HostControlRepository.createIntent/approveIntent/executeAction/getAudit` + `ActionIntentRequest/IntentChallenge/ApproveIntentRequest/ExecutionRequest/ActionExecution/ActionAuditPage` have **zero UI callers** (only tests). YAGNI: either wire real approval UI or drop; UI honestly shows only capabilities.
S2. Interpolated path ids `/api/tunnels/$id`, `/intents/$intentId/approve` — use `ApiClient.encodePathSegment`.
S3. `HostControlScreens.kt` = 800 LOC (limit `docs.maxLoc 800`); split into `IdleSuspendTab/SshCredentialsTab/DiagnosticsTab`. `WorkbenchScreen.kt` now 1346 LOC (+108); extract Phase-16 wiring into a `HostFeatureBindings` holder.
S4. `LaunchedEffect(status){ quietSecText = … }` rewrites the user's in-progress timing edit on every status push; guard when field focused/dirty.
S5. Force dialog pre-checks `force=true` after conflict; prefer unchecked + explicit tick since fleet changed (explicit-confirm intent).
S6. Force dialog hides `actionError` (rendered behind Dialog) → non-conflict failures invisible; show error inline.
S7. `IdleConsentController.connection` unused (no fencing by `ConnectionRef`/generation); `IdleSuspendChangedPayload.version` not validated (docs: client validates `version==1`); `_lastRevision` can regress on out-of-order refresh (guard with `max`).
S8. `TunnelSession.toString()` exposes public tunnel `url` (capability-like link) in logs; consider redacting. Remove `LOST` ports after TTL (list grows unbounded); `DetectedPort` fence by `(sessionId,port)` not `port` alone.

## Test Assessment
- Good: redaction toString tests (4 types), receipt fail-closed (null receipt → failure, with receipt → capability/requestId submitted), force-suspend 409 variants, old-server normalization, incarnation fencing (stale/newer/lost), FAB/WebView scans.
- Gaps / weak:
  - `IdleConsentControllerTest` step 4 (lag `revision=0`) is vacuous: registers unused `status-check` handler, `refreshTriggered` never asserted, asserts `lastRevision==20` which was already 20 → would pass if `handleServerMsg` were a no-op. Needs counter on `/status` hits + revision bump.
  - No tests: H1 (same-id non-pending), `retire()`, double-submit guard, receipt revoked mid-flight, `rev<=last` ignore, Tunnel WS events out-of-order, Forget/Load failure truthfulness, UI/Compose behaviour (none; static greps only).
  - Phase-16 static script + androidApp test = string-presence; `hasLiveReceipt = liveReceipt != null` asserted by text, not behaviour. FAB scan only covers `features/host`, not Workbench.

## Positive
- Capability token / passphrase / password / approvalToken / receipt redacted in `toString` consistently; receipt read at submit time from live `WsConnection.currentReceipt` (cleared in `closeInternal`), fail-closed message.
- Force-suspend: `ApiClient` has no auto-retry; 409 variants map to typed exceptions; refresh authoritative status after every outcome; `require` bounds (60..86400 / 0).
- Old-server fallback normalization per docs (both absent → empty-fleet; partial → reject).
- Diagnostics default `includeTerminalOutput=false` + explicit privacy-warning checkbox; `encodeDefaults=true` ensures it is on the wire.
- Banner mounted at Workbench level (outside panel), no extra top row, 0 FAB, 0 WebView, TLS-only netsec config.
- Wire kind/payload shape for `host:idleSuspendChanged` matches server incl. `revision:0` lag hint.

## Recommended Actions (priority)
1. Fix H1 (`else → null`), add test.
2. Add re-entrancy guards H2.
3. Bootstrap/reconnect refresh H3; make `handleServerMsg` non-blocking W1.
4. Make host-control UI truthful H4/H5 (check `success/forgotten/error`, per-key credential, surface list failures, real export/save or relabel).
5. Retire/clear on profile rebuild W2; extract banner host composable W4; ticking countdown W3.
6. Strengthen lag/retire/out-of-order tests; behavioural not grep.
7. Wire or hide Copy; wire or remove unused intent/execute APIs.

## Unresolved Questions
1. Is manual-approval flow for privileged host actions (`intents/approve/executions`) intended in Phase 16 or deferred? Currently dead code with no UI.
2. Does server push an initial `host:idleSuspendChanged` (or consent) on WS connect? If yes H3 is partly mitigated; not found in `ws.rs` review.
3. Expected UX for diagnostics export: save to Downloads / share sheet vs in-memory preview? Current UI exports nowhere.
4. Should per-key credential management (multi-key) be in scope, or default-key only?
5. Is Kotlin `String` passphrase accepted for "zeroization" requirement (JVM limitation), or is a CharArray path required?
6. Gradle suites not re-run by reviewer; relying on tester report 417/417 + assembleDebug.
