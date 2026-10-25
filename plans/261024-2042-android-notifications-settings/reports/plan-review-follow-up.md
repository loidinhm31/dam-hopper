# Targeted independent plan follow-up

**Status: COMPLETE. Readiness: BLOCKED — R1 remains an essential High contract gap.**
One permitted follow-up; plan-only, not implementation approval or final user validation. Revised design inspected directly; accepted issue register used only to identify dispositions. R2 is a bounded Medium documentation omission.

## Coverage and evidence

Path abbreviations, all relative to repository root:
- `P/` = `plans/261024-2042-android-notifications-settings/`.
- `C/` = `native/android-app/shared/src/commonMain/kotlin/dev/damhopper/nativeapp/`.
- `A/` = `native/android-app/androidApp/src/main/kotlin/dev/damhopper/nativeapp/`.
- `J/` = `native/android-app/shared/src/jvmTest/kotlin/dev/damhopper/nativeapp/`.
- `AT/` = `native/android-app/androidApp/src/test/kotlin/dev/damhopper/nativeapp/`.

Revised artifacts inspected: `P/plan.md:1-70`, `P/contracts.md:1-187` (long relevant contract lines read untruncated), `P/parity-matrix.md:1-154`; `P/phase-01-shared-contracts.md:1-86`, `P/phase-02-settings-parity.md:1-120`, `P/phase-03-live-notifications.md:1-71`, `P/phase-04-retained-root-integration.md:1-113`, `P/phase-05-qualification-and-docs.md:1-76`. Accepted dispositions: `P/reports/review-triage.md:1-19`.

Supporting source inspected:
- Transport/authority: `C/core/transport/ApiClient.kt:1-358`; `C/core/ownership/ConnectionRegistry.kt:1-168`; `C/features/profiles/ProfileRepository.kt:1-222`; `A/platform/workspace/NativeWorkspaceViewModel.kt:1-144`; `C/ui/screens/DamHopperMobileApp.kt:53-150`.
- Settings/migration: `C/features/settings/SettingsModels.kt:1-158`, `SettingsRepository.kt:1-305`, `PreferencesStore.kt:1-41`, `MaintenanceView.kt:584-674`; `A/platform/storage/AndroidPreferencesStore.kt:1-54`.
- Reused integration/host/files: `C/features/terminal/TerminalRepository.kt:105-210`, `TerminalModels.kt:210-314`; `C/features/host/IdleSuspendRepository.kt:1-119`, `UsageController.kt:150-206`; `C/features/files/FileRepository.kt:1-103`, `FileTreeState.kt:1-113`.
- Wire evidence: `packages/ui/src/api/fs-types.ts:123-145`; `server/src/config/schema.rs:1045-1053`; `server/src/api/config.rs:203-249`; `server/src/api/settings.rs:41-47,175-195,267-276`; `server/src/api/agent_status.rs:199-248,295-355`.
- Hardware grammar: `packages/ui/src/lib/shortcuts.ts:1-120,180-220,288-328`; targeted DoubleShift/default/handler symbol searches in UI.
- Regression/cleanup boundaries: `AT/SettingsPreferencesPhase17Test.kt:1-115`; `tests/test-phase-17-preferences-privacy-lifecycle.sh:1-148`; `J/features/profiles/ProfileRepositoryRaceTest.kt:1-87`; `native/android-app/shared/src/commonTest/kotlin/dev/damhopper/nativeapp/core/ownership/ConnectionRegistryTest.kt:55-86`; targeted `AT/FileScreensPhase08Test.kt` source-scan matches.
- Context/docs: `README.md:1-95`; targeted `docs/project-overview-pdr.md:7-94` matches, exact `:91-94`; `docs/code-standards.md:1-76`; `docs/architecture/android-native-client.md:478-511`; targeted `P/design-brief.md` evidence/scope matches.

Repository-wide **targeted symbol searches**, not a whole-repository audit, covered existing Settings constructors/admin calls, all migrated workspace/usage/idle/agent mutations, flat-policy/filter references, reducer calls, notification constructors/cancellation, and retirement listener registrations. Named existing transport/profile tests confirmed by file discovery; newly planned tests not mistaken for existing APIs/evidence.

## Accepted-issue dispositions

“Addressed” below means resolved in the proposed implementation contract/ownership, **not an executed fix**.

