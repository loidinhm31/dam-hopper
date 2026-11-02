# Code Review — Phase 05: Application catalog and deep links

## Assessment

**Score: 3/10 — request changes.** Catalog and adapters exist; Phase 05 end-to-end acceptance is incomplete. Passing compilation and mount-oriented tests do not establish owner isolation, working cross-app navigation, or review lifecycle safety.

Review method: static source/diff inspection; `code-review` skill read directly from published installation. No source/test/plan changes and no duplicate validation execution. Findings below distinguish static evidence from unexercised runtime impact (`[INFERENCE]`). Plan status intentionally unchanged: coordinator owns task state; assignment prohibits TODO tracking.

| Required invariant | Assessment |
| --- | --- |
| Strict owner/client qualification | **Fails static review**: ambient configuration/search/diff mutation paths remain reachable from new adapters. |
| Review input cannot reach PTY | **Not established**: bubbling containment exists; activation/focus and PTY-send gating are missing. |
| Untrusted deep links, no ambient execution | Known profile checks and no automatic command execution observed; payload validation and delivery incomplete. |
| Persistence excludes sensitive drafts/diffs | App-state allowlist excludes resolver/session payloads; **in-memory purge lifecycle fails**. |

## Critical issues

### C1 — Project Info and Changes can mutate a server other than their window owner

**Confidence: high (static dataflow).**

- `packages/ui/src/os/apps/ProjectInfoApp.tsx:23-24,44-48,84-87` invokes `useConfig()` / `useUpdateConfig()` without the window owner and omits `ProjectInfoPanel.target`.
- `packages/ui/src/api/queries.ts:112-128,966-975,1185-1208` confirms omitted owners select the ambient API / active profile. `ProjectInfoPanel.tsx:50-58` also derives ambient project targeting without its override.
- `packages/ui/src/os/apps/ChangesApp.tsx:149-157` mounts an editable `DiffViewer`. `packages/ui/src/components/organisms/DiffViewer.tsx:40-45,321-354` resolves the ambient transport independently for read and write. `packages/ui/src/api/ws-transport.ts:74-84,3323-3344` strips client-only profile identity from wire targets: supplying `target.profileId` does not select the socket.

**Impact [INFERENCE]:** with window owner A and active profile B, configuration edits and diff saves can affect B. Switching ambient transport between the diff stat and write can also redirect a multi-step mutation. Equal project/path IDs make this a data corruption risk, not just incorrect labels.

**Correction:** pass the captured `{profileId,generation}` into configuration hooks and an explicit project snapshot into ProjectInfoPanel; bind diff save to the same captured owner's transport for every step; reject stale generation before dispatch and after awaits. Integrate these fixes into canonical shared bodies rather than duplicating feature logic.

### C2 — Search adapter's apparent explicit target is discarded before search/replace

**Confidence: high (static dataflow).**

- `packages/ui/src/os/apps/SearchApp.tsx:20-28,68-71` passes a qualified target, but `packages/ui/src/components/organisms/SearchPanel.tsx:48-54,78,142-150` rebuilds it without `profileId`, passing that stripped target into search and replacement.
- `packages/ui/src/hooks/use-file-search.ts:116-142` consequently uses ambient `getTransport()`. Its qualified-owner failure branch also explicitly falls back to the ambient transport.
- `SearchApp.tsx:43-51` routes every federated match through the window's profile/project/worktree rather than the match's source identity (`search-matches.ts:3-11`; search results include source metadata).

**Impact [INFERENCE]:** a Search window labeled A can read or replace B's files; a cross-profile search result opens the wrong file once file intents are wired.

**Correction:** retain the full target through SearchPanel and its hooks; fail closed instead of ambient fallback; route result actions using the result's verified owner/target/generation. Preserve federated-search behavior explicitly rather than relabeling results as the window owner.

## Warnings / required fixes

### W1 — High: almost all advertised intents have no production consumer

`packages/ui/src/os/intents.ts:262-274` returns unhandled when no handler exists, and stops at the first registered handler even if it returns `unhandled`. Production registration search finds only `packages/ui/src/os/apps/FilesApp.tsx:63-80` (`file:reveal`). There are no production handlers for file open, terminal open/focus, browser open, conflict resolve, Git reveal, search query, workflow selection, settings, or session review.

`packages/ui/src/os/OsShell.tsx:128-144` opens a blank/default window, does not initialize appState from the parsed payload, immediately dispatches before a newly mounted child can register, and ignores the result.

