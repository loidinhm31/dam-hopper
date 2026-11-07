# Phase 10: P5 completion — Documentation and hand-off

Estimate: 24h; implementation status **DONE (2026-11-07 07:00:00 +07:00)**. [Overview](plan.md) · [Ownership](ownership.md) · [Acceptance](acceptance.md).

## Context / requirements
Final OS docs follow ordinary Phase09 web qualification/human review. They never gate the independently published P0 early release in Phase03. Validated V1–V6 override older source reports: no Usage migration code/documentation/history; no external Resolver/native gate. This authoring only changes selected plan artifacts, never product/docs/runtime.

## Ordered steps by task ID
### publish-os-documentation
1. Update README/AGENTS/architecture/PDR/codebase/frontend maps for shared OsShell/static17-app registry/context/window/input/topics/persistence/root resources and unchanged owner-bound server APIs. Explain P0 had its own earlier artifact/version/receipt. Intermediate releases served ordinary authenticated `/os` URL-only, no discovery link/build flag, old default UI until Phase08; final root OS replaces it.
2. Document17 apps/desktop/compact/input/badges, dirty-memory-only buffers and F2 same parked xterm plus zero placement-only attach/replay/reset versus separately allowed owner-fenced reconnect. Resolver is a normal web feature qualified in Phase09; old native AC12 is superseded/informational, not an external release prerequisite.
3. Document exact os:v1/terminal-v3 contracts and V3 Save subset: chosen server/project, matching plus named/contextual excluded-window preview BEFORE save, explicit confirmation/cancel, deterministic pruned topology and source desktop unchanged. No rejection of whole mixed desktop or silent omission. Same-project worktrees supported.
4. Preserve F1 durable pending/dispatched/confirmed/failed/outcomeUnknown, locked durable reread, exact original identity or no-longer-can-succeed proof, blocked open-list/dismiss-no-relaunch flow. Commands explicitly authored/confirmed, export warns commands+paths, imports schema/appIds/topology/bounds validated/inert; no credentials/env/output/dirty persistence.
5. Preserve V6 COMPLETE scrub: deleted docs/api/agent-usage-and-sessions.md stays deleted; no Usage/telemetry/OTLP feature sections/mentions return to README/system/frontend/API/configuration/codebase/Android docs or old CHANGELOG entries. No new Usage Removed/migration/data-cleanup entry. Tauri/SSH Removed handling from P0 remains, not removed or repeated needlessly. Retained agent-status/PTY-session facts stay in existing non-Usage guides with working links; host monitoring remains.
6. V5 has NO exporter cleanup/ownership/legacy-collector reader/migration module or one-release retention story. The only approved local data action was Phase03 human-only deletion of exactly two machine files, recorded in selected plan/release receipt, not a resurrected current Usage guide. No token/Codex config action or automatic data restoration.
7. Link actual P0 and OS evidence/visual records and update roadmap accurately; unrelated plans remain untouched. Future topic/intent/Recipe/node vocabulary only, no graph/server ROS/API/Android OS adoption. Final code/visual/operational claims must match exercised scope.

## Success / verification
Literal task contract below governs exact docs. Final docs never recreate removed guides/features/history or claim that validation interview proves implementation. P0 release is independent and already recorded; ordinary Resolver web checks are included in final app matrix. Main reviews links/current facts and accepted human evidence; mismatches reopen relevant source tasks.

## Risks / security / rollback
Use fixtures, never private commands/paths/tokens in examples. Rollback coherent OS docs with its intermediate artifact, preserving independently shipped P0 and its V6 scrub. Never restore the two manually deleted local files automatically or invent cleanup/migration. No builds/tests/Git/publishing/deletion executed by plan author. User validation completed 2026-11-01 with9 questions; implementation and actual release/human evidence still pending.

## Literal file actions and ownership
Project-relative paths below; all others read-only. Every listed existing doc is modified, never a deleted Usage guide recreated. One docs owner after Phase09; P0 doc owner already released these files.

### `publish-os-documentation` file actions

