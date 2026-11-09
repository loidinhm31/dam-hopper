# P04 — Adapt retained Settings and safe config workflows

## Context links
[Overview](plan.md) | [Binding C1–C10](architecture-contracts.md) | [Ownership/transfers](execution-ownership.md) | [Acceptance matrix](acceptance-matrix.md) | [reports/api-compatibility-evidence.md](reports/api-compatibility-evidence.md) | [reports/design-dispositions.md](reports/design-dispositions.md) | [reports/android-ui-ux-design.md](reports/android-ui-ux-design.md)

## Overview
- Priority: P1 (safety-critical cutover); status: pending; effort: 16h.
- Owner: Feature04-Settings. Parallelization group: `G-A`.
- Prerequisite task IDs: `cutover-settings-patches`
- Authoring only. No product execution approved; no build/lint/tests/formatter while authoring or feature writers are active.

## Key evidence
Settings already separates preference source A from administered target B with single-use admission and unknown outcomes; Hub C is not authority for either. Server stores nullable JSON shortcut values as TOML empty string; Android emits JSON null. Workspace root change can dispose server PTYs and is not a project selection.

## Requirements
Functional: retained globally reachable Settings overlay with exact origin restoration via settled P01 ports; scope chips This Device, Preference Source A and Admin Target B. Present native-supported controls only; retain all unknown/web-only configuration. SAF import/export remains Activity-owned port; root changes require destructive impact warning and explicit confirmation, dirty/owner guards before mutation. Device commands/history opt-in/clear, Cognito, diagnostics and agent admin reuse existing behavior.
Nonfunctional: no preference auto-source/target from active Hub, no blanket no-auth read-only denial, no new settings database/service, no OS shortcut advertising. Preserve failed hydration/unknown writes as visible state; never regenerate defaults over malformed raw storage.

## Architecture and ports
Use existing SettingsRepository/SettingsTargetAuthority and request-local guard, no second state owner. P02 provides sparse null-aware patches; this slice renders/edit supported values and confirms destructive operations. Root navigation takes targetProfileId+subsection+origin; P07 wires ports but G-A may not edit them. NotificationsView belongs exclusively to Feature05; Feature04 exposes existing screen slot without editing notification-specific controls. Maintenance uses existing Settings documentPort backed by SAF in MainActivity; source A/B do not change on import/export or active workspace switch.

## Related files and ownership
Absolute source mapping: every project-relative literal below resolves under `G:/ws/sharing/dam-hopper/`; these are full source paths by that mapping. Runtime report paths listed Create are future evidence artifacts, not files authored during planning. No directory ownership or globs.
### Create (new files; not existing source)
- None.

### Modify (existing files)
- `native/android-app/shared/src/commonMain/kotlin/dev/damhopper/nativeapp/features/settings/SettingsScreens.kt`
- `native/android-app/shared/src/commonMain/kotlin/dev/damhopper/nativeapp/features/settings/PreferencesPrivacyView.kt`
- `native/android-app/shared/src/commonMain/kotlin/dev/damhopper/nativeapp/features/settings/SettingsHostView.kt`
- `native/android-app/shared/src/commonMain/kotlin/dev/damhopper/nativeapp/features/settings/GlobalSettingsView.kt`
- `native/android-app/shared/src/commonMain/kotlin/dev/damhopper/nativeapp/features/settings/RemoteConfigScreen.kt`
- `native/android-app/shared/src/commonMain/kotlin/dev/damhopper/nativeapp/features/settings/SettingsConfirmDialogs.kt`
- `native/android-app/shared/src/commonMain/kotlin/dev/damhopper/nativeapp/features/settings/AgentIntegrationView.kt`
- `native/android-app/shared/src/commonMain/kotlin/dev/damhopper/nativeapp/features/settings/HardwareShortcutRegistry.kt`
- `native/android-app/shared/src/jvmTest/kotlin/dev/damhopper/nativeapp/features/settings/PreferenceConsumersTest.kt`
- `native/android-app/shared/src/jvmTest/kotlin/dev/damhopper/nativeapp/features/settings/HardwareShortcutRegistryTest.kt`
- `native/android-app/androidApp/src/test/kotlin/dev/damhopper/nativeapp/SettingsPreferencesPhase17Test.kt`
- `native/android-app/shared/src/commonMain/kotlin/dev/damhopper/nativeapp/features/settings/SettingsRepository.kt`
- `native/android-app/shared/src/commonMain/kotlin/dev/damhopper/nativeapp/features/settings/RemoteConfigEditor.kt`
- `native/android-app/shared/src/commonMain/kotlin/dev/damhopper/nativeapp/features/settings/RemoteConfigRepository.kt`
- `native/android-app/shared/src/commonMain/kotlin/dev/damhopper/nativeapp/features/settings/MaintenanceView.kt`
- `native/android-app/shared/src/commonMain/kotlin/dev/damhopper/nativeapp/features/settings/SettingsDiagnostics.kt`
- `native/android-app/shared/src/jvmTest/kotlin/dev/damhopper/nativeapp/features/settings/SettingsRepositoryTest.kt`
- `native/android-app/shared/src/jvmTest/kotlin/dev/damhopper/nativeapp/features/settings/RemoteConfigEditorTest.kt`
- `native/android-app/shared/src/jvmTest/kotlin/dev/damhopper/nativeapp/features/settings/SettingsDiagnosticsTest.kt`

