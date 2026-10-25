# Phase 02 — Complete native Settings branch

Priority P2; status in-progress. Owner: Settings implementer. Runs concurrently with Phase03 only after Phase01 terminal. Inputs: [contracts](contracts.md), [per-control parity](parity-matrix.md), [web evidence](scout/web-feature-evidence.md). Policy/models/ports frozen read-only. Root, notification reducer/sink/audio and reactive workspace consumers excluded. Settings operation-fencing and remote-admin tasks remain open for the W1 readiness/mutation-lifetime correction; see overview.

## Related files and ownership

Task fences enumerate exclusive writes. New scoped views/orchestrator/diagnostics reuse existing endpoints. WorkspaceRepository known-workspace/TerminalRepository agent methods **already exist**; branch owns guard propagation/serialization, not duplicate transport. Own IdleSuspendRepository dynamic bounds and UsageDialogs/IdleSuspendDialogs callers. G0 ApiClient/registry/profile and **proposed awaited C2a1 barriers** frozen read-only; this branch consumes availability/failure latch, never registers root barriers or invents recovery/retry. S2 awaited invalidator must transitively avoid profile/registry reentry/awaiting lock-dependent work. SettingsScreens/NotificationsView/Phase17 transfer to G2; no root/notification writes.

## settings-owner-safe-sync

1. Implement C2a fresh requestGuard: resolve/credentials/preparation outside locks, then registry Mutex→operation **tryLock only**, final non-suspending snapshot/revision check and monotonic terminal guard receipt. No operation→registry/profile; contention NotSubmitted, never retry. Ordered selection/edit invalidation uses same fair operation Mutex/direct UNDISPATCHED callbacks; test actual registered waiter handoff/held-registry invalidation/simultaneous guards, not assumed queue inspection.
2. Android envelope/source migration preserves original bytes, consent and errors. Legacy known/code/text each local all non-equivalent fallback with notice; never dirty or automatically patch remote. Decode/hydrate/save all/rust/javascript-typescript/java correctly; unrelated saves omit fallback filter/unsupported policy.
3. Implement complete dirty UiPreferences including nested v2 while preserving unknown UI/config/policy data. Source failure keeps usable local snapshot and truthful status, never another server. Route every P/T mutation through non-null request-local guard; no client-global guard, fresh precheck-only gap or implicit retry.
4. RemoteConfigRepository/RemoteConfigEditor use exact C2b signatures, owner-qualified base/draft/conflict and outcomes. Global defaults Set `{"defaults":{"workspace":path}}`, Clear `{"defaults":{}}`; existing known workspace API remains distinct. Export/import/cache/reset guarded at existing transport. Decode required imported/fileName/backupFileName/workspaceName; false/missing/malformed imported or malformed2xx cannot confirm; after admission ambiguous response Unknown. Remove ok and migrate all UI/tests.
5. Author meaningful SettingsRepository/RemoteConfigEditor tests for credential suspension A-B-A, retirement/replaced client, wait-on-lock invalidation, ordered intent, guard reuse/cancellation/runCatching and busy-token replacement. Tests use existing transport boundary; pre-admission zero requests, post-admission Unknown, no auth/retry duplicate; never claim socket cancellation. Include every new/legacy language value and malformed import. Run only Phase05.

## settings-remote-admin

1. Surface target-qualified native Usage settings: enable/disable/resume/retry Codex receiver, exporter setup toggle/status, data/retention/deletion destination reusing existing usage APIs and destructive confirmations. Keep remote failure and read-only capability states visible.
2. Reuse idle controllers/views and **IdleSuspendRepository**. Replace repository and controller hard-coded timing validation with latest current-owner status min/max for both fields, pair atomic. Capability/unknown/locked/handoff/noauth prevents submission; fixed agent-free interval remains read-only. Propagate required guard through timing, force-suspend and consent mutations C2b; preserve non-retry semantics.
3. GlobalSettingsView reuses WorkspaceRepository list/add/remove and adds required guards to its two mutation methods. Current removal disabled/server rejection preserved; remote paths remain remote. Defaults Set/Clear exact C2b payloads and independent selected target.
4. Structured RemoteConfigScreen handles workspace/projects/services/commands/terminal profiles and unknown fields/conflicts as parity C01–C09 specifies. Stable row IDs, required/duplicate validation; raw JSON supplemental only.
5. AgentIntegrationRepository reuses TerminalRepository C2b guards/structured serializers. Inject `invalidateRuntime: suspend (ConnectionRef)->Unit`; SettingsRepository path patch/RemoteConfigEditor writes also **await revocation before edit/install/uninstall/request**, not eventual flow. Failure/cancellation aborts mutation, cannot claim success or retry; caller cleanup preserves cancellation. Callback chain transitively no profile/registry reentry or awaiting work requiring those locks; I1 wires provider.invalidate and G0 barrier lifetime, S2 never changes registry/profile. Exact owner/socket/endpoint/account/path revision, B never verifies C; escaped paths/stale discard. N1 consumer and I1 provider remain disjoint.
6. Author AgentIntegrationRepositoryTest plus new TerminalRepositoryIntegrationTest and IdleSuspendRepositoryTest, existing IdleConsentControllerTest, UsageControllerLoadingTest, WorkspaceRepositoryTest and UsageRepositoryAndControllerTest. Cover every reused mutation suspended-credential invalidation, exact Set/Clear payload, dynamic bounds, cancellation wrappers, authoritative readiness status, path escaping and zero replay. No endpoint/backend/dependency expansion.

