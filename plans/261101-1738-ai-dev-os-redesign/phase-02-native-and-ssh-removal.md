# Phase 02: P0a — Remove Tauri and SSH-forward UI

Estimate: 32h; implementation status: **DONE** (2026-11-02 01:26:49 +07:00). [Overview](plan.md) · [Ownership](ownership.md) · [Acceptance](acceptance.md).

## Context / objective
Priority P1; status DONE (2026-11-02 01:26:49 +07:00). D8 removes `apps/native` only; independent Android `native/android-app` is retained. [Placement/removal authority](../reports/brainstorm-261101-1738-ai-dev-os-redesign.md#41-current--os-placement), [ownership](ownership.md).

## Dependency and ownership
`remove-native-ui` shared-host pruning is independently ready (NO native build/prototype/release dependency). Its files are disjoint from native-build/server/Android lanes; hand off web-only hosts to prototype core immediately. Pin the P0 host versions at handoff in isolated P0 release artifact workspace before prototype edits. Usage web follows native UI; only prototype route subtask later waits for Usage web's two embed files. Thus prototype core runs concurrently with all remaining P0 work/release; P0 never waits for prototype qualification.

## Ordered implementation by task ID
### remove-native-build
1. Delete `apps/native` subtree, including Tauri Rust crate/lock/config, frontend, SSH native tests and platform adapters. Keep all Android scripts/artifacts and server Linux/Windows release packages.
2. Remove `dev:native`/`build:native`; change `check` to web build + lint + Rust tests. Remove obsolete native install requirements, workspace lock importer/dependencies, Tailwind native source entry (UI owner handles CSS below).
3. Remove native Linux/Windows quality jobs and desktop release matrix plus `native-ssh-forward-windows-gate`. Update dependent `needs`/release aggregation and desktop tag triggers. Delete an entire workflow only if it becomes empty (release.yml is owned here); do not damage release-linux/release-android.
4. Update retained version manifest/help/lock refresh/checker/fixtures and drop obsolete13-file assertion. Do not bump during source removal; Phase03 independent P0 gate uses this updated bump script/checker for synchronized version bump without Git writes.
### remove-native-ui
1. Delete listed SSH-forward UI/contexts/hooks/lib modules and dedicated tests. Keep SshRetryStatusMessage and use-git-with-ssh-retry: GitPage, WorkspaceGitPanel and ProjectInfoGitSection use them for retained remote Git SSH authentication, not local native forwarding. Remove route/lazy import/nav item and exported host bridge, not a disabled button or unsupported stub. Removed-feature deep links display removed-feature guidance rather than launch nonexistent apps.
2. Remove native browser host/same-origin policy branches and their every caller in connections, embed and login-devices-owner. Web profile/CORS/token rules are unchanged; do not replace old checks with always-true compatibility exports.
3. Collapse BrowserDebugKeepAliveHost to its existing web iframe path, delete BrowserDebugHostContext and native viewport helpers. Retain browser-debug-host types/functions still used by web iframe protocol/controller; relocate or simplify only native-only members. Keep nonce/source/origin/capability verification unchanged.
4. Remove WebView2 WebGL case; retain existing app-zoom/visibility/DOM fallback/no-fit policy. WorkspacePage remains legacy sole host owner; later prototype consumes web-only hosts, not a prerequisite.
5. Rewrite shared host regressions to verify real web behavior and remove native-specific assertions/imports. Delete native CSS @source. Recheck source consumers of every removed export before handoff; unexpected consumer outside file list is an ownership escalation, not permission for arbitrary edits.

## Success / verification
AC1: no native app/jobs/commands. Existing default web preview/capture, profiles/auth/devices and terminal zoom work. P0 uses existing browser-debug/login-device/Traditional production journeys, NOT future os-lifecycle; Phase03 gate independently verifies/releases P0 before OS phases.

### Verification Record (2026-11-02 01:26:49 +07:00)
- **Status:** **DONE per user direction**; technical acceptance incomplete per Cycle 2 review carryovers.
- **Unit & Release Tests:** 3,114–3,119 tests passed across full UI suite (330 files; 3,088–3,093 tests), shared (6 tests), browser-bridge (19 tests), and release version tests (`bump-version.test.mjs` passing with 6 sub-checks). Release alignment verified at v0.15.5 across 9 locations via `check-version-alignment.mjs`.
- **Component Browser Tests:** 325 component browser tests reported passing at handoff.
- **Code Review:** Score 8/10 (Cycle 2, `plans/reports/code-review-261102-0119-phase-02-native-ssh-removal-cycle-2.md`), 0 Critical issues. Carryovers noted: W1 (browser-debug-panel browser harness native prop, modified post-review; final disposition unverified without follow-up review) and W2 (Traditional agents/device-login production journeys retained for Phase 03 P0 release receipt gate).
- **User Direction:** User approved phase closure.
## Risks / security / rollback
Preserve web origin/CORS/token/bridge checks when deleting native restrictions. Android and Linux/Windows server releases remain. Roll back coherent P0 artifact/manifests, never partial jobs; no SSH credential deletion. P0 docs retain Tauri/SSH Removed handling but V6 scrubs Usage history without adding a Usage entry. Next Phase03 release, then hidden OS prototype.

## Literal file actions and ownership

Paths below are project-root-relative (`/home/loidinh/WS/dam-hopper/`). Directory entries own all descendants; no glob expansion, no implicit adjacent-test ownership. All unlisted source/docs/other plans read-only. Existing files are re-read before editing; discoveries requiring additional writable paths return to coordinator for a reviewed contract revision.

### `remove-native-build` file actions

| Action | Literal writable path |
|---|---|
| Delete | `apps/native` |
| Modify | `package.json` |
| Modify | `pnpm-lock.yaml` |
| Modify | `pnpm-workspace.yaml` |
| Modify | `.github/workflows/pr-quality-gate.yml` |
| Modify | `.github/workflows/release.yml` |
| Modify | `scripts/bump-version.mjs` |
| Modify | `scripts/release-version-manifest.mjs` |
| Modify | `scripts/release-version-semver.mjs` |
| Modify | `scripts/run-all-tests.sh` |
| Modify | `tests/deploy/bump-version.test.mjs` |
| Modify | `deploy/release/check-version-alignment.mjs` |
| Delete | `packages/shared/src/ssh-forward-contract-fixtures.json` |
| Delete | `packages/shared/src/ssh-forward-contract-fixtures.test.ts` |

### `remove-native-ui` file actions

| Action | Literal writable path |
|---|---|
| Delete | `packages/ui/src/components/pages/SshForwardingPage.tsx` |
| Delete | `packages/ui/src/components/pages/SshForwardingPage.test.tsx` |
| Delete | `packages/ui/src/contexts/SshForwardHostContext.tsx` |
| Delete | `packages/ui/src/contexts/SshForwardHostContext.test.tsx` |
| Delete | `packages/ui/src/components/organisms/SshConnectionDialog.tsx` |
| Delete | `packages/ui/src/components/organisms/SshConnectionDialog.test.tsx` |
| Delete | `packages/ui/src/components/organisms/SshForwardAuthFields.tsx` |
| Delete | `packages/ui/src/components/organisms/SshForwardAuthFields.test.tsx` |
| Delete | `packages/ui/src/components/organisms/SshForwardDialogFocus.test.tsx` |
| Delete | `packages/ui/src/components/organisms/SshForwardEndpointFields.tsx` |
| Delete | `packages/ui/src/components/organisms/SshForwardProfileField.tsx` |
| Delete | `packages/ui/src/components/organisms/SshForwardRuleDialog.tsx` |
| Delete | `packages/ui/src/components/organisms/SshForwardRuleDialog.test.tsx` |
| Delete | `packages/ui/src/components/organisms/SshForwardTargetFields.tsx` |
| Delete | `packages/ui/src/components/organisms/SshHostKeyApprovalDialog.tsx` |
| Delete | `packages/ui/src/components/organisms/SshHostKeyApprovalDialog.test.tsx` |
| Delete | `packages/ui/src/components/organisms/SshHostKeyChangedPanel.tsx` |
| Delete | `packages/ui/src/components/organisms/SshHostKeyUnknownPanel.tsx` |
| Delete | `packages/ui/src/components/molecules/SshForwardRuleCard.tsx` |
| Delete | `packages/ui/src/components/molecules/SshForwardRuleCard.test.tsx` |
| Delete | `packages/ui/src/components/molecules/SshForwardSecurityCallout.tsx` |
| Delete | `packages/ui/src/components/molecules/SshConnectionCard.tsx` |
| Delete | `packages/ui/src/components/molecules/SshConnectionCard.test.tsx` |
| Delete | `packages/ui/src/lib/ssh-forward-error-definitions.ts` |
| Delete | `packages/ui/src/lib/ssh-forward-form.ts` |
| Delete | `packages/ui/src/lib/ssh-forward-form.test.ts` |
| Delete | `packages/ui/src/lib/ssh-forward-host.ts` |
| Delete | `packages/ui/src/lib/ssh-forward-host.test.ts` |
| Delete | `packages/ui/src/lib/ssh-forward-trust-repair-command.ts` |
| Delete | `packages/ui/src/lib/ssh-forward-trust-repair-command.test.ts` |
| Delete | `packages/ui/src/lib/ssh-forward-error-copy.ts` |
| Delete | `packages/ui/src/lib/ssh-forward-error-copy.test.ts` |
| Delete | `packages/ui/src/hooks/use-ssh-forward.ts` |
| Delete | `packages/ui/src/hooks/use-ssh-forward.test.tsx` |
| Delete | `packages/ui/src/hooks/use-ssh-forward-page-controller.ts` |
| Delete | `packages/ui/src/hooks/use-ssh-forward-page-controller.test.tsx` |
| Delete | `packages/ui/browser-tests/ssh-forward-browser-fixture.ts` |
| Delete | `packages/ui/browser-tests/ssh-forward-credential-dialog.browser.tsx` |
| Delete | `packages/ui/browser-tests/ssh-forward-multi-connection.browser.tsx` |
| Delete | `packages/ui/browser-tests/ssh-forward-route-gating.browser.tsx` |
| Delete | `packages/ui/browser-tests/ssh-forward-availability.browser.tsx` |
| Modify | `packages/ui/src/api/server-config.ts` |
| Modify | `packages/ui/src/api/server-config.test.ts` |
| Modify | `packages/ui/src/api/transport-utils.ts` |
| Modify | `packages/ui/src/api/transport-utils.test.ts` |
| Modify | `packages/ui/src/api/connections.ts` |
| Modify | `packages/ui/src/api/connections.test.ts` |
| Modify | `packages/ui/src/components/organisms/login-devices-owner.ts` |
| Modify | `packages/ui/src/components/organisms/TerminalKeepAliveHost.tsx` |
| Modify | `packages/ui/src/components/organisms/TerminalKeepAliveHost.test.tsx` |
| Modify | `packages/ui/src/components/organisms/BrowserDebugKeepAliveHost.tsx` |
| Modify | `packages/ui/src/components/organisms/BrowserDebugKeepAliveHost.test.tsx` |
| Modify | `packages/ui/src/components/organisms/BrowserDebugPanel.tsx` |
| Modify | `packages/ui/src/components/organisms/BrowserDebugIframeHost.tsx` |
| Modify | `packages/ui/src/contexts/BrowserDebugHostContext.tsx` |
| Modify | `packages/ui/src/lib/browser-debug-host.ts` |
| Modify | `packages/ui/src/lib/browser-debug-host.test.ts` |
| Modify | `packages/ui/src/lib/browser-debug-keep-alive.ts` |
| Modify | `packages/ui/src/lib/browser-debug-keep-alive.test.ts` |
| Modify | `packages/ui/src/hooks/use-browser-debug.ts` |
| Modify | `packages/ui/src/hooks/use-browser-debug.test.ts` |
| Modify | `packages/ui/src/components/pages/WorkspacePage.tsx` |
| Modify | `packages/ui/src/embed/dam-hopper-app.tsx` |
| Modify | `packages/ui/src/embed/dam-hopper-app.test.tsx` |
| Modify | `packages/ui/src/components/organisms/TopNavRouteMenu.tsx` |
| Modify | `packages/ui/src/lib/navigation.ts` |
| Modify | `packages/ui/src/lib/navigation.test.ts` |
| Modify | `packages/ui/src/index.css` |

## Durable task contracts

Exactly one authored fence; no execution state/hydration, completion or test receipts implied. Dependency IDs are plan-wide.

```evcrate-tasks
[
  {
    "id": "remove-native-build",
    "title": "Delete desktop host and prune build release version plumbing",
    "blocked_by": [],
    "allowed_files": [
      "apps/native",
      "package.json",
      "pnpm-lock.yaml",
      "pnpm-workspace.yaml",
      ".github/workflows/pr-quality-gate.yml",
      ".github/workflows/release.yml",
      "scripts/bump-version.mjs",
      "scripts/release-version-manifest.mjs",
      "scripts/release-version-semver.mjs",
      "scripts/run-all-tests.sh",
      "tests/deploy/bump-version.test.mjs",
      "deploy/release/check-version-alignment.mjs",
      "packages/shared/src/ssh-forward-contract-fixtures.json",
      "packages/shared/src/ssh-forward-contract-fixtures.test.ts"
    ],
    "constraints": [
      "Only listed paths writable; escalate additions to coordinator before editing.",
      "No mid-flight build/test/formatter runs while other writers are active; main integration owner verifies after the group joins."
    ],
    "acceptance": [
      "No Tauri desktop jobs/commands/manifest targets remain; Android and Windows/Linux server releases preserved.",
      "Version fixture updates retained locations without writing real versions or authorizing Git."
    ],
    "verification": [
      "node --test tests/deploy/bump-version.test.mjs",
      "node deploy/release/check-version-alignment.mjs",
      "pnpm check"
    ]
  },
  {
    "id": "remove-native-ui",
    "title": "Remove SSH-forward UI and native-only shared branches",
    "blocked_by": [],
    "allowed_files": [
      "packages/ui/src/components/pages/SshForwardingPage.tsx",
      "packages/ui/src/components/pages/SshForwardingPage.test.tsx",
      "packages/ui/src/contexts/SshForwardHostContext.tsx",
      "packages/ui/src/contexts/SshForwardHostContext.test.tsx",
      "packages/ui/src/components/organisms/SshConnectionDialog.tsx",
      "packages/ui/src/components/organisms/SshConnectionDialog.test.tsx",
      "packages/ui/src/components/organisms/SshForwardAuthFields.tsx",
      "packages/ui/src/components/organisms/SshForwardAuthFields.test.tsx",
      "packages/ui/src/components/organisms/SshForwardDialogFocus.test.tsx",
      "packages/ui/src/components/organisms/SshForwardEndpointFields.tsx",
      "packages/ui/src/components/organisms/SshForwardProfileField.tsx",
      "packages/ui/src/components/organisms/SshForwardRuleDialog.tsx",
      "packages/ui/src/components/organisms/SshForwardRuleDialog.test.tsx",
      "packages/ui/src/components/organisms/SshForwardTargetFields.tsx",
      "packages/ui/src/components/organisms/SshHostKeyApprovalDialog.tsx",
      "packages/ui/src/components/organisms/SshHostKeyApprovalDialog.test.tsx",
      "packages/ui/src/components/organisms/SshHostKeyChangedPanel.tsx",
      "packages/ui/src/components/organisms/SshHostKeyUnknownPanel.tsx",
      "packages/ui/src/components/molecules/SshForwardRuleCard.tsx",
      "packages/ui/src/components/molecules/SshForwardRuleCard.test.tsx",
      "packages/ui/src/components/molecules/SshForwardSecurityCallout.tsx",
      "packages/ui/src/components/molecules/SshConnectionCard.tsx",
      "packages/ui/src/components/molecules/SshConnectionCard.test.tsx",
      "packages/ui/src/lib/ssh-forward-error-definitions.ts",
      "packages/ui/src/lib/ssh-forward-form.ts",
      "packages/ui/src/lib/ssh-forward-form.test.ts",
      "packages/ui/src/lib/ssh-forward-host.ts",
      "packages/ui/src/lib/ssh-forward-host.test.ts",
      "packages/ui/src/lib/ssh-forward-trust-repair-command.ts",
      "packages/ui/src/lib/ssh-forward-trust-repair-command.test.ts",
      "packages/ui/src/lib/ssh-forward-error-copy.ts",
      "packages/ui/src/lib/ssh-forward-error-copy.test.ts",
      "packages/ui/src/hooks/use-ssh-forward.ts",
      "packages/ui/src/hooks/use-ssh-forward.test.tsx",
      "packages/ui/src/hooks/use-ssh-forward-page-controller.ts",
      "packages/ui/src/hooks/use-ssh-forward-page-controller.test.tsx",
      "packages/ui/browser-tests/ssh-forward-browser-fixture.ts",
      "packages/ui/browser-tests/ssh-forward-credential-dialog.browser.tsx",
      "packages/ui/browser-tests/ssh-forward-multi-connection.browser.tsx",
      "packages/ui/browser-tests/ssh-forward-route-gating.browser.tsx",
      "packages/ui/browser-tests/ssh-forward-availability.browser.tsx",
      "packages/ui/src/api/server-config.ts",
      "packages/ui/src/api/server-config.test.ts",
      "packages/ui/src/api/transport-utils.ts",
      "packages/ui/src/api/transport-utils.test.ts",
      "packages/ui/src/api/connections.ts",
      "packages/ui/src/api/connections.test.ts",
      "packages/ui/src/components/organisms/login-devices-owner.ts",
      "packages/ui/src/components/organisms/TerminalKeepAliveHost.tsx",
      "packages/ui/src/components/organisms/TerminalKeepAliveHost.test.tsx",
      "packages/ui/src/components/organisms/BrowserDebugKeepAliveHost.tsx",
      "packages/ui/src/components/organisms/BrowserDebugKeepAliveHost.test.tsx",
      "packages/ui/src/components/organisms/BrowserDebugPanel.tsx",
      "packages/ui/src/components/organisms/BrowserDebugIframeHost.tsx",
      "packages/ui/src/contexts/BrowserDebugHostContext.tsx",
      "packages/ui/src/lib/browser-debug-host.ts",
      "packages/ui/src/lib/browser-debug-host.test.ts",
      "packages/ui/src/lib/browser-debug-keep-alive.ts",
      "packages/ui/src/lib/browser-debug-keep-alive.test.ts",
      "packages/ui/src/hooks/use-browser-debug.ts",
      "packages/ui/src/hooks/use-browser-debug.test.ts",
      "packages/ui/src/components/pages/WorkspacePage.tsx",
      "packages/ui/src/embed/dam-hopper-app.tsx",
      "packages/ui/src/embed/dam-hopper-app.test.tsx",
      "packages/ui/src/components/organisms/TopNavRouteMenu.tsx",
      "packages/ui/src/lib/navigation.ts",
      "packages/ui/src/lib/navigation.test.ts",
      "packages/ui/src/index.css"
    ],
    "constraints": [
      "Only listed paths writable; escalate additions to coordinator before editing.",
      "No mid-flight build/test/formatter runs while other writers are active; main integration owner verifies after the group joins."
    ],
    "acceptance": [
      "SSH UI and native-host abstraction deleted with all callers migrated; no inert host shims.",
      "Default old web terminal/browser/profile behavior retained; native pruning precedes prototype ownership and requires no OS-phase result."
    ],
    "verification": [
      "pnpm --filter @dam-hopper/ui test -- src/api/server-config.test.ts src/api/transport-utils.test.ts src/api/connections.test.ts src/components/organisms/BrowserDebugKeepAliveHost.test.tsx src/components/organisms/TerminalKeepAliveHost.test.tsx",
      "pnpm --filter @dam-hopper/ui test:browser -- browser-tests/browser-debug-keep-alive.browser.tsx browser-tests/login-devices.browser.tsx",
      "E2E_CAPTURE=1 pnpm --filter @dam-hopper/ui test:e2e -- traditional-terminal-agents device-login-management"
    ]
  }
]
```

- [x] <!-- evcrate-task:remove-native-build --> Delete desktop host and prune build release version plumbing
- [x] <!-- evcrate-task:remove-native-ui --> Remove SSH-forward UI and native-only shared branches
