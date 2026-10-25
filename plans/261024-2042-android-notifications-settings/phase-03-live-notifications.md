# Phase 03 — Accepted-live notifications and Android adapters

Priority P2; status in-progress. Owner: Notifications implementer; concurrent with Phase02 after Phase01. Inputs: [contracts C3–C5](contracts.md), both scout reports, current reducer/source. Existing reducer comments are **not** proof of baseline/gap/matching/dedupe correctness. No Settings model/UI or root edits. Root collection/permission launcher belongs only to integration. Live admission is closed; Android delivery remains open for the W3 audio-resource correction and regression.

## notifications-live-admission

Related modifications: AgentStatusReducer and its existing behavior tests. New coordinator owns bounded memory history/transients; new coordinator tests use real reducer results, not injected fake acceptance as sole integration evidence.

1. Replace reducer's noncontiguous-revision acceptance and synthetic snapshot seed IDs with C3 silent-baseline/high-water state. Explicit baselineInstalled and owner/socket identity; first/live-before-baseline events cannot alert. All changed/removed/invalidation messages advance one ordered cursor; gaps close admission and request silent reconciliation.
2. Snapshot capture/publication qualified to current owner+socket; no stale same-epoch snapshot regression or stale in-flight snapshot installation after replacement. Coordinate serialized mutation with outer fetch, no lock held over network. Close admission on replacement/unavailable/invalidation; no catch-up notification after resume/reconnect.
3. Match attention row/event terminal/incarnation/session/kind/revision. Enforce semantic OMP/qualified Claude/Codex rules, checked server-safe integer range. Terminal high-water prevents resurrection after 1,000-ID eviction, history clear or a reused semantic ID. Bound snapshot/high-water/tombstone storage; capacity triggers silent reconciliation, not authority eviction.
4. coordinator.admit passes unchanged frame-captured key to provider.withVerified. Display lookup cannot authorize effects. C3a readiness/effect Mutex checks exact VERIFIED owner and direct immutable registry.connectionsState.value availability (not eventually collected cache), then synchronous history/post/audio. No suspending registry/profile query, lock acquisition or transitive await of lock-dependent work in provider/cleanup/effect chain; no detached effects/network.
5. Unknown/stale/pending/failed runtime consumed without replay. `suspend retire(owner)` awaits provider.invalidate; attempt **all** exact-old-owner feed/transient prune, sink cancel and audio cleanup even if one fails; aggregate failure propagates to C2a1 unavailable latch, cancellation not swallowed. Earlier admitted post finishes then canceled. Late N cleanup cannot cancel/stop N+1/other-owner tags/audio. G0 owns proposed registry barrier, I1 registers before eligibility/teardown; branch never changes their files.
6. Regress baseline/gap/replay/capacity/profile plus sourceA-targetB-eventC/frame-edit/lookup-revocation/stale-refresh/path-install acknowledgement and retire-post. Unit failures prove every cleanup attempted/propagated and exact-owner audio/cancel; completed retirement zero tags/no replay. Real ProfileRepository→VM barrier/lifetime regression is literal I1 ownership, not simulated registry proof here.

## notifications-platform-delivery

Related modifications: frozen NotificationSink now implemented under ordered transfer from Phase01; AndroidNotificationSink. Create AndroidNotificationAudio and AndroidNotificationPlatform (Application-context state/adapters only). Settings permission action uses port, not direct Activity capture.

1. Implement collision-safe String keys through history/OS tag/immutable PendingIntent.data, no Int hash identity. Canonical tuple includes process nonce and exact profile/terminal incarnation/session; private extras include authoritative destination. InMemory sink follows same interface; update existing sink tests.
2. Keep exactly three existing channels. Implement C4 foreground/background/permission/audio decision table: foreground OS silent + at-most-once manual pattern/volume; background channel-only sound, no manual workaround or catch-up toast. Existing channel sound/importance immutable and user-controlled; per-policy sound=false/zero => silent; no channels per setting.
3. AndroidNotificationPlatform refreshes permission/app/channel status, exposes explicit request/open-settings callbacks bound later by Activity. API29 not-required; API33+ deny/dismiss do not auto-request/revoke in-app policy. Permission race/SecurityException after precheck is a failed OS post, never crashes or deletes admitted history.
4. Audio resources release on stop/profile retirement/final teardown; no Activity retained. Native generated tones from Android audio APIs honor finite volume and supported patterns; no bundled dependency or user content in sound. Serialize one admitted event's playback and OS silent posting to prevent double chime.
5. Cancel profile/generation tags on retirement, leave other profiles intact. Cold process click cannot trust stale generation; decode only checked safe integers and required canonical fields, validation/navigation left integration-owned. Generic public notification prevents lockscreen data leakage.
6. Author sink/audio/permission identity regressions and Android delivery instrumentation covering equal terminal IDs across profiles, equal Int hash collisions, rotation/relaunch intents, denied/block status, public redaction, foreground silent builder and background policy. Instrumentation is future planned, not run by branch.

## Acceptance/checks