## settings-native-controls

1. Build all parity-matrix control rows with actual handlers; no display-only writable preferences. Independent target/source selectors, offline/removed-source status, full appearance/shortcut editor, host/global/config/admin, maintenance and notifications subsections use retained services injected later. Replace Settings-view hard-coded typography/colors with shared theme tokens so integration can apply system-font scaling and real theme palettes without undeclared view edits.
2. History privacy/clear and real accessory keyboard controls per parity. Shortcut capture/cancel/reset/collision follows frozen C1 Android Mod→Ctrl, explicit Meta, physical DOM-code grammar and DoubleShift450, not chord-only approximation. Only approved Git/Ports/Fleet/IDE-layout unavailable rows; preserve imported bindings/reasons.
3. Notifications v2 editor separates permission and policy, foreground pattern/volume vs OS channel sound, Codex status-only and qualified readiness. Preview is local foreground audio only, no fake production target. Unknown readiness visibly disables enable/install-dependent actions, never grants runtime authority from source/target verification.
4. Maintenance cache/query revalidation target-qualified. Reset confirmation says PTYs/runtime state destroyed, **saved preferences not reset**; dirty guard before local admission and Unknown cannot navigate. Diagnostics LOCAL allowlist excludes secrets/private paths/history/raw commands/output, CreateDocument only.
5. Bounded TOML open/create C2; required imported response controls authoritative success/backup display, never obsolete ok. Cancel/error/stale callbacks clean only their token; no retry/rollback claim. Existing transfer launchers independent.
6. Adapt SettingsScreens host/ports. **Delete obsolete source-wording/static implementation assertions** from SettingsPreferencesPhase17Test; replace only with meaningful behavior/boundary/precedence/error regressions, never re-pin new labels/channels/keys/source fragments. Runtime/UI tests later prove actual controls. Handoff exact changed signatures and readiness state to integration.

## Success/checks

Every parity row S/H/G/C/M/A/N has a real view/action and exact service; no raw-JSON-only parity, inert toggle or target/source conflation. Future qualification: `pnpm native-app:test`, `pnpm native-app:test:android`; actual MainActivity two-server tests and SAF/admin scenarios in Phase05. Branch performs no suites/formatting. Inspection checks every async branch including catch/finally, not only happy response.

## Risks/security/failure/rollback

Settings target is remote authority; do not use currently viewed workspace as fallback. Imports/config/install/reset destructive outcomes may be ambiguous: no automatic replay or rollback claim. Preserve user draft/unknown JSON fields and original local bytes; explicit server import backup is recovery evidence only. Local diagnostics uses field allowlist, not redaction-after-export. Remote paths never passed to Android filesystem or executed locally. On unavailable capability show disabled reason and retry-by-user, not fake success. Rollback feature code by scoped corrective edits; no remote mutation reversal without explicit operator recovery. Related explorer/editor plans release overlapping host/runtime callers before integration.

