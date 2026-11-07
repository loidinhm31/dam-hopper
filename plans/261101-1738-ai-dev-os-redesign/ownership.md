# Exclusive ownership — corrected prototype-first concurrent schedule

## Scheduling contract
Single integration/release coordinator. Literal task arrays own writes; directory descendants/case-insensitive overlaps included. Other plans read-only; actual shared claims serialize. Qualification uses coherent source-pinned artifact workspaces; one main verifier sequences expensive checks, never suites over a half-edited live shared checkout. Pin P0 host/embed versions at the source-owner handoff before prototype writes, so independent P0 artifact release never depends on prototype completion or accidentally packages unfinished OS code. No new snapshot helper/service/API/Git action is prescribed or executed.

## Corrected schedule / ownership matrix
| Lane | Exclusive owners | Required dependency / overlap |
|---|---|---|
| Immediate shared-host prerequisite | remove-native-ui | Independently ready, no native-build/release/prototype prerequisite. Owns TerminalKeepAliveHost, BrowserDebugKeepAliveHost, browser-debug-keep-alive, BrowserDebugHostContext, server-config, transport-utils, WorkspacePage + native UI paths; pin P0 state at handoff. |
| Concurrent P0 | remove-native-build; retire-usage-server; retire-usage-android | Disjoint from host pruning/prototype core; native build is NOT a prototype prerequisite. |
| First OS core | generalize-tile-tree -> implement-os-lifecycle | Starts after remove-native-ui ONLY; core owns no embed route files. Runs alongside remaining P0 and early release. |
| P0 Usage web | retire-usage-web | After remove-native-ui; owns Usage/client/route/navigation files, none overlap prototype core. |
| Exact shared route handoff | integrate-os-prototype-route | After core AND retire-usage-web ONLY. Sole overlap is packages/ui/src/embed/dam-hopper-app.tsx and its test; those paths removed from core task. Pin P0 embed version before this handoff. NO backend/Android/docs/manual/release wait. |
| Prototype exit | qualify-prototype-gate | After route task; real lifecycle/input gate independent of P0 receipt. |
| Concurrent P0 docs/manual | document-removals; manual-local-telemetry-cleanup | Docs after P0 source joins, manual human-only after backend; disjoint from prototype. |
| Independent EARLY P0 RELEASE | release-p0-removals | After P0 docs/manual only (all P0 source inherited); own source-pinned old-UI checks, nine-file version bump/alignment/publication receipt. NO OS ancestor, NO CHANGELOG writes. |
| Shell chrome/services | complete-os-chrome -> integrate-os-services | qualify-prototype-gate ONLY; all actual native/Usage-web overlaps already inherited. No docs/manual/release file overlap, so receipt dependency removed. |
| OS feature progression | Phase05 ->06 ->07 | Existing sequential registry/shared-body ownership; can progress while P0 operator/release pending. |
| Root cutover join | cutover-root-shell -> remove-web-mobile-paths | Requires implement-launch-recipes AND release-p0-removals: P0 ships before root cutover, not before prototype. No Resolver-plan gate. |
| Later OS release gate/docs | Phase09 ->10 | Normal web apps/Resolver/human review and final docs; inherited cutover dependency serializes prior P0 doc/version owners. |

## Critical shared paths
- Shared native hosts: remove-native-ui -> implement-os-lifecycle (NOT via release gate). BrowserDebugHostContext deleted by first owner, not recreated.
- Embed dam-hopper-app.tsx + test: native UI -> Usage web -> integrate-os-prototype-route -> later services/management/cutover/mobile cleanup. Core never writes them.
- Native build/CI/package-root vs prototype core paths are disjoint; server/Android/docs/manual/version are also disjoint from core/route except already completed named handoffs.
- Version bump writes nine declared release files/report; P0 doc owner alone handles Usage history scrub/Tauri notes. Final docs follow cutover and thus P0 release, no competing docs writer.
- Manual task allowed_files=[] confers no repository or agent HOME writes. Human deletes only two user-approved local files; no migration/config/token action.

## Exact shared-path sequence
Generated in dependency topological order, including actual route-task split. Literal arrays/markers remain sole ownership authority; nested regression dirs ordered through cutover/Phase09.

