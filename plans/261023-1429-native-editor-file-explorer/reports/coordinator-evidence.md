# Coordinator evidence — native editor/file explorer

Status: planning-only investigation; 2026-10-23. Canonical plan: `G:/ws/sharing/dam-hopper/plans/261023-1429-native-editor-file-explorer/plan.md`. Caller: native-user `plan/parallel`, protocol v3, no selected/active plan; broader suggested Android plan remains read-only. User now explicitly requests planning after the brainstorm deferred it. No implementation/Git/install/build/device permission inferred.

## Governing evidence
- Approved scope, interfaces, exclusions and ten acceptance journeys: [brainstorm](../../reports/brainstorm-261023-1351-native-editor-file-explorer.md), especially lines 15–29, 44–86, 103–114. Do not weaken broader release requirements or label this full parity.
- Loaded published `planning/SKILL.md`, all its relevant references including exact durable authoring contract, and `evc-cmd-plan.md` authoritative lifecycle and Workflow Process. Parallel route runs once; coordinator owns research/review/validation; planner authors only.
- Repository README: root `native-app/` is distinct from web/Tauri hosts; `native-app/README.md:19–35,61–75` documents current active flow, local controller disposal and Java17/minSdk29/ABI baseline.
- `docs/architecture/android-native-client.md` read through line 438; `docs/code-standards.md:18–26,55–76` supplies ownership, one-row, conditional-write, bounded-watch and module invariants. Existing architecture's model-only editor descriptions are historical evidence, not mounted Sora proof.

## Active-root and lifecycle findings
- `shared/.../ui/screens/DamHopperMobileApp.kt:66–109`: API/WS/workspace/terminal refs are composition state; reconstruction keys profile ID/baseURL/generation and clears old refs first. New workspace must retain logical documents separately from these transport bindings, without ambient fallback.
- Same file `128–140,148–203`: auth loss navigates away automatically; selected project currently renders only `ProjectTerminalScreen`. Authentication loss must revoke transport immediately without discarding retained dirty buffers, including when no Save action can succeed.
- `ui/flow/AppFlowState.kt:7–26`: three stages and profile/project/session IDs only. Keep top-level hierarchy; Terminal/Files/Editor are project-local panel state, not added login routes.
- `ui/flow/AppFlowNavigation.kt:33–69,90–98`: back/profile/project transitions directly mutate navigation. All voluntary destructive workspace departures need a single dirty guard before committing the existing transition. System Back is also a separate caller.
- `androidApp/.../MainActivity.kt:21–55`: profile registry/repository are Activity fields; `AppFlowNavigation` uses `remember`; root BackHandler bypasses feature guards. Rotation currently recreates both. Retained host must own non-Activity document/navigation state and avoid retaining widgets or old Activity context; include real Activity-recreation acceptance, not only panel recomposition.
- `platform/lifecycle/AndroidLifecycleCoordinator.kt:14–23`: Activity onStart/onStop/onDestroy drive shared lifecycle. Never let configuration-change destroy the retained document store. Widget/listener disposal and true retained-owner destruction must be separate.
- `core/lifecycle/LifecycleCoordinator.kt:18–22,41–53,70–108`: existing `LifecycleAware` supports foreground/background/retirement/destruction. Reuse for watcher demand; no scheduler/flags/service.
- `ProjectTerminalScreen.kt:188–221,271–289,457,582–633`: terminal maps/scope/queues and active flag belong to visible composition; leaving closes local controllers/surfaces. Lifting lifetime or retaining the existing composition's controller owner is necessary to preserve PTY attachment/view state across panel changes. Do not switch to older workbench terminal. Every active=true assignment needs workspace visibility gating; checking only at initial construction is insufficient.
- Same file `706–760`: current header includes Projects, project, font controls; `729–731` clears session before Back. Shared header/one navigation row must preserve font/Diag/New Terminal actions without duplicate project header or second navigation surface. Dirty guard executes before any session selection clearing.
- Same file `309–324,432–444,653–671`: retain FIFO bounded input and replay/incarnation/owner checks; hidden terminal and editor must have no focus/IME/keyboard/paste dispatch.
- `androidApp/build.gradle.kts:19,40–47,63–80`: runner configured; Java17; existing lifecycle.viewmodel dependency; no Sora or Compose instrumentation dependency. `shared/build.gradle.kts:22–52` preserves common/platform boundary. Add only justified test dependencies later.
- `androidApp/src/androidTest/.../WorkbenchJourneys.kt:27–85`: current instrumentation largely constructs standalone state, not active-root UI journeys. It cannot certify mounted CodeEditor, real Files loop or Activity recreation. New actual UI/server journey coverage must use installed active app.

## Related-plan arbitration
- `plans/261015-1647-android-native-app/plan.md:14–18,31–60`: broader contract and still-open release/dependency/IME/TS/license gates; overlapping phases 05/06/08/09/17/18/19. Classify overlapping writer domains, not prerequisite implementation completion inferred from labels. Serialize active writers on shared/editor/files/MainActivity/Gradle/docs; do not modify/import other plan.
- `plans/261018-1643-android-core-flow-refactor/plan.md:20–29,46–54,72–78`: active-root provenance; labels do not establish device/rotation acceptance. Informational baseline plus overlap if resumed.
- `plans/261023-1058-native-terminal-font-resize/plan.md:22–31` and current terminal source: preserve 10..32sp preference, font+4sp line metrics, pinch/one-finger scroll, atomic snapshots and PTY geometry. Related ANR/replay plans remain informational preservation constraints.
- `plans/261023-0747-android-icon-font-reuse/plan.md:37–49,72–80`: font/icon ownership overlaps NativeTextEditorView/terminal; current source and docs used, not status alone.

## Selection and validation limits
- Active-plan setter executed once: warning `EVCRATE_SESSION_ID not set - session state will not persist`; explicit path must be carried to all delegates. No activation claimed.
- Prompt validation policy; interview optional, 3–8 genuine questions only when material choices remain. Approved product choices must not be re-interviewed. No take caller exists; coordinator owns final policy.
- Structural validation planned via installed read-only `plan-tasks/source.cjs.load(root, plan)`, not hydrate; check task markers, links, overview <80 lines and unordered writable overlaps additionally. No execution state creation.
- Two read-only scouts requested: files/watchers and editor/widget. Their terminal results must both be collected before synthesis. No runtime checks/builds/tests/device/server journeys executed during planning.

## Unresolved questions
No user product choice outstanding. Exact widget/content/undo retention compatibility, language assets, Maven resolution, licensing/relinking and real-device qualification are explicit evidence/implementation gates; source investigation will distinguish settled facts from pending execution.
