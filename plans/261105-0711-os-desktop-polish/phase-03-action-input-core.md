# P03 — Checked action resource and root-input cutovers

Status: **completed** · Priority: P2 · Estimated effort: **44h** work, not elapsed schedule.

## Context and contracts

[Overview](plan.md) · [C1–C14 architecture](architecture-contracts.md) · [ownership/DAG](execution-ownership.md) · [AC1–10](acceptance-matrix.md) · [accepted review decisions](reports/review-triage.md). Evidence: immutable [intake](reports/planning-intake.md), [commands](reports/command-evidence.md), [preferences](reports/preference-evidence.md), [desktop](reports/desktop-evidence.md), [review](reports/plan-review.md). C14 supersedes old group/cutover placement, not evidence. Planning only; no product edits/checks authorized now.

## Ownership and completion boundary

- Owner: **ActionsOwner**. Group: **G2b, four checked sequential nodes after P02**.
- Literal task allowlists below are exhaustive (root `/home/loidinh/WS/dam-hopper`); existing paths modify, new paths create. Obsolete code/tests removed in-place; no file deletion/shim. No implicit parent directory writes.
- All dependencies mean evidence-backed **completed**, not implementation-terminal. Sequential nodes checked/reviewed before next starts. G3 independent writers all terminal before one coordinator runs branch checks and completes each; no child starts on unchecked prerequisite.
- Coordinator alone schedules checks; workers do not run competing suites/formatters mid-edit. Build failures remain blockers, never N/A. Extra unknown callers require reviewed plan revision; known callers already owned here.
- Available LSP reference inventory before public changes; fallback targeted references if unavailable, record limitation. No unrelated-plan/docs/source edits; external exclusive handoffs in ownership map.

## Ordered changes, acceptance and future checks

### `resolve-action-bindings` — Resolve configured actions and guarded gestures

- [x] <!-- evcrate-task:resolve-action-bindings --> Resolve configured actions and guarded gestures

1. Consume P01 pure functions and completed P02 settings. Resolve eligibility/conflicts using exact C1 requirements and current capture/menu/modal/Cognito/IME/AltGraph inputs; remove obsolete OS shortcut aliases only after reference inventory.
2. Prepare pure one-gesture DoubleShift/reset behavior for root coordinator, without adding another live native listener. Ordinary Shift and disabled commands passthrough, no hardcoded fallback. Preserve protected local copy/find/frame conflicts and page-wide font scope.

**Exact writable paths** (modify existing/create new; no deletes):
- `packages/ui/src/os/input-arbiter.ts`
- `packages/ui/src/os/input-arbiter.test.ts`
- `packages/ui/src/os/shortcuts.ts`
- `packages/ui/src/lib/shortcuts.ts`
- `packages/ui/src/lib/shortcuts.test.ts`

**Acceptance:**
- Configured binding replacement/unbind and conflict eligibility deterministic; no descriptor implementation duplication.
- No new live dispatcher until atomic root-input node; existing caller APIs stay compilable.

**Future verification, not receipts:**
- Coordinator after implementation terminal: pnpm --filter @dam-hopper/ui build; run focused tests below, behavior smoke and passing independent implementation review; record commands, exit codes and reports before completion.
- pnpm --filter @dam-hopper/ui test src/os/actions.test.ts src/os/input-arbiter.test.ts src/lib/shortcuts.test.ts; smoke remap/unbind/guarded gesture resolution.

### `guard-ordinary-launches` — Implement durable globally locked ordinary-launch safety

- [x] <!-- evcrate-task:guard-ordinary-launches --> Implement durable globally locked ordinary-launch safety

1. Implement C3 reserve/settle in existing persistence.ts with global transaction Web Lock, whole-document reread/validation, 128 records/8192 bytes each/1MiB bound, pre-send dispatch-capable durable reservation, token-fenced settlements. Release lock before I/O; unresolved never evicted.
2. C12 exact target/cwd structured keys and fresh requested ID provenance; same folder Open/New guard, distinct proven directories independent; profile/endpoint/alias/target ambiguity fail closed. No desktop/generation/tab/mode key component.
3. Exclude journal from all reset/import/export; no TTL/dismiss/retry/reconciliation service. Unit transaction tests same-key race/distinct-key lost update/crash/corrupt/caps/missing capabilities/write/settlement/stale callback/ID reuse; focus still allowed. Real cooperating-tab journey remains P08.