### Create (coordinator-only completion receipts after stopped task/wave)
- `plans/261107-0305-android-agent-hub-redesign/reports/present-settings-scopes-completion.md`
- `plans/261107-0305-android-agent-hub-redesign/reports/present-settings-scopes-evidence.json`
- `plans/261107-0305-android-agent-hub-redesign/reports/preserve-settings-documents-completion.md`
- `plans/261107-0305-android-agent-hub-redesign/reports/preserve-settings-documents-evidence.json`

### Delete
- No whole-file deletions. Remove obsolete replaced methods/callers/navigation assertions inside the modified files; unrelated dormant feature code stays.

### Conflict and transfer rules
The task fences below are exhaustive writable authority. Within this phase, steps execute by their task dependencies. Shared sequential paths transfer `Contract01 -> Api02 -> owning Feature03/04/05/06 -> Integration07 -> Qualification08/docs` only where declared. G-A may read other slices but cannot write their files, common root, shared DTOs or ports. Any missing writable caller blocks the affected task until coordinator deliberately revises that task and reruns structural validation; no compatibility shim or unsanctioned edit. Ownership transfers only after predecessor stopped-wave checks, independent review and evidence-backed completion. Per-task report/evidence grants are coordinator-only after the worker stops. Exact per-path chain: [execution-ownership.md](execution-ownership.md).

## Numbered implementation steps by stable task ID
### present-settings-scopes
1. Make This Device/Source A/Admin B visible in every relevant Settings section, including explicit removed/disconnected/unsupported state. Leave Hub C independent and restore exact previous panel/document/session on close through origin callback.
2. Render supported nullable scalar/extra shortcut bindings as bound/unbound; user edits emit sparse patches via P02 repository. Do not show web-only desktop actions or overwrite unknown OS keys.
3. Preserve privacy/history/font/native accessory controls and agent admin gates. No-auth dev is a warning based on actual capability, not an invented read-only rule.
4. Author A/B/C separation, null unbind, unknown-key retention, removed source, supported no-auth admin and return-origin fixtures; coordinate notification section through existing APIs only.

### preserve-settings-documents
1. Ensure sole selected config/raw merge semantics throughout remote editor/import/export; retain unrelated server/project/web-only fields and show explicit unconfigured workspace.root errors, no defaults.workspace fallback.
2. Before root switch/import that changes root, display exact selected target and destructive remote PTY impact; require user confirmation plus current mutation/dirty guards, revalidate owner after SAF picker and consent.
3. Keep SAF export/import cancel/not-submitted/rejected/unknown distinct. Lost acknowledgement never triggers automatic replay/reset. Diagnostics redact credentials, account identifiers where sensitive and ticket paths.
4. Author raw round-trip fixtures and root-change/cancel/owner-retire cases; leave Activity launcher attach/detach wiring to P07.

