# Android Settings / notifications — targeted final review

## Score
**7/10 — changes required.** Provisional source-review assessment, not release approval.

## Scope and evidence
- Reviewed change inventory and the five blocker fixes across runtime/readiness, Settings operations, integration dialogs, retained workspace routing, shortcut input and force-suspend confirmation. Supporting inspection: transport admission, notification coordinator/privacy, command-history persistence, diagnostics allowlist, feature contracts, previous review and selected regression tests. Not an exhaustive line-by-line audit of the larger working tree.
- Principal source: `NativeWorkspaceViewModel.kt`, `AgentIntegrationView.kt`, `AgentIntegrationRepository.kt`, `SettingsRepository.kt`, `SettingsPorts.kt`, `SettingsHostView.kt`, `RemoteConfigEditor.kt`, `RemoteConfigScreen.kt`, `AppFlowNavigation.kt`, `AppFlowState.kt`, `DamHopperMobileApp.kt`, `ProjectWorkspaceState.kt`, `ProjectWorkspaceScreen.kt`, `ProjectTerminalState.kt`, `ProjectTerminalScreen.kt`, `HostControlScreens.kt`, `IdleConsentController.kt`, `HardwareShortcutRegistry.kt`, `WorkspaceSearchView.kt`, `ApiClient.kt`, `NotificationCoordinator.kt`, `AndroidNotificationSink.kt`, `AndroidCommandHistoryStore.kt`, `SettingsDiagnostics.kt`.
- **User/Main reports 901 passing unit tests: 725 shared JVM + 176 Android unit.** Accepted as reported; not rerun. No build, test, lint, device or live-server verification performed by this reviewer. Test counts are not scenario coverage percentages.
- Source changed during review. Re-read affected sections; superseded issues are not retained below: captured execution is now private; force conflict effect no longer renews the ticket; preference-source property spelling is corrected.
- Product code and plan/task status unchanged by reviewer. This report only. No plan assigned for status updates.