| Prior issue | Disposition and revised evidence | Current-source correspondence |
|---|---|---|
| F1: wrong shared language schema | **Addressed.** `contracts.md:13-17,43-47`; Phase01:20-23,58-79; Phase02:12-15,49-59; Phase04:25,75-107. Exact all/rust/javascript-typescript/java; known/code/text becomes visibly non-equivalent local-all fallback with retained bytes, not dirty or remotely auto-saved. Explicit real scan DTO/API and both Files/sidebar consumers owned by I2. | UI `fs-types.ts:123-145`, server `schema.rs:1045-1053` agree; native `SettingsModels.kt:32-40` differs. `AndroidPreferencesStore.kt:21-47` is the actual decode/save boundary; S1 owns it. |
| F2: repository precheck cannot fence transport | **Core request-admission correction addressed; lifecycle handoff R1 remains separate below.** `contracts.md:95-107`; Phase01:9-15,35-57; Phase02:11-15; Phase04:13. Existing transport/registry/profile and tests owned in sequential G0 before model freeze/branches. Auth/prepare outside locks; registry→operation tryLock; same fair operation gate for registered selection/edit intent; retire-before-identity-publication; thread-safe immutable snapshot. True authorizes only that invocation's single execute; losing reused guard is NotSubmitted; post-admission Unknown, no socket/non-delivery/retry claim. | `ApiClient.kt:58-74,148-185` currently checks before suspending credentials; bounded GET's execute callback `:86-94` is already after submission. Registry `:119-146` supplies existing mutex boundary; profile `:65-88,138-174,189-220` contains actual identity/token publication sites. All are in G0's literal writable set. |
| Reused endpoint ownership and escaping | **Addressed.** `contracts.md:109-119`; Phase02:7,20-24,65-95; Phase04:19,46-69. Required guards propagate through existing TerminalRepository, WorkspaceRepository, idle/usage repositories/controllers/views/dialogs; active and dormant Workbench callers assigned I1. Sole agent endpoint owner retained; interpolated install bodies replaced with structured JSON; repository/controller test ownership explicit. | `TerminalRepository.kt:123-199` already owns those URLs, with interpolated bodies at149/183. Targeted callers were found in owned Workbench/UsageScreens/HostControlScreens and the enumerated existing tests, not an undeclared second API owner. |
| Defaults and reset semantics | **Addressed.** `contracts.md:111,121`; Phase02:14,21,31; Phase05:23,31. Set `{defaults:{workspace:path}}`, Clear `{defaults:{}}`; distinct known-workspace registry. Reset destroys PTYs/runtime, not saved preferences; dirty guard and still-current confirmed navigation required. | `server/src/api/config.rs:213-234` consumes/replaces defaults; `server/src/api/settings.rs:41-47` disposes PTYs, does not erase preferences. |
| Hardware grammar / default DoubleShift | **Addressed.** `contracts.md:49-51`; parity:48-65; Phase02:29; Phase04:29,91-107; Phase05:24. Android Mod=Ctrl, explicit Meta distinct, physical DOM-code map, release-separated nonrepeat DoubleShift450 on monotonic time, capture/cancel/collision and focus/route/IME/privacy/owner resets. 449/450/451ms and real filename-search dispatch named. Only approved Git/Ports/Fleet/IDE-layout destinations unavailable. | `shortcuts.ts:1-17,63-95,196-208,288-328` establishes actual defaults, aliases and450ms detector; stronger native release/reset/input safeguards are explicit adaptation, not claimed existing web behavior. |
| Runtime-qualified readiness | **Partly addressed; R1 unresolved.** `contracts.md:144-152`; Phase02:23; Phase03:12-14; Phase04:14,65-69. Frame captures owner/socket/endpoint/account/path revision before reducer suspension; eventC never borrows sourceA/targetB. Runtime-owned serialized withVerified/effect/revocation gate; awaited local edit/install invalidator; stale refresh discarded/no replay. Endpoint orchestration S2, provider I1, consumer N1 disjoint. Missing registry/profile retirement barrier below. | `TerminalModels.kt:253-314` exposes required authoritative fields; server `agent_status.rs:220-246,319-355` supplies real enable/readiness predicates. Existing VM only has non-suspending retirement listener `:57-63`; no awaited provider handoff exists yet. |
| Import discriminator | **Addressed.** `contracts.md:121`; Phase01:21,65-79; Phase02:14,32; Phase05:23. Required imported/fileName/backupFileName plus nullable workspaceName; obsolete ok/error success assumptions removed. False/missing/malformed imported cannot confirm; admitted malformed2xx becomes Unknown/no replay. Model, repository, MaintenanceView and test owners explicit. | Native `SettingsModels.kt:124-129`, repository `:248-254`, MaintenanceView `:595-605` are lossy/current success sites; server `settings.rs:175-182,271-276` confirms actual response. |
| Docs bounds/schema ownership | **Accepted code-standards correction addressed, R2 remains.** Phase05:30-33,58-70 owns exact code-standards path and limits changes to scroll1..50/default5 plus relevant language/migration/ownership notes. | `docs/code-standards.md:73` currently requires1..20; model `SettingsModels.kt:95-106` has same old bound. PDR separately retains an unowned required bound at93. |
| Static assertion deletion, not re-pinning | **Addressed.** Phase02:33,108-113 → Phase04:19,30,62,102,107 → Phase05:7,18,45-55. Literal test/script transfers; delete obsolete implementation/source-wording assertions, replace only meaningful behavior/boundary/precedence/error tests. Existing shell script explicitly not required acceptance. | `SettingsPreferencesPhase17Test.kt:22-57,83-93,110-114` pins labels/source/channel/key strings; shell script `:40-70,100-140` scans implementation text. Revised plan does not re-pin replacements or count those scans as runtime proof. |