## Durable task contract
```evcrate-tasks
[
  {
    "id": "present-settings-scopes",
    "title": "Render native Settings scopes and nullable preferences",
    "blocked_by": [
      "cutover-settings-patches"
    ],
    "allowed_files": [
      "native/android-app/shared/src/commonMain/kotlin/dev/damhopper/nativeapp/features/settings/SettingsScreens.kt",
      "native/android-app/shared/src/commonMain/kotlin/dev/damhopper/nativeapp/features/settings/PreferencesPrivacyView.kt",
      "native/android-app/shared/src/commonMain/kotlin/dev/damhopper/nativeapp/features/settings/SettingsHostView.kt",
      "native/android-app/shared/src/commonMain/kotlin/dev/damhopper/nativeapp/features/settings/GlobalSettingsView.kt",
      "native/android-app/shared/src/commonMain/kotlin/dev/damhopper/nativeapp/features/settings/RemoteConfigScreen.kt",
      "native/android-app/shared/src/commonMain/kotlin/dev/damhopper/nativeapp/features/settings/SettingsConfirmDialogs.kt",
      "native/android-app/shared/src/commonMain/kotlin/dev/damhopper/nativeapp/features/settings/AgentIntegrationView.kt",
      "native/android-app/shared/src/commonMain/kotlin/dev/damhopper/nativeapp/features/settings/HardwareShortcutRegistry.kt",
      "native/android-app/shared/src/jvmTest/kotlin/dev/damhopper/nativeapp/features/settings/PreferenceConsumersTest.kt",
      "native/android-app/shared/src/jvmTest/kotlin/dev/damhopper/nativeapp/features/settings/HardwareShortcutRegistryTest.kt",
      "native/android-app/androidApp/src/test/kotlin/dev/damhopper/nativeapp/SettingsPreferencesPhase17Test.kt",
      "plans/261107-0305-android-agent-hub-redesign/reports/present-settings-scopes-completion.md",
      "plans/261107-0305-android-agent-hub-redesign/reports/present-settings-scopes-evidence.json"
    ],
    "constraints": [
      "Stay within this literal allowlist; escalate additional writes to integration owner before editing.",
      "Implementer authors tests but runs no checks. After every writer in this selected coherent wave stops, coordinator runs applicable compile, focused regressions, separate meaningful task-local smoke and independent review before evidence-backed completion or successor admission; no sibling-edit checks, no defer-to-P08 completion."
    ],
    "acceptance": [
      "Changing Hub workspace/profile never silently selects Settings source or target.",
      "Unbinding sends JSON null for changed field only; web-only values remain untouched."
    ],
    "verification": [
      "At this task/wave stop barrier, coordinator runs applicable existing Gradle shared/app compilation and focused owned regression classes from acceptance-matrix command timing; record exact command, exit and assertions. No dependent future root/release work is required for this task's acceptance.",
      "Use the current Settings screen/component with independent A/B/C selections, change C, unbind one A value, and observe scopes/callback origin plus actual sparse request; no future retained Hub overlay required.",
      "Collect terminal implementation and passing independent review after stopped-wave checks; write exact results and reviewer provenance to plans/261107-0305-android-agent-hub-redesign/reports/present-settings-scopes-completion.md and current helper-schema evidence to plans/261107-0305-android-agent-hub-redesign/reports/present-settings-scopes-evidence.json. Smoke/review cannot be waived; failed or missing gates block completion. P08 separately repeats full integrated/live/device release suites."
    ]
  },
  {
    "id": "preserve-settings-documents",
    "title": "Preserve raw config and confirm destructive workspace operations",
    "blocked_by": [
      "present-hub-navigator",
      "present-settings-scopes",
      "present-bounded-attention-feed",
      "present-codebase-browser"
    ],
    "allowed_files": [
      "native/android-app/shared/src/commonMain/kotlin/dev/damhopper/nativeapp/features/settings/SettingsRepository.kt",
      "native/android-app/shared/src/commonMain/kotlin/dev/damhopper/nativeapp/features/settings/RemoteConfigEditor.kt",
      "native/android-app/shared/src/commonMain/kotlin/dev/damhopper/nativeapp/features/settings/RemoteConfigRepository.kt",
      "native/android-app/shared/src/commonMain/kotlin/dev/damhopper/nativeapp/features/settings/MaintenanceView.kt",
      "native/android-app/shared/src/commonMain/kotlin/dev/damhopper/nativeapp/features/settings/SettingsDiagnostics.kt",
      "native/android-app/shared/src/jvmTest/kotlin/dev/damhopper/nativeapp/features/settings/SettingsRepositoryTest.kt",
      "native/android-app/shared/src/jvmTest/kotlin/dev/damhopper/nativeapp/features/settings/RemoteConfigEditorTest.kt",
      "native/android-app/shared/src/jvmTest/kotlin/dev/damhopper/nativeapp/features/settings/SettingsDiagnosticsTest.kt",
      "plans/261107-0305-android-agent-hub-redesign/reports/preserve-settings-documents-completion.md",
      "plans/261107-0305-android-agent-hub-redesign/reports/preserve-settings-documents-evidence.json"
    ],
    "constraints": [
      "Stay within this literal allowlist; escalate additional writes to integration owner before editing.",
      "Implementer authors tests but runs no checks. After every writer in this selected coherent wave stops, coordinator runs applicable compile, focused regressions, separate meaningful task-local smoke and independent review before evidence-backed completion or successor admission; no sibling-edit checks, no defer-to-P08 completion."
    ],
    "acceptance": [
      "Import/export and one-field edits preserve unrelated raw config.",
      "Root-changing operation is separately confirmed and cannot masquerade as Open Project; uncertain result is not retried."
    ],
    "verification": [
      "At this task/wave stop barrier, coordinator runs applicable existing Gradle shared/app compilation and focused owned regression classes from acceptance-matrix command timing; record exact command, exit and assertions. No dependent future root/release work is required for this task's acceptance.",
      "Use existing Settings remote-config component with owned raw config and document port: export/import round trip, cancel, and root-change consent/refusal/unknown result. Observe actual preserved fields and zero mutation on cancel. Full MainActivity SAF lifecycle acceptance remains P08, not this task prerequisite.",
      "Collect terminal implementation and passing independent review after stopped-wave checks; write exact results and reviewer provenance to plans/261107-0305-android-agent-hub-redesign/reports/preserve-settings-documents-completion.md and current helper-schema evidence to plans/261107-0305-android-agent-hub-redesign/reports/preserve-settings-documents-evidence.json. Smoke/review cannot be waived; failed or missing gates block completion. P08 separately repeats full integrated/live/device release suites."
    ]
  }
]
```

