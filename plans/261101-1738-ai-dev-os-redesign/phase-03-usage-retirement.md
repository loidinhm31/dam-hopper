# Phase 03: P0b — Usage retirement and independent early release

Estimate: 48h; implementation status **DONE per user approval (2026-11-02); technical acceptance incomplete**. [Overview](plan.md) · [Ownership](ownership.md) · [Acceptance](acceptance.md).

## Context and validated authority
V1–V6 override older prose while retaining PROTOTYPE FIRST. Phase02+03 ship their OWN EARLY RELEASE before OS cutover, independently of prototype/other OS gates. Native shared-host pruning hands files immediately to prototype core; remaining P0 build/Usage/docs/manual/release runs concurrently. Only prototype's two-file embed-route task waits for Usage web, not any release receipt. Coordinator pins exact P0 shared-file states at ownership handoffs and qualifies source-pinned isolated artifacts, never half-edited live prototype sources. Old UI stays default.

## Architecture / requirements
- Keep neutral DB path-helper extraction before deleting telemetry; preserve auth/session canonical/symlink/hardlink/Windows collision safety, dropping only removed active telemetry DB entry.
- Delete TelemetryConfig/runtime/collector and all Usage endpoints/clients; tolerate ignored legacy server.telemetry on TOML load and PUT /api/config by deleting BOTH config/replacement.rs and api/config.rs telemetry guards. No new server API/WS change or compatibility shim.
- V5: NO migration code at all. Do not move/preserve exporter ownership(), config read/write/secret logic or parse raw legacy collector settings; delete that old code with telemetry directory. No startup/periodic/exporter cleanup, marker, ≥1-release retention or Codex config mutation.
- V5 one-time manual OPERATOR action on THIS MACHINE ONLY: user verified telemetry.db and telemetry-hmac-key present, no collector token file, no [otel] exporter block in ~/.codex/config.toml. With old collector-owning runtime stopped during P0 installation, delete exactly the two specified files. No token or Codex action, no other-machine instructions/general cleanup automation. This plan performs no deletion.
- V6: delete docs/api/agent-usage-and-sessions.md entirely; relocate only useful retained agent-status/PTY-session facts into existing API/architecture guides. Remove Usage/telemetry/OTLP collector documentation sections and mentions entirely from README/system/frontend/API/configuration/codebase/Android docs, and scrub old CHANGELOG entries about those features. Do NOT add a Usage Removed/migration/cleanup changelog entry. Retain separate Tauri/SSH removal handling. Keep unrelated host CPU/memory “usage” and Traditional/runtime usage-mode.
- Android ResourcesSubProduct is already FLEET-only; delete remaining Usage parameter/files/active NativeWorkspaceViewModel/settings/inactive Workbench callers without OS adoption or unrelated Git changes.

## Ordered steps by task ID
### retire-usage-server
1. Move neutral path helpers/tests and migrate every listed AppState constructor caller.
2. Delete telemetry directory, Usage routes/modules/types, config/default/validation/serialization, both guards and runtime/shutdown wiring; remove proven telemetry-only dependencies. Do NOT create any migrations/exporter helper or raw legacy collector reader.
3. Remove feature-only tests; preserve retained test assertions. Add usage_retirement regressions for404/legacy TOML+PUT/no4811/non-Usage routes and path collisions, and prove startup never reads/writes Codex exporter/user data.
### retire-usage-web
1. After native UI owner releases route/navigation, delete Usage page/components/settings/client DTO/hooks/query keys/REST invocation branches and dedicated tests.
2. Preserve terminal-usage-mode and system host metrics. Existing old UI routes/default remain; no background requests to removed APIs.
### retire-usage-android
1. Delete eight Usage files/two tests and active/inactive/settings instantiation/disposal/foreground callers.
2. Retain Fleet/host/idle/config/remote Git behavior and legacy generic config roundtrip.
### document-removals
1. After native+Usage source joins, perform full V6 scrub in exact docs below; delete the entire mixed API Usage guide. Relocate retained non-Usage facts to existing rest-endpoints/transport-and-events/agent-status docs, fix links, no second Usage authority.
2. host-and-usage.md retains only HOST-resource material, no Usage sections or feature text. Scrub old Usage/telemetry/OTLP collector CHANGELOG entries entirely, not annotate/deprecate them; no new Usage entry. Tauri/SSH Removed entries remain permitted/required independently. Phase10 must not recreate deleted sections/guide.
### manual-local-telemetry-cleanup
1. Human operator stops old collector-owning runtime for P0 installation, deletes only the two user-authorized local files with the exact command in contract, then starts updated P0. No agent write scope outside repo, no re-probing provided observations.
2. Record operator result in release report. No exporter/token action (none present); no cleanup module/script. Deleted local data is irreversible, not a rollback promise.
### release-p0-removals
1. Join P0 source writers and freeze source-pinned P0 artifact workspace, retaining shared-host/embed P0 versions captured BEFORE their handoff to prototype. Run own existing legacy UI/server/Android checks there, not future OS suites or live half-edited prototype tree. Prototype work continues concurrently; one main verifier sequences CPU-heavy check runs without adding completion dependencies.
2. Use updated version script once with patch/allow-dirty/no-commit/no-tag, then alignment checker. All nine retained synchronized version paths are explicitly owned; native manifest paths absent. No Git operation is authorized/performed by this gate.
3. Gate writes NO CHANGELOG. Prior docs task removes Usage history and handles Tauri separately. Review that no telemetry docs/history/migration code survived.
4. Publish/install THIS P0 artifact via existing retained pipeline/runbook and record source/version/check/publication receipt. Neither P0 gate nor prototype waits on the other's receipt; only Phase08 OS root cutover requires P0 already shipped. No release claim merely from tests/version edit.