## Remaining findings

### R1 — High: retirement-barrier handoff not frozen across phase ownership

- **Plan:** `P/contracts.md:99,103,150-152,185`; Phase01:12-15; Phase04:13-14,67. G0 freezes registry/profile read-only before G2, but C3a requires runtime/socket/auth/API retirement to await provider invalidation/coordinator retirement. Only Phase02's `invalidateRuntime` injection is specified; no awaited handoff from registry/profile retirement to the VM/provider is frozen.
- **Source:** `C/core/ownership/ConnectionRegistry.kt:24,60-87,152-160` exposes only `(ConnectionRef)->Unit` listeners; `removeProfile:93-113` has the same boundary. `A/platform/workspace/NativeWorkspaceViewModel.kt:57-63` registers that synchronous listener. `C/features/profiles/ProfileRepository.kt:65-88,138-174,203-220` retires directly, commonly under its profile mutex.
- **Concrete failure:** a notification effect has passed withVerified and holds the effect mutex. Concurrent logout/endpoint/auth replacement retires the registry. An ordinary listener launching suspend coordinator cleanup cannot await that mutex; registry/profile retirement can return/publish replacement while the admitted old effect is still posting. Later cleanup may remove it, but “no retired tag recreation after retirement return” has already failed. Reading current generation only rejects future effects; it cannot drain an already-admitted effect.
- **Impact/confidence:** High privacy/lifecycle correctness and essential cross-phase handoff gap; **high confidence** in the missing public boundary, not a claim of an executed race. Requiring an awaited barrier is material; requiring every listener to become suspend is not necessary.
- **Smallest correction:** in G0 freeze an explicit awaited retirement hook/barrier (or synchronous revocation plus awaited drain), its registration/lifetime, ordering relative to registry invalidation and identity publication, and cancellation/failure behavior. Run external cleanup outside registry lock; forbid re-entry into any profile lock retained by its caller, or release it with transition fencing. Assign I1 exact VM wiring; retain current registry/profile/VM test owners. G2 must consume that API without reopening frozen G0 files. Named future regression: pause an admitted effect, retire through real ProfileRepository/registry, verify retirement/publication waits for prune/cancel, no deadlock, cancellation fails closed, and generationN cleanup cannot cancelN+1. **Not performed.**

### R2 — Medium: changed scroll bound leaves contradictory required PDR

- **Plan/source:** Phase05:31,61-68 limits docs writes to five files, excluding `docs/project-overview-pdr.md`; that file's `:93` still says **Required** scroll1..20, while `contracts.md:13` changes it to1..50.
- **Failure/impact/confidence:** implementation/final docs may correctly expose50 yet requirements still mandate20; later maintenance/review can restore the obsolete clamp. Medium documentation consistency; **high confidence**. Historical current-state caveats need not be erased.
- **Smallest correction:** add only that exact PDR path to D ownership, narrowly update/supersede the required scroll bound after qualification; preserve unrelated baseline limitations. No product or unrelated Git/Ports/Fleet scope expansion.

## Checks and terminal gate

Performed: source/plan reads, targeted caller/file discovery, contract/ownership/dependency reasoning; Advisor consultation challenged R1's boundary. Advisor prose is not source or execution evidence. Concurrent parent structural parser remains independent; no parser result claimed here.

Not performed: implementation, plan/task-state edits, builds, typechecks, tests, formatters, Git, dependency operations, external research, nested agents, live server/Android/device runs. All regression commands/scenarios above and Phase05 are **future acceptance**, not a demand for runtime proof during planning.

**Coverage complete for assigned follow-up surfaces. Prior corrections are substantially incorporated, but R1 blocks readiness at this one-follow-up limit.** Parent must disposition the remaining essential contract gap; this report neither starts another review loop nor authorizes coding. R2 also requires bounded docs ownership reconciliation. Final user validation remains parent-owned and pending.

## Unresolved questions

- Which explicit G0 retirement barrier/API will I1 wire so profile/registry retirement can await provider drain without profile/registry lock re-entry? Current plan supplies the requirement, not that cross-phase contract.
