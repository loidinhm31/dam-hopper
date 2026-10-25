# Android-applicable Settings and notification parity

Status: planned, **all runtime verification unexecuted**. Each row is acceptance, not a claim of existing reachability. Web evidence: [web scout](scout/web-feature-evidence.md), SettingsPage/SettingsAppearanceSection/SettingsKeyboardShortcutsSection/AgentSettings in `packages/ui/src/components`; exact web wire keys in `packages/ui/src/api/client.ts:2101-2177`. [Contracts](contracts.md) settle adaptation/security. No no-op controls and no raw-JSON-only parity.

## Ownership and file keys

G0=`establish-request-local-admission`→`freeze-native-contracts`: existing transport/profile plus **proposed** awaited C2a1 registry barriers/API/tests, frozen before branches/read-only G2. S1=`settings-owner-safe-sync`; S2=`settings-remote-admin`; S3=`settings-native-controls`; N1=`notifications-live-admission`; N2=`notifications-platform-delivery` (disjoint G1). I1=`integrate-retained-settings-notifications`; I2=`integrate-reactive-preference-consumers`, sequential owner. Q=`qualify-active-settings-notifications`; D=`finalize-settings-notification-docs`, scoped code-standards scroll/language and `docs/project-overview-pdr.md` **only Required scroll1..50/default5**, unrelated caveats preserved. S3→I2 view/consumer transfer, never concurrent writes.

File names below resolve only to these paths (new files explicitly planned):
- Settings views/repositories: `native/android-app/shared/src/commonMain/kotlin/dev/damhopper/nativeapp/features/settings/` + named file; no write authority from this directory reference.
- Active screen consumers: `native/android-app/shared/src/commonMain/kotlin/dev/damhopper/nativeapp/ui/screens/` + named file.
- Host controls: `native/android-app/shared/src/commonMain/kotlin/dev/damhopper/nativeapp/features/host/` + named file.
- Files/editor consumers: `native/android-app/shared/src/commonMain/kotlin/dev/damhopper/nativeapp/features/files/FileTreeState.kt`, `native/android-app/shared/src/commonMain/kotlin/dev/damhopper/nativeapp/features/files/FileScreens.kt`, `native/android-app/shared/src/commonMain/kotlin/dev/damhopper/nativeapp/features/editor/NativeTextEditorView.kt`.
- Platform: `native/android-app/androidApp/src/main/kotlin/dev/damhopper/nativeapp/platform/storage/AndroidCommandHistoryStore.kt`, `native/android-app/androidApp/src/main/kotlin/dev/damhopper/nativeapp/platform/editor/AndroidEditorSurface.kt`, `native/android-app/androidApp/src/main/kotlin/dev/damhopper/nativeapp/platform/workspace/NativeWorkspaceViewModel.kt`, `native/android-app/androidApp/src/main/kotlin/dev/damhopper/nativeapp/platform/notifications/AndroidNotificationSink.kt`, `AndroidNotificationAudio.kt` and `AndroidNotificationPlatform.kt` in that same notifications package.
- Typography: `native/android-app/shared/src/commonMain/kotlin/dev/damhopper/nativeapp/ui/theme/NativeTheme.kt` and `Type.kt`; privacy: `native/android-app/shared/src/commonMain/kotlin/dev/damhopper/nativeapp/core/security/PrivacyController.kt`.

Scope P=preference source, T=independent Settings target, L=local, R=existing connected runtime. Dirty `{ui:{field}}` only. Every P/T mutation including reused workspace/usage/idle/TerminalRepository agent methods forwards required request-local C2a/C2b guard. Resolve/credentials/preparation before registry→operation **tryLock only** atomic local commit, never operation→registry/profile. Same fair operation Mutex ordered invalidations; retire-before-publication/thread-safe currentSnapshot. Registered earlier intent cannot be overtaken; contention/pre-admission rejection zero execute, post-admission Unknown possible, no socket cancellation/retry. G0 transport/profile/tests, S1 operation gate, S2 reused repository/controller/view/tests, I1 runtime publication/callers. TerminalRepository sole agent endpoints, structured escaped JSON; P never implicitly changes T/workspace.