**Impact [INFERENCE]:** Files/Search clicks and resolver/browser/terminal handoffs silently do nothing; an editor URL opens `untitled.ts`, session URL lacks the tuple and shows incomplete identity, commit/query/tab parameters are lost. A second Files window's reveal is rejected by the first window's handler without trying the matching handler.

**Correction:** implement one owner-qualified catalog launch/delivery controller that opens or focuses the exact context and reliably delivers payloads after mount; continue past nonmatching handlers or route directly to a window. Surface invalid/unhandled results. Add actual user-action tests, including a destination not yet mounted.

### W2 — High: Session Changes bypasses authoritative enablement and never purges on retirement

`packages/ui/src/os/apps/SessionChangesApp.tsx:22-43,65-83,146-193`:

- derives generation from the current window owner rather than the captured review identity;
- renders SessionChangesPanel while enablement is loading;
- disabled/disconnected handling only cancels queries, never removes cached sensitive results or closes the window;
- lacks a full-tuple panel key and captured-owner invalidation cleanup.

The old shared host already supplies authoritative gating, removal, closure and full-tuple keying (`SessionChangesHost.tsx:39-64,100-106`). The panel issues status queries on mount (`SessionChangesPanel.tsx:377-384`), and ready status mounts lazy file fetching (`:574-584`, `:82-93`).

**Impact [INFERENCE]:** review requests start before config establishes permission; old-owner diffs remain cached; reconnect can silently reinterpret the same tuple under a new generation. This violates the explicit close/purge contract.

**Correction:** share the existing host lifecycle guard, require `!isLoading && isEnabled`, pin the full captured tuple including generation, key the panel by it, cancel/remove the retiring owner's queries and close on disable/disconnect/retirement. Do not purge only the newly resolved owner after reconnect.

### W3 — High: review keyboard containment does not establish PTY input isolation

`SessionChangesApp.tsx:85-94,175-183` and `ConflictResolverApp.tsx:132-137` stop bubbling only for events already targeting the review DOM. Neither transfers focus on activation. `window-store.ts:99-115` changes state only; `WindowFrame.tsx:67-69,294-304` has no automatic focus effect. `TerminalsApp.tsx:46-57` can attach/refocus terminals on registry changes without consulting OS focus. `terminal-host-attachment.ts:61` schedules focus by default; `TerminalPanel.tsx:822-827` gates writes on connection/replay, not focused OS app.

**Impact [INFERENCE]:** a programmatically activated review may leave focus in a live xterm; later registry events can steal focus back. The review's bubble handler never sees those keystrokes.

**Correction:** establish DOM focus when activating review windows, prevent background terminal auto-focus, and gate PTY input on the actual active/visible OS terminal owner. Preserve Monaco widget Escape precedence. Test real focus/keyboard entry with a live terminal surface and assert zero `terminalWrite` calls, not only lack of window-level event bubbling.

### W4 — High: instancing conflates worktrees/roots/operations and even profiles

`app-registry.ts:67-83,94-119` marks Agent Store and Ports globally single-instance rather than per-profile and Session Changes multi-instance rather than per-full-tuple. `OsShell.tsx:104-125,225-248`, `Dock.tsx:54-76`, and `CommandPalette.tsx:113-137` compare only app ID or `(profile,project)`, ignoring worktree/root/operation. `ConflictResolverApp.tsx:36-43` also omits worktree and operation from its claim. The supplied `ctx.operation` is not validated or consumed by the resolver adapter.

**Impact [INFERENCE]:** opening the same repository on a second worktree focuses the first; a profile-B Ports/Store link can focus profile A; unrelated resolver instances collide, while duplicate reviews can be spawned.

**Correction:** encode manifest-approved context identity once and share it across all launch paths and resource claims. Include worktree/root/operation and full review tuple where required. Test equal IDs across two profiles and two worktrees. Update registry tests against the plan contract, not the current mismatched values (`app-registry.test.ts:81-97`).

### W5 — High: management windows retain page-global URL/default ownership

`AgentStoreApp.tsx:8-16` ignores window context; `AgentStorePage.tsx:61-102` uses route search params and active/first-profile defaults. `OsShell.tsx:146-147` removes those parameters. `SettingsApp.tsx:47-48` supplies no explicit deep-link target to Settings or Devices; Devices initializes from active/first profile (`DevicesPage.tsx:19-21`), Settings uses its independent global selections (`SettingsPage.tsx:44-74`).