## Success / planned verification
P0 independently satisfies updated AC1–3/V5 manual/V6 scrub/version checks on joined P0 artifact; author runs none. Old shell remains default. Prototype/OS gates may run concurrently or finish first; NONE gates P0 release. `/os` is not required in the P0 artifact. P0 receipt must precede root cutover, not lifecycle work.

## Risks / security / rollback
Retain non-Usage server/Android compatibility, remote Git SSH and host-resource protections. Manual deletion affects only two explicitly approved machine files with old writer stopped; no config/token/other files touched and no restoration guaranteed. Roll back P0 through existing coherent artifact procedure if needed, without inventing exporter migration or restoring deleted data automatically. Do not document dead Usage features as supported or add forbidden Usage history. Subsequent OS rollback must retain shipped P0. No builds/tests/Git/deletion/publication performed in planning.

## Literal file actions and ownership
Paths relative to `/home/loidinh/WS/dam-hopper/`; directory entries own descendants. Human manual task has empty repository writable set and confers no agent HOME write permission. Later version gate owns only retained version paths/report, NO CHANGELOG. All other paths read-only.

### `retire-usage-server` file actions

| Action | Literal writable path |
|---|---|
| Create | `server/src/utils/db_paths.rs` |
| Modify | `server/src/utils/mod.rs` |
| Modify | `server/src/auth/config.rs` |
| Modify | `server/src/main.rs` |
| Modify | `server/src/lib.rs` |
| Modify | `server/src/state.rs` |
| Modify | `server/src/config/schema.rs` |
| Modify | `server/src/config/parser.rs` |
| Modify | `server/src/config/mod.rs` |
| Modify | `server/src/config/replacement.rs` |
| Modify | `server/src/config/tests.rs` |
| Modify | `server/src/api/config.rs` |
| Modify | `server/src/api/router.rs` |
| Modify | `server/src/api/mod.rs` |
| Modify | `server/src/api/tests.rs` |
| Modify | `server/src/api/resource_events.rs` |
| Modify | `server/src/pty/tests.rs` |
| Modify | `server/src/persistence/restore.rs` |
| Delete | `server/src/telemetry` |
| Delete | `server/src/api/usage.rs` |
| Delete | `server/src/api/usage_sessions.rs` |
| Delete | `server/src/api/usage_sessions` |
| Modify | `server/Cargo.toml` |
| Modify | `server/Cargo.lock` |
| Modify | `server/examples/agent_free_consent_fixture.rs` |
| Delete | `server/tests/codex_app_server_compatibility.rs` |
| Create | `server/tests/usage_retirement.rs` |
| Modify | `server/tests/auth_lite_mode.rs` |
| Modify | `server/tests/auth_mfa_api.rs` |
| Modify | `server/tests/auth_no_auth.rs` |
| Modify | `server/tests/browser_debug_artifacts.rs` |
| Modify | `server/tests/fs_mutate.rs` |
| Modify | `server/tests/fs_upload.rs` |
| Modify | `server/tests/fs_write_streaming.rs` |
| Modify | `server/tests/git_blame_api.rs` |
| Modify | `server/tests/git_commit_message_api.rs` |
| Modify | `server/tests/git_conflict_discovery_api.rs` |
| Modify | `server/tests/git_conflict_operation_api.rs` |
| Modify | `server/tests/git_leased_publish_api.rs` |
| Modify | `server/tests/git_squash_api.rs` |
| Modify | `server/tests/host_resource_baseline.rs` |
| Modify | `server/tests/host_resource_events.rs` |
| Modify | `server/tests/idle_suspend.rs` |
| Modify | `server/tests/idle_suspend_phase07.rs` |
| Modify | `server/tests/plans_api.rs` |
| Modify | `server/tests/session_changes_api.rs` |
| Modify | `server/tests/session_changes_lifecycle.rs` |
| Modify | `server/tests/settings_import_export.rs` |
| Modify | `server/tests/transport_enforcement_phase03.rs` |
| Modify | `server/tests/workflow_api.rs` |
| Modify | `server/tests/ws_client_presence.rs` |
| Modify | `server/tests/ws_fs_subscribe.rs` |
| Modify | `server/tests/common/auth_fixtures.rs` |
| Modify | `scripts/qualify-phase09-workbench.mjs` |