Only newly accepted live semantic events produce at-most-once history/audio/OS effects. Snapshot/replay/gap/reconnect silent. Exact permission/audio matrix and bounded memory enforced. Future coherent commands: `pnpm native-app:test`, `pnpm native-app:test:android`, `node scripts/run-gradle.mjs :androidApp:connectedDebugAndroidTest` on API29/API33+ after Phase04. Phase05 must additionally use real MainActivity/live Linux server semantic events; fake sink/unit tests alone cannot qualify runtime reachability.

## Risks/security/failure/rollback

Lossy ULong conversion, stale socket reentrancy and ID collision can route to another authority; reject invalid identity, never normalize to current profile. Audio cannot bypass Android channel blocking in background. Failed post still leaves history; explicit permission only. If reducer exceeds bounded authority state, suspend alerts and silently reconcile rather than leak memory/resurrect old attentions. No automatic mutation or transport creation. Corrective rollback disables delivery while preserving current status baseline and user consent; never re-enable historical notifications or delete unrelated shade entries. Root and dormant Workbench callers must migrate in Phase04; no overload shim.

```evcrate-tasks
[
  {
    "id": "notifications-live-admission",
    "title": "Harden semantic baseline and accepted-live admission with bounded feed",
    "blocked_by": ["freeze-native-contracts"],
    "allowed_files": [
      "native/android-app/shared/src/commonMain/kotlin/dev/damhopper/nativeapp/features/terminal/AgentStatusReducer.kt",
      "native/android-app/shared/src/commonMain/kotlin/dev/damhopper/nativeapp/core/notifications/NotificationCoordinator.kt",
      "native/android-app/shared/src/jvmTest/kotlin/dev/damhopper/nativeapp/features/terminal/AgentStatusReducerTest.kt",
      "native/android-app/shared/src/jvmTest/kotlin/dev/damhopper/nativeapp/core/notifications/NotificationCoordinatorTest.kt"
    ],
    "constraints": ["Frozen models/C2a1 registry/readiness ports read-only; I1 provider/VM barrier lifetime, S2 orchestration; no shared branch writes/new runtime/backend.", "Cleanup/effect chain transitively no profile/registry reentry or await of lock-dependent work; all cleanup attempted, aggregate failure propagated, no mid-flight suites."],
    "acceptance": ["Silent owner/socket baseline/contiguous cursor only new attention; replay/capacity never resurrects.", "Exact readiness withVerified serializes effects/invalidate/retire; pending/failed unavailable silent, prune/cancel/audio failures propagate, no detached cleanup or retired tag recreation.", "Memory50/transients3/read/clear and exact-owner audio/cancel obey C4; sourceA/targetB never qualifies C; N cleanup cannot affect N+1."],
    "verification": ["Phase05 reducer/coordinator tests cover readiness/frame/revocation/retire-post, all cleanup attempted after failure and N/N+1 isolation; completed retire zero tags.", "I1 NativeWorkspaceViewModelTest/RuntimeIntegrationReadinessTest owns real ProfileRepository barrier, registration/close/failure/cancellation/concurrency; static/comment assertions not proof."]
  },
  {
    "id": "notifications-platform-delivery",
    "title": "Implement collision-safe Android notification permission, channel and audio adapters",
    "blocked_by": ["notifications-live-admission"],
    "allowed_files": [
      "native/android-app/shared/src/commonMain/kotlin/dev/damhopper/nativeapp/core/notifications/NotificationSink.kt",
      "native/android-app/androidApp/src/main/kotlin/dev/damhopper/nativeapp/platform/notifications/AndroidNotificationSink.kt",
      "native/android-app/androidApp/src/main/kotlin/dev/damhopper/nativeapp/platform/notifications/AndroidNotificationAudio.kt",
      "native/android-app/androidApp/src/main/kotlin/dev/damhopper/nativeapp/platform/notifications/AndroidNotificationPlatform.kt",
      "native/android-app/shared/src/jvmTest/kotlin/dev/damhopper/nativeapp/core/notifications/NotificationSinkTest.kt",
      "native/android-app/androidApp/src/androidTest/kotlin/dev/damhopper/nativeapp/AndroidNotificationDeliveryTest.kt"
    ],
    "constraints": ["C4 permission/audio decision table authoritative; existing three stable channels, no per-setting channel churn or manual background audio.", "Immutable PendingIntent plus unique canonical data URI and String OS tags; no hash-only identity.", "Application context only; Activity launchers and click navigation are integration-owned; no branch suites."],
    "acceptance": ["Foreground app pattern/volume and silent OS post cannot double-sound; background respects app/channel/permission without workaround.", "Permission denial preserves history; status refresh observes OS settings; public shade text stays generic.", "Cross-profile/incarnation identity collisions cannot replace/click/cancel another notification; retired generation cancellation is isolated."],
    "verification": ["Phase05 runs NotificationSinkTest and AndroidNotificationDeliveryTest, records API29/API33+ permission/channel/audio and collision scenarios.", "Inspect pending-intent immutability/data identity and actual public/private notification presentation; no physical-device claim without device evidence."]
  }
]
```

- [x] <!-- evcrate-task:notifications-live-admission --> Complete admission and bounded feed
- [x] <!-- evcrate-task:notifications-platform-delivery --> Complete Android delivery adapters
