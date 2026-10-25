# Phase 05 — Qualification then project documentation

Priority P2 · task markers administratively closed per user direction; docs complete; connected-device technical qualification open · owners: qualification author -> read-only verifier -> docs-manager (strict sequence). No time estimate.

## Durable tasks

```evcrate-tasks
[
  {
    "id": "author-live-agents-journeys",
    "title": "Author real MainActivity two-profile multi-project Agents journeys",
    "blocked_by": [
      "author-retained-integration-tests"
    ],
    "allowed_files": [
      "native/android-app/androidApp/src/androidTest/kotlin/dev/damhopper/nativeapp/NativeTerminalAgentsJourneys.kt",
      "native/android-app/androidApp/src/androidTest/kotlin/dev/damhopper/nativeapp/NativeTerminalAgentsServerFixture.kt",
      "native/android-app/androidApp/src/androidTest/kotlin/dev/damhopper/nativeapp/RetainedWorkspaceLifecycleTest.kt"
    ],
    "constraints": [
      "Qualification author owns only these test/fixture files after Phase04 terminal and existing instrumentation-writer release.",
      "Reuse actual MainActivity/AndroidJUnitRunner/Compose test and real-server fixture patterns; no product hooks, dependency change or VM-only substitution for UI proof.",
      "Missing current-server/device prerequisites must be explicit blocked/open; HTTP404 uses owned controlled real-HTTP loopback proof, not mandatory older-server artifacts or conditional passing tests."
    ],
    "acceptance": [
      "Tests navigate real MainActivity controls against two explicitly configured live server profiles and multiple retained projects/worktrees with independently verified terminal metadata.",
      "Current real-server UI journeys cover equal caller-selected IDs on two servers, stale dirty-guard click, inactive exit/restart, offline/reconnect, Settings A/B, rotation, IME/privacy/input and compact/wide content.",
      "Fixture verifies absence before seeding same unique test-owned ID via existing POST /api/terminal on both disposable servers; cleanup verifies exact IDs/incarnations and cannot delete preexisting user terminals.",
      "Lifecycle test asserts retained open/filter/selection/controller identity through Activity recreation without duplicating host or PTY."
    ],
    "verification": [
      "Compile instrumentation using node scripts/run-gradle.mjs :androidApp:compileDebugAndroidTestKotlin after all code lands.",
      "Run the exact connected-device command in this phase on named API29 and API33+ targets; record actual server versions/identity and independent REST evidence."
    ]
  },
  {
    "id": "qualify-terminal-agents",
    "title": "Run coherent behavior, compile, APK and real-device visual qualification",
    "blocked_by": [
      "author-live-agents-journeys"
    ],
    "allowed_files": [],
    "constraints": [
      "Read-only verification owner; no production/test/docs/task-state edits. Coordinator records reports/artifacts outside this task writable set.",
      "Run checks once over complete integration, not parallel full suites; record failures and prerequisite gaps without fabricated passes.",
      "Physical/hardware/API/IME/visual gaps cannot be substituted with static scans, screenshots of another host or plain ViewModel state tests."
    ],
    "acceptance": [
      "Focused/full behavior, real ApiClient->repository->reducer->projection HTTP404 loopback proof, shared/instrumentation compile and APK outcomes record exact commands/counts/exits.",
      "Actual MainActivity two-profile multi-project journeys prove stale/dirty routing, retained lifecycle, input/Settings/isolation and no added roster connection.",
      "Compact/wide screenshots and human visual/accessibility/input observations identify device/API/orientation/width and server version without exposing secrets.",
      "Missing hardware/current-server or failed required checks remain blockers; no older-version artifact or hypothetical ID-collision gate is introduced, and implementation review/required coverage must pass."
    ],
    "verification": [
      "Run node scripts/run-gradle.mjs :shared:jvmTest --tests \"*TerminalAgentsHttpAvailabilityTest\"; shared/instrumentation compile; pnpm native-app:test; pnpm native-app:test:android; pnpm native-app:assembleDebug sequentially.",
      "Run node scripts/run-gradle.mjs :androidApp:connectedDebugAndroidTest with class and real-server runner arguments specified below, separately for each target/configuration.",
      "Capture real MainActivity compact/wide visual and touch/hardware/IME/privacy/Settings/rotation evidence plus truthful API29/API33+/physical-device disposition."
    ]
  },
  {
    "id": "document-qualified-agents-sidebar",
    "title": "Update existing native feature, architecture, acceptance and changelog docs",
    "blocked_by": [
      "qualify-terminal-agents"
    ],
    "allowed_files": [
      "native/android-app/README.md",
      "docs/architecture/android-native-client.md",
      "docs/android-native-acceptance.md",
      "docs/CHANGELOG.md"
    ],
    "constraints": [
      "Docs-manager is sole final project-doc writer after qualification terminal and explicit cross-plan documentation writer release.",
      "No product/tests/dependencies/plan/task-state edits; update existing docs only, do not create parallel feature docs.",
      "Preserve notification W1/W2/W3 and broader native release caveats; qualification evidence does not imply unrelated closure."
    ],
    "acceptance": [
      "README describes discoverable Terminal Agents sidebar, retained attached scope, local filter and Settings path accurately.",
      "Architecture reconciles intended design section with implemented owner/freshness/navigation/overlay contracts and observed limits.",
      "Acceptance records real command/device/server/visual evidence and honest still-open gaps; no fabricated pass or old JVM-only evidence promoted to device proof.",
      "Changelog documents the narrow sidebar exception and user-visible feature without claiming Agent Store/backend/notification-policy work."
    ],
    "verification": [
      "Docs-manager cross-checks actual qualification reports and final source interfaces/paths; peer reviews the four-doc diff and retained caveats.",
      "Coordinator reruns structural link/path checks only for docs; if documentation exposes behavior drift, reopen affected implementation/verification explicitly before completion."
    ]
  }
]
```

