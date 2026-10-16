# Code Review — Phase 16 (Ports, Tunnels, Idle Consent, Host Controls) — Cycle 2

Reviewer: ReviewPhase16Cycle2 | Date: 2026-10-16 | Branch: feat/android-native-app (uncommitted Phase 16 tree on 9c9badd7)

## Score: 7/10 — changes required (unchanged vs cycle 1)

Critical: **0** | High (residual/new): **3** | Warnings: **9** | Suggestions: **7**

Cycle-1 remediation is real and mostly sound (H1, H5, W2, W3, W4, W5, W8 verified fixed). Score held at 7 because 2 of 5 Highs are only partially fixed, 1 new High found (error wiped before render), and tests don't cover the new behaviours. No security hole; server enforces capability/revision independently. Tests/APK green.

## Scope
- Read in full: `IdleConsentController`, `IdleSuspendRepository`, `PortRepository`, `TunnelRepository`, `SshRepository`, `HostControlRepository`, `DiagnosticsRepository`, `PortsPanelScreen`, `PortsDialogs`, `IdleSuspendDialogs`, `HostControlScreens`, Phase-16 hunks of `WorkbenchScreen` (L217-472, 769-808, 1201-1228, 1345-1367), `ServerMsg` diff; tests `IdleConsentControllerTest`, `PortsAndTunnelsRepositoryTest`, `SshAndDiagnosticsRepositoryTest` (assertions), `PortsAndHostControlsPhase16Test` (outline).
- Cross-checked server: `server/src/api/ssh.rs` (per-key `keyPath`=basename, 200+`success:false`/`error` shape), `server/src/api/ws.rs` (only `pump_idle_suspend_hints`; no initial push on connect).
- Updated plans: none (no plan file given).

## Validation
| Check | Result |
|---|---|
| `bash tests/test-phase-16-ports-tunnels-host-controls.sh` | 194/194 pass (run by me) |
| `./gradlew :shared:jvmTest :androidApp:testDebugUnitTest :androidApp:assembleDebug` | exit 0 (run by me; tasks up-to-date from Main's run at 22:55, no source change since) |
| JUnit XML totals | shared jvmTest **282** tests, androidApp debug unit **68** = **350/350**, 0 fail/err/skip; Phase-16 classes: IdleConsentController 5, PortsAndTunnelsRepo 2, SshAndDiagnosticsRepo 2, PortsAndHostControlsPhase16 5 |
| APK | `androidApp-debug.apk` 37.7 MB, built 22:55:55 |
| Release unit tests / test-phase-02..15 | not re-run (cycle-1 tester report only) |

Caveat: static script + androidApp Phase16Test are string/source scans; no Compose/UI interaction tests exist. 350 green ≠ behavioural coverage of the items below.

## Remediation status (implemented / covered / remaining)
| Item | Implemented | Test coverage | Remaining |
|---|---|---|---|
| H1 stale consent cleared | Yes (`else → null`) | Yes (`testPendingConsentClearedWhenStateTurnsNonPending`, also retire) | none |
| H2 re-entrancy | Yes (flag check both paths) | **No** | not CAS (`.value` check-then-set); safe only on single dispatcher; flag reset not in `finally` |
| H3 bootstrap/reconcile | Partial: refresh at controller creation (Workbench L386), `rev != last` | lag(rev=0) test now real (hit count + rev 25) | **no refresh on WS reconnect / new receipt**; server has no initial push |
| H4 truthful UI | Partial: load-key + per-key forget check `success/forgotten/error`; export relabelled honest ("server daemon memory") | none (UI) | see High-2/3 |
| H5 per-key creds | Yes (per-key status map, per-key forget/load by `key.name`=basename, matches ssh.rs) | repo-level only | default-key card kept alongside |
| W1 non-blocking collector | Yes (`coroutineScope.launch`) | no | launch per *every* WS msg; unconflated; see W-A |
| W2 retirement | Yes (retire/clear at L365-367 before rebuild + null branch) | no | init-failure window, see W-B |
| W3 ticker | Yes (`LaunchedEffect`+`delay(1s)`, buttons disabled at 0) | no | device clock vs server `expiresAtMs`; controller doesn't expire |
| W4 isolation | Yes (`SleepConsentBannerHost` owns collection) | no | — |
| W5 atomic update | Yes (`_x.update{}` everywhere) | no concurrency test | — |
| W6 fencing | Partial: ports refresh incarnation-fenced; `TunnelCreated` keeps READY/url | none | tunnel snapshot not fenced vs WS; WS-discovered ports during in-flight GET dropped |
| W7 swallowed failures | Partial: error banner added; install/refresh errors shown | none | create/stop failures still invisible, see W-C |
| W8 Copy | Yes (`LocalClipboardManager` default + notice) | no | `QrCodeDialog` still no QR/Copy |

## Critical
None.

## High
**High-1 (NEW). Action errors wiped before render / never shown** — `IdleConsentController`.
`refreshStatus()` begins with `_actionError.value = null` (L50). `submitConsent` (L191-194) and `requestForceSuspend` (L131-147, handoff + generic branches) set `_actionError` then call `refreshStatus()` → error cleared synchronously unless the refresh itself fails. Additionally: `SleepConsentBannerHost` never reads `actionError` (consent decision failure — stale revision, bad capability, network — is invisible), and `ManualForceSuspendDialog` doesn't render it (S6 cycle 1). Net: failed sleep-consent / force-suspend appear to do nothing. Violates H4 truthfulness for the most safety-relevant action. Fix: split mutation error from refresh error (don't clear in `refreshStatus`; clear only at start of a mutation), render in banner + force dialog. Add test: failed decision → `actionError != null` after call.