- [ ] <!-- evcrate-task:present-settings-scopes --> Render native Settings scopes and nullable preferences
- [ ] <!-- evcrate-task:preserve-settings-documents --> Preserve raw config and confirm destructive workspace operations

## Behavior acceptance and qualification
Each task's acceptance/verification arrays are binding at its own stopped coherent-wave completion barrier; the coordinator runs applicable compile, focused regressions, separate meaningful task-local smoke and independent review before helper evidence-backed completion and dependent admission. Implementers run no checks, and no coordinator checks occur while any sibling writer edits. P01–P06 prove component/provider behavior through settled ports, not unimplemented future MainActivity/release wiring; P07 proves its focused active-root/lifetime behavior sequentially. P08 alone repeats full integrated/live/device/human release suites. Tests alone are not smoke. Missing required runtime/device prerequisites block the affected gate; source-only authoring cannot claim runtime success. Record failures/skips/blockers distinctly; no fabricated pass or waiver.

## Risks, privacy, security, failure and rollback
Risk: full-config typed serialization silently drops web fields; use raw document preservation and byte/field comparison in qualification. Privacy: exports/diagnostics are user-initiated SAF, no secret logs. Failure: null/unknown/unsupported data stays explicit, destructive requests retain Unknown on admitted loss. Rollback: restore client Settings changes only, never overwrite remote config from stale backup; saved remote changes remain user's data.

## Downstream barrier
present-settings-scopes joins W05 and preserve-settings-documents waits for all W05 completions then joins W06. Each stopped wave requires coordinator applicable compile/focused tests, component/provider smoke and independent review before evidence-backed completion; P07 admits only completed features. No MainActivity/ViewModel/root/AppFlow/DTO/theme/NotificationsView/platform writes. P07 wires retained origin/SAF lifecycle; task-local acceptance must not wait for that future wiring.

## Unresolved questions
None for product design. User confirmed adaptive navigator and all already-connected profiles; no saved-profile auto-connect/keepalive. [Final validation](reports/final-plan-validation.md) preserves C1-C10, task contracts and ownership unchanged. Device/WS/auth/crypto-fixture checks remain explicit implementation gates, not observed passes.