**Exact writable paths** (modify existing/create new; no deletes):
- `packages/ui/src/os/persistence.ts`
- `packages/ui/src/os/app-launch-journal.test.ts`

**Acceptance:**
- Unresolved attempts block compatible resource creation across reload; exact different-directory reservations coexist.
- Fresh single-use requested ID cannot be reused after uncertainty/closure; failures never clear journal.

**Future verification, not receipts:**
- Coordinator after implementation terminal: pnpm --filter @dam-hopper/ui build; run focused tests below, behavior smoke and passing independent implementation review; record commands, exit codes and reports before completion.
- pnpm --filter @dam-hopper/ui test src/os/app-launch-journal.test.ts src/os/persistence.test.ts; controlled two-reservation/failed-settlement smoke, no backend mutation.

### `execute-captured-actions` — Atomically cut over executor exact intents terminal producers and real choosers

- [x] <!-- evcrate-task:execute-captured-actions --> Atomically cut over executor exact intents terminal producers and real choosers

1. Create executor and runtime MRU; generic compatible usable resource focus/restore current desktop then explicit focus sequence elsewhere, no unrelated owner fallback. Exact review eight-tuple/conflict operation or actionable disabled. Replace OsShell generic launcher and terminal-open domain adapter atomically; action executor delivers domain intents without recursively redispatching its terminal adapter.
2. Change required search/reveal intents and every known producer/handler/test in this node. C11 pure URL parse returns unresolved request; OsShell supplies captured connected owner/generation plus actual bound authorization before qualifier emits required payload. URL generation never authority; recheck await/destination, unavailable/stale/unauthorized returns notice. Deep links missing explicit editor file/browser URL open real chooser; remove fabricated untitled/default URL.
3. C12 terminal-create payload retains FsTargetRef/cwd/requestedTerminalId/source window/full context/owner/destination. Migrate Files/Git/ProjectInfo producers and tests explicitly; project+worktree normalized before wire projection. Workspace root cwd dot, folder cwd exact, contradictory fields reject. Explicit folder always supported New not reuse/cd/HOME; all creates same journal/fresh-ID guard. Missing exact originating PTY proof uncertain; no fallback attach.
4. Implement C10 final selection UX in EditorApp/BrowserApp: discriminated chooser/resource child, Editor uses controlled existing Files authorized FileTree/open callback, Browser explicit valid http/https form. Capture token/destination/owner at creation; cancel only picker; repeat independent pickers. Before and after authorization/load recheck token/context/owner. Existing canonical target focuses holder while picker explains collision and remains selectable; distinct target promotes same picker to usable exclusive resource. No synthetic claim IDs or PTY.
5. MonacoKeepAliveHost and OsResourceHost exclude chooser/unset/invalid selection, so no hidden resource/default URL/file effects. Browser slot updates publish immutable snapshots and refresh position-only presentation moves/visibility without changing iframe src/key. Preserve existing root hosts/claims and dirty state; browser host tests cover movement/minimize/desktop/privacy state.
6. Create Settings Appearance delivery token in executor for both existing/new singleton (consumer P07), ordinary open unaffected. Test executor/integration all known public callers, lossless folder root/two-folder/context switch/persistence failures, chooser cancellation/repeat/collision/stale owner, no preselection network/claim/iframe/editor load. Existing inputs remain current until next checked atomic node.

**Exact writable paths** (modify existing/create new; no deletes):
- `packages/ui/src/os/action-executor.ts`
- `packages/ui/src/os/action-executor.test.ts`
- `packages/ui/src/os/app-registry.ts`
- `packages/ui/src/os/app-registry.test.ts`
- `packages/ui/src/os/window-store.ts`
- `packages/ui/src/os/OsShell.tsx`
- `packages/ui/src/os/intents.ts`
- `packages/ui/src/os/intents.test.ts`
- `packages/ui/src/os/deep-links.ts`
- `packages/ui/src/os/deep-links.test.ts`
- `packages/ui/src/os/apps/FilesApp.tsx`
- `packages/ui/src/os/apps/FilesApp.test.tsx`
- `packages/ui/src/os/apps/SearchApp.tsx`
- `packages/ui/src/os/apps/SearchApp.test.tsx`
- `packages/ui/src/os/apps/GitApp.tsx`
- `packages/ui/src/os/apps/GitApp.test.tsx`
- `packages/ui/src/os/apps/ProjectInfoApp.tsx`
- `packages/ui/src/os/apps/ProjectInfoApp.test.tsx`
- `packages/ui/src/os/apps/EditorApp.tsx`
- `packages/ui/src/os/apps/EditorApp.test.tsx`
- `packages/ui/src/os/apps/BrowserApp.tsx`
- `packages/ui/src/os/apps/BrowserApp.test.tsx`
- `packages/ui/src/os/MonacoKeepAliveHost.tsx`
- `packages/ui/src/os/OsResourceHost.tsx`
- `packages/ui/src/os/OsResourceHost.test.tsx`
- `packages/ui/browser-tests/os-shell.browser.tsx`
- `packages/ui/browser-tests/project-worktree-target.browser.tsx`
- `packages/ui/browser-tests/os-workspace-apps.browser.tsx`