**High-2 (H3 residual). No reconnect reconciliation.** Consent that becomes pending while WS is down (or across server restart) is only discovered on next `host:idleSuspendChanged` or when user opens SSH_HOST tab. `ws.rs` has no initial push (only `pump_idle_suspend_hints`). Fix: `LaunchedEffect(ws.currentReceipt)` → on each new non-null receipt `ic.refreshStatus()` (coalesced). No test.

**High-3 (H4 residual). Default-credential Forget still unverified** — `HostControlScreens.kt` L543-547: `forgetCredential().onSuccess { "Saved passphrase removed…"; reload() }` ignores `success=false`/`forgotten=false`/`error`; no `onFailure`. Server returns HTTP 200 + `success:false` (keyring error) → false confirmation while credential remains. Also `CredentialStatus.error` (keyring failure, HTTP 200) ignored in default card and per-key map → renders "No SSH passphrase currently saved" on keyring error. `getCapabilities`/`checkAgent` failures silent → "Querying server capabilities…"/"Probing ssh-add…" forever. Per-key forget (L607-618) is correct; reuse it.

(Advisor note: High-3 is Medium if you consider the false-success text only; I keep High because the text asserts deletion of a credential that may persist.)

## Warnings
- **W-A. WS handler runs per message + stale status.** `WorkbenchScreen` L779 launches a coroutine for *every* incoming WS message (terminal frames included) though `handleServerMsg` ignores all but `IdleSuspendChanged`. Filter before launch (`if (msg is ServerMsg.IdleSuspendChanged)`). Parallel refreshes are unconflated and `refreshStatus` doesn't revision-fence `_status/_pendingConsent` (only `_lastRevision` uses `max`) → older GET can regress newer consent state. Add single-flight/conflated refresh + `if (s.statusRevision < lastRevision) ignore`.
- **W-B. Mixed-owner window / init failure.** Message collector (L769) is keyed on new `activeProfileId` but old `portRepo/tunnelRepo/idleConsentController` until L379-385; old controller isn't retired until L365; `catch (_: Exception) {}` (L406) on init failure leaves previous profile's controls bound while header shows new profile. Retire/clear Phase-16 bundle at top of the effect (before any await) and publish as one bundle. Same pre-existing pattern for other phases; Phase 16 adds more state.
- **W-C. Ports panel still swallows create/stop failures.** `createTunnel`/`stopTunnel` never set `_errorMessage`; UI (L239, L297) discards the `Result`. Error banner "Dismiss" only clears `copiedUrlNotice`, so repo errors are un-dismissable until next refresh. Install: single `refreshInstallStatus` after POST, no poll → "Installing…" until manual refresh; if that refresh fails `_isInstalling` stays true; install dialog closes regardless of outcome.
- **W-D. Force-suspend/consent guards not atomic.** `.value` check-then-set (H2). OK on Main dispatcher, wrong if ever called off-main; use `compareAndSet` + `try/finally` for flag reset. No double-submit test.
- **W-E. Tunnel snapshot unfenced.** `refreshTunnels()` wholesale-replaces; older GET can regress READY→STARTING, drop WS-created items. `refreshPorts()` same for ports created during GET.
- **W-F. Consent expiry uses device clock** vs server `expiresAtMs`; skew shows wrong countdown/disables early or late. Controller never clears expired pending consent (server hint/refresh does).
- **W-G. Test weakness.** `testForceSuspendNonRetryingConflicts` sets up 409 handlers but never sends `X-Mode` → only the 202 branch runs (callCount==1). Test name overclaims; active-fleet/fleet-changed/handoff mapping untested (it was cited as good in cycle 1 — regression of coverage or never real). No tests: double-submit, out-of-order refresh, TunnelCreated-after-Ready, refreshPorts-vs-WS race, error surfacing, profile retirement.
- **W-H. File size.** `HostControlScreens.kt` 849 LOC (was 800), `WorkbenchScreen.kt` 1367, `PortsPanelScreen.kt` 549; rule is <200. Split per tab.
- **W-I. Diagnostics UX.** `statusMessage = "Diagnostics exported successfully"` while nothing is saved/shared; secondary box clarifies "in server daemon memory", but top banner still overclaims. `windowMinutes` invalid/empty silently becomes 60.