### `retire-usage-android` file actions

| Action | Literal writable path |
|---|---|
| Delete | `native/android-app/shared/src/commonMain/kotlin/dev/damhopper/nativeapp/features/host/UsageRepository.kt` |
| Delete | `native/android-app/shared/src/commonMain/kotlin/dev/damhopper/nativeapp/features/host/UsageController.kt` |
| Delete | `native/android-app/shared/src/commonMain/kotlin/dev/damhopper/nativeapp/features/host/UsageModels.kt` |
| Delete | `native/android-app/shared/src/commonMain/kotlin/dev/damhopper/nativeapp/features/host/UsageDialogs.kt` |
| Delete | `native/android-app/shared/src/commonMain/kotlin/dev/damhopper/nativeapp/features/host/UsageSettingsSection.kt` |
| Delete | `native/android-app/shared/src/commonMain/kotlin/dev/damhopper/nativeapp/features/host/UsageScreens.kt` |
| Delete | `native/android-app/shared/src/commonMain/kotlin/dev/damhopper/nativeapp/features/host/UsageSettingsModels.kt` |
| Delete | `native/android-app/shared/src/commonMain/kotlin/dev/damhopper/nativeapp/features/host/UsageUiState.kt` |
| Modify | `native/android-app/shared/src/commonMain/kotlin/dev/damhopper/nativeapp/features/host/ResourcesUnifiedPanelScreen.kt` |
| Modify | `native/android-app/shared/src/commonMain/kotlin/dev/damhopper/nativeapp/features/settings/SettingsHostView.kt` |
| Modify | `native/android-app/shared/src/commonMain/kotlin/dev/damhopper/nativeapp/ui/screens/WorkbenchScreen.kt` |
| Modify | `native/android-app/androidApp/src/main/kotlin/dev/damhopper/nativeapp/platform/workspace/NativeWorkspaceViewModel.kt` |
| Delete | `native/android-app/shared/src/jvmTest/kotlin/dev/damhopper/nativeapp/features/host/UsageControllerLoadingTest.kt` |
| Delete | `native/android-app/shared/src/jvmTest/kotlin/dev/damhopper/nativeapp/features/host/UsageRepositoryAndControllerTest.kt` |

### `retire-usage-web` file actions

| Action | Literal writable path |
|---|---|
| Delete | `packages/ui/src/components/usage` |
| Delete | `packages/ui/src/components/pages/UsagePage.tsx` |
| Delete | `packages/ui/src/components/pages/UsagePage.test.tsx` |
| Delete | `packages/ui/src/components/organisms/SettingsUsageInsightsSection.tsx` |
| Delete | `packages/ui/src/components/organisms/SettingsUsageInsightsSection.test.tsx` |
| Delete | `packages/ui/src/components/organisms/SettingsUsageInsightsCodexRow.tsx` |
| Modify | `packages/ui/src/components/pages/SettingsPage.tsx` |
| Modify | `packages/ui/src/components/pages/SettingsPage.test.tsx` |
| Modify | `packages/ui/src/components/pages/DashboardPage.tsx` |
| Modify | `packages/ui/src/api/queries.ts` |
| Modify | `packages/ui/src/api/queries.test.ts` |
| Modify | `packages/ui/src/api/client.ts` |
| Modify | `packages/ui/src/api/ws-transport.ts` |
| Modify | `packages/ui/src/api/ws-transport.test.ts` |
| Modify | `packages/ui/src/api/query-client.ts` |
| Modify | `packages/ui/src/lib/navigation.ts` |
| Modify | `packages/ui/src/lib/navigation.test.ts` |
| Modify | `packages/ui/src/embed/dam-hopper-app.tsx` |
| Modify | `packages/ui/src/embed/dam-hopper-app.test.tsx` |
| Delete | `packages/ui/browser-tests/usage-session-audit.browser.tsx` |
| Modify | `packages/ui/browser-tests/settings-usage-insights.browser.tsx` |
| Delete | `packages/ui/browser-tests/usage-page.browser.tsx` |