| Literal path | Ordered exclusive owners |
|---|---|
| `AGENTS.md` | `document-removals` -> `publish-os-documentation` |
| `README.md` | `document-removals` -> `publish-os-documentation` |
| `docs/CHANGELOG.md` | `document-removals` -> `publish-os-documentation` |
| `docs/README.md` | `document-removals` -> `publish-os-documentation` |
| `docs/android-native-acceptance.md` | `document-removals` -> `publish-os-documentation` |
| `docs/api-reference.md` | `document-removals` -> `publish-os-documentation` |
| `docs/api/rest-endpoints.md` | `document-removals` -> `publish-os-documentation` |
| `docs/api/system-services.md` | `document-removals` -> `publish-os-documentation` |
| `docs/api/transport-and-events.md` | `document-removals` -> `publish-os-documentation` |
| `docs/architecture/agent-status.md` | `document-removals` -> `publish-os-documentation` |
| `docs/architecture/agent-store-ports-and-browser.md` | `document-removals` -> `publish-os-documentation` |
| `docs/architecture/android-native-client.md` | `document-removals` -> `publish-os-documentation` |
| `docs/code-standards.md` | `document-removals` -> `publish-os-documentation` |
| `docs/codebase-summary-release.md` | `document-removals` -> `publish-os-documentation` |
| `docs/codebase-summary.md` | `document-removals` -> `publish-os-documentation` |
| `docs/configuration-guide.md` | `document-removals` -> `publish-os-documentation` |
| `docs/configuration/index.md` | `document-removals` -> `publish-os-documentation` |
| `docs/configuration/server-configuration.md` | `document-removals` -> `publish-os-documentation` |
| `docs/configuration/server-runtime-settings.md` | `document-removals` -> `publish-os-documentation` |
| `docs/deployment-guide.md` | `document-removals` -> `publish-os-documentation` |
| `docs/frontend-components/host-and-usage.md` | `document-removals` -> `publish-os-documentation` |
| `docs/frontend-components/platform-integrations.md` | `document-removals` -> `publish-os-documentation` |
| `docs/system-architecture.md` | `document-removals` -> `publish-os-documentation` |
| `docs/windows-release-packaging.md` | `document-removals` -> `publish-os-documentation` |
| `packages/ui/e2e/os-lifecycle` | `qualify-prototype-gate` -> `migrate-application-journeys` |
| `packages/ui/e2e/os-recipes` | `implement-launch-recipes` -> `migrate-application-journeys` |
| `packages/ui/src/components/organisms/BrowserDebugKeepAliveHost.test.tsx` | `remove-native-ui` -> `implement-os-lifecycle` |
| `packages/ui/src/components/organisms/BrowserDebugKeepAliveHost.tsx` | `remove-native-ui` -> `implement-os-lifecycle` |
| `packages/ui/src/components/organisms/BrowserDebugPanel.tsx` | `remove-native-ui` -> `migrate-workspace-apps` |
| `packages/ui/src/components/organisms/ChangedFilesList.tsx` | `migrate-workspace-apps` -> `migrate-git-and-reviews` -> `remove-web-mobile-paths` |
| `packages/ui/src/components/organisms/ConflictResolverPanel.tsx` | `migrate-git-and-reviews` -> `cutover-root-shell` |
| `packages/ui/src/components/organisms/DiffViewer.tsx` | `migrate-workspace-apps` -> `remove-web-mobile-paths` |
| `packages/ui/src/components/organisms/EditorTabs.tsx` | `implement-os-lifecycle` -> `migrate-workspace-apps` -> `migrate-git-and-reviews` |
| `packages/ui/src/components/organisms/GitLocalChanges.tsx` | `migrate-workspace-apps` -> `remove-web-mobile-paths` |
| `packages/ui/src/components/organisms/HostResourcePopover.tsx` | `implement-system-monitor` -> `cutover-root-shell` |
| `packages/ui/src/components/organisms/MonacoHost.test.tsx` | `implement-os-lifecycle` -> `remove-web-mobile-paths` |
| `packages/ui/src/components/organisms/MonacoHost.tsx` | `implement-os-lifecycle` -> `migrate-workspace-apps` -> `remove-web-mobile-paths` |
| `packages/ui/src/components/organisms/MultiTerminalDisplay.tsx` | `implement-os-lifecycle` -> `remove-web-mobile-paths` |
| `packages/ui/src/components/organisms/PaneContainer.tsx` | `implement-os-lifecycle` -> `remove-web-mobile-paths` |
| `packages/ui/src/components/organisms/SplitLayout.tsx` | `generalize-tile-tree` -> `remove-web-mobile-paths` |
| `packages/ui/src/components/organisms/TerminalFloatingFilePanel.tsx` | `migrate-workspace-apps` -> `cutover-root-shell` |
| `packages/ui/src/components/organisms/TerminalFloatingToolPanel.tsx` | `migrate-workspace-apps` -> `cutover-root-shell` |
| `packages/ui/src/components/organisms/TerminalKeepAliveHost.test.tsx` | `remove-native-ui` -> `implement-os-lifecycle` -> `remove-web-mobile-paths` |
| `packages/ui/src/components/organisms/TerminalKeepAliveHost.tsx` | `remove-native-ui` -> `implement-os-lifecycle` -> `remove-web-mobile-paths` |
| `packages/ui/src/components/organisms/TopNavRouteMenu.tsx` | `remove-native-ui` -> `cutover-root-shell` |
| `packages/ui/src/components/organisms/TraditionalTerminalProjectsDisplay.tsx` | `implement-os-lifecycle` -> `complete-os-chrome` -> `remove-web-mobile-paths` |
| `packages/ui/src/components/organisms/WorkflowContextSurface.tsx` | `migrate-management-apps` -> `remove-web-mobile-paths` |
| `packages/ui/src/components/pages/AgentStorePage.tsx` | `migrate-management-apps` -> `cutover-root-shell` |
| `packages/ui/src/components/pages/DashboardPage.tsx` | `retire-usage-web` -> `implement-system-monitor` -> `cutover-root-shell` |
| `packages/ui/src/components/pages/DevicesPage.tsx` | `migrate-management-apps` -> `cutover-root-shell` |
| `packages/ui/src/components/pages/GitPage.tsx` | `migrate-git-and-reviews` -> `cutover-root-shell` |
| `packages/ui/src/components/pages/SettingsPage.tsx` | `retire-usage-web` -> `migrate-management-apps` -> `cutover-root-shell` |
| `packages/ui/src/components/pages/WorkspacePage.tsx` | `remove-native-ui` -> `cutover-root-shell` |
| `packages/ui/src/embed/dam-hopper-app.test.tsx` | `remove-native-ui` -> `retire-usage-web` -> `integrate-os-prototype-route` -> `cutover-root-shell` |
| `packages/ui/src/embed/dam-hopper-app.tsx` | `remove-native-ui` -> `retire-usage-web` -> `integrate-os-prototype-route` -> `integrate-os-services` -> `migrate-management-apps` -> `cutover-root-shell` -> `remove-web-mobile-paths` |
| `packages/ui/src/hooks/use-browser-debug.test.ts` | `remove-native-ui` -> `implement-os-lifecycle` |
| `packages/ui/src/hooks/use-browser-debug.ts` | `remove-native-ui` -> `implement-os-lifecycle` -> `migrate-workspace-apps` |
| `packages/ui/src/hooks/use-terminal-manager.ts` | `implement-os-lifecycle` -> `migrate-workspace-apps` |
| `packages/ui/src/lib/browser-debug-keep-alive.ts` | `remove-native-ui` -> `implement-os-lifecycle` |
| `packages/ui/src/lib/navigation.test.ts` | `remove-native-ui` -> `retire-usage-web` |
| `packages/ui/src/lib/navigation.ts` | `remove-native-ui` -> `retire-usage-web` |
| `packages/ui/src/os/CommandPalette.tsx` | `complete-os-chrome` -> `integrate-os-services` -> `implement-launch-recipes` |
| `packages/ui/src/os/DesktopCanvas.tsx` | `implement-os-lifecycle` -> `complete-os-chrome` -> `implement-launch-recipes` |
| `packages/ui/src/os/Dock.tsx` | `complete-os-chrome` -> `integrate-os-services` |
| `packages/ui/src/os/OsShell.tsx` | `implement-os-lifecycle` -> `complete-os-chrome` -> `integrate-os-services` -> `migrate-management-apps` -> `cutover-root-shell` |
| `packages/ui/src/os/TopBar.tsx` | `complete-os-chrome` -> `integrate-os-services` -> `migrate-management-apps` -> `implement-system-monitor` |
| `packages/ui/src/os/WindowFrame.tsx` | `implement-os-lifecycle` -> `complete-os-chrome` |
| `packages/ui/src/os/app-registry.test.ts` | `migrate-management-apps` -> `implement-launch-recipes` |
| `packages/ui/src/os/app-registry.ts` | `implement-os-lifecycle` -> `integrate-os-services` -> `migrate-workspace-apps` -> `migrate-git-and-reviews` -> `migrate-management-apps` -> `implement-system-monitor` -> `implement-agent-hub` -> `implement-launch-recipes` |
| `packages/ui/src/os/apps/AgentHubApp.tsx` | `implement-agent-hub` -> `implement-launch-recipes` |
| `packages/ui/src/os/apps/BrowserApp.tsx` | `implement-os-lifecycle` -> `migrate-workspace-apps` |
| `packages/ui/src/os/apps/EditorApp.tsx` | `implement-os-lifecycle` -> `migrate-workspace-apps` |
| `packages/ui/src/os/apps/TerminalsApp.tsx` | `implement-os-lifecycle` -> `migrate-workspace-apps` |
| `packages/ui/src/os/deep-links.test.ts` | `migrate-management-apps` -> `cutover-root-shell` |
| `packages/ui/src/os/deep-links.ts` | `migrate-management-apps` -> `cutover-root-shell` |
| `packages/ui/src/os/desktop-templates.ts` | `migrate-management-apps` -> `implement-agent-hub` -> `implement-launch-recipes` |
| `packages/ui/src/os/input-arbiter.test.ts` | `implement-os-lifecycle` -> `integrate-os-services` |
| `packages/ui/src/os/input-arbiter.ts` | `implement-os-lifecycle` -> `integrate-os-services` -> `migrate-git-and-reviews` |
| `packages/ui/src/os/intents.ts` | `integrate-os-services` -> `migrate-workspace-apps` -> `migrate-git-and-reviews` -> `migrate-management-apps` -> `implement-system-monitor` -> `implement-agent-hub` |
| `packages/ui/src/os/notifications.ts` | `integrate-os-services` -> `implement-system-monitor` -> `implement-agent-hub` |
| `packages/ui/src/os/persistence.test.ts` | `implement-os-lifecycle` -> `complete-os-chrome` -> `integrate-os-services` |
| `packages/ui/src/os/persistence.ts` | `implement-os-lifecycle` -> `complete-os-chrome` -> `integrate-os-services` |
| `packages/ui/src/os/resource-registry.ts` | `implement-os-lifecycle` -> `migrate-workspace-apps` |
| `packages/ui/src/os/use-os-viewport.ts` | `complete-os-chrome` -> `remove-web-mobile-paths` |
| `packages/ui/src/os/window-context.tsx` | `implement-os-lifecycle` -> `integrate-os-services` |
| `packages/ui/src/os/window-ops.test.ts` | `implement-os-lifecycle` -> `complete-os-chrome` |
| `packages/ui/src/os/window-ops.ts` | `implement-os-lifecycle` -> `complete-os-chrome` |
| `packages/ui/src/os/window-store.ts` | `implement-os-lifecycle` -> `complete-os-chrome` |
| `packages/ui/src/stores/editor.ts` | `implement-os-lifecycle` -> `migrate-workspace-apps` |
| `packages/ui/src/stores/settings.ts` | `integrate-os-services` -> `remove-web-mobile-paths` |
| `server/Cargo.lock` | `retire-usage-server` -> `release-p0-removals` |
| `server/Cargo.toml` | `retire-usage-server` -> `release-p0-removals` |