## Suggestions
1. YAGNI: `HostControlRepository.createIntent/approveIntent/executeAction/getAudit` + models still have no UI callers (S1 cycle 1 unchanged).
2. Use `ApiClient.encodePathSegment` for `/api/tunnels/$id`, `/intents/$intentId/approve` (S2 unchanged).
3. `LaunchedEffect(status)` still overwrites in-progress timing edits on every status push.
4. Force dialog pre-checks `force=true` after conflict; prefer explicit tick (S5).
5. Validate-and-clamp `_lastRevision` strategy: `max` + `!=` can mask server-restart revision regress; consider epoch/instance id.
6. `TunnelSession.toString()` still exposes public URL; LOST ports never pruned; `DetectedPort` keyed by `port` only (S8).
7. `QrCodeDialog` misnamed (no QR); add Copy there or rename. `LocalClipboardManager` is deprecated in newer Compose — switch to `LocalClipboard` when upgrading.

## Positive
- H1 fix + test + `retire()` test; lag-hint test now genuine (hit counter, rev 25).
- `SleepConsentBannerHost` extraction, ticking countdown, disabled-at-zero, fail-closed receipt gating retained.
- Per-key credential UX with correct basename semantics; `keyboardType=Password` + `autoCorrectEnabled=false` + `PasswordVisualTransformation` on passphrase (W9 partly addressed).
- All StateFlow mutations atomic via `update{}`; port incarnation fencing retained.
- 0 FAB / 0 WebView / TLS-only config preserved; redaction `toString` intact.

## Recommended actions (priority)
1. High-1: don't clear `_actionError` in `refreshStatus`; render in banner + force dialog; test.
2. High-2: refresh on new WS receipt (coalesced, owner-fenced).
3. High-3: verify `success/forgotten/error` on default forget; surface `CredentialStatus.error`, `checkAgent`/`getCapabilities` failures.
4. W-A: filter before `launch`, single-flight + revision fence in `refreshStatus`.
5. W-B: retire/clear bundle at effect start; reject stale init.
6. W-C: surface create/stop failures; dismissable repo errors; poll install status.
7. Fix `testForceSuspendNonRetryingConflicts` (send `X-Mode`, assert each branch, 1 request, no retry) + add double-submit/out-of-order tests.
8. Split `HostControlScreens.kt` / extract Phase-16 wiring from Workbench.

## Metrics
- Tests: 350/350 pass (shared 282 + androidApp debug 68); Phase-16 static 194/194; assembleDebug OK.
- Lint/type: no compile errors; not run: detekt/ktlint (none observed configured).
- Behavioural coverage of Cycle-1 fixes: H1 covered; H2/H3/H4/W1-W8 uncovered by behavioural tests.

## Unresolved questions
1. Should failed consent/force-suspend errors be shown in the banner itself or only in the SSH_HOST tab?
2. Is a reconnect-triggered `refreshStatus` acceptable load-wise, or should the server push an initial hint on WS connect?
3. Diagnostics export: save/share to device in scope for Phase 16, or in-memory acknowledgement only?
4. Is the manual intent/approve/execute flow deferred (dead code) or required now?
5. Release unit tests and phases 02-15 scripts not re-run by me — rely on tester report?
