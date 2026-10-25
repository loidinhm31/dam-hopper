# Phase 01 — Shared models and ports

Priority P2; status completed. Owner: contract implementer, sequential prerequisite. Evidence: [brief](design-brief.md), [Android scout](scout/android-feature-evidence.md), [web scout](scout/web-feature-evidence.md), [contracts C1–C5](contracts.md). Implementation is reported complete; current unit/build evidence and remaining acceptance caveats are recorded in the overview.

## Scope and related files

First modify existing ApiClient/ConnectionRegistry/ProfileRepository and their real tests under `establish-request-local-admission`; add **proposed, not currently existing** C2a1 awaited retirement barriers to that existing registry, separate from synchronous observers. Then freeze models/ports under `freeze-native-contracts`. One sequential G0, never parallel branches. No backend/wire DTO changes/new runtime/helper/flags. Public ProfileRepository signatures unchanged; Android persistence Phase02, VM wiring/publication Phase04. G2 cannot reopen these G0 files.

## establish-request-local-admission

1. Implement C2a in existing transport: request-local generic single-use guard, credentials/suspending validation/Ktor preparation before final admission, same registry Mutex for generation mutation and final non-suspending commit. One attempt after admission, no retry/auth-refresh replay; optional guard on general transport, required non-null for Settings callers.
2. Freeze C2a RequestAdmissionGuard and `suspend fun admitCurrentOwner(ref: ConnectionRef, commit: () -> Boolean): Boolean`; deny pending/failed transition before commit. Profile→registry, registry→operation **tryLock only**, no operation→registry/profile; no suspension/network in final commit. Contention NotSubmitted/no retry. Freeze exact C2a1 signatures in existing ConnectionRegistry.kt: `suspend fun addRetirementBarrier(barrier: suspend (ConnectionRef) -> Unit): Long`, `suspend fun removeRetirementBarrier(token: Long): Boolean`, `suspend fun retireConnection(ref: ConnectionRef): ConnectionRef`, `suspend fun removeProfile(profileId: ProfileId): ConnectionRef?`, `suspend fun recoverRetirement(ref: ConnectionRef): Unit`. Retain synchronous add/removeRetirementListener separately.
3. Implement C2a1 atomic revoke N→RETIRING/shared completion under registry Mutex; watermark monotonic, reserved successor unavailable. current/state/create/admission reject pending/failed N+1; concurrent same-generation retire/remove join drain. Full NonCancellable sequence: attempt every captured barrier outside registry lock, dispatch compliant observers while still unavailable, then under registry Mutex seal disposition/finalize authority/settle completion atomically. A pre-seal remove may upgrade disposition; post-seal remove drains actual successor in a new cycle, never N cleanup for N+1. Barrier and observer restrictions transitively forbid profile/registry reentry or waiting on their lock-dependent work. Cancellation settles cleanup then propagates, failure stays unavailable; explicit recovery one bounded captured-barrier attempt, no network/identity/retry loop/observer redispatch. Test paused-observer remove/admit races before and after sealing.
4. ProfileRepository retires/drains before endpoint/account/auth/credential changes/loss and identity publication, no public API change; serialize API/WS client creation and identity/auth commits under existing profile Mutex, never relabel pre-wait snapshot N+1. Vault I/O outside registry lock. Barrier **transitively** cannot call profile/registry or await work requiring those locks, because profile Mutex may remain held. I1 publishes immutable bindings only through transition-aware admitCurrentOwner commit after drain and caller-activity check; currentSnapshot non-suspending StateFlow.value, no fabricated identity/same-generation replacement.
5. Author existing ApiClientTest/ConnectionRegistryTest/ProfileRepositoryTest/ProfileRepositoryRaceTest: all earlier credential/validator/queued-intent/single-use/Unknown races plus C2a1 named pending-successor fencing, concurrent shared completion, every-barrier-attempted failure, canceled/failed later calls fenced, bounded explicit recovery, remove/retire joining, captured unregister and observer order. Profile tests use real retirement/update/session/logout/auth loss, prove drain before credential/identity publication and no deadlock/reentry. I1 owns admitted-effect/VM readiness/lifetime tests in Phase04, not this task. Future checks only.
6. Handoff conservative admission (only invocation with admit=true executes once; reused ADMITTED loser NotSubmitted) plus C2a1 barrier/lifetime and C3a effect/revocation ports before G1. G0 files frozen read-only thereafter; I1 consumes without reopening registry/profile.