```evcrate-tasks
[
  {
    "id": "settings-owner-safe-sync",
    "title": "Implement v2 persistence and fresh-owner-fenced Settings operations",
    "blocked_by": ["freeze-native-contracts"],
    "allowed_files": [
      "native/android-app/shared/src/commonMain/kotlin/dev/damhopper/nativeapp/features/settings/SettingsRepository.kt",
      "native/android-app/shared/src/commonMain/kotlin/dev/damhopper/nativeapp/features/settings/RemoteConfigRepository.kt",
      "native/android-app/shared/src/commonMain/kotlin/dev/damhopper/nativeapp/features/settings/RemoteConfigEditor.kt",
      "native/android-app/androidApp/src/main/kotlin/dev/damhopper/nativeapp/platform/storage/AndroidPreferencesStore.kt",
      "native/android-app/shared/src/jvmTest/kotlin/dev/damhopper/nativeapp/features/settings/SettingsRepositoryTest.kt",
      "native/android-app/shared/src/jvmTest/kotlin/dev/damhopper/nativeapp/features/settings/RemoteConfigEditorTest.kt"
    ],
    "constraints": ["G0 transport/profile/model contracts read-only; C2a exact atomic local admission and same-Mutex ordered invalidation, not captured-client/precheck-only fencing.", "No root/notification/backend/dependency writes; no checks mid-flight; no retry or socket non-delivery claim."],
    "acceptance": ["All four real language values synchronize; legacy known/code/text local all fallback preserves bytes/notice and never marks dirty or auto-saves remote.", "Every P/T config/UI/import/cache/reset mutation uses request-local admission after credentials; queued newer intent/retirement prevents execution.", "Import required imported response and exact defaults Set/Clear have honest confirmed/not-submitted/rejected/unknown outcomes and token cleanup."],
    "verification": ["Phase05 runs SettingsRepositoryTest/RemoteConfigEditorTest with all language wires, fallback omission, exact defaults JSON, malformed2xx/imported=false, suspended-credential A-B-A, ordered callbacks, post-admission cancellation and no replay."]
  },
  {
    "id": "settings-remote-admin",
    "title": "Implement complete remote host, global, structured config and agent integration Settings",
    "blocked_by": ["settings-owner-safe-sync"],
    "allowed_files": [
      "native/android-app/shared/src/commonMain/kotlin/dev/damhopper/nativeapp/features/settings/RemoteConfigRepository.kt",
      "native/android-app/shared/src/commonMain/kotlin/dev/damhopper/nativeapp/features/settings/RemoteConfigEditor.kt",
      "native/android-app/shared/src/commonMain/kotlin/dev/damhopper/nativeapp/features/settings/RemoteConfigScreen.kt",
      "native/android-app/shared/src/commonMain/kotlin/dev/damhopper/nativeapp/features/settings/GlobalSettingsView.kt",
      "native/android-app/shared/src/commonMain/kotlin/dev/damhopper/nativeapp/features/settings/AgentIntegrationRepository.kt",
      "native/android-app/shared/src/commonMain/kotlin/dev/damhopper/nativeapp/features/settings/AgentIntegrationView.kt",
      "native/android-app/shared/src/commonMain/kotlin/dev/damhopper/nativeapp/features/settings/SettingsHostView.kt",
      "native/android-app/shared/src/commonMain/kotlin/dev/damhopper/nativeapp/features/host/UsageSettingsSection.kt",
      "native/android-app/shared/src/commonMain/kotlin/dev/damhopper/nativeapp/features/host/UsageScreens.kt",
      "native/android-app/shared/src/commonMain/kotlin/dev/damhopper/nativeapp/features/host/UsageController.kt",
      "native/android-app/shared/src/commonMain/kotlin/dev/damhopper/nativeapp/features/host/UsageRepository.kt",
      "native/android-app/shared/src/commonMain/kotlin/dev/damhopper/nativeapp/features/host/HostControlScreens.kt",
      "native/android-app/shared/src/commonMain/kotlin/dev/damhopper/nativeapp/features/host/IdleConsentController.kt",
      "native/android-app/shared/src/commonMain/kotlin/dev/damhopper/nativeapp/features/host/IdleSuspendRepository.kt",
      "native/android-app/shared/src/commonMain/kotlin/dev/damhopper/nativeapp/features/host/IdleSuspendDialogs.kt",
      "native/android-app/shared/src/commonMain/kotlin/dev/damhopper/nativeapp/features/host/UsageDialogs.kt",
      "native/android-app/shared/src/commonMain/kotlin/dev/damhopper/nativeapp/features/workspace/WorkspaceRepository.kt",
      "native/android-app/shared/src/commonMain/kotlin/dev/damhopper/nativeapp/features/terminal/TerminalRepository.kt",
      "native/android-app/shared/src/jvmTest/kotlin/dev/damhopper/nativeapp/features/workspace/WorkspaceRepositoryTest.kt",
      "native/android-app/shared/src/jvmTest/kotlin/dev/damhopper/nativeapp/features/terminal/TerminalRepositoryIntegrationTest.kt",
      "native/android-app/shared/src/jvmTest/kotlin/dev/damhopper/nativeapp/features/host/IdleSuspendRepositoryTest.kt",
      "native/android-app/shared/src/jvmTest/kotlin/dev/damhopper/nativeapp/features/host/IdleConsentControllerTest.kt",
      "native/android-app/shared/src/jvmTest/kotlin/dev/damhopper/nativeapp/features/host/UsageControllerLoadingTest.kt",
      "native/android-app/shared/src/jvmTest/kotlin/dev/damhopper/nativeapp/features/settings/RemoteConfigEditorTest.kt",
      "native/android-app/shared/src/jvmTest/kotlin/dev/damhopper/nativeapp/features/settings/AgentIntegrationRepositoryTest.kt",
      "native/android-app/shared/src/jvmTest/kotlin/dev/damhopper/nativeapp/features/host/UsageRepositoryAndControllerTest.kt"
    ],
    "constraints": ["Reuse sole WorkspaceRepository/TerminalRepository endpoint ownership; exact C2b guards and host callers, no naked mutation or duplicate URLs.", "C3a owner/socket/endpoint/account/path revision; sourceA/targetB never certifies C. Awaited invalidator transitively avoids profile/registry reentry/lock-dependent work.", "G0 proposed C2a1 barriers/failure latch and models read-only; I1 alone registers/wires lifecycle; no root/notification/backend/dependency writes or mid-flight checks."],
    "acceptance": ["Every usage/setup/delete/idle/known/integration mutation forwards required guard; false admission NotSubmitted even reused ADMITTED receipt.", "Defaults exact, dynamic idle repository/controller bounds, config unknown/conflict preservation; pending/failed retirement cannot regain authority through Settings.", "AgentIntegration escaped JSON and awaited revocation before edits/install/mutation; failure/cancellation aborts request, no retry, stale verification cannot reinstate."],
    "verification": ["Phase05 runs named workspace/terminal/idle/usage/AgentIntegration tests for suspended credentials, cancellation, failed invalidator, bounds, escaping, payloads and stale readiness; I1 separately tests real ProfileRepository barrier handoff."]
  },
  {
    "id": "settings-native-controls",
    "title": "Expose every applicable native Settings control and bounded document workflow",
    "blocked_by": ["settings-remote-admin"],
    "allowed_files": [
      "native/android-app/shared/src/commonMain/kotlin/dev/damhopper/nativeapp/features/settings/SettingsScreens.kt",
      "native/android-app/shared/src/commonMain/kotlin/dev/damhopper/nativeapp/features/settings/PreferencesPrivacyView.kt",
      "native/android-app/shared/src/commonMain/kotlin/dev/damhopper/nativeapp/features/settings/NotificationsView.kt",
      "native/android-app/shared/src/commonMain/kotlin/dev/damhopper/nativeapp/features/settings/MaintenanceView.kt",
      "native/android-app/shared/src/commonMain/kotlin/dev/damhopper/nativeapp/features/settings/SettingsConfirmDialogs.kt",
      "native/android-app/shared/src/commonMain/kotlin/dev/damhopper/nativeapp/features/settings/SettingsDiagnostics.kt",
      "native/android-app/androidApp/src/test/kotlin/dev/damhopper/nativeapp/SettingsPreferencesPhase17Test.kt",
      "native/android-app/shared/src/jvmTest/kotlin/dev/damhopper/nativeapp/features/settings/SettingsDiagnosticsTest.kt"
    ],
    "constraints": ["Every parity row real handler or approved unavailable shortcut destination; C1 DoubleShift450/Mod/DOM semantics authoritative.", "No root/consumer/sink writes; use frozen history/document/permission/readiness ports.", "Delete obsolete source-wording assertions, never re-pin source implementation strings; transfer views/test only after both branches terminal, no suites."],
    "acceptance": ["Complete controls capture/cancel/reset DoubleShift and chords, preserve unavailable bindings and show non-equivalent legacy language fallback without remote writes.", "SAF enforces byte/UTF-8/owner gates, actual imported response and honest token cleanup; diagnostics LOCAL only.", "Reset accurately describes PTY/runtime destruction rather than saved preferences; behavior tests replace obsolete static assertions."],
    "verification": ["Phase05 mounted MainActivity parity/SAF/reset tests and saved diagnostics inspection exercise behavior; source scans/new strings cannot substitute."]
  }
]
```

- [x] <!-- evcrate-task:settings-owner-safe-sync --> Complete safe persistence and operation fencing
- [x] <!-- evcrate-task:settings-remote-admin --> Complete remote administrative parity
- [x] <!-- evcrate-task:settings-native-controls --> Complete native Settings views and ports