- [x] <!-- evcrate-task:author-live-agents-journeys --> Author real-host qualification journeys (complete per explicit user direction; Cycle 3 coverage warning retained)
- [x] <!-- evcrate-task:qualify-terminal-agents --> Execute coherent qualification (administratively closed per explicit user direction; connected-device gate remains open)
- [x] <!-- evcrate-task:document-qualified-agents-sidebar --> Finalize existing project docs (docs-manager handoff complete; validator findings recorded in plan.md)

## Context / ownership / prerequisites
All Phase05 task markers are closed: journey authoring and reported automated qualification are administratively closed per explicit user direction, while the docs-manager has updated the existing project documentation. The docs validator completed with the scope and candidate findings recorded in the plan; it did not establish anchor/meaning validity or device acceptance. Connected-device/current-server MainActivity qualification remains a separate open gate. Three review cycles completed; user approved with noted issues after Cycle 3 (7/10, zero Critical, four warnings). The review records incomplete real two-profile/observed-agent journeys and existing lifecycle/fixture defects; these remain documented warnings, not fixed behavior claims.

Required environment: repo-supported JDK/Android SDK/Gradle/pnpm, API29 and API33+ target coverage, actual MainActivity, two reachable disposable **current** real servers/accounts, multiple projects/worktree, qualified observed agent sessions and safe dirty editor fixture. Record hardware keyboard/native IME/physical ARM64 and compact/wide visual coverage honestly; missing environment stays blocked/open. Required HTTP404 is separately deterministic **real HTTP loopback** in Phase04-owned `TerminalAgentsHttpAvailabilityTest.kt`, reusing installed JDK HttpServer + real Ktor client convention from ApiClientTest; no mocked repository return, product hook, new dependency or external old-version artifact. This proves typed transport/reducer/projection behavior, **not older-version compatibility**. MainActivity current two-server journeys remain mandatory; no product scope reduced.