**Acceptance:**
- Required intent declarations plus known callers/tests, including os-workspace-apps owner-qualified search/reveal fixtures, change coherently; deep-link success and rejected qualification compile/work together.
- Explicit folder creates only exact captured directory via guarded New; requested-ID safety and exact originating provenance preserved.
- Two distinct selected documents/URLs yield usable exclusive views; chooser cancel/repeat/collision/owner transition behavior complete, root no-unset target effects.
- MRU/focus and await fences do not retarget or kill known orphan; terminal domain adapter cannot bypass journal or recurse.

**Future verification, not receipts:**
- Coordinator after implementation terminal: pnpm --filter @dam-hopper/ui build; run focused tests below, behavior smoke and passing independent implementation review; record commands, exit codes and reports before completion.
- pnpm --filter @dam-hopper/ui test src/os/action-executor.test.ts src/os/app-registry.test.ts src/os/intents.test.ts src/os/deep-links.test.ts src/os/apps/FilesApp.test.tsx src/os/apps/SearchApp.test.tsx src/os/apps/GitApp.test.tsx src/os/apps/ProjectInfoApp.test.tsx src/os/apps/EditorApp.test.tsx src/os/apps/BrowserApp.test.tsx src/os/OsResourceHost.test.tsx src/os/resource-registry.test.ts
- pnpm --filter @dam-hopper/ui test:browser browser-tests/os-shell.browser.tsx browser-tests/project-worktree-target.browser.tsx browser-tests/os-workspace-apps.browser.tsx; migrate both workspace-app search/reveal producers to exact target/generation/mode and keep their behavioral success/denial coverage; mounted chooser/deep-link/folder smoke uses actual adapters/executor, not mocked success.

### `capture-and-cache-input` — Atomically transfer keyboard authority to ordered root coordinator

- [x] <!-- evcrate-task:capture-and-cache-input --> Atomically transfer keyboard authority to ordered root coordinator

1. C5 root installs single keydown/keypress/keyup coordinator layout effect before lazy shell. Extract/reuse existing Cognito physical policy and remove its own keyboard registrations; retain pointer/focus authority, activation chord, consumed physical codes/repeats/releases, blur/timers/focus restoration. No second executor privacy toggle. Shell registers delegate; remount cleanup cannot clear root held-key state.
2. Convert browser guard hook to ordered coordinator stage (remove obsolete standalone listener; keep pure helper), and remove GlobalTerminalFontSizeShortcuts component/listener. Root current state direct order: privacy -> capture -> IME/AltGraph -> menu/modal -> configured enabled action (page-wide font) -> browser suppression -> frame/local/normal. Mod+R etc configurable before browser block; capture/menu/modal prevent reserved defaults without background commands. Terminal copy/local protected chords retained; undispatched browser/OS chords honestly limited.
3. Migrate OsShell/WindowFrame/hook/Monaco/terminal OS dispatch in same node, no overlapping old/new listener period in completed source. Native WeakMap one resolution/execution; xterm only suppresses handled/owned, existing terminal-input-policy still owns guarded stdin. Preserve copy/find/Shift+Enter, wheel zoom and normal remapped/unbound input. DoubleShift single root owner/reset, ordinary Shift not consumed.
4. Register stable claimed EditorApp slot provider with exact context/owner/target/window/resource. MonacoHost current DOM-path slot + editor refs supplies selection/filePath, no new props/upstream producer changes. Validate live claim/model/owner each event; parked/unclaimed/detached editor not context. Cleanup on claim loss/disposal and reparent tests preserve provider authority.
5. Root-mounted tests must exercise actual installed guards/coordinator, not just matcher or mocked shell: late shell mount, remount/StrictMode, Settings capture and menu/modal, remap to formerly browser-blocked Mod+R, page-wide font once and guarded suppression, full privacy keydown/keypress/keyup held sequence/dismissal after settings edit. Browser tests real Monaco/xterm event path and normal typing. Physical server PTY proof remains P08, not inferred.
6. Implement prerequisite authoritative menu snapshot/subscription/dismiss in existing lib/context-menu-coordinator.ts with tests; claim/replacement/release synchronous. Root reads per native event, TerminalPanel subscription immediately applies existing terminal-input-policy suppression without React-render delay; shell context subscribes for UI state. Test claim->immediate key/input, menu replacement, stale release, Cognito dismiss->held releases. Preserve claim/release caller API/scroll/focus cleanup; P06 consumes completed seam, no future export prerequisite.