### `document-removals` file actions

| Action | Literal writable path |
|---|---|
| Modify | `README.md` |
| Modify | `AGENTS.md` |
| Modify | `docs/CHANGELOG.md` |
| Modify | `docs/api-reference.md` |
| Delete | `docs/api/agent-usage-and-sessions.md` |
| Modify | `docs/system-architecture.md` |
| Modify | `docs/codebase-summary.md` |
| Modify | `docs/deployment-guide.md` |
| Modify | `docs/windows-release-packaging.md` |
| Modify | `docs/frontend-components/platform-integrations.md` |
| Modify | `docs/frontend-components/host-and-usage.md` |
| Modify | `docs/android-native-acceptance.md` |
| Modify | `docs/code-standards.md` |
| Modify | `docs/README.md` |
| Modify | `docs/configuration-guide.md` |
| Modify | `docs/configuration/server-runtime-settings.md` |
| Modify | `docs/architecture/android-native-client.md` |
| Modify | `docs/architecture/agent-store-ports-and-browser.md` |
| Modify | `docs/api/system-services.md` |
| Delete | `docs/native-browser-debug-support.md` |
| Delete | `docs/architecture/native-ssh-forwarding.md` |
| Modify | `docs/api/rest-endpoints.md` |
| Modify | `docs/api/transport-and-events.md` |
| Modify | `docs/architecture/agent-status.md` |
| Modify | `docs/configuration/index.md` |
| Modify | `docs/configuration/server-configuration.md` |
| Modify | `docs/codebase-summary-release.md` |

### `manual-local-telemetry-cleanup` file actions

| Action | Literal writable path |
|---|---|

No repository writes; human-only external manual action exactly scoped above.

### `release-p0-removals` file actions

| Action | Literal writable path |
|---|---|
| Modify | `apps/browser-extension/package.json` |
| Modify | `apps/web/package.json` |
| Modify | `packages/browser-bridge/package.json` |
| Modify | `packages/shared/package.json` |
| Modify | `packages/ui/package.json` |
| Modify | `server/Cargo.toml` |
| Modify | `server/Cargo.lock` |
| Modify | `scripts/run-uat.sh` |
| Modify | `tests/deploy/linux-release-rootless-smoke.sh` |
| Create | `plans/261101-1738-ai-dev-os-redesign/reports/p0-release.md` |

## Durable task contracts