## freeze-native-contracts

1. Obtain release from any active writer touching the same files; read current source, actual installed development rules, `docs/code-standards.md`, and contracts. Record source drift; do not edit other plans.
2. Implement exact v2 nested policy and all synchronized fields; replace language enum with all/rust/javascript-typescript/java. Legacy known/code/text fallback is local all with non-equivalence notice/recoverable bytes, never dirty or remote auto-save.
3. Shared codecs preserve legacy master=false and unknown/corrupt bytes. Author real decode/dirty-projection tests for every new/legacy language value and actual import response required imported/fileName/backupFileName/workspaceName; remove obsolete ok/error discriminator.
4. Add SettingsOperation/owner/outcome/document/history ports C2, non-suspending currentSnapshot and ordered operation-gate contract; accepted-live plus per-event owner/path-revision readiness provider C3/C3a; notification identity/platform/audio C4. Freeze C1 DOM-code/Mod/Meta/DoubleShift450 grammar for both branches, not chord-only assumptions.
5. Handoff exact signatures and migration owners: Phase02 SettingsRepository/RemoteConfigEditor/host controllers/views, reused WorkspaceRepository/TerminalRepository/IdleSuspendRepository and serializers; Phase03 reducer/coordinator/readiness consumer/sink; Phase04 VM runtime publication/provider, MainActivity and dormant Workbench callers. No duplicate integration endpoints, aliases or legacy callers.

## Acceptance and future verification

- Shared policy/language/import/readiness/hardware contracts express all required semantics without Android dependencies; unknown policy and legacy filter fallback cannot leak into unrelated remote patch.
- Fresh/legacy-disabled install gains no consent. Safe integers accept max9007199254740991, reject +1/ULong.MAX_VALUE. Admission validates operation+generation atomically locally, with ordered invalidations and honest post-admission Unknown.
- Future qualification only: `pnpm native-app:test`; run real ApiClientTest/ProfileRepository tests/ConnectionRegistryTest, C2a1 named barriers/transition/cancellation/recovery tests and model methods. I1 later proves real ProfileRepository→VM provider drain. No source-wording assertions or re-pinned implementation strings.

## Risks, security, failure and rollback

Lossy decode/serialization is highest risk: retain original bytes, use explicit field allowlist and dirty patch. Branches must treat frozen policy files read-only. If contract changes, stop affected branch, revise graph and propagate every consumer before restart. No blanket reset on decode failure. Rollback uses retained legacy bytes/explicit corrective migration, not overwriting remote policy with defaults. This phase adds no permission request or side effect. Source-only contract review is not compilation evidence.

