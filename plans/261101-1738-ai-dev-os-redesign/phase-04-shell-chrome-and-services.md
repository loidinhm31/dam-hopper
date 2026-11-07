# Phase 04: P1 completion — Shell chrome and services

Estimate: 56h; implementation status: **DONE per user direction (2026-11-02 13:02:03 +07:00)** (technical acceptance incomplete). [Overview](plan.md) · [Ownership](ownership.md) · [Acceptance](acceptance.md).

## Context / objective
Priority P1; status: **DONE per user direction (2026-11-02 13:02:03 +07:00)** (technical acceptance incomplete). Minimal true dependency: qualified lifecycle prototype ONLY. Its ancestors already complete native shared-host and Usage-web embed handoffs; chrome files overlap no P0 docs/manual/version/release paths, so no P0 receipt prerequisite. P0 release remains independent and must precede Phase08 root cutover only. `/os` stays URL-only/no discovery/build flag. [UI](../reports/ui-ux-designer-261101-1738-ai-dev-os-initial-ui.md).

## Architecture / requirements
- `packages/ui/src/os/` owns services/composition. Existing status/transport/query/crypto providers stay canonical; no new bus protocol, dependency, plugin system or server API.
- Top bar desktop tabs/default context/workflow ribbon, left dock AI/Workspace/System groups, palette, attention routing/bell and context badges. Top-bar selector affects new windows ONLY. Per-window ctx immutable; changing a target opens/focuses another instance, never changes a live resource's server.
- Implement desktop CRUD/name/defaultCtx, focus stack, z-order, tile tab groups, 5-zone tile drag/swap/merge, root edges, float drag/8-way resize/clamp, last-placement restoration, maximize/minimize and dock popover. Deleting desktop moves its windows to explicit surviving desktop or asks for ordinary guarded close; never kills PTYs or discards dirty models. Registry enforces singleton/perContext/multi and resource claims independently.
- `OsWindowContext` resolves explicit profile/project/worktree validity and fresh owner per action, no ambient first-connected fallback. Unknown/missing targets retain unavailable window/repair affordance. Composite/Fleet windows badge their scope and stamp row actions with real owner.
- `useTopic` facade only names/fans in existing agent/status/lifecycle/fs/port/tunnel/host/workflow hooks; unsubscribe bound to originating owner generation. Subscribe only where needed; no duplicate resource SSE per window and no broad polling layer.
- Notifications: bounded 50-entry in-memory bell log; migrate Dashboard activity presentation, existing terminal toasts and fenced attention revisions drive dock/desktop/window badges. Max-three/6s toast policy reused, no new status inference. Cognito suppresses/redacts identity in toasts/live regions/log presentation; don't persist terminal output or text.
- UI tokens/fonts from current index.css, not stale hex comments. Standard >=1280: top 40px/dock48; 1024–1279: top36/dock44, drawer navigator, <=2x2 tiles and default maximize/tab merge; height640–767: top34, <=2x1 with tab merge; <1024x640 notice/single-window fallback, not mobile shell. Adapt layout view non-destructively so widening restores original topology. Respect app minima/44px compact targets, zoom and reduced motion/transparency.
- Accessibility: banner/nav/main landmarks, desktop tablist/selected state, labeled window regions/toolbars, keyboard separators, visible focus, polite switch/state announcements and assertive attention/disconnect. Cognito overlay outside inert shell retains accessible dismissal; announcements redact while active.