## Related plans / final validation
All12 requested plans classified in overview; none modified. Resolver informational, native AC12 superseded for OS, normal web qualification in09; no external blocker/phase08 disposition. Preserve real shared claims across Advisor/blame/Git/devices/Android plans without demanding their administrative completion. V1–V6 final interview completed2026-11-01,9 questions; execution/evidence still pending.

## Release / rollback
1. P0 independent release needs only P0 source/docs/manual/check/version/publication receipts. Prototype/chrome do NOT wait for it: native prune -> core, Usage-web two-file handoff -> prototype route. Phase08 root cutover alone joins P0 receipt with completed OS parity.
2. Intermediate builds ship hidden URL-only /os, no discovery/build flag; old root/default until08. Prototype/chrome rollback preserves completed P0 removal work and any already-published P0 release, plus profile/terminal-v3/OS JSON and sessions. It never requires P0 release to have happened first.
3. OS cutover release requires full17/normal Resolver app qualification, F1/F2 and fresh human review. Failures reopen owning tasks; never shrink assertion scope or mock away resources. OS rollback restores prior coherent intermediate artifact, not retired Usage/native functionality.
4. V5 manual deletion is irreversible/no automatic restore: exactly this machine telemetry.db + telemetry-hmac-key with old writer stopped. User verified no token/no Codex exporter block; no code/config cleanup or other files. No migration is retained ≥1 release.
5. V6 Usage guide/sections/old CHANGELOG history stay scrubbed, no new Usage entry. Tauri/SSH Removed handling unaffected. Version gate itself changes no CHANGELOG; final docs do not recreate deleted feature material.
6. F1 unknown identity persists across rollback/reload/tabs/dismissal. Time/list absence/user acknowledgement never permits replacement; exact original identity completion or authoritative cannot-still-succeed proof required. F2 placement-only moves preserve xterm with zero new attach/replay/reset; true reconnect separately fenced.

## Unresolved questions
None from user decisions. Actual source/test/operational/human/artifact evidence and implementation/release authorization remain coordinator-owned; no author execution or Git action.