**Exact writable paths** (modify existing/create new; no deletes):
- `packages/ui/src/os/action-dispatch.ts`
- `packages/ui/src/os/action-dispatch.test.ts`
- `packages/ui/src/os/shell-input-context.tsx`
- `packages/ui/src/os/shell-input-context.test.tsx`
- `packages/ui/src/lib/context-menu-coordinator.ts`
- `packages/ui/src/lib/context-menu-coordinator.test.ts`
- `packages/ui/src/embed/dam-hopper-app.tsx`
- `packages/ui/src/embed/dam-hopper-app.test.tsx`
- `packages/ui/src/hooks/use-browser-shortcut-guard.ts`
- `packages/ui/src/hooks/use-browser-shortcut-guard.test.tsx`
- `packages/ui/src/lib/browser-shortcut-guard.ts`
- `packages/ui/src/lib/browser-shortcut-guard.test.ts`
- `packages/ui/src/hooks/use-cognito-mode-input-guard.ts`
- `packages/ui/src/hooks/use-cognito-mode-input-guard.test.tsx`
- `packages/ui/src/hooks/use-shortcuts.ts`
- `packages/ui/src/lib/terminal-keyboard-shortcuts.ts`
- `packages/ui/src/lib/terminal-keyboard-shortcuts.test.ts`
- `packages/ui/src/components/organisms/TerminalPanel.tsx`
- `packages/ui/src/components/organisms/TerminalPanel.test.tsx`
- `packages/ui/src/components/organisms/MonacoHost.tsx`
- `packages/ui/src/components/organisms/MonacoHost.test.tsx`
- `packages/ui/src/os/apps/EditorApp.tsx`
- `packages/ui/src/os/apps/EditorApp.test.tsx`
- `packages/ui/src/os/OsShell.tsx`
- `packages/ui/src/os/WindowFrame.tsx`
- `packages/ui/browser-tests/os-input-isolation.browser.tsx`
- `packages/ui/browser-tests/os-shell.browser.tsx`
- `packages/ui/browser-tests/terminal-panel-replay-notifications.browser.tsx`

**Acceptance:**
- One ordered root authority installed/cleaned deterministically; shell remount cannot duplicate listener or privacy toggle.
- Browser guards respect capture/menu/modal/current action; page-wide font scope preserved once, no local duplicate.
- Exact editor selection/target/generation reaches qualified search/reveal; xterm never dispatches OS action or leaks handled event bytes at browser boundary.

**Future verification, not receipts:**
- Coordinator after implementation terminal: pnpm --filter @dam-hopper/ui build; run focused tests below, behavior smoke and passing independent implementation review; record commands, exit codes and reports before completion.
- pnpm --filter @dam-hopper/ui test src/os/action-dispatch.test.ts src/os/shell-input-context.test.tsx src/embed/dam-hopper-app.test.tsx src/hooks/use-browser-shortcut-guard.test.tsx src/lib/browser-shortcut-guard.test.ts src/hooks/use-cognito-mode-input-guard.test.tsx src/lib/terminal-keyboard-shortcuts.test.ts src/components/organisms/TerminalPanel.test.tsx src/components/organisms/MonacoHost.test.tsx src/os/apps/EditorApp.test.tsx
- pnpm --filter @dam-hopper/ui test src/lib/context-menu-coordinator.test.ts; current menu claim/release/privacy-dismissal and root/input snapshot smoke before completion.
- pnpm --filter @dam-hopper/ui test:browser browser-tests/os-input-isolation.browser.tsx browser-tests/os-shell.browser.tsx browser-tests/terminal-panel-replay-notifications.browser.tsx; mounted late-shell/remap/privacy-release and ordinary-input smoke.