**Impact [INFERENCE]:** a valid explicit management link does not reliably select its stated target. Store tab/profile changes modify the global `/os` query, not per-window state, and a subsequent desktop/window update can reconsume an unrelated pending `open` link.

**Correction:** separate reusable feature content/controllers from page URL navigation; feed Store explicit owner/tab and Settings explicit target intent while retaining its independent preferences-source selector. Do not make singleton Settings a global selected-server substitute.

### W6 — Medium: URL processing is not router-driven and parser accepts malformed payloads

`OsShell.tsx:83-88,146-160` reads `window.location` in an effect keyed to session state, not router location. A same-route navigation/back-forward with unchanged window state is not reliably consumed. Raw history replacement also bypasses React Router's location state.

`deep-links.ts:65-78,99-108,204-230,275-280` accepts arbitrary actions, partially parsed/invalid line numbers, unchecked root/operation/hash/URL values, no captured generation, and fabricates generation `0` for Session Changes. Unknown profiles are rejected, but that alone is not full untrusted input validation.

**Correction:** consume basename-aware router location/navigation, track a navigation identity for idempotence, explicitly validate supported fields/actions and review owner freshness, and present invalid/stale notices. Keep terminal creation behind an explicit user trigger. No automatic command execution was observed in current code; absent intent consumers are not a substitute for this contract.

### W7 — High: nested-root diffs and per-window state parity are incomplete

`ChangesApp.tsx:37-54,149-157` keeps the selected file locally but drops `ChangedFileSelection.gitRootId` and `diffPath` when rendering DiffViewer; its existing props support both (`DiffViewer.tsx:48-60,123-133`). The selection handler does not activate the Diff tab. New Files/Search/Changes/Project Info/Settings adapters do not write view changes back into session state, so tab/desktop/minimize unmounts reset them (`DesktopCanvas.tsx:40-53,95`). Conditional DiffViewer unmount also has no dirty-buffer guard.

**Impact [INFERENCE]:** nested repository files request the parent repository's diff; view state disappears on normal window transitions; unsaved diff edits can be discarded on tab switches.

**Correction:** preserve root-relative diff identity; persist only approved per-window view state and retain dirty content in the canonical memory-owned resource; guard dirty transitions. Add nested-root and tab/minimize/desktop-switch journeys.

### W8 — Medium: template and lazy catalog wiring are not delivered

`desktop-templates.ts:18-132` produces the expected 60/40 tree, but repository references are tests only; production desktop creation never calls it. `OsShell.tsx:6-19` eagerly imports every app rather than registry/lazy loading. New management/project desktop flows therefore cannot exercise the approved template, and visiting `/os` loads all feature modules.

**Correction:** connect template creation to the intended project-desktop action and lazy-load app bodies behind the existing route/Suspense boundary. Do not add a second template/launcher convention.

### W9 — High: tests do not exercise Phase 05 acceptance journeys

`os-workspace-apps.browser.tsx:108-165`, `os-review-apps.browser.tsx:107-141`, and `os-management-apps.browser.tsx:114-173` principally assert adapter DOM existence. Session isolation test (`os-review-apps.browser.tsx:143-204`) dispatches a synthetic event directly on the wrapper and checks a window listener; it neither mounts/focuses a background PTY for that journey nor checks its `terminalWrite` spy. No two-profile/worktree collision, stale-generation mutation, disable/disconnect cache removal, deep-link delivery/back-forward, actual file opening, or sensitive-review persistence regression is asserted.

**Correction:** add focused behavioral regressions for C1/C2/W1-W7 with owner-distinct transports and meaningful state assertions. Pure parser tests alone do not prove deep-link execution safety or usability.

## Suggestions / positive observations

- Keep shared feature bodies canonical; the small adapters and no-layout extraction are a useful direction, provided the owner/controller contracts are actually threaded through.
- Preserve the positive persistence design: `persistence.ts:38-98` is a strict per-app allowlist; resolver/session appState defaults to omitted. Add explicit new-review/draft/diff persistence regressions; current secret-field test covers Terminals only (`persistence.test.ts:53-79`).
- Consolidate the duplicated launcher/instancing logic in shell, palette and Dock; one simple context-key function/controller is sufficient. Prefer typed intent actions in manifest metadata over unrestricted `string[]`.
- Reuse canonical resolver composition/controller instead of copying its toolbar/continue/abort logic. Pass the existing resolver into MergeConflictEditor (`ConflictResolverApp.tsx:48,199-210`; `MergeConflictEditor.tsx:102-107`) to avoid a second inventory/controller. Restore terminal-handoff guidance rather than treating that nonterminal outcome as silence.
- Preserve known-profile rejection and no automatic URL command execution. No new server endpoint or dependency was introduced in the reviewed diff.

