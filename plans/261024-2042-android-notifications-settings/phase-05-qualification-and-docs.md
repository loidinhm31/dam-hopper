# Phase 05 — Coherent qualification and truthful documentation

Priority P2; status in-progress. Integration owner is single verification coordinator; docs-manager writes final docs only after qualification terminal. Reported unit/build evidence is recorded, but the MainActivity/live-server and physical-device qualification gates remain future work. [Contracts](contracts.md), [parity matrix](parity-matrix.md), [architecture intended increment](../../docs/architecture/android-native-client.md#intended-increment-active-settings-and-notifications-not-implemented) are acceptance authority, not evidence of implementation.
## Current qualification status and supplied evidence

- Reported: **725 passed** in `:shared:jvmTest`; **176 passed** in `:androidApp:testDebugUnitTest`; `:androidApp:assembleDebug` built cleanly.
- The latest source-review report accepts the unit totals as supplied but did not rerun tests or build. These results do not close the full qualification task.
- Planned future gates: actual MainActivity with qualified live Linux server, physical-device qualification, and API29/API33+ notification/permission/channel/audio and related acceptance scenarios below. No device/live-server result is claimed.
- Documentation is still assigned to docs-manager after qualification; `docs/` was not edited in this tracking update.

## Ownership, prerequisites, related files

Only after Phase04 terminal/all overlapping writers released. Qualification receives Phase17/lifecycle/delivery tests. New SettingsNotificationJourneysTest mounts **MainActivity**; NativeSettingsServerFixture independently observes real qualified Linux server, existing file fixture read/reused not modified. Delete obsolete source-wording/implementation scans from existing Phase17 script if affected; do not re-pin channel/key/label/source assertions. Script is **not required behavior acceptance**, no mandatory execution. Permanent tests exercise boundaries/precedence/errors/actions. Missing environment/device remains unexecuted, never mock replacement/waiver.

## qualify-active-settings-notifications

1. Reconcile terminal changes and exact writable-file ledger, no pending shared writer. Extend tests with actual mounted Settings controls and all parity IDs. Independent reviewer examines lifecycle/permission/destructive-admin/click authorization changes; severe unresolved findings block. Fixes return to proper implementation owner under revised ownership, not broaden this verification task to arbitrary source writes.
2. Execute coherent commands once after source convergence, recording command/exit code/device/server build and exact report locations. These are **future planned** commands from root:
   - `pnpm native-app:test`
   - `pnpm native-app:test:android`
   - `pnpm native-app:assembleDebug`
   - `node scripts/run-gradle.mjs :androidApp:compileDebugAndroidTestKotlin`
   - `node scripts/run-gradle.mjs :androidApp:connectedDebugAndroidTest` with explicitly selected API29 and API33+ device/emulator. Record actual serial/API/ABI; sequential device runs, no simultaneous full suites.
   No required static-script command. Any throwaway structural-wiring inspection is supplemental only, removed afterward; it cannot prove consumer-visible behavior. Existing obsolete Phase17 scans are deleted rather than updated to new implementation strings.
3. Prepare two independently authenticated qualified Linux server profiles, real authorized terminal agents and authoritative observer. Drive genuine server semantic attention through actual MainActivity socket→reducer→policy→history/audio/Android sink. OMP turn-ended/needs-attention, qualified Claude needs-attention, Codex status-only; require fixed safe text. Snapshot/replay/reconnect/gap/revision/epoch/invalidations/terminal replacement remain silent. No test-only broadcast into app used as sole end-to-end evidence.
4. API29 and API33+: fresh permission state, grant/deny/dismiss, app block/channel block, settings-return refresh, foreground manual pattern/volume with silent OS post, background live socket channel audio only, policy browser/toast/sound combinations and zero-volume. Observe actual notification shade/public lockscreen redaction; no app keepalive promise. Stop process: no new-delivery claim; existing shade click cold process produces safe status UX.
5. Click same terminal IDs across profiles/incarnations and colliding legacy hashes, mark-read independent of navigation. Live/cold/newIntent/rotation consume once. Test stale epoch/generation, account/endpoint replacement, unavailable terminal, disconnect and changed project/worktree; after dirty Save/Discard/Cancel guard reconnect before continuation, validate again; newer attentionRevision still allows current terminal. Assert no unintended autoactivation or profile fallback.
6. Settings sourceA/targetB races and real transport regressions: suspend credentials or validator→A-B-A/retirement/auth loss/endpoint-account-client replacement, then resume => **zero transport invocation before admission**. Invalidate while waiting for either lock; ordered direct UI callbacks must invalidate before older queued save. Separate guards cannot cross-talk/reuse; auth/redirect/retry error never duplicates execution. After local admission cancellation/retirement/timeout/malformed2xx Unknown, no socket/server cancellation claim. Existing runCatching preserves cancellation and token-owned busy cleanup. Unknown policy survives font save. All four language values decode/hydrate/save; each legacy known/code/text local-all fallback non-equivalent/notice/recoverable bytes never dirty/remote auto-save.
7. SAF 0/1MiB/+1/multibyte/invalid UTF-8/lying MIME-size/cancel/revoke/partial I/O/rotation/stale target. Assert actual imported=true + required fileName/backupFileName/workspaceName response; false/missing/malformed imported or malformed2xx never success, admitted ambiguity Unknown without replay. Defaults exact Set `{"defaults":{"workspace":path}}` and Clear `{"defaults":{}}`; known workspace registry unaffected. Diagnostics LOCAL secret/history exclusion. Reset destroys PTYs/runtime, not saved preferences; dirty guard before admission, unknown no navigation/retry.
8. Every parity row: family filtering Files/sidebar, hidden/scan truncation/error/stale results; live fonts/zoom/history/scroll1/50/commit/guarded auto-switch/accessory. Hardware Mod=Ctrl vs Meta, physical DOM codes, default DoubleShift449/450/451ms/release/repeat/composition/focus/route/capture/owner/privacy gates, collisions/cancel/no hidden leak; only approved unavailable destinations. Usage/idle dynamic repository+controller bounds/defaults/known/config; escaped integration paths. EventC cannot reuse sourceA/targetB readiness; capture owner/path revision before reducer suspension, invalidate while suspended, reject stale frame/result. Unknown/path-edit/install/invalidation/retirement suppress without readiness-arrival replay.
9. Retain dirty editor text/undo/selection/sidebar and terminal session/draft on Settings/history/rotation/background; hidden terminal/editor receives no hardware/IME input, no duplicate watcher/PTY/notification. Capture phone/tablet/accessory keyboard screenshots and human review of 48dp controls/large fonts/theme/Cognito; report actual API29 and physical ARM64 coverage separately. Emulator success is not physical-device qualification.
10. Run C2a1 named G0 ConnectionRegistryTest/ProfileRepositoryTest/ProfileRepositoryRaceTest plus I1 NativeWorkspaceViewModelTest/RuntimeIntegrationReadinessTest: pause admitted effect→**real ProfileRepository** update/logout, retirement/publication wait for prune/cancel/audio; current/create/admit N+1 denied pending/failed. Concurrent same-generation retirees same completion, every barrier attempted despite failure, captured unregister survives, observer order after drain/outside registry lock, cancellation full cleanup and later calls fenced, explicit recovery one bounded attempt/no identity/retry, transitive no-reentry/deadlock, old cleanup cannot cancel N+1, register-before-watchers/close-drain-before-unregister/registration-failure failclosed. Also earlier guard/lookup/edit/install races. These are future qualification, not planning runtime proof; required missing/failing evidence blocks, no automatic Git.

## finalize-settings-notification-docs

1. After qualification terminal, docs-manager reconciles actual behavior/evidence with native README, architecture intended-only section, Android acceptance and CHANGELOG. Preserve prior current-state caveats unrelated to this scope; only promote verified portions.
2. Document real language all/rust/javascript-typescript/java and non-equivalent legacy local-all/no remote auto-save; update `docs/code-standards.md` only scroll1..50/default5 plus relevant language/migration/ownership guidance. **Add `docs/project-overview-pdr.md` solely to reconcile its Required scroll bound to1..50/default5 after qualification; preserve every unrelated baseline limitation/caveat.** Exact defaults Set/Clear, imported response, PTY-not-preferences reset and source/target/runtime scope stay truthful.
3. Document entry/return/history/input, runtime-qualified readiness/no replay and conservative local admission/Unknown/no socket cancellation/retry. Describe proposed C2a1 as implemented only after observed qualification: awaited barriers, pending/failed publication fence, full cancellation-safe drain, unavailable failure latch/explicit bounded local recovery, VM register/close ordering. Exactly three channels, foreground vs channel-only background audio/permission/cold clicks/feed limits/no after-stop promise; remove fictitious fourth channel.
4. Link real qualification evidence; keep unexecuted API29/physical ARM64/IME/server/device gates explicit. Update only docs in task scope; no parallel finalizer or other plan edits. Architecture wording changing a contract requires affected design/implementation re-entry before acceptance.

## Risks/security/failure/rollback

Device/server availability is qualification dependency, not grounds to narrow scope. Synthetic unit fixtures useful for races but cannot replace live semantics/OS observations. Use non-production test workspaces for destructive reset/import/install; server backup and explicit operator restore only. Tests never export real user secrets. No automatic retry or destructive Git cleanup. If qualification finds regression, preserve logs/artifacts and return bounded fix to owning phase; rerun affected coherent checks under coordinator, never fabricate a pass. Documentation states what ran, failed, remains unexecuted.

```evcrate-tasks
[
  {
    "id": "qualify-active-settings-notifications",
    "title": "Qualify every Settings control and accepted-live notification on actual MainActivity",
    "blocked_by": ["integrate-reactive-preference-consumers"],
    "allowed_files": [
      "native/android-app/androidApp/src/androidTest/kotlin/dev/damhopper/nativeapp/SettingsNotificationJourneysTest.kt",
      "native/android-app/androidApp/src/androidTest/kotlin/dev/damhopper/nativeapp/NativeSettingsServerFixture.kt",
      "native/android-app/androidApp/src/androidTest/kotlin/dev/damhopper/nativeapp/AndroidNotificationDeliveryTest.kt",
      "native/android-app/androidApp/src/androidTest/kotlin/dev/damhopper/nativeapp/RetainedWorkspaceLifecycleTest.kt",
      "native/android-app/androidApp/src/test/kotlin/dev/damhopper/nativeapp/SettingsPreferencesPhase17Test.kt",
      "tests/test-phase-17-preferences-privacy-lifecycle.sh"
    ],
    "constraints": ["All implementation branches/integration terminal first; one qualification owner, sequential coherent suites.", "Actual MainActivity plus real qualified Linux server semantic events required; fixtures/static assertions alone insufficient.", "API29/API33+, permission/audio/channel, physical/visual coverage reported separately; no invented pass, waiver, runtime approval or auto Git."],
    "acceptance": ["Every parity/C1-C5/C2a1 outcome pass/failure/unexecuted recorded; missing required evidence or severe implementation review blocks.", "Real ProfileRepository admitted-effect retirement/publication wait; transition fencing, shared concurrent completion/all callbacks, cancellation/failure/recovery/no-reentry/lifetime/N+1 isolation and prior transport/schema/input corrections observed.", "Obsolete source scans deleted, not re-pinned; actual app/server/OS behavior evidence required."],
    "verification": ["Run coherent pnpm native-app:test/native-app:test:android/native-app:assembleDebug after convergence, including G0 named barrier/profile tests and I1 NativeWorkspaceViewModelTest/RuntimeIntegrationReadinessTest; exact exits, no runtime proof inferred from source.", "Run node scripts/run-gradle.mjs :androidApp:compileDebugAndroidTestKotlin and :androidApp:connectedDebugAndroidTest on named API29/API33+ devices; static script not behavior proof.", "Record real event-to-OS, sourceA-targetB-eventC, admitted-effect ProfileRepository retirement/failure/cancellation/lifetime plus all parity scenarios/screenshots; absent physical ARM64/API/device evidence unexecuted."]
  },
  {
    "id": "finalize-settings-notification-docs",
    "title": "Reconcile Android architecture, acceptance, README and changelog with observed evidence",
    "blocked_by": ["qualify-active-settings-notifications"],
    "allowed_files": [
      "native/android-app/README.md",
      "docs/architecture/android-native-client.md",
      "docs/android-native-acceptance.md",
      "docs/CHANGELOG.md",
      "docs/code-standards.md",
      "docs/project-overview-pdr.md"
    ],
    "constraints": ["Docs-manager alone after qualification; code-standards only scroll1..50/default5 and relevant language/migration/ownership; project-overview-pdr solely Required scroll1..50/default5, preserve unrelated baseline caveats.", "Promote only qualified behavior with explicit remaining gates/no after-stop guarantee; no other plan/source edits.", "Exact channels/import/defaults/reset/local-admission and C2a1 barrier/failure/recovery/lifetime wording; no source-scan qualification claim."],
    "acceptance": ["Docs reflect actual input/admin/SAF/readiness/language migration and transport/retirement outcomes with evidence.", "Both code-standards and project-overview-pdr Required scroll bound1..50/default5 consistent; unrelated PDR caveats preserved, no legacy language/reset contradiction.", "Failures/unexecuted gates honest; no implementation/release approval inferred."],
    "verification": ["Review six literal docs against terminal qualification and bound/schema/ownership/C2a1 contracts; confirm project-overview-pdr change limited Required scroll1..50/default5, unrelated baseline caveats intact; human privacy/channel review."]
  }
]
```

- [ ] <!-- evcrate-task:qualify-active-settings-notifications --> Complete coherent qualification with evidence — reported unit/build evidence verified; live-server and physical-device acceptance gates open
- [x] <!-- evcrate-task:finalize-settings-notification-docs --> Finalize truthful Android documentation