## Related files / exact actions / transfer
- CREATE `NativeTerminalAgentsJourneys.kt`, `NativeTerminalAgentsServerFixture.kt` under the exact existing Android instrumentation source directory in allowed_files.
- MODIFY existing `RetainedWorkspaceLifecycleTest.kt` only after its writer release. Existing `NativeEditorExplorerJourneys.kt`, `NativeFileServerFixture.kt`, MainActivity, runtime product files and UI sidebar test are read-only references; reuse conventions, not their conditional-server-pass shortcut.
- Verification task allowed_files empty: no source/report writes by verifier; return terminal observations/artifact locations to coordinator, who owns evidence reports. No hydration/tasks.json.
- Docs-manager modifies only the four listed project docs after verification and writer release. If qualification is blocked, do not claim it passed or waive the gate. Per user direction, Phase05 task markers record administrative completion; connected-device/MainActivity qualification remains separately open.

## author-live-agents-journeys — ordered steps
1. Define test-runner inputs in new fixture: `agentsPrimaryUrl`, `agentsSecondaryUrl`, `agentsPrimaryProject`, `agentsOtherProject`, `agentsAccount` and optional secure token inputs consistent with real-server harness. Use safe fixture credentials, never echo/persist them in plan/report/screenshots. Servers launched externally using existing server commands, not by app. Validate reachability/auth/project metadata up front; missing prerequisite produces explicit unfulfilled coverage, not fake UI success.
2. Choose fresh `agents-<run-unique-suffix>` terminal ID. Independently GET /api/terminal/detailed on **both** disposable servers and fail setup if that ID already exists; never commandeer it. POST /api/terminal with the **same id** and owned command/project/worktree using current server's supported caller-selected id (server/src/api/terminal.rs:28-42,85-107). Read back each server's exact ID/incarnation/project/worktree/alive/type; require real qualified tool observation for agent rows. Register both profiles through supported setup/UI, retaining a saved unattached third profile to prove roster does not connect it.
3. Assert actual MainActivity row/count/cycle/filter behavior across both attached profiles and retained projects. Equal chosen ID on both real servers must remain owner-qualified and never cross-route; setup is deterministic, not a hypothetical collision gap. Profile/attachment switch-back exercises same-generation equal sock-1 replacement without treating old receipts as current; detailed metadata and current attachment token identify actual route target.
4. Exercise delayed dirty Save/Discard: click observed group from another retained workspace, pause on actual dirty dialog, terminate/restart or change target on server before confirming. Assert **fresh network validation after confirmation**, explicit refusal, same source profile/panel/session, sheet still open, no first-terminal route. Also demonstrate valid delayed confirm commits exact target and closes origin sheet; Cancel/failed Save/duplicate confirm never commits late.
5. Inactivate a retained project and exit/restart its observed terminal; assert roster removes/reclassifies by exact incarnation, no stale Working. Test list invalidation while request delayed using real server latency boundary if available; controlled coroutine tests are authoritative for deterministic timing otherwise, with real latency coverage gap stated. Disconnect/reconnect current socket, verify cached Unavailable and successful requalification; logout/endpoint/account replacement purges affected cache, no data from successor/another profile.
6. Settings A/B: preference source A distinct from selected workspace B; click Agents Settings while group may refer to C. Show HOST -> AGENTS for B, independent A label unchanged, exact target binding; mutate selected context during queued target selection and verify blocked/explicit choice, no ambient fallback. Back restores dirty editor/session. No dormant Agent Store screen.
7. Lifecycle/input: recreate/rotate compact<->wide, same retained open/filter/selection/controller and one host. Try Agents->search/panel/Projects shortcuts while compact (consume/no route); search->Agents and local create/kill/diagnostics/modal->Agents (disabled/refused); sheet->dirty dialog (dialog topmost Back cancels request), popup->Settings and privacy replacements (no uncovered transition). Resize with another cover active; test hardware/accessory/native IME suppression, no early focus restore, and pinned terminal input only when terminal focused/eligible. Back/Escape dismisses actual rendered topmost, not lower sheet.
8. Reuse required **controlled real-HTTP404** result from Phase04-owned JVM test: actual ApiClient->TerminalRepository->reducer->projection, current404=>typed Unsupported, stale delayed404 cannot alter successor, non404 text mentioning404 stays Other, no auto retry loop. Execute exact named test below; no old-server or MainActivity404 compatibility claim.
9. Extend lifecycle test; teardown only terminals this run actually created and whose current ID/incarnation still match recorded owned instance on each server. Use existing kill/remove APIs only for that exact test-owned metadata; if incarnation/ownership differs, report cleanup refusal rather than deleting it. Remove only owned fixture files/profiles; never broad-delete PTYs or preexisting collision.