## Reviewed files

All requested production files inspected:

- `packages/ui/src/os/{types.ts,app-registry.ts,intents.ts,Dock.tsx,persistence.ts,CommandPalette.tsx,desktop-templates.ts,deep-links.ts,OsShell.tsx}`.
- `packages/ui/src/os/apps/{FilesApp,SearchApp,ChangesApp,ProjectInfoApp,GitApp,ConflictResolverApp,SessionChangesApp,WorkflowPlansApp,PortsTunnelsApp,AgentStoreApp,SettingsApp}.tsx`.
- `packages/ui/src/components/pages/{AgentStorePage,SettingsPage,DevicesPage}.tsx`.
- `packages/ui/src/embed/dam-hopper-app.tsx`.

Tests inspected: `src/os/{app-registry,deep-links,intents,persistence}.test.ts`, `browser-tests/{os-workspace-apps,os-review-apps,os-management-apps,os-input-isolation}.browser.tsx` (all under `packages/ui/`).

Supporting source inspected: `os/{window-context.tsx,input-arbiter.ts,window-store.ts,WindowFrame.tsx,DesktopCanvas.tsx,OsResourceHost.tsx}`, existing Terminals/Editor/Browser adapters; `api/{queries.ts,session-changes-queries.ts,transport.ts,ws-transport.ts}`; `hooks/{use-file-search.ts,use-ports.ts,use-conflict-resolver.ts}`; canonical ProjectInfoPanel/SearchPanel/ChangedFilesList/DiffViewer/WorkflowContextSurface/ConflictResolverPanel/MergeConflictEditor/SessionChangesHost/SessionChangesPanel/TerminalKeepAliveHost; terminal registry/attachment and search-match helpers. Large supporting modules reviewed in targeted sections, not exhaustively.

Requirements: `plans/261101-1738-ai-dev-os-redesign/phase-05-app-migration-and-intents.md`, README, PDR and code standards. Approximate inspected source/test sections: 6,000+ lines. Not a whole-repository audit.

## Validation commands / results

No validation commands executed by this reviewer; tester owns execution. Results below are **tester-reported**, confirmed by Phase05Tester and inspected in `plans/reports/tester-261102-1356-phase-05-app-catalog.md`:

| Command | Reported result |
| --- | --- |
| `pnpm --filter @dam-hopper/ui test src/os` | Exit 0; 9 files, 58 tests passed. |
| `pnpm --filter @dam-hopper/ui test:browser browser-tests/os-workspace-apps.browser.tsx browser-tests/os-review-apps.browser.tsx browser-tests/os-management-apps.browser.tsx` | Exit 0; 3 files, 7 tests passed; no skips. |
| `pnpm --filter @dam-hopper/ui build` | Exit 0; `tsc -p tsconfig.json`, 0 compilation errors. This is not a production web bundle build. |
| Literal `test -- src/os` command | Receipt reports full unit suite: 337 files, 3,151 tests passed. |
| Literal `test:browser -- ...` command | Receipt reports full browser suite: 60 files passed/2 skipped; 324 tests passed/4 skipped. |

Browser receipt notes React `act(...)` warnings. Lint not executed/reported. Coverage percentage and type-coverage percentage not measured. Passing tests do not invalidate static defects above.

## Recommended disposition

Do not accept Phase 05 as behaviorally complete. Fix cross-owner mutation/search paths first, then reliable intent delivery/context identity, review lifecycle/input isolation, and retained-state/nested-root/template behavior. Validate each with actual target-change/error journeys after integration.

## Unresolved questions

- Live PTY focus/input behavior, stale-owner transitions and runtime deep-link navigation are not exercised by the supplied tests; findings identify the missing contracts, but exact runtime reproduction remains unqualified.
- No additional product decision is needed to correct the above: the Phase 05 plan already specifies the required owner, instancing, persistence and URL behavior.