## Durable task contract

Exactly one fence, exact installed schema; no runtime state authored.

```evcrate-tasks
[
  {
    "id": "resolve-action-bindings",
    "title": "Resolve configured actions and guarded gestures",
    "blocked_by": [
      "expose-appearance-controls"
    ],
    "allowed_files": [
      "packages/ui/src/os/input-arbiter.ts",
      "packages/ui/src/os/input-arbiter.test.ts",
      "packages/ui/src/os/shortcuts.ts",
      "packages/ui/src/lib/shortcuts.ts",
      "packages/ui/src/lib/shortcuts.test.ts"
    ],
    "constraints": [
      "Implement frozen architecture-contracts.md including C10-C14; no shims, new service, Recipe rewrite or ambient authority.",
      "Implementation-terminal is not completion. Coordinator runs applicable compile/tests/smoke and independent implementation review before any dependent starts; no failed compile labeled N/A.",
      "Own only literal paths; inventory exported references before edits. New unknown callers require reviewed allowlist revision, not partial migration."
    ],
    "acceptance": [
      "Configured binding replacement/unbind and conflict eligibility deterministic; no descriptor implementation duplication.",
      "No new live dispatcher until atomic root-input node; existing caller APIs stay compilable."
    ],
    "verification": [
      "Coordinator after implementation terminal: pnpm --filter @dam-hopper/ui build; run focused tests below, behavior smoke and passing independent implementation review; record commands, exit codes and reports before completion.",
      "pnpm --filter @dam-hopper/ui test src/os/actions.test.ts src/os/input-arbiter.test.ts src/lib/shortcuts.test.ts; smoke remap/unbind/guarded gesture resolution."
    ]
  },
  {
    "id": "guard-ordinary-launches",
    "title": "Implement durable globally locked ordinary-launch safety",
    "blocked_by": [
      "resolve-action-bindings"
    ],
    "allowed_files": [
      "packages/ui/src/os/persistence.ts",
      "packages/ui/src/os/app-launch-journal.test.ts"
    ],
    "constraints": [
      "Implement frozen architecture-contracts.md including C10-C14; no shims, new service, Recipe rewrite or ambient authority.",
      "Implementation-terminal is not completion. Coordinator runs applicable compile/tests/smoke and independent implementation review before any dependent starts; no failed compile labeled N/A.",
      "Own only literal paths; inventory exported references before edits. New unknown callers require reviewed allowlist revision, not partial migration."
    ],
    "acceptance": [
      "Unresolved attempts block compatible resource creation across reload; exact different-directory reservations coexist.",
      "Fresh single-use requested ID cannot be reused after uncertainty/closure; failures never clear journal."
    ],
    "verification": [
      "Coordinator after implementation terminal: pnpm --filter @dam-hopper/ui build; run focused tests below, behavior smoke and passing independent implementation review; record commands, exit codes and reports before completion.",
      "pnpm --filter @dam-hopper/ui test src/os/app-launch-journal.test.ts src/os/persistence.test.ts; controlled two-reservation/failed-settlement smoke, no backend mutation."
    ]
  },
  {
    "id": "execute-captured-actions",
    "title": "Atomically cut over executor exact intents terminal producers and real choosers",
    "blocked_by": [
      "guard-ordinary-launches"
    ],
    "allowed_files": [
      "packages/ui/src/os/action-executor.ts",
      "packages/ui/src/os/action-executor.test.ts",
      "packages/ui/src/os/app-registry.ts",
      "packages/ui/src/os/app-registry.test.ts",
      "packages/ui/src/os/window-store.ts",
      "packages/ui/src/os/OsShell.tsx",
      "packages/ui/src/os/intents.ts",
      "packages/ui/src/os/intents.test.ts",
      "packages/ui/src/os/deep-links.ts",
      "packages/ui/src/os/deep-links.test.ts",
      "packages/ui/src/os/apps/FilesApp.tsx",
      "packages/ui/src/os/apps/FilesApp.test.tsx",
      "packages/ui/src/os/apps/SearchApp.tsx",
      "packages/ui/src/os/apps/SearchApp.test.tsx",
      "packages/ui/src/os/apps/GitApp.tsx",
      "packages/ui/src/os/apps/GitApp.test.tsx",
      "packages/ui/src/os/apps/ProjectInfoApp.tsx",
      "packages/ui/src/os/apps/ProjectInfoApp.test.tsx",
      "packages/ui/src/os/apps/EditorApp.tsx",
      "packages/ui/src/os/apps/EditorApp.test.tsx",
      "packages/ui/src/os/apps/BrowserApp.tsx",
      "packages/ui/src/os/apps/BrowserApp.test.tsx",
      "packages/ui/src/os/MonacoKeepAliveHost.tsx",
      "packages/ui/src/os/OsResourceHost.tsx",
      "packages/ui/src/os/OsResourceHost.test.tsx",
      "packages/ui/browser-tests/os-shell.browser.tsx",
      "packages/ui/browser-tests/project-worktree-target.browser.tsx",
      "packages/ui/browser-tests/os-workspace-apps.browser.tsx"
    ],
    "constraints": [
      "Implement frozen architecture-contracts.md including C10-C14; no shims, new service, Recipe rewrite or ambient authority.",
      "Implementation-terminal is not completion. Coordinator runs applicable compile/tests/smoke and independent implementation review before any dependent starts; no failed compile labeled N/A.",
      "Own only literal paths; inventory exported references before edits. New unknown callers require reviewed allowlist revision, not partial migration."
    ],
    "acceptance": [
      "Required intent declarations plus known callers/tests, including os-workspace-apps owner-qualified search/reveal fixtures, change coherently; deep-link success and rejected qualification compile/work together.",
      "Explicit folder creates only exact captured directory via guarded New; requested-ID safety and exact originating provenance preserved.",
      "Two distinct selected documents/URLs yield usable exclusive views; chooser cancel/repeat/collision/owner transition behavior complete, root no-unset target effects.",
      "MRU/focus and await fences do not retarget or kill known orphan; terminal domain adapter cannot bypass journal or recurse."
    ],
    "verification": [
      "Coordinator after implementation terminal: pnpm --filter @dam-hopper/ui build; run focused tests below, behavior smoke and passing independent implementation review; record commands, exit codes and reports before completion.",
      "pnpm --filter @dam-hopper/ui test src/os/action-executor.test.ts src/os/app-registry.test.ts src/os/intents.test.ts src/os/deep-links.test.ts src/os/apps/FilesApp.test.tsx src/os/apps/SearchApp.test.tsx src/os/apps/GitApp.test.tsx src/os/apps/ProjectInfoApp.test.tsx src/os/apps/EditorApp.test.tsx src/os/apps/BrowserApp.test.tsx src/os/OsResourceHost.test.tsx src/os/resource-registry.test.ts",
      "pnpm --filter @dam-hopper/ui test:browser browser-tests/os-shell.browser.tsx browser-tests/project-worktree-target.browser.tsx browser-tests/os-workspace-apps.browser.tsx; migrate both workspace-app search/reveal producers to exact target/generation/mode and keep their behavioral success/denial coverage; mounted chooser/deep-link/folder smoke uses actual adapters/executor, not mocked success."
    ]
  },
  {
    "id": "capture-and-cache-input",
    "title": "Atomically transfer keyboard authority to ordered root coordinator",
    "blocked_by": [
      "execute-captured-actions"
    ],
    "allowed_files": [
      "packages/ui/src/os/action-dispatch.ts",
      "packages/ui/src/os/action-dispatch.test.ts",
      "packages/ui/src/os/shell-input-context.tsx",
      "packages/ui/src/os/shell-input-context.test.tsx",
      "packages/ui/src/lib/context-menu-coordinator.ts",
      "packages/ui/src/lib/context-menu-coordinator.test.ts",
      "packages/ui/src/embed/dam-hopper-app.tsx",
      "packages/ui/src/embed/dam-hopper-app.test.tsx",
      "packages/ui/src/hooks/use-browser-shortcut-guard.ts",
      "packages/ui/src/hooks/use-browser-shortcut-guard.test.tsx",
      "packages/ui/src/lib/browser-shortcut-guard.ts",
      "packages/ui/src/lib/browser-shortcut-guard.test.ts",
      "packages/ui/src/hooks/use-cognito-mode-input-guard.ts",
      "packages/ui/src/hooks/use-cognito-mode-input-guard.test.tsx",
      "packages/ui/src/hooks/use-shortcuts.ts",
      "packages/ui/src/lib/terminal-keyboard-shortcuts.ts",
      "packages/ui/src/lib/terminal-keyboard-shortcuts.test.ts",
      "packages/ui/src/components/organisms/TerminalPanel.tsx",
      "packages/ui/src/components/organisms/TerminalPanel.test.tsx",
      "packages/ui/src/components/organisms/MonacoHost.tsx",
      "packages/ui/src/components/organisms/MonacoHost.test.tsx",
      "packages/ui/src/os/apps/EditorApp.tsx",
      "packages/ui/src/os/apps/EditorApp.test.tsx",
      "packages/ui/src/os/OsShell.tsx",
      "packages/ui/src/os/WindowFrame.tsx",
      "packages/ui/browser-tests/os-input-isolation.browser.tsx",
      "packages/ui/browser-tests/os-shell.browser.tsx",
      "packages/ui/browser-tests/terminal-panel-replay-notifications.browser.tsx"
    ],
    "constraints": [
      "Implement frozen architecture-contracts.md including C10-C14; no shims, new service, Recipe rewrite or ambient authority.",
      "Implementation-terminal is not completion. Coordinator runs applicable compile/tests/smoke and independent implementation review before any dependent starts; no failed compile labeled N/A.",
      "Own only literal paths; inventory exported references before edits. New unknown callers require reviewed allowlist revision, not partial migration."
    ],
    "acceptance": [
      "One ordered root authority installed/cleaned deterministically; shell remount cannot duplicate listener or privacy toggle.",
      "Browser guards respect capture/menu/modal/current action; page-wide font scope preserved once, no local duplicate.",
      "Exact editor selection/target/generation reaches qualified search/reveal; xterm never dispatches OS action or leaks handled event bytes at browser boundary.",
      "Menu ownership and stdin suppression change synchronously before React render: immediate claim/key, replacement, stale release and privacy dismissal/held-release tests pass; no future P06 prerequisite."
    ],
    "verification": [
      "Coordinator after implementation terminal: pnpm --filter @dam-hopper/ui build; run focused tests below, behavior smoke and passing independent implementation review; record commands, exit codes and reports before completion.",
      "pnpm --filter @dam-hopper/ui test src/os/action-dispatch.test.ts src/os/shell-input-context.test.tsx src/embed/dam-hopper-app.test.tsx src/hooks/use-browser-shortcut-guard.test.tsx src/lib/browser-shortcut-guard.test.ts src/hooks/use-cognito-mode-input-guard.test.tsx src/lib/terminal-keyboard-shortcuts.test.ts src/components/organisms/TerminalPanel.test.tsx src/components/organisms/MonacoHost.test.tsx src/os/apps/EditorApp.test.tsx",
      "pnpm --filter @dam-hopper/ui test src/lib/context-menu-coordinator.test.ts; current menu claim/release/privacy-dismissal and root/input snapshot smoke before completion.",
      "pnpm --filter @dam-hopper/ui test:browser browser-tests/os-input-isolation.browser.tsx browser-tests/os-shell.browser.tsx browser-tests/terminal-panel-replay-notifications.browser.tsx; mounted late-shell/remap/privacy-release and ordinary-input smoke."
    ]
  }
]
```

## Risks, failure and rollback

Risks: lost directory/worktree, destructive requested ID, chooser claims before selection, stale provider, same-window listener race, browser remap stolen. Atomic nodes include actual callers/tests; no delayed compile errors. Stop new dispatch on repair/rollback, preserve exact hosts, config and unresolved journal; no kill/retry/ambient target.

Common invariant: owner-bound authorization; recheck after awaits; retain exact PTY/ReviewTarget and root keep-alive identities. Never kill/retarget confirmed orphan, clear unresolved journal, suppress failure or substitute ambient owner. Rollback coherent authorized code/config groups only, preserve user work.

## Handoff / unresolved questions

G3 starts only when capture-and-cache-input has real passing completion evidence. persistence.ts transfers exclusively to DockOwner; geometry interfaces and captured executor stable; root guard remains mounted outside lazy shell.

No unsettled product choice. Separate implementation authorization, cross-plan ownership, actual infrastructure/check/review and production human acceptance remain gates. Parent owns installed structural parser, targeted independent planning follow-up and final validation/interview; this authoring return claims none.