Path shorthand: **A/** = `native/android-app/androidApp/src/main/kotlin/dev/damhopper/nativeapp/`; **S/** = `native/android-app/shared/src/commonMain/kotlin/dev/damhopper/nativeapp/`.

## Critical issues
**No critical security issue confirmed in inspected scope.** This does not establish absence of vulnerabilities, complete acceptance or device/release readiness.

## Warnings

### W1 — High: readiness still relies on UI busy state rather than captured mutation lifetime
**Evidence:** `A/platform/workspace/NativeWorkspaceViewModel.kt:178-215,616-635,874-883,988-994,1057-1066,1088-1094`; `S/features/settings/SettingsRepository.kt:452-479,570-576,744-775,943-969`; `RemoteConfigEditor.kt:251-291`.

The added callback blocks publication/effects while the observed integration/config/admin state is busy. The separate preference-source check now correctly recognizes A independently of target B. However:
- Explicit `beginMutation`/`endMutation` still wrap only `coordinator.invalidateRuntime`, not the subsequent HTTP mutation.
- Source/target selection changes clear Settings busy tokens even if an already-admitted request is unresolved. Replacing the selected profile is not completion of its request.
- Verification captures the provider revision before network reads and checks busy only at publication. A refresh begun during a mutation can retain the same revision and publish after busy clears; settlement does not advance that provider revision. The asynchronous path/integration refresh collectors do not provide an atomic settlement/publication fence.
- The profile `HashSet` cannot represent overlapping invalidations independently: one end removes the other's marker.
- No deterministic config-save-settlement refresh hook was found in the inspected wiring: integration has a busy-to-idle collector and paths have revision/busy collectors; `configEditor` is constructed without equivalent settlement wiring. A successful full-config save can leave readiness unavailable until another refresh trigger.

**Impact [INFERENCE; source-traced, not executed]:** old path/integration proof can become VERIFIED during an unresolved mutation or immediately after it, admitting fresh alerts from invalid evidence; the converse is indefinite loss of notifications after config save.

**Correction:** retain exact-owner, operation-qualified mutation tokens through request settlement/reconciliation independently of selected UI busy state. Fence overlapping verification with the existing provider gate/revision, and start fresh verification after settlement. Preserve fail-closed behavior for cleanup failure and unresolved Unknown/cancellation. Reuse existing coordination; no retry loop or second runtime.

**Needed evidence:** held mutation with A != B; source/target switch after admission; refresh beginning during mutation and completing afterward; overlapping same-profile operations; cleanup failure/Unknown; full-config save followed by fresh same-generation attention. These scenarios were not shown in inspected readiness tests. **Confidence: high for lifetime and ordering gaps; runtime interleavings unexecuted.**

### W2 — High: integration dialog still does not retain opening-time selection authority
**Evidence:** `S/features/settings/AgentIntegrationView.kt:71,100-123,217-218,233-247`; `AgentIntegrationRepository.kt:148-175`; `SettingsRepository.kt:637-645,715-725`; `SettingsPorts.kt:22-38`.

Capturing repository/path now prevents switching the action to a different repository. Capturing a guard before awaited revocation also fixes the held-revocation ABA window. But `openingTarget` is only `SettingsOwner`; its confirmation-time `isCurrent(owner)` checks current identity, not the opening selection revision. `guardFor(owner)` still captures a new operation when the confirmed repository method runs.

**Failure [INFERENCE]:** open on A, select B, select A, confirm. The same cached A repository and owner are current again, so the identity check passes and a fresh A operation authorizes the old dialog. Its original selection was never retained. The dialog also displays current `targetLabel`, not opening target context.

**Correction:** capture an opening-time Settings operation/ticket together with repository, immutable inputs and display label; carry that operation unchanged through confirmation, revocation and request admission. Identity-only prechecks do not replace a selection revision.

**Needed evidence:** open-dialog A -> B and A -> B -> A; zero revocation/mutation for stale opening authority; unchanged opening permits one attempt. Existing `AgentIntegrationRepositoryTest.suspendedCredentialsThenTargetAbaSendsNothing` covers a later interval, after operation capture. **Confidence: high; dialog sequence unexecuted.**

### W3 — Medium: direct terminal IME composition remains outside the new editable gate
**Evidence:** `S/ui/screens/DamHopperMobileApp.kt:489-503`; `ProjectTerminalScreen.kt:232,1431-1475,1651-1678`; `S/features/settings/HardwareShortcutRegistry.kt:118-134`.

Root now resets/passes through for search, Editor and the explicit command field. This addresses those inputs. However, the invisible direct terminal `BasicTextField` also accepts IME input and retains `TextFieldValue.composition`; it publishes neither focus nor composition to the gate. Root still supplies `composing = false`.

**Impact [INFERENCE]:** an app-delivered configured chord or DoubleShift can dispatch during direct-terminal composition instead of being vetoed. No claim that Android delivers OS/IME-reserved keys, and no unintended terminal input reproduced. Reset is also event-driven; focus/composition transitions between key events do not themselves clear pending taps.

**Correction:** expose actual composition/focus from the direct terminal host to the existing registry and reset pending state on relevant transitions. Keep terminal shortcuts available outside composition as intended; do not disable every terminal key indiscriminately. **Confidence: high for missing producer/consumer path; device manifestation unverified.**

### W4 — Medium: retained activation lookup is worktree-qualified but still omits logical owner identity
**Evidence:** `A/platform/workspace/NativeWorkspaceViewModel.kt:867,897-902,1100-1163,1282-1289`; `S/ui/screens/DamHopperMobileApp.kt:296-311`; `ProjectWorkspaceState.kt:91-98,124-127`.

The added worktree predicate fixes the previously identified same-project/different-worktree lookup. New-state creation also applies the pending session. But the cache is keyed by full `WorkspaceFileOwner` while activation still scans by profile/project/worktree only. Retirement revokes retained workspace authority without removing those entries.

**Failure [INFERENCE]:** after endpoint/account replacement under the same profile ID, old and current retained workspaces can have identical target fields. `firstOrNull` can select the revoked old state, leaving the current retained destination on Files/Editor instead of Terminal. The existing-state return does not apply the new-state activation hook.

**Correction:** resolve activation through the exact current logical owner/cache key, including endpoint/account and current authority, rather than scanning a partial identity. Do not discard old dirty state as a workaround. **Confidence: high for incomplete predicate/cache retention; selection interleaving unexecuted.**

## Named fix disposition
| Fix | Source assessment |
|---|---|
| Extended readiness fence | Improvement; unresolved W1. |
| Worktree route and Settings-origin protection | Worktree predicate, new-state session application and explicit notification-route cause present. Residual owner variant W4. |
| Frozen integration action | Repository/inputs captured; guard moved before awaited invalidation. Opening selection authority still missing, W2. |
| Shortcut editable input gates | Search/Editor/command field protected; direct terminal composition still missing, W3. |
| Force-dialog authority | Specific silent conflict-ticket renewal removed. Continuing dialog uses original ticket. Original finding closed in source. |

## Suggestions — security, performance, architecture, YAGNI/KISS/DRY
1. Prioritize W1/W2; reuse existing SettingsOperation/HostMutationTicket and provider mutex/revision machinery. Avoid new generic authority frameworks, alternate runtimes or automatic retries.
2. Remove duplicate focus authority: `ProjectWorkspaceState.kt:104-105` remains an unused command-focus flow while `ProjectTerminalState.kt:102` is written by the command field. Keep one meaningful producer, with direct composition modeled explicitly.
3. Clear/invalidate old search hits when the query changes, or bind opening eligibility to their producing query. `WorkspaceSearchView.kt:71-103,140-146` keeps old results clickable during debounce/request; its comment at 48-50 overstates the guarantee.
4. Reconcile docs at closeout: `docs/code-standards.md:73` still says scroll 1..20 rather than the frozen 1..50; `docs/architecture/android-native-client.md:487-498` still labels implemented source as a proposed, unimplemented increment. Retain device/live-server qualification caveats.
5. After correctness, split the large VM along existing lifetimes—readiness/runtime, target services, route activation—only where it reduces coupled state. No unrelated restyling or abstraction. No measured performance regression established here.

## Positive observations
- Request-local single-use admission, guard-before-execute and disabled default redirects remain intact in inspected transport; no mutation retry/auth replay added.
- Notification effects remain behind the provider gate; bounded feed/transients, fixed semantic wording, private visibility, generic public version and immutable data-qualified PendingIntents reduce disclosure and routing risk.
- Command history is opt-in, backup-excluded, endpoint/account/profile/project-qualified and bounded. Diagnostics use a typed disclosure allowlist rather than dumping arbitrary state.
- The worktree-routing correction and removal of conflict-triggered authority renewal are small, appropriately scoped changes.

## Validation and unresolved evidence
- No checks exercised by this reviewer; reported 901 passes acknowledged. Type coverage, test coverage percentage and lint counts unavailable.
- Main should validate the named deterministic transition regressions, not rerun suites merely to reconfirm reported results. Inspected tests do not establish those specific mounted/dialog/readiness journeys.
- MainActivity/live-server routing, API29/API33+ permission/channel/audio, lockscreen presentation, physical keyboard/IME, physical-device performance and visual qualification remain separate gates.
- No unresolved product decision identified. Remaining uncertainty is runtime evidence for the source-traced cases above.