```evcrate-tasks
[
  {
    "id": "retire-usage-server",
    "title": "Remove Usage server without migration code; preserve legacy config tolerance",
    "blocked_by": [],
    "allowed_files": [
      "server/src/utils/db_paths.rs",
      "server/src/utils/mod.rs",
      "server/src/auth/config.rs",
      "server/src/main.rs",
      "server/src/lib.rs",
      "server/src/state.rs",
      "server/src/config/schema.rs",
      "server/src/config/parser.rs",
      "server/src/config/mod.rs",
      "server/src/config/replacement.rs",
      "server/src/config/tests.rs",
      "server/src/api/config.rs",
      "server/src/api/router.rs",
      "server/src/api/mod.rs",
      "server/src/api/tests.rs",
      "server/src/api/resource_events.rs",
      "server/src/pty/tests.rs",
      "server/src/persistence/restore.rs",
      "server/src/telemetry",
      "server/src/api/usage.rs",
      "server/src/api/usage_sessions.rs",
      "server/src/api/usage_sessions",
      "server/Cargo.toml",
      "server/Cargo.lock",
      "server/examples/agent_free_consent_fixture.rs",
      "server/tests/codex_app_server_compatibility.rs",
      "server/tests/usage_retirement.rs",
      "server/tests/auth_lite_mode.rs",
      "server/tests/auth_mfa_api.rs",
      "server/tests/auth_no_auth.rs",
      "server/tests/browser_debug_artifacts.rs",
      "server/tests/fs_mutate.rs",
      "server/tests/fs_upload.rs",
      "server/tests/fs_write_streaming.rs",
      "server/tests/git_blame_api.rs",
      "server/tests/git_commit_message_api.rs",
      "server/tests/git_conflict_discovery_api.rs",
      "server/tests/git_conflict_operation_api.rs",
      "server/tests/git_leased_publish_api.rs",
      "server/tests/git_squash_api.rs",
      "server/tests/host_resource_baseline.rs",
      "server/tests/host_resource_events.rs",
      "server/tests/idle_suspend.rs",
      "server/tests/idle_suspend_phase07.rs",
      "server/tests/plans_api.rs",
      "server/tests/session_changes_api.rs",
      "server/tests/session_changes_lifecycle.rs",
      "server/tests/settings_import_export.rs",
      "server/tests/transport_enforcement_phase03.rs",
      "server/tests/workflow_api.rs",
      "server/tests/ws_client_presence.rs",
      "server/tests/ws_fs_subscribe.rs",
      "server/tests/common/auth_fixtures.rs",
      "scripts/qualify-phase09-workbench.mjs"
    ],
    "constraints": [
      "Only listed paths writable; escalate additions to coordinator before editing.",
      "No mid-flight build/test/formatter runs while other writers are active; main integration owner verifies after the group joins.",
      "V5 prohibits all Codex exporter/telemetry migration code and any filesystem mutation of user telemetry/config data by the server; manual local cleanup is separate."
    ],
    "acceptance": [
      "All Usage HTTP routes return authenticated404; no telemetry runtime/collector listener; other REST/WS contracts unchanged.",
      "Legacy server.telemetry TOML and PUT config accepted after removing both API/replacement guards, with no compatibility config member.",
      "No startup exporter cleanup, ownership-proof logic, raw legacy collector read, migration module or scheduled/user-data cleanup code exists.",
      "Neutral DB path helpers retain auth/session collision semantics; every constructor consumer migrated."
    ],
    "verification": [
      "cargo test --manifest-path server/Cargo.toml --test usage_retirement",
      "cargo test --manifest-path server/Cargo.toml",
      "Main launches isolated updated server with legacy config, probes authenticated /api/usage/summary -> 404 and PUT /api/config acceptance; ss -ltn confirms no 4811 listener in its isolated namespace."
    ]
  },
  {
    "id": "retire-usage-android",
    "title": "Delete Android Usage and remove active and panel-shell callers",
    "blocked_by": [],
    "allowed_files": [
      "native/android-app/shared/src/commonMain/kotlin/dev/damhopper/nativeapp/features/host/UsageRepository.kt",
      "native/android-app/shared/src/commonMain/kotlin/dev/damhopper/nativeapp/features/host/UsageController.kt",
      "native/android-app/shared/src/commonMain/kotlin/dev/damhopper/nativeapp/features/host/UsageModels.kt",
      "native/android-app/shared/src/commonMain/kotlin/dev/damhopper/nativeapp/features/host/UsageDialogs.kt",
      "native/android-app/shared/src/commonMain/kotlin/dev/damhopper/nativeapp/features/host/UsageSettingsSection.kt",
      "native/android-app/shared/src/commonMain/kotlin/dev/damhopper/nativeapp/features/host/UsageScreens.kt",
      "native/android-app/shared/src/commonMain/kotlin/dev/damhopper/nativeapp/features/host/UsageSettingsModels.kt",
      "native/android-app/shared/src/commonMain/kotlin/dev/damhopper/nativeapp/features/host/UsageUiState.kt",
      "native/android-app/shared/src/commonMain/kotlin/dev/damhopper/nativeapp/features/host/ResourcesUnifiedPanelScreen.kt",
      "native/android-app/shared/src/commonMain/kotlin/dev/damhopper/nativeapp/features/settings/SettingsHostView.kt",
      "native/android-app/shared/src/commonMain/kotlin/dev/damhopper/nativeapp/ui/screens/WorkbenchScreen.kt",
      "native/android-app/androidApp/src/main/kotlin/dev/damhopper/nativeapp/platform/workspace/NativeWorkspaceViewModel.kt",
      "native/android-app/shared/src/jvmTest/kotlin/dev/damhopper/nativeapp/features/host/UsageControllerLoadingTest.kt",
      "native/android-app/shared/src/jvmTest/kotlin/dev/damhopper/nativeapp/features/host/UsageRepositoryAndControllerTest.kt"
    ],
    "constraints": [
      "Only listed paths writable; escalate additions to coordinator before editing.",
      "No mid-flight build/test/formatter runs while other writers are active; main integration owner verifies after the group joins."
    ],
    "acceptance": [
      "No Usage screen/controller/repository/models/polling remain; Fleet/idle/settings authority retained.",
      "Active NativeWorkspaceViewModel and inactive WorkbenchScreen compile without Usage dependencies."
    ],
    "verification": [
      "pnpm android:test",
      "pnpm android:test:app",
      "node scripts/run-gradle.mjs :shared:compileKotlinJvm :androidApp:compileDebugKotlin",
      "Exercise retained Host Resources/settings against updated server; no /api/usage requests."
    ]
  },
  {
    "id": "retire-usage-web",
    "title": "Delete web Usage and all REST client/query consumers",
    "blocked_by": [
      "remove-native-ui"
    ],
    "allowed_files": [
      "packages/ui/src/components/usage",
      "packages/ui/src/components/pages/UsagePage.tsx",
      "packages/ui/src/components/pages/UsagePage.test.tsx",
      "packages/ui/src/components/organisms/SettingsUsageInsightsSection.tsx",
      "packages/ui/src/components/organisms/SettingsUsageInsightsSection.test.tsx",
      "packages/ui/src/components/organisms/SettingsUsageInsightsCodexRow.tsx",
      "packages/ui/src/components/pages/SettingsPage.tsx",
      "packages/ui/src/components/pages/SettingsPage.test.tsx",
      "packages/ui/src/components/pages/DashboardPage.tsx",
      "packages/ui/src/api/queries.ts",
      "packages/ui/src/api/queries.test.ts",
      "packages/ui/src/api/client.ts",
      "packages/ui/src/api/ws-transport.ts",
      "packages/ui/src/api/ws-transport.test.ts",
      "packages/ui/src/api/query-client.ts",
      "packages/ui/src/lib/navigation.ts",
      "packages/ui/src/lib/navigation.test.ts",
      "packages/ui/src/embed/dam-hopper-app.tsx",
      "packages/ui/src/embed/dam-hopper-app.test.tsx",
      "packages/ui/browser-tests/usage-session-audit.browser.tsx",
      "packages/ui/browser-tests/settings-usage-insights.browser.tsx",
      "packages/ui/browser-tests/usage-page.browser.tsx"
    ],
    "constraints": [
      "Only listed paths writable; escalate additions to coordinator before editing.",
      "No mid-flight build/test/formatter runs while other writers are active; main integration owner verifies after the group joins."
    ],
    "acceptance": [
      "No Usage page/nav/settings/client hooks/background calls remain.",
      "Traditional/runtime terminal usage-mode and CPU/memory usage displays preserved."
    ],
    "verification": [
      "pnpm --filter @dam-hopper/ui test -- src/api/queries.test.ts src/api/ws-transport.test.ts src/components/pages/SettingsPage.test.tsx",
      "pnpm --filter @dam-hopper/ui build",
      "Inspect authenticated default old Settings/Dashboard and retained routes; zero /api/usage calls. No future /os suite or route required for P0."
    ]
  },
  {
    "id": "document-removals",
    "title": "Scrub Usage documentation/history and retain Tauri removal documentation",
    "blocked_by": [
      "retire-usage-server",
      "retire-usage-android",
      "retire-usage-web",
      "remove-native-ui",
      "remove-native-build"
    ],
    "allowed_files": [
      "README.md",
      "AGENTS.md",
      "docs/CHANGELOG.md",
      "docs/api-reference.md",
      "docs/api/agent-usage-and-sessions.md",
      "docs/system-architecture.md",
      "docs/codebase-summary.md",
      "docs/deployment-guide.md",
      "docs/windows-release-packaging.md",
      "docs/frontend-components/platform-integrations.md",
      "docs/frontend-components/host-and-usage.md",
      "docs/android-native-acceptance.md",
      "docs/code-standards.md",
      "docs/README.md",
      "docs/configuration-guide.md",
      "docs/configuration/server-runtime-settings.md",
      "docs/architecture/android-native-client.md",
      "docs/architecture/agent-store-ports-and-browser.md",
      "docs/api/system-services.md",
      "docs/native-browser-debug-support.md",
      "docs/architecture/native-ssh-forwarding.md",
      "docs/api/rest-endpoints.md",
      "docs/api/transport-and-events.md",
      "docs/architecture/agent-status.md",
      "docs/configuration/index.md",
      "docs/configuration/server-configuration.md",
      "docs/codebase-summary-release.md"
    ],
    "constraints": [
      "Only listed paths writable; escalate additions to coordinator before editing.",
      "No mid-flight build/test/formatter runs while other writers are active; main integration owner verifies after the group joins."
    ],
    "acceptance": [
      "Delete docs/api/agent-usage-and-sessions.md entirely, relocating only retained agent-status/PTY-session facts to existing non-Usage guides; no duplicate Usage document survives.",
      "Remove Usage/telemetry/OTLP collector sections/mentions from current README/API/frontend/system/configuration/codebase/Android docs AND old CHANGELOG entries; no new Usage Removed or migration entry.",
      "Keep Tauri/SSH-forward removal documentation and Removed handling; old web UI remains documented/default and retained host CPU/memory monitoring is not deleted."
    ],
    "verification": [
      "Review exact documentation paths for zero live Usage/telemetry feature documentation and zero old Usage/OTLP collector CHANGELOG entries; no new Usage entry.",
      "Check all links after deleting mixed API guide; retained agent-status/PTY-session facts live in existing rest-endpoints/transport/agent-status guides. Tauri removal handling remains."
    ]
  },
  {
    "id": "manual-local-telemetry-cleanup",
    "title": "Perform user-authorized one-time telemetry file deletion on this machine only",
    "blocked_by": [
      "retire-usage-server"
    ],
    "allowed_files": [],
    "constraints": [
      "HUMAN OPERATOR ONLY; allowed_files is empty because these external HOME files are not repository/agent write authority.",
      "This task documents a manual future action; plan author performs no deletion, shell probe or runtime change.",
      "Only this machine: user verified telemetry.db and telemetry-hmac-key present, no collector token file, and no [otel] exporter block in ~/.codex/config.toml. Do not re-probe to confirm or edit Codex config."
    ],
    "acceptance": [
      "While installing P0 with old collector-owning server stopped, operator deletes exactly ~/.config/dam-hopper/telemetry.db and ~/.config/dam-hopper/telemetry-hmac-key.",
      "No cleanup script/migration, collector-token action, Codex config edit, recursive deletion, other-machine cleanup or restoration of deleted data implied."
    ],
    "verification": [
      "Operator records manual execution of: rm -- \"$HOME/.config/dam-hopper/telemetry.db\" \"$HOME/.config/dam-hopper/telemetry-hmac-key\"; only these two paths, after stopping old collector-owning runtime, then start updated P0.",
      "Record operator completion in P0 release report without secrets. This authored plan is not evidence deletion occurred; no personal runtime action is executed during authoring."
    ]
  },
  {
    "id": "release-p0-removals",
    "title": "Qualify, version and ship the independent early P0 release",
    "blocked_by": [
      "document-removals",
      "manual-local-telemetry-cleanup"
    ],
    "allowed_files": [
      "apps/browser-extension/package.json",
      "apps/web/package.json",
      "packages/browser-bridge/package.json",
      "packages/shared/package.json",
      "packages/ui/package.json",
      "server/Cargo.toml",
      "server/Cargo.lock",
      "scripts/run-uat.sh",
      "tests/deploy/linux-release-rootless-smoke.sh",
      "plans/261101-1738-ai-dev-os-redesign/reports/p0-release.md"
    ],
    "constraints": [
      "Only listed repository paths writable; discoveries require coordinator contract revision.",
      "Main verifies after all P0 writers join; no mid-flight checks or formatter runs.",
      "No dependency on any Phase01 or04–10 task. Use existing legacy UI suites/flows and retained server/Android release pipeline, not future OS fixtures.",
      "Qualify a source-pinned isolated P0 artifact/workspace with shared-host/embed versions captured at writer handoff; prototype proceeds concurrently. Never test half-edited live prototype files or add a prototype completion dependency.",
      "CHANGELOG-free release gate: no changelog file in writable set, no generated Usage/telemetry release entry. Prior docs task scrubs Usage history and retains Tauri removal handling.",
      "Version-only authorized future invocation: node scripts/bump-version.mjs patch --allow-dirty --no-commit --no-tag; no Git read/write, staging, commit, tag or push. These flags bypass source status and return before Git actions; existing release publication/deployment stays with release coordinator/operator."
    ],
    "acceptance": [
      "P0 artifact containing Phase02+03 ships as its OWN EARLY RELEASE before OS cutover, with current old UI default; no prototype/full-shell/AI/cutover/Phase09/10 prerequisite.",
      "Synchronized retained release files bumped by scripts/bump-version.mjs and check-version-alignment passes; version fixtures/retained CI server-web-Android packaging no native coupling.",
      "Independent current-source backend/UI/browser/legacy production-journey/Android probes and manual local cleanup receipts pass; no Usage docs/history/new entry, no migration/exporter cleanup code.",
      "Release report identifies source/artifact/version, exact check outcomes and existing-pipeline publication/install receipt; no release claim merely from tests or version edit."
    ],
    "verification": [
      "pnpm check",
      "pnpm --filter @dam-hopper/ui test",
      "pnpm --filter @dam-hopper/ui test:browser",
      "E2E_CAPTURE=1 pnpm --filter @dam-hopper/ui test:e2e -- traditional-terminal-agents device-login-management privacy-heavy-blur",
      "pnpm android:test && pnpm android:test:app",
      "node scripts/run-gradle.mjs :shared:compileKotlinJvm :androidApp:compileDebugKotlin",
      "cargo test --manifest-path server/Cargo.toml --test usage_retirement",
      "node --test tests/deploy/bump-version.test.mjs",
      "node scripts/bump-version.mjs patch --allow-dirty --no-commit --no-tag",
      "node deploy/release/check-version-alignment.mjs",
      "pnpm release:verify",
      "Against isolated updated P0: legacy telemetry TOML boot/PUT accepted, authenticated Usage404/no4811; non-Usage REST/WS inventory stable; existing old UI/profile/auth/browser/terminal works.",
      "Review V6 documentation/history scrub and Tauri-only removal notes; record manual local deletion completion plus actual early release publication/install receipt under existing runbook, independent of OS phases."
    ]
  }
]
```