## qualify-terminal-agents — ordered checks and evidence
User-reported results: `pnpm native-app:test` — 824 shared JVM tests passed; `pnpm native-app:test:android` — 224 Android unit tests passed (1,048 total); `pnpm native-app:assembleDebug` — passed; `node scripts/run-gradle.mjs :shared:jvmTest --tests "*TerminalAgentsHttpAvailabilityTest"` — controlled real-loopback HTTP404 passed. Not rerun for this update. Connected-device/API29/API33+/MainActivity/visual/hardware/input coverage remains open; loopback HTTP404 does not substitute for live MainActivity qualification.

```text
node scripts/run-gradle.mjs :shared:compileKotlinJvm :androidApp:compileDebugAndroidTestKotlin
pnpm native-app:test
pnpm native-app:test:android
pnpm native-app:assembleDebug
node scripts/run-gradle.mjs :shared:jvmTest --tests "*TerminalAgentsHttpAvailabilityTest"
```

Focused commands are listed per prior task; full suites detect notification/Settings/editor/terminal regressions. Use actual observed task counts/exits; source-file counts are not test counts. Failures require explicitly scoped implementation reopen then coherent reverification, not suppression or conversion to waived/passed.

Example device command with **disposable loopback fixture setup** (4821/4822 reachable/reversed on the selected device, project names/account must actually exist; token arguments omitted from this public example):

```text
node scripts/run-gradle.mjs :androidApp:connectedDebugAndroidTest -Pandroid.testInstrumentationRunnerArguments.class=dev.damhopper.nativeapp.NativeTerminalAgentsJourneys,dev.damhopper.nativeapp.TerminalAgentsSidebarTest,dev.damhopper.nativeapp.RetainedWorkspaceLifecycleTest -Pandroid.testInstrumentationRunnerArguments.agentsPrimaryUrl=http://127.0.0.1:4821 -Pandroid.testInstrumentationRunnerArguments.agentsSecondaryUrl=http://127.0.0.1:4822 -Pandroid.testInstrumentationRunnerArguments.agentsPrimaryProject=dam-hopper -Pandroid.testInstrumentationRunnerArguments.agentsOtherProject=eigen-air -Pandroid.testInstrumentationRunnerArguments.agentsAccount=dev-user
```