| Action | Literal writable path |
|---|---|
| Modify | `README.md` |
| Modify | `AGENTS.md` |
| Modify | `docs/CHANGELOG.md` |
| Modify | `docs/api-reference.md` |
| Modify | `docs/system-architecture.md` |
| Modify | `docs/codebase-summary.md` |
| Modify | `docs/deployment-guide.md` |
| Modify | `docs/windows-release-packaging.md` |
| Modify | `docs/frontend-components/platform-integrations.md` |
| Modify | `docs/frontend-components/host-and-usage.md` |
| Modify | `docs/android-native-acceptance.md` |
| Modify | `docs/README.md` |
| Modify | `docs/code-standards.md` |
| Modify | `docs/frontend-components.md` |
| Modify | `docs/frontend-components/workbench.md` |
| Modify | `docs/frontend-components/files-and-media.md` |
| Modify | `docs/frontend-components/terminal-and-ide.md` |
| Modify | `docs/frontend-components/notifications-and-privacy.md` |
| Modify | `docs/project-overview-pdr.md` |
| Modify | `docs/project-roadmap.md` |
| Modify | `docs/user-guide-multi-server-profiles.md` |
| Modify | `docs/testing.md` |
| Modify | `docs/architecture/workbench-files-editor-and-git.md` |
| Modify | `docs/architecture/git-history-search.md` |
| Modify | `docs/workflow-context-surface.md` |
| Modify | `docs/configuration-guide.md` |
| Modify | `docs/configuration/server-runtime-settings.md` |
| Modify | `docs/architecture/android-native-client.md` |
| Modify | `docs/architecture/agent-store-ports-and-browser.md` |
| Modify | `docs/api/system-services.md` |
| Modify | `docs/api/rest-endpoints.md` |
| Modify | `docs/api/transport-and-events.md` |
| Modify | `docs/architecture/agent-status.md` |
| Modify | `docs/configuration/index.md` |
| Modify | `docs/configuration/server-configuration.md` |
| Modify | `docs/codebase-summary-release.md` |
| Modify | `docs/architecture/terminal-continuity-and-workflow.md` |
| Modify | `docs/architecture/preferences-settings-and-host-resources.md` |
| Delete | `docs/development-roadmap.md` |

## Durable task contracts

```evcrate-tasks
[
  {
    "id": "publish-os-documentation",
    "title": "Publish accurate OS architecture guides removals and evidence-linked hand-off",
    "blocked_by": [
      "accept-fresh-visual-review"
    ],
    "allowed_files": [
      "README.md",
      "AGENTS.md",
      "docs/CHANGELOG.md",
      "docs/api-reference.md",
      "docs/system-architecture.md",
      "docs/codebase-summary.md",
      "docs/deployment-guide.md",
      "docs/windows-release-packaging.md",
      "docs/frontend-components/platform-integrations.md",
      "docs/frontend-components/host-and-usage.md",
      "docs/android-native-acceptance.md",
      "docs/README.md",
      "docs/code-standards.md",
      "docs/frontend-components.md",
      "docs/frontend-components/workbench.md",
      "docs/frontend-components/files-and-media.md",
      "docs/frontend-components/terminal-and-ide.md",
      "docs/frontend-components/notifications-and-privacy.md",
      "docs/project-overview-pdr.md",
      "docs/project-roadmap.md",
      "docs/user-guide-multi-server-profiles.md",
      "docs/testing.md",
      "docs/architecture/workbench-files-editor-and-git.md",
      "docs/architecture/git-history-search.md",
      "docs/workflow-context-surface.md",
      "docs/configuration-guide.md",
      "docs/configuration/server-runtime-settings.md",
      "docs/architecture/android-native-client.md",
      "docs/architecture/agent-store-ports-and-browser.md",
      "docs/api/system-services.md",
      "docs/api/rest-endpoints.md",
      "docs/api/transport-and-events.md",
      "docs/architecture/agent-status.md",
      "docs/configuration/index.md",
      "docs/configuration/server-configuration.md",
      "docs/codebase-summary-release.md",
      "docs/architecture/terminal-continuity-and-workflow.md",
      "docs/architecture/preferences-settings-and-host-resources.md",
      "docs/development-roadmap.md"
    ],
    "constraints": [
      "Only listed paths writable; escalate additions to coordinator before editing.",
      "No mid-flight build/test/formatter runs while other writers are active; main integration owner verifies after the group joins."
    ],
    "acceptance": [
      "Current docs cover all17 apps, V2 hidden-route-to-cutover sequence, V3 selected subset/excluded preview and F1/F2 lifecycle/unknown proof contracts.",
      "V6 deleted Usage guide/sections/history stay absent, with no new Usage/telemetry/OTLP Removed/migration entry or V5 migration code; separate Tauri/SSH removal handling retained.",
      "P0 early release receipt/version bump remains independent of final OS documentation; Resolver qualified normally in Phase09, no native AC12 prerequisite; implementation/automation/human review distinguished."
    ],
    "verification": [
      "Review current docs/links against source, independent P0 release receipt and final OS report; never recreate deleted Usage guide or sections.",
      "Audit V1–V6 propagation: early P0/version gate, hidden intermediate /os, subset/excluded preview, normal Resolver, manual-only two-file local action recorded only in plan/release receipt (not new Usage feature docs), zero migration code and scrubbed Usage CHANGELOG history.",
      "Review recipe examples for explicit commands/export paths/inert validated imports/F1 no-relaunch unknown state and placement-only same-xterm/zero-attach-replay vs real reconnect; no Git action."
    ]
  }
]
```

- [x] <!-- evcrate-task:publish-os-documentation --> Publish accurate OS architecture guides removals and evidence-linked hand-off