```evcrate-tasks
[
  {
    "id": "establish-request-local-admission",
    "title": "Establish atomic local request admission in existing transport and authority publication",
    "blocked_by": [],
    "allowed_files": [
      "native/android-app/shared/src/commonMain/kotlin/dev/damhopper/nativeapp/core/transport/ApiClient.kt",
      "native/android-app/shared/src/commonMain/kotlin/dev/damhopper/nativeapp/core/ownership/ConnectionRegistry.kt",
      "native/android-app/shared/src/commonMain/kotlin/dev/damhopper/nativeapp/features/profiles/ProfileRepository.kt",
      "native/android-app/shared/src/jvmTest/kotlin/dev/damhopper/nativeapp/core/transport/ApiClientTest.kt",
      "native/android-app/shared/src/commonTest/kotlin/dev/damhopper/nativeapp/core/ownership/ConnectionRegistryTest.kt",
      "native/android-app/shared/src/jvmTest/kotlin/dev/damhopper/nativeapp/features/profiles/ProfileRepositoryTest.kt",
      "native/android-app/shared/src/jvmTest/kotlin/dev/damhopper/nativeapp/features/profiles/ProfileRepositoryRaceTest.kt"
    ],
    "constraints": ["Implement C2a/C2a1 in existing client/registry/profile, proposed suspend barriers separate from existing synchronous observers; exact signatures frozen before G1/G2.", "Profile may hold its Mutex during drain: strict transitive barrier no profile/registry reentry or awaiting work needing those locks; no registry lock over external callbacks/auth/network.", "Whole post-revocation drain/finalization NonCancellable, shared completion and unavailable failure/cancellation latch; one bounded explicit recovery only; no new runtime/helper/flags or mid-flight checks."],
    "acceptance": ["Suspended credentials/validator plus invalidation prevents pre-admission transport; request guards single-use and post-admission Unknown honest.", "Atomic revoke/pending/failed transition fences current/create/admit/publication N+1; concurrent retirees share completion; all captured barriers attempted and observers ordered after drain.", "Real ProfileRepository retirement precedes identity/credentials publication, cancellation cannot strand transition or publish replacement; explicit recovery cannot bypass cleanup or invent identity."],
    "verification": ["Phase05 runs existing ApiClientTest, commonTest ConnectionRegistryTest and ProfileRepositoryTest/ProfileRepositoryRaceTest with named C2a/C2a1 pending/concurrent/failure/cancellation/recovery/remove/unregister/order races.", "Inspect Ktor admission/execute and transitive lock protocol; actual request counters prove zero invocation. I1 VM/readiness tests later pause an admitted effect and retire via real ProfileRepository."]
  },
  {
    "id": "freeze-native-contracts",
    "title": "Freeze native v2 preferences, ownership, admission and platform ports",
    "blocked_by": ["establish-request-local-admission"],
    "allowed_files": [
      "native/android-app/shared/src/commonMain/kotlin/dev/damhopper/nativeapp/features/settings/SettingsModels.kt",
      "native/android-app/shared/src/commonMain/kotlin/dev/damhopper/nativeapp/features/settings/RemoteConfigModels.kt",
      "native/android-app/shared/src/commonMain/kotlin/dev/damhopper/nativeapp/features/settings/PreferencesStore.kt",
      "native/android-app/shared/src/commonMain/kotlin/dev/damhopper/nativeapp/features/settings/SettingsPorts.kt",
      "native/android-app/shared/src/commonMain/kotlin/dev/damhopper/nativeapp/features/terminal/AgentAttentionAdmission.kt",
      "native/android-app/shared/src/commonMain/kotlin/dev/damhopper/nativeapp/core/notifications/NotificationSink.kt",
      "native/android-app/shared/src/jvmTest/kotlin/dev/damhopper/nativeapp/features/settings/SettingsModelsTest.kt"
    ],
    "constraints": [
      "Implement C1-C4/C3a exactly, including real language wire values/non-equivalent local fallback, import discriminator and DoubleShift grammar; no backend/runtime/dependency/scheduler/flags.",
      "Transport gate terminal before this freeze; frozen models/ports precede concurrent branches, no aliases.",
      "No builds, tests, lint or formatters mid-flight; coordinator runs coherent qualification later."
    ],
    "acceptance": [
      "Exact v2 and real language schema, non-dirty legacy fallback, local-only consent and unknown-version preservation defined and regression tests authored.",
      "Ordered operation invalidation/request guard, current owner snapshot, honest outcomes, imported result and runtime-qualified readiness handoff frozen.",
      "Safe integers, consent migration and Mod/DOM-code/DoubleShift450 behavior have explicit boundary acceptance."
    ],
    "verification": [
      "At Phase05 run pnpm native-app:test for model roundtrip, all four language values/three legacy fallbacks, import malformed2xx, unknown policy, consent and integer bounds.",
      "Inspect frozen signatures/caller ownership and C1 hardware grammar; no comment/source-string assertions count as behavioral verification."
    ]
  }
]
```

- [x] <!-- evcrate-task:establish-request-local-admission --> Establish existing-transport atomic local admission
- [x] <!-- evcrate-task:freeze-native-contracts --> Freeze shared models and interfaces