- [x] <!-- evcrate-task:retire-usage-server --> Remove Usage server without migration code; preserve legacy config tolerance
- [x] <!-- evcrate-task:retire-usage-android --> Delete Android Usage and remove active and panel-shell callers
- [x] <!-- evcrate-task:retire-usage-web --> Delete web Usage and all REST client/query consumers
- [x] <!-- evcrate-task:document-removals --> Scrub Usage documentation/history and retain Tauri removal documentation
- [x] <!-- evcrate-task:manual-local-telemetry-cleanup --> Perform user-authorized one-time telemetry file deletion on this machine only
- [x] <!-- evcrate-task:release-p0-removals --> Qualify, version and ship the independent early P0 release

## Phase completion summary

Marked **DONE per user approval (2026-11-02); technical acceptance incomplete**.
- **retire-usage-server**: Deleted `server/src/telemetry`, usage REST endpoints (`/api/usage/*`), and OTLP dependencies. Extracted neutral DB path helpers (`server/src/utils/db_paths.rs`). Tolerated legacy `[server.telemetry]` TOML and PUT `/api/config`. 5 `usage_retirement` tests and 28 regression tests passed. Hermetic binary startup/no4811 evidence (W5) carried forward.
- **retire-usage-android**: Deleted 8 Kotlin Usage files and 2 test files; updated callers (`ResourcesUnifiedPanelScreen`, `SettingsHostView`, `WorkbenchScreen`, `NativeWorkspaceViewModel`). `:shared:jvmTest` passed; transport-level allocation boundedness (W1) carried forward.
- **retire-usage-web**: Deleted `/usage` page, `components/usage`, `SettingsUsageInsightsSection`, client DTOs, query hooks, and navigation; removed `/usage` route from `dam-hopper-app.tsx` and router tests. 78 UI unit tests passed across 4 files. Phase 01 Task 3 (`integrate-os-prototype-route`) route handoff unblocked.
- **document-removals**: V6 scrub completed in `docs/CHANGELOG.md` with zero new Usage entries. Deleted `docs/api/agent-usage-and-sessions.md`; relocated retained agent-status and session persistence facts to `docs/api/rest-endpoints.md`. Full documentation link repair and audit (W2/W3) delegated to `Phase03DocsManager`.
- **manual-local-telemetry-cleanup**: Documented exact user-authorized external command recipe for operator execution (`telemetry.db`, `telemetry-hmac-key`) per V5; actual external execution on host remains an operational receipt requirement.
- **release-p0-removals**: Version bumped to v0.15.6 across 9 release manifests; `deploy/release/check-version-alignment.mjs` verified server/web alignment. Full shipment, publication/install receipt, and container production journeys (`traditional-terminal-agents`, `device-login-management`) remain open qualification gates before Phase 08 root cutover.