C2a1 exact seam/latch/recovery in contracts: registry atomic revoke N→RETIRING shared completion; current/create/admit/runtime publication cannot use guessed N+1 pending/failed. Whole drain/finalization NonCancellable outside registry lock, attempt all barriers/aggregate failure, observers only after drain, concurrent retirees share result. Failure/cancellation latches unavailable until explicit one-attempt recoverRetirement, no new identity/automatic retry. Strict transitive no profile/registry reentry/awaited lock-dependent work. G0 owns registry/profile API/tests; I1 VM registers by token before eligibility, retires/drains before unregister and owns literal VM/readiness tests; captured callbacks survive removal. No claimed existing awaited registry capability.

## Selectors, appearance and native local controls

| ID / web control | Actual native control → reactive consumer | API/scope | Owner/task | Planned verification |
|---|---|---|---|---|
| S01 Target Server | MaintenanceView selector → retained target services/SettingsHostView | T, no active-profile fallback | S3/S1→I1 | Target B while active A; writes B only; stale B completion hidden |
| S02 Workbench Preferences Source | PreferencesPrivacyView selector/status → SettingsRepository.preferences flow | P, source snapshot/local/unset/removed | S3/S1→I1 | A→B→A with suspended hydrate/save cannot publish first A |
| S03 System font | PreferencesPrivacyView stepper → NativeTheme/Type and active ProfileLoginScreen/ProjectListScreen/ProjectWorkspaceScreen themed text | P systemFontSize 10..32 | S3/S1→I2 | Change live, large-font screenshots; no route recreation |
| S04 Editor font | Stepper → NativeTextEditorView → AndroidEditorSurface update | P editorFontSize 10..32 | S3/S1→I2 | Font changes with dirty text/undo unchanged |
| S05 Terminal font | Stepper → ProjectTerminalScreen/retained ProjectTerminalState | P terminalFontSize 10..32 | S3/S1→I2 | Live settings and shortcut +/− share same flow/persistence |
| S06 Ctrl+wheel zoom | Native zoom toggle → AndroidEditorSurface pinch/hardware-wheel gate | P editorZoomWheelEnabled | S3/S1→I2 | Enabled zoom; disabled no font change; hidden input blocked |
| S07 Hidden files | Switch → FileTreeState/FileScreens and editor sidebar | P explorerShowHidden | S3/S1→I2 | Same hidden entry disappears/appears in both active consumers |
| S08 Inline terminal suggestions | Switch → explicit native history suggestion strip in ProjectTerminalScreen | P terminalSuggestionsEnabled; history L | S3/S1→I2 | True shows matching consented local history; false removes; insert draft only; no shell-prompt inference |
| S09 Latest commit | Switch → ProjectTerminalScreen target-qualified branch/commit header | P terminalCommitStatusEnabled; existing remote read API | S3/S1→I2 | Actual project branch/commit appears/hides; stale target result rejected; no Git page |
| S10 Project auto-switch | Switch → ProjectWorkspaceScreen guarded authoritative terminal selection | P terminalAutoSwitchProjectEnabled | S3/S1→I2 | Assigned terminal switches project only when enabled; free terminal preserves; dirty guard |
| S11 Local history enable | Explicit consent switch → AndroidCommandHistoryStore and ProjectTerminalScreen record gate | **L only**, no global UI/TOML | S3→I2 | Off initial; enabled exact confirmed app-submitted commands; disable stops future recording |
| S12 Clear local history | Confirmed clear action → storage and live suggestion invalidation | L, all native history; endpoint/account/profile isolation for lookup | S3→I2 | Clear persistent bytes and current suggestions, no server write/export |
| S13 Scroll buttons | Switch → inline ProjectTerminalScreen step/jump row | P terminalScrollButtonsEnabled | S3/S1→I2 | Visible/invisible without FABs; edge commands affect retained viewport only |
| S14 Scroll step | Stepper1..50 → retained terminal viewport | P terminalScrollStep; raise clamp20→50, default5 | S3/S1→I2; Q→D docs |1/50 exact lines, existing5 preserved; D code-standards + project-overview-pdr Required bound reconciled, unrelated caveats unchanged |
| S15 Custom mobile keyboard enable | Switch → NativeAccessoryKeyboard visible/input eligibility | P mobileCustomKeyboardEnabled | S3/S1→I2 | Enabled usable Ctrl/Alt/Esc/Tab/arrows; disabled hides, no browser forced-on policy |
| S16 Keyboard font | Stepper → NativeAccessoryKeyboard | P mobileCustomKeyboardFontSize 9..18sp | S3/S1→I2 | Live min/max render and accessible labels |
| S17 Keyboard padding | Stepper → NativeAccessoryKeyboard | P mobileCustomKeyboardPadding 2..14dp | S3/S1→I2 | Padding changes; actual touch bounds stay >=48dp |
| S18 Keyboard row gap | Stepper → NativeAccessoryKeyboard | P mobileCustomKeyboardRowGap 2..12dp | S3/S1→I2 | Two rows relayout live, no hidden key dispatch |
| S19 Cognito style | Choice → PrivacyController active mask | P heavy-blur/black-screen | S3/S1→I2 | Both real mask presentations; terminal/editor input freezes; touch dismissal |
| S20 Existing native theme | Choice → NativeTheme palette | L existing WorkbenchTheme | S3→I2 | Every exposed choice changes presentation; legacy values not inert |
| S21 Language filter | Choice → FileRepository existing language scan/FileTreeState/FileScreens/sidebar ancestor tree | P **all/rust/javascript-typescript/java** | G0/S3/S1→I2 | Every real value decode/hydrate/save and actual family tree; known/code/text each local all non-equivalent notice/recoverable bytes, never dirty/remote auto-save; hidden/truncated/error/stale-target tests |
| S22 Existing sound master | Switch → foreground NotificationCoordinator audio decision | L soundEnabled | S3→I1 | Sound off suppresses manual foreground play, no OS bypass |
| S23 Existing haptics | Switch → NativeAccessoryKeyboard feedback | L hapticFeedbackEnabled | S3→I2 | On/off changes native key feedback |
| S24 Existing status filter | Text/filter → NotificationCenter list | L statusFilter | S3→I1 | Filter affects current list, not event admission/history deletion |