## Ordered implementation by task ID
### complete-os-chrome
1. Complete WindowFrame/DesktopCanvas pure operations, tabs, focus/z and geometry using existing @dnd-kit + react-resizable-panels + geometry/dock helpers (extract shared bits, don't import obsolete panel controller). Build TopBar/DesktopSwitcher/Dock/WindowList; persist dock pins under os:v1:dock.
2. Add palette modes commands/agents/windows/files/recipes with lazy providers; not-yet-registered app/recipe actions unavailable until their phase lands. Frame toolbar is a complete alternative for every chord; keyboard-only move/resize/split/focus works.
3. Add OS viewport hook/container queries; Terminals compact navigator driven by OS window/container size, not old mobile viewport query. Default desktop template only enabled after app registration; preserve Hub slot until Phase 07 replaces prototype landing.
### integrate-os-services
1. Harden context validity and revalidation, thin topic naming and subscriptions; scope window action controllers and async completions. Keep system services at authenticated root once.
2. Add notifications/event log/attention action dispatch. Reuse existing toast viewport/store and attention reducer; only register one listener per source/generation. Central focus intent restores minimized target/switches desktop/selects exact PTY without duplicate attach.
3. Expand input arbiter/remappable OS keymap in Settings. Preserve all existing tools/font zoom/Cognito/app chords. Route `/os` through arbiter once, and suspend old GlobalShortcuts on /os to prevent double dispatch; old route keyboard behavior otherwise unchanged. IME/repeat/AltGr/shortcut capture honored; app split/cycle wins unless frame focused.
4. Define typed intents now; next phase supplies catalog handlers. Unknown app/intent -> safe notice/no-op. Export/import four OS namespaces as explicit envelope with allowlisted app serializers; imported launch execution records cannot authorize process reuse and imported recipe commands never run. Session refs remain stable-only; recipe execution identity persisted separately by Phase 07.

## Success / verification
AC6/9/11 and chrome part of AC4/5; context selector never resends actions to a new profile. Browser tests cover 1440x900,1920x1080,1024x640, zoom, resizing, reduced preferences, keyboard-only controls and focus after closing. No dirty buffer/output/credentials in exported JSON; corrupted or unavailable storage recovers visibly. Main runs commands below after tasks land; all new app hooks remain explicit owner-scoped.

### Verification Record — Phase 04 Completion (2026-11-02 13:02:03 +07:00)
- **Status:** Phase 04 marked **DONE per user direction (2026-11-02 13:02:03 +07:00)**; technical acceptance incomplete (Cycle 3 review scored 5/10, 0 Critical, 7 warnings W1–W7 carried forward to Phase 05/09).
- **Task Dispositions:**
  - `complete-os-chrome` (Task 1): **DONE (2026-11-02)**. Delivered `WindowFrame`, `DesktopCanvas`, pure window operations in `window-ops.ts`, `window-store.ts`, `TopBar` with desktop switcher and context selector, `Dock` with pinning/running/attention badges, `WindowList` popover, `CommandPalette` with commands/agents/windows modes, `use-os-viewport.ts`, and `os.css` layout styles.
  - `integrate-os-services` (Task 2): **DONE (2026-11-02)**. Delivered `NotificationCenter` with in-memory bell log and reactive Cognito redaction, typed intents (`intents.ts`), envelope persistence with allowlisted app state (`persistence.ts`), input arbiter with global shortcut isolation and remappable OS keymap in Settings (`input-arbiter.ts`, `shortcuts.ts`, `SettingsKeyboardShortcutsSection.tsx`), and fail-closed qualified terminal transport resolving C1 (`TerminalPanel.tsx`).
- **Phase 04 Final Validation Evidence (`Phase04Tester` report):**
  - **Overall Status:** `PASS` (100% pass rate).
  - **Targeted Unit Tests (62 / 62 passed across 9 files; 113 / 113 across literal command selection):**
    - `src/os/resource-registry.test.ts`: 5/5 passed
    - `src/os/topics.test.ts`: 2/2 passed
    - `src/os/intents.test.ts`: 3/3 passed
    - `src/os/notifications.test.ts`: 3/3 passed
    - `src/os/window-ops.test.ts`: 11/11 passed
    - `src/os/input-arbiter.test.ts`: 6/6 passed
    - `src/os/persistence.test.ts`: 12/12 passed
    - `src/components/organisms/SettingsKeyboardShortcutsSection.test.tsx`: 11/11 passed
    - `src/components/organisms/TerminalPanel.test.tsx`: 9/9 passed
  - **Browser Component Tests (26 / 26 passed):**
    - `os-shell.browser.tsx`: 4/4 passed (landmarks, virtual desktop switching, dock launch/pip indicator, 8-way resize handles).
    - `os-input-isolation.browser.tsx`: 3/3 passed (Cognito physical keyboard block, immediate notification redaction, IME/AltGr chord passthrough).
    - `cognito-mode.browser.tsx`: 10/10 passed (mask overlay, toast z-index 10001 stacking, click prevention, protected labels).
    - `os-lifecycle.browser.tsx`: 9/9 passed (desktop management, window state preservation, focus restoration).
  - **Typecheck & Build:**
    - `@dam-hopper/ui build` (`tsc -p tsconfig.json`): 0 TypeScript errors.
    - Monorepo `pnpm build`: Clean production Vite build (6,126 modules transformed, 0 errors).
- **Cycle 3 Code Review & Carried Technical Acceptance Items (`Phase04Reviewer` report):**
  - **Score:** 5/10 (0 Critical, 7 warnings W1–W7).
  - **Resolved / Closed Findings:**
    - C1: Qualified terminal ambient fallback closed (terminals fail closed when connection snapshot is disconnected/missing).
    - W5: WindowList dirty-close confirmation present.
    - W8: `removeDesktop` validates and rejects invalid explicit destination.
    - Bell notification ingestion and reactive Cognito title/body/aria redaction verified.
    - Envelope import sanitized through allowlisted projection.
  - **Carried Technical Debt & Remediation Items (to Phase 05 / Phase 09):**
    - W1: Native keyboard event spreading in input arbiter (`input-arbiter.ts`, `src/lib/shortcuts.ts`) requires explicit key/code/modifier copying for remapped chords.
    - W2: Notification exact-target routing (`NotificationCenter.tsx`) requires exact `{profileId, sessionId}` match and freshness checks before focus restoration.
    - W3: Envelope schema typing and inert-reference activation (`persistence.ts`) requires strict namespace schema validation.
    - W4: `fencedAction` caller integration and project/worktree validation (`window-context.tsx`).
    - W5: Keyboard move/resize/split alternatives and container queries in production consumers (`DesktopCanvas.tsx`, `WindowFrame.tsx`).
    - W6: Canonical service topic subscriptions integration (`topics.ts`).
    - W7: Test coverage depth for C1 ambient retirement scenario (`TerminalPanel.test.tsx`).

## Risks / security / rollback
Nested OS/terminal DnD and split handlers must consume once with distinct drag ID namespaces. A background desktop must not request terminal fits or WebGL, and still receives metadata attention without mounting all app bodies. Freeform appState serialization is forbidden; schema allowlists only. Roll back shell chrome/services as a unit to Phase01 /os without touching old web routes or local terminal v3 keys. Unknown future OS schemas default safely; never downgrade/overwrite unknown data without explicit user import/reset. Next: app migration.

## Literal file actions and ownership

Paths below are project-root-relative (`/home/loidinh/WS/dam-hopper/`). Directory entries own all descendants; no glob expansion, no implicit adjacent-test ownership. All unlisted source/docs/other plans read-only. Existing files are re-read before editing; discoveries requiring additional writable paths return to coordinator for a reviewed contract revision.

### `complete-os-chrome` file actions

| Action | Literal writable path |
|---|---|
| Modify | `packages/ui/src/os/OsShell.tsx` |
| Modify | `packages/ui/src/os/DesktopCanvas.tsx` |
| Modify | `packages/ui/src/os/WindowFrame.tsx` |
| Modify | `packages/ui/src/os/window-ops.ts` |
| Modify | `packages/ui/src/os/window-ops.test.ts` |
| Modify | `packages/ui/src/os/window-store.ts` |
| Create | `packages/ui/src/os/TopBar.tsx` |
| Create | `packages/ui/src/os/DesktopSwitcher.tsx` |
| Create | `packages/ui/src/os/Dock.tsx` |
| Create | `packages/ui/src/os/WindowList.tsx` |
| Create | `packages/ui/src/os/CommandPalette.tsx` |
| Create | `packages/ui/src/os/use-os-viewport.ts` |
| Create | `packages/ui/src/os/os.css` |
| Modify | `packages/ui/src/os/persistence.ts` |
| Modify | `packages/ui/src/os/persistence.test.ts` |
| Modify | `packages/ui/src/components/organisms/TraditionalTerminalProjectsDisplay.tsx` |
| Create | `packages/ui/browser-tests/os-shell.browser.tsx` |

### `integrate-os-services` file actions

| Action | Literal writable path |
|---|---|
| Modify | `packages/ui/src/os/window-context.tsx` |
| Create | `packages/ui/src/os/topics.ts` |
| Create | `packages/ui/src/os/topics.test.ts` |
| Create | `packages/ui/src/os/notifications.ts` |
| Create | `packages/ui/src/os/notifications.test.ts` |
| Create | `packages/ui/src/os/NotificationCenter.tsx` |
| Create | `packages/ui/src/os/intents.ts` |
| Create | `packages/ui/src/os/intents.test.ts` |
| Modify | `packages/ui/src/os/input-arbiter.ts` |
| Modify | `packages/ui/src/os/input-arbiter.test.ts` |
| Create | `packages/ui/src/os/shortcuts.ts` |
| Modify | `packages/ui/src/os/app-registry.ts` |
| Modify | `packages/ui/src/os/OsShell.tsx` |
| Modify | `packages/ui/src/os/TopBar.tsx` |
| Modify | `packages/ui/src/os/Dock.tsx` |
| Modify | `packages/ui/src/os/CommandPalette.tsx` |
| Modify | `packages/ui/src/os/persistence.ts` |
| Modify | `packages/ui/src/os/persistence.test.ts` |
| Modify | `packages/ui/src/embed/dam-hopper-app.tsx` |
| Modify | `packages/ui/src/lib/shortcuts.ts` |
| Modify | `packages/ui/src/lib/shortcuts.test.ts` |
| Modify | `packages/ui/src/stores/settings.ts` |
| Modify | `packages/ui/src/components/organisms/SettingsKeyboardShortcutsSection.tsx` |
| Modify | `packages/ui/src/components/organisms/SettingsKeyboardShortcutsSection.test.tsx` |
| Modify | `packages/ui/src/components/organisms/TerminalNotificationToastViewport.tsx` |
| Create | `packages/ui/browser-tests/os-input-isolation.browser.tsx` |

## Durable task contracts

Exactly one authored fence; no execution state/hydration, completion or test receipts implied. Dependency IDs are plan-wide.

```evcrate-tasks
[
  {
    "id": "complete-os-chrome",
    "title": "Complete desktop window controls, dock, palette and accessible compact chrome",
    "blocked_by": [
      "qualify-prototype-gate"
    ],
    "allowed_files": [
      "packages/ui/src/os/OsShell.tsx",
      "packages/ui/src/os/DesktopCanvas.tsx",
      "packages/ui/src/os/WindowFrame.tsx",
      "packages/ui/src/os/window-ops.ts",
      "packages/ui/src/os/window-ops.test.ts",
      "packages/ui/src/os/window-store.ts",
      "packages/ui/src/os/TopBar.tsx",
      "packages/ui/src/os/DesktopSwitcher.tsx",
      "packages/ui/src/os/Dock.tsx",
      "packages/ui/src/os/WindowList.tsx",
      "packages/ui/src/os/CommandPalette.tsx",
      "packages/ui/src/os/use-os-viewport.ts",
      "packages/ui/src/os/os.css",
      "packages/ui/src/os/persistence.ts",
      "packages/ui/src/os/persistence.test.ts",
      "packages/ui/src/components/organisms/TraditionalTerminalProjectsDisplay.tsx",
      "packages/ui/browser-tests/os-shell.browser.tsx"
    ],
    "constraints": [
      "Only listed paths writable; escalate additions to coordinator before editing.",
      "No mid-flight build/test/formatter runs while other writers are active; main integration owner verifies after the group joins."
    ],
    "acceptance": [
      "All window/desktop operations accessible by toolbar and keyboard; dock pins/running/minimized state accurate.",
      "Supported compact desktop layout never invokes mobile shell or destroys stored topology; focus/geometry stable on zoom."
    ],
    "verification": [
      "pnpm --filter @dam-hopper/ui test -- src/os",
      "pnpm --filter @dam-hopper/ui test:browser -- browser-tests/os-shell.browser.tsx",
      "pnpm --filter @dam-hopper/ui build"
    ]
  },
  {
    "id": "integrate-os-services",
    "title": "Integrate explicit context, topics, notifications, intents and shortcut ownership",
    "blocked_by": [
      "complete-os-chrome"
    ],
    "allowed_files": [
      "packages/ui/src/os/window-context.tsx",
      "packages/ui/src/os/topics.ts",
      "packages/ui/src/os/topics.test.ts",
      "packages/ui/src/os/notifications.ts",
      "packages/ui/src/os/notifications.test.ts",
      "packages/ui/src/os/NotificationCenter.tsx",
      "packages/ui/src/os/intents.ts",
      "packages/ui/src/os/intents.test.ts",
      "packages/ui/src/os/input-arbiter.ts",
      "packages/ui/src/os/input-arbiter.test.ts",
      "packages/ui/src/os/shortcuts.ts",
      "packages/ui/src/os/app-registry.ts",
      "packages/ui/src/os/OsShell.tsx",
      "packages/ui/src/os/TopBar.tsx",
      "packages/ui/src/os/Dock.tsx",
      "packages/ui/src/os/CommandPalette.tsx",
      "packages/ui/src/os/persistence.ts",
      "packages/ui/src/os/persistence.test.ts",
      "packages/ui/src/embed/dam-hopper-app.tsx",
      "packages/ui/src/lib/shortcuts.ts",
      "packages/ui/src/lib/shortcuts.test.ts",
      "packages/ui/src/stores/settings.ts",
      "packages/ui/src/components/organisms/SettingsKeyboardShortcutsSection.tsx",
      "packages/ui/src/components/organisms/SettingsKeyboardShortcutsSection.test.tsx",
      "packages/ui/src/components/organisms/TerminalNotificationToastViewport.tsx",
      "packages/ui/browser-tests/os-input-isolation.browser.tsx"
    ],
    "constraints": [
      "Only listed paths writable; escalate additions to coordinator before editing.",
      "No mid-flight build/test/formatter runs while other writers are active; main integration owner verifies after the group joins."
    ],
    "acceptance": [
      "Every window/row action explicit-owner/generation fenced; no duplicate bus/attention/shortcut handling.",
      "Cognito hides/redacts toast/bell/live-region identities and blocks all input; IME/AltGr/capture and app/frame scope correct.",
      "Imported data inert; stable session refs only; unknown intent yields notice without side effects."
    ],
    "verification": [
      "pnpm --filter @dam-hopper/ui test -- src/os src/lib/shortcuts.test.ts src/components/organisms/SettingsKeyboardShortcutsSection.test.tsx",
      "pnpm --filter @dam-hopper/ui test:browser -- browser-tests/os-input-isolation.browser.tsx browser-tests/cognito-mode.browser.tsx",
      "E2E_CAPTURE=1 pnpm --filter @dam-hopper/ui test:e2e -- os-lifecycle"
    ]
  }
]
```

- [x] <!-- evcrate-task:complete-os-chrome --> Complete desktop window controls, dock, palette and accessible compact chrome (DONE 2026-11-02 13:02:03 +07:00)
- [x] <!-- evcrate-task:integrate-os-services --> Integrate explicit context, topics, notifications, intents and shortcut ownership (DONE 2026-11-02 13:02:03 +07:00)