1. Select one actual target (existing Android tooling/ANDROID_SERIAL), establish required port routing, record device/model/API/ABI/build and server versions/auth accounts without secrets. Check actual MainActivity launch before claiming device proof; a VM-only test is insufficient.
2. Execute API29 and API33+ runs separately. Run compact and >=600dp wide layouts using actual supported device/window configuration; capture screenshots before/after rotate and selection, independent server metadata, exact UI assertions and route/refusal outcomes. A screenshot only proves what is visible, not input isolation.
3. Human visual review records left placement, clamped 280dp sheet/pinned width, original shell unchanged, readable counts/status/reasons/coverage/profile, filter interaction, empty/error/Unsupported and source-A/target-B labeling. Inspect accessibility labels/touch targets. No secret/prompt/command leakage in screenshots; use harmless test labels and redact artifacts appropriately.
4. Exercise real touch/hardware keyboard/native IME/accessory input, privacy overlap and focus restoration; physical-device/ARM64/hardware/API gaps remain named open, not generalized from emulator success. Existing notification API29/API33+ delivery caveats are not claimed fixed by these roster runs.
5. Record fresh post-confirmation request chronology and zero selection on stale/cancelled/refused routes, exact ID/incarnation on committed route, inactive freshness and socket/profile isolation. Existing deterministic tests cover hard-to-force races; do not present those as real-server latency evidence.
6. Coordinator collects verifier terminal and implementation review. Missing device/current-server or failed HTTP404 loopback test stays blocked/open; no prerequisite old-version download or hypothetical equal-ID gap. Record deterministic concurrency/404 behavior separately from real MainActivity/server/hardware evidence, never substitute one class for the other.

## document-qualified-agents-sidebar — ordered steps
1. After the reported automated qualification and documentation-writer release, docs-manager reads the implementation, verification/review evidence and existing caveats. Document all open device/server gates without implying they passed.
2. Native README: discoverability through Terminal header, attached-retained scope/no added sockets, phone sheet/wide pinned, seven-status local multi-filter/count semantics, cycling/refusals and HOST/AGENTS path; explicitly not Agent Store/task success inference.
3. Architecture: reconcile owner/attachment token, shared inventory, cache/typed404, nested try-admission and mutation/receipt linearization, exact screen intent and complete minimal-exclusive input cover. Preserve existing retirement discipline and unrelated W1/W2/W3 caveats; no claim of future-server exclusion, transport keepalive or old-version compatibility.
4. Acceptance: exact behavior/loopback404/compile/device/current-server/visual results, identity-safe equal-ID seeding/cleanup, topmost/shortcut/IME overlap evidence and all genuine hardware/API/security/release gaps. Do not reintroduce hypothetical old-server or collision gate, infer physical proof from JVM, or erase broader OPAQUE/ABI/editor/notification caveats.
5. `docs/CHANGELOG.md`: concise user-visible native feature and narrow exception to historical no-sidebar constraint; no backend, wire schema, Agent Store or notification-policy change. Link canonical plan/evidence where useful, no new documentation tree.
6. Coordinator checks doc links/paths/diff and actual evidence alignment; if docs reveal behavior drift reopen code/testing explicitly, not silently change contracts after qualification. Task completion does not authorize Git stage/commit/push.

## Risks / security / failure / rollback
- Real setup unavailable: exact blocked prerequisite, never no-op/conditional pass. Separate pure, Android unit, device/UI, real-server and physical/visual evidence classes.
- Test data cleanup: exact ownership and disposable fixtures only; credentials/terminal content excluded from durable artifacts. No product telemetry or new server APIs.
- HTTP404 uses a controlled real HTTP response and installed client/loopback machinery; it does not certify older-server compatibility. Equal IDs are caller-selected on two disposable current servers with preflight absence and exact-incarnation cleanup; setup failure is reported, not a hypothetical unsupported capability.
- Regression/failure: one coordinator reopens bounded code tasks and reruns relevant/full acceptance; verifier does not edit product to make tests pass. Current docs record reported automated outcomes; connected-device qualification remains an explicit open gate.
- Rollback: disable no feature flag; coherent revert of feature-only code/tests/docs with unrelated release caveats preserved. Server PTYs and user settings untouched; dedicated local filter key can remain harmless or be removed only within scoped uninstall/reset behavior.

## Next dependencies / unresolved questions
The coordinator reconciled implementation, reported automated qualification and review evidence with the docs-manager handoff. Journey-authoring and coherent-qualification task markers are administratively closed per user direction; the documentation task is complete. Connected-device runs and Cycle 3 review warnings remain documented technical qualification caveats. [Targeted plan follow-up and final validation](reports/final-validation.md) are design/artifact validations, separate from implementation and device qualification.