## Hardware shortcuts — capture/cancel/reset for each supported binding

HardwareShortcutRegistry control/dispatch follows frozen C1: Android Mod=Ctrl, explicit Meta separate, exact modifiers/physical DOM codes, capture consumes down/up/cancel/reset/collision. DoubleShift first-class default filename search, monotonic450ms inclusive/release-separated nonrepeat taps, resets focus/route/owner/modifier/IME/capture/privacy. Unsupported physical key explicit reason and imported binding preserved. Tests exercise behavior, not source strings; only approved destination exclusions below.

| ID / exact action | Native control/consumer and disposition | Scope/key | Owner/task | Planned verification |
|---|---|---|---|---|
| K01 Text Search | Capture/reset → WorkspaceSearchView content via existing SearchRepository | P searchTextShortcut; default Mod+Shift+KeyF | S3/S1→I2 | Android Ctrl+Shift+physicalF opens real search; Meta not interchangeable; locale/IME/repeat/input precedence |
| K02 Filename Search | Capture/reset including DoubleShift → actual filename search | P searchFilenameShortcut; default **DoubleShift** | S3/S1→I2 |449/450 match,451 no match; release/repeat/composition/focus/route/capture/owner/privacy resets, no PTY leak; real owner/path result |
| K03 Terminal workspace/IDE toggle | Disabled row: guided native terminal has no IDE-layout mode; user-approved unavailable | P terminalWorkspaceShortcut preserved, no dispatcher | S3/S1→I2 | Reason visible, no page/layout activated; imported chord roundtrip |
| K04 Terminal font increase | Capture/reset → repository terminalFontSize update | P terminalFontSizeIncreaseShortcut | S3/S1→I2 | One keydown increments, upper clamp32, no terminal key leak |
| K05 Terminal font decrease | Capture/reset → same consumer | P terminalFontSizeDecreaseShortcut | S3/S1→I2 | Lower clamp10; Settings value reflects immediately |
| K06 File panel | Capture/reset → focused Files panel | P terminalFilePanelShortcut | S3/S1→I2 | Opens existing Files only, retained editor unaffected |
| K07 Reveal active file | Capture/reset → retained tree expand/select active document path | P revealActiveFileShortcut | S3/S1→I2 | Correct owner/path; no active file reports visible reason |
| K08 Git | Disabled row: Git page not part of focused root; user-approved unavailable | P gitPanelShortcut preserved | S3/S1→I2 | Reason visible; no dormant Git shell mounted |
| K09 Ports | Disabled row: Ports page excluded from focused root | P portsPanelShortcut preserved | S3/S1→I2 | No unrelated Ports page or dead handler |
| K10 Project | Capture/reset → existing guarded Projects flow | P projectPanelShortcut | S3/S1→I2 | Dirty departure guard Save/Discard/Cancel respected |
| K11 Fleet terminal | Disabled row: no Fleet destination in focused root | P fleetTerminalShortcut preserved | S3/S1→I2 | Reason visible; no global runtime creation |
| K12 Cognito | Capture/reset → PrivacyController activation/exact captured dismiss chord | P cognitoModeShortcut | S3/S1→I2 | Touch emergency exit/trailing release consumed; active state never persisted |

## Remote usage and server idle policy

| ID / control | Actual native control/consumer | API/scope | Owner/task | Planned verification |
|---|---|---|---|---|
| H01 Codex receiver enable | SettingsHostView → UsageSettingsSection/UsageController | T GET/PATCH `/api/usage/settings`, `/api/usage/setup` | S2→I1 | Receiver actually enabled on selected server, not device |
| H02 Receiver disable | Same control/controller | T same existing APIs | S2→I1 | Server disabled state confirmed; error preserves authoritative value |
| H03 Resume receiver | Resume action → UsageController | T settings/setup semantics from existing web/controller | S2→I1 | Paused state resumes without duplicate install |
| H04 Retry receiver | Explicit Retry action → UsageController | T retry setup/settings request | S2→I1 | Failed receiver retried only by user; no destructive replay |
| H05 Codex exporter toggle/status | Setup switch/status → UsageController/UsageRepository | T GET/PATCH usage setup | S2→I1 | Enabled/disabled reflects real setup, busy/error/current owner |
| H06 Open usage data | Settings Usage data action → retained UsageScreens scoped subdestination | T existing usage queries | S2→I1 | Real data loads, Back returns Settings; no unrelated Resources shell |
| H07 Retention | UsageScreens/UsageSettingsSection retention control | T usage settings | S2→I1 | Retention update changes server, bounds/error visible |
| H08 Data deletion | UsageScreens/UsageDialogs destructive action | T existing usage delete APIs, explicit confirmation | S2→I1 | Cancel no write; confirmed selected target deletion, stale result fenced |
| H09 Idle quiet period | HostControlScreens pair editor → IdleConsentController/**IdleSuspendRepository** | T status GET/timing PATCH, required C2b guard | S2→I1 | Returned min/max enforced by repository/controller, unknown/stale no write, suspended credentials invalidation zero |
| H10 Idle wake period | Same pair and guard | T timing pair, returned wake bounds | S2→I1 | Atomic pair, dynamic bounds and cancellations, never hardcoded60..86400 |
| H11 Idle fixed agent-free quiet | Read-only status explanation | T server-owned constant | S2→I1 | Actual fixed period not fake edit |
| H12 Capability/locked/handoff/noauth | Disabled reasons/controller, force/consent consumers use required owner guard | T status/timing/force/consent existing APIs | S2→I1 | Unknown/unsupported/locked/handoff/noauth blocks, auth invalidation/no retry/cancellation preserved |

## Global and structured configuration

| ID / control | Actual native control/consumer | API/scope | Owner/task | Planned verification |
|---|---|---|---|---|
| G01 Default inspect/Set | GlobalSettingsView→RemoteConfigRepository.updateGlobalDefaults | T POST `/api/global-config/defaults`, **`{"defaults":{"workspace":path}}`** | S2/S1→I1 | Exact JSON/server default/status/errors, required guard after credentials |
| G02 Default Clear | Same explicit Clear | T **`{"defaults":{}}`** | S2/S1→I1 | Default removed, known registry unchanged, no delete route guess |
| G03 Known workspaces list | GlobalSettingsView→existing WorkspaceRepository | T GET `/api/workspace/known` | S2→I1 | Real paths/current marker, no duplicate API owner |
| G04 Known add | Existing addKnownWorkspace with required request-local guard | T POST known, structured path/name | S2→I1 | Duplicate/invalid remote path errors, pre-admission switch zero writes |
| G05 Known remove | Existing removeKnownWorkspace with required guard | T DELETE known JSON | S2→I1 | Current removal disabled/server rejection preserved, no automatic replay |
| C01 Workspace name/root | RemoteConfigScreen structured fields → RemoteConfigEditor | T GET/PUT `/api/config` | S2→I1 | Name editable; authoritative root visible/read-only like web; unknown fields preserved |
| C02 Project add/edit/remove | Structured project rows, stable IDs → editor | T config PUT/project PATCH `/api/config/projects/{name}` | S2→I1 | Required/duplicate name/path/type validation and real create/update/remove |
| C03 Project type | Select maven/gradle/npm/pnpm/cargo/custom | T project structured config | S2→I1 | Selected type saves exact wire value |
| C04 Env file | Structured text field | T project config | S2→I1 | Optional value/clear; path remains server-side |
| C05 Tags | Structured tag list editor | T project config | S2→I1 | Add/edit/remove tags without wiping other config |
| C06 Services | Service add/edit/remove: name/buildCommand/runCommand | T project config | S2→I1 | Each field mutation persists; duplicate/required validation |
| C07 Custom commands | Named command add/rename/value/remove | T project config | S2→I1 | Stable row identity while renaming; no execution by editing |
| C08 Terminal profiles | Add/edit/remove name/command/cwd rows | T project config | S2→I1 | Exact structured rows roundtrip, no PTY launch from editing |
| C09 Save/reload/conflict | Save/Reload/explicit replace choice → owner-qualified base/draft | T config current owner | S2/S1→I1 | Concurrent server change retains local draft, explicit resolution; no raw JSON sole UI |

## Maintenance and documents

| ID / control | Actual native control/consumer | API/scope | Owner/task | Planned verification |
|---|---|---|---|---|
| M01 Revalidate cache | MaintenanceView action → target-owned retained queries plus existing server cache clear | T POST `/api/settings/cache-clear` + local query invalidation | S3/S1→I1 | Consumers refetch selected target only, unrelated profile untouched |
| M02 LOCAL diagnostics export | Scope-confirmed action → SettingsDiagnostics + CreateDocument | L allowlisted app state; no server diagnostics substitute | S3→I1 | Inspect JSON: no secrets/private content/raw commands/history/output; correct selected scope |
| M03 Nuclear Reset | Guarded confirm→SettingsRepository | T POST reset | S3/S1→I1 | Destroys PTYs/runtime **not saved preferences**; dirty guard before admission, confirmed current navigation only, Unknown no retry |
| M04 Export TOML | Bounded export/CreateDocument | T GET export→SAF | S3/S1→I1 | <=1MiB saved bytes; cancel/write/stale no false success |
| M05 Open/import | OpenDocument bounded strict UTF-8→captured target confirmation→guarded transport | T POST import | S3/S1→I1 |1MiB/+1/multibyte/invalid/cancel/switch; suspended credentials invalidation zero requests |
| M06 Import outcome/backup | Actual imported/fileName/backupFileName/workspaceName response; obsolete ok removed | T captured outcome | G0/S3/S1→I1 | Valid imported=true only success; false/missing/malformed2xx never success, admitted ambiguity Unknown, backup authoritative, no automatic retry/rollback claim |

## Remote Agent Integration and notification policy

Agent Integration reuses TerminalRepository guards/JSON. Capture C3a owner/socket/endpoint/account/pathRevision before reducer suspension; withVerified checks direct registry.connectionsState.value availability, not eventually collected VM cache/display lookup/numeric generation alone. Path/config/install awaits invalidator. Profile retirement via **proposed G0 C2a1 barrier**, I1 VM before watchers/through close; coordinator.retire→provider.invalidate attempts old-owner prune/cancel/audio, failure to latch. No transitive lock reentry/network/detached cleanup; prior effect drained before return, N cannot cancel N+1. SourceA/targetB never certifies C; stale refresh/no replay. S2/N1/I1 disjoint; real ProfileRepository retirement, successor fencing/concurrency/failure/cancellation/lifetime tests required.

| ID / control | Actual native control/consumer | API/scope | Owner/task | Planned verification |
|---|---|---|---|---|
| A01 OMP path edit/reset | AgentIntegrationView→orchestrator→TerminalRepository, dirty source path patch | T host verify; P agentSettingsPaths.ompAgentDir | S2/S1→I1 | Scope visible; edit/reset revokes revision, runtime C not certified by B |
| A02 Codex path edit/reset | Same codexDir | T verify; P codexDir | S2/S1→I1 | Remote not device path, status-only |
| A03 Claude path edit/reset | Same claudeDir | T verify; P claudeDir | S2/S1→I1 | Wrong/unknown invalidates, valid result exact owner/path revision |
| A04 Verify paths | Reused getAgentPathsVerification, encoded query | T paths API | S2→I1 | Missing/unknown/stale result no enable; edits/socket/auth/retirement revoke |
| A05 OMP status/refresh | Reused getOmpExtensionStatus | T OMP extension API | S2→I1 | Authoritative ompCanEnable + runtime/install match + extension result, stale cannot reinstate |
| A06 OMP install | Confirm Install → POST `/api/agent-status/omp/extension/install` | T existing server | S2→I1 | Actual remote installation/status refresh, no Android shell |
| A07 OMP uninstall | Confirm Uninstall → DELETE OMP extension | T existing server | S2→I1 | Cancel no action, Unknown no automatic retry |
| A08 Claude hook status/refresh | Status/Refresh → GET `/api/agent-status/integrations/claude` | T encoded agentDir | S2→I1 | Real current hook/version state |
| A09 Claude hook install | Confirm Install → POST integrations/claude | T existing server | S2→I1 | Verified required path, confirmed remote outcome |
| A10 Claude hook uninstall | Confirm Uninstall → DELETE integrations/claude | T existing server | S2→I1 | Current owner/explicit confirmation/error |
| A11 Codex hook status/refresh | Status/Refresh → GET integrations/codex | T existing server | S2→I1 | Lifecycle hooks shown without enabling terminal alerts |
| A12 Codex hook install | Confirm Install → POST integrations/codex | T existing server | S2→I1 | Real remote hook installation, status-only policy unchanged |
| A13 Codex hook uninstall | Confirm Uninstall → DELETE integrations/codex | T existing server | S2→I1 | Real removal, stale completion fenced |
| N01 OMP enable | v2 switch→coordinator C3a readiness | P policy; R **event-qualified VERIFIED** | S3/S1→N1/I1 | Legacy off; sourceA-targetB-eventC isolation, unknown/invalidated suppress, no readiness-arrival replay |
| N02 Claude enable | Qualified needs-attention only | P policy; R path/integration VERIFIED | S3/S1→N1/I1 | turn-ended suppressed; path/config/edit/install/stale refresh/retirement revokes, labels fixed |
| N03 Codex enable | Disabled status-only row/reason, preserve imported policy wire | P v2 agents.codex; R always no alert | S3/S1→N1/I1 | No history/audio/OS for Codex even if remote enabled=true |
| N04 Per-agent in-app alert | Toast switch → transient feed | P agents.{agent}.toast; R foreground | S3/S1→N1/I1 | Toast false still history, max3, no resume backlog |
| N05 Per-agent System notifications | Switch labelled native System notifications → sink | P wire agents.{agent}.browser; R | S3/S1→N1/N2/I1 | Exact browser key roundtrip, no OS post without permission/channel |
| N06 Per-agent sound | Switch → C4 audio decision | P agents.{agent}.sound; R/L master | S3/S1→N1/N2/I1 | Foreground once, background channel only; false silent |
| N07 Per-agent volume | 0..1 slider → AndroidNotificationAudio | P agents.{agent}.volume; foreground only | S3/S1→N2/I1 | 0 mute/1 upper bound, no background volume workaround |
| N08 Per-agent pattern | default/soft/two-tone/urgent choice and explicit foreground preview | P agents.{agent}.pattern | S3/S1→N2/I1 | Different real patterns; no per-setting OS channels |
| N09 Unsupported policy | Read-only explanatory row, unrelated controls usable | P raw version preserved; R suppressed | S3/S1→N1/I1 | Unknown version survives font save byte-shape intact, no enable/delivery |
| N10 Permission request | Explicit Enable system notifications button → MainActivity launcher | L Android permission API33+; API29 not required | S3→N2/I1 | Grant/deny/dismiss each; never prompt on arrival/migration/event |
| N11 OS channel settings/status | Status/link → AndroidNotificationPlatform refresh | L existing three Android channels | S3→N2/I1 | Block/sound changes reflected on resume; no attempted immutable mutation |
| N12 Bell/unread/history | Inline NotificationCenter list → coordinator | R memory50, profile/generation identity | N1→I1 | Newest first/read counts/capacity; no process persistence |
| N13 Read/read-all | Per-record/Mark all → coordinator | R, no server write | N1→I1 | Read state changes only; target validity independent |
| N14 Dismiss transient | Close native transient → coordinator | R max3 | N1→I1 | Removes transient not history/high-water |
| N15 Clear history | Clear all → coordinator | R feed/transients only | N1→I1 | Clears UI, does not re-enable replay/evicted old audio |
| N16 Click OS/feed/transient | Exact target validator → AppFlowNavigation guarded continuation | R authoritative current owner/terminal; safe cold/disconnected UX | N2→I1 | Cold/live/rotation/after-auth/after-guard stale tests; newer attention revision allowed |

## Coverage and evidence gate

Every row above must receive real control/consumer evidence under Q; not satisfied by storing a field, mocked Settings host, static comment or passing build. New notifications originate only from live accepted semantic events after silent baseline; no added raw BEL/OSC behavior, runtime/scheduler/flags/backend change. Existing browser permission/input/document actions are adapted natively, not omitted. Missing Git/Ports/Fleet/IDE-layout destinations are the **only user-approved shortcut destination exclusions**, not authority to omit local history, keyboard, search or other Settings.

Accepted-correction gate: Q runs G0 ApiClientTest/ConnectionRegistryTest/ProfileRepository tests, I1 NativeWorkspaceViewModelTest/RuntimeIntegrationReadinessTest for real admitted-effect ProfileRepository retirement/publication wait, N+1 fencing, shared completion/all barriers, failure/cancellation/recovery/no-deadlock/lifetime and old-owner isolation; reused repository/consumer/input tests and actual MainActivity/server/OS remain required. Delete obsolete source assertions, never re-pin; Phase17 script not required behavior proof. D owns code-standards narrowly scroll1..50/default5 plus language/migration/ownership, and project-overview-pdr **only Required scroll1..50/default5**, preserving unrelated caveats; accurate imported/defaults/reset/admission/retirement docs.
