# Phase 01: Terminal Title Ordinal Display

## Context links

- [Plan overview](./plan.md)
- [Preflight contract](../reports/preflight-260829-2106-terminal-title-ordinals.md)
- [Scout evidence](../reports/scout-external-260829-2106-terminal-title-ordinals.md)
- [UX review and must-fix constraints](../reports/ui-ux-260829-2106-terminal-title-ordinals.md)
- [Repository guidance](../../AGENTS.md)
- [Frontend components](../../docs/frontend-components.md)
- [System architecture](../../docs/system-architecture.md)
- [Code standards](../../docs/code-standards.md)
- `docs/design-guidelines.md` is absent; existing frontend docs govern.

## Overview

- **Date:** 2026-08-29
- **Priority:** P2
- **Plan status:** Completed
- **Phase status:** Completed
- **Effort:** 4h
- **Outcome:** Every current open terminal title shows its existing base plus the global ordinal, e.g. `dam-hopper:bash #1`; narrow layouts truncate only the base and keep `#N` visible, while actions remain keyed by `sessionId`.

## Key Insights

- `useTerminalManager()` owns global `openTabs`; its order is the only ordinal authority. Per-pane ordinals may be non-contiguous and shift after any global order change.
- New and hydrated tabs get base labels through two paths: `tabLabel()` in `use-terminal-manager.ts` and `sessionTabLabel()`/`tabForSession()` in `terminal-auto-attach.ts`. Both currently emit `Terminal ?` when a free-session index is transiently absent.
- A single concatenated `label` inside `truncate` can hide the distinguishing suffix. Open-title data must therefore stay structured through render: `{ baseLabel, ordinal, fullText }`, with only `baseLabel` allowed to shrink/truncate.
- Actual split-pane `TabBar`, legacy `TerminalTabBar`, runtime navigator/tree, and active runtime header require the same shared renderer contract. Consumers must not append or regex-parse suffixes locally.
- `WorkspacePage.browserTerminalTargets` unions mounted sessions with raw `state.openTabs`. It must use the projected open-tab map for open targets; mounted-only fallbacks are not open titles and stay readable but unsuffixed.
- `TerminalKeepAliveHost` already derives `openTabs.findIndex(...) + 1` for notifications. Reuse its global current-order semantics, not notification state.
- Internal base tabs and all identity-bearing operations stay unchanged: unsuffixed `TabEntry.label`, stable `sessionId`, no persisted ordinal.

## Requirements

### Preflight contract, clarified by UX review

- Every **current open-tab title** carries `#N`, where `N` is current 1-based position in global `openTabs`. Update after attach/hydration, close/removal, and reorder; duplicate bases remain distinguishable.
- Use an `OpenTerminalTitle` projection with separate `baseLabel`, numeric `ordinal`, and complete `fullText`. No renderer may recover parts with regex/string parsing or use the ordinal as identity.
- Shared rendering contract: one min-width-constrained flex row; `baseLabel` is the only `min-w-0 truncate` child; visible ` #N` is a `shrink-0` sibling; visual fragments are hidden from assistive technology while `fullText` is exposed once as the title's accessible text. A hidden suffix at the plan's narrow smoke width is a failure.
- Apply that renderer to split-pane tabs, runtime navigator open items, active runtime header/compact title, legacy tab strip, and browser handoff target rows. Browser targets backed by open tabs also retain `label: fullText` for existing dialog/status string consumers.
- Mounted-only browser/runtime fallback entries are outside the open-title ordinal contract. Preserve their existing readable `${project} · ${command}`-style fallback without inventing an ordinal; never fall back to raw `sessionId`.
- Preserve indexed free labels such as `Terminal 1`. If `freeTerminalIndexMap` transiently lacks the new session, use `Terminal (starting…)`; it becomes `Terminal X` when the index appears. `Terminal ?` is prohibited.
- Keep selection, close, pin, diagnostics, drag, PTY attach, notification navigation, and browser handoff keyed by `sessionId`. Preserve cwd tooltip precedence, keyboard behavior, `min-h-11` navigator targets, existing control hit areas, and compact/desktop usability.
- No raw `sessionId`/`incarnation` in titles. No backend, API, WebSocket, database, config, dependency, asset, or unrelated visual redesign.

### Side-effect review checklist

- [x] **Auth/session/permissions:** no authentication, authorization, browser permission, or server-session lifecycle change; frontend `sessionId` identity stays authoritative.
- [x] **API compatibility:** `SessionInfo`, REST calls, transport methods, and payloads unchanged. Internal `BrowserTerminalTarget` gains only optional presentation data; its `sessionId` identity/readiness fields and artifact contract stay unchanged.
- [x] **Database/migrations/data integrity:** no schema, migration, persistence, storage key, hydration payload, or durable ordinal; base `TabEntry.label` stays unsuffixed.
- [x] **Business meaning:** current global 1-based open-list position, not creation order, pane order, duplicate-only count, profile index, durable ID, or PTY incarnation.
- [x] **Security/privacy/secrets/logging:** no opaque IDs, new command data, terminal output, secrets, telemetry, or logs exposed.
- [x] **Performance/concurrency/resource use:** one synchronous O(n) display projection from already-refreshed base tabs; no effects, polling, timers, network/PTY work, listeners, or persisted display state.
- [x] **Docs/config/onboarding/deployment:** update existing frontend behavior docs only; no config, onboarding, deployment, dependency, asset, or release-infrastructure change.

## Architecture

```text
internal openTabs: TabEntry[]                         identity/order owner
  label = unsuffixed base; sessionId = stable identity
        |
        +--> refresh live/free base labels
              missing free index -> "Terminal (starting…)"
        |
        `--> applyTerminalTitleOrdinals(baseTabs)
              DisplayTabEntry.title = {
                baseLabel: tab.label,
                ordinal: index + 1,
                fullText: `${tab.label} #${index + 1}`
              }
                    |
                    +--> TerminalTitleText
                    |     [truncating baseLabel] [non-shrinking #N]
                    |     + one fullText accessibility node
                    |       |- split-pane TabBar / legacy TerminalTabBar
                    |       |- runtime tree -> navigator open item
                    |       `- active compact/desktop header
                    |
                    `--> WorkspacePage browser target union
                          open-tab target -> { label: fullText, openTitle: title }
                          mounted-only target -> readable unsuffixed label

keys, callbacks, diagnostics, drag, PTY, navigation, handoff artifact -> sessionId
```

```ts
interface OpenTerminalTitle {
  baseLabel: string;
  ordinal: number;
  fullText: string;
}

type DisplayTabEntry = TabEntry & {
  title: OpenTerminalTitle;
};
```

- Keep `TabEntry.label` and hook-internal `openTabs` base-only. `TerminalManagerDerived.tabsWithLiveSession` becomes `DisplayTabEntry[]`; never pass projected tabs back to `setOpenTabs`.
- `applyTerminalTitleOrdinals(readonly TabEntry[]): DisplayTabEntry[]` creates fresh entries in current array order. It does not mutate, persist, strip, parse, or inspect label suffixes.
- `TerminalTitleText` owns the DOM/layout/accessibility contract. Consumers provide `OpenTerminalTitle`; they do not concatenate `#N`.
- Active header looks up the projected open tab by `activeSessionId`. If absent, retain readable mounted-session fallback without ordinal; if neither exists, show `No terminal selected`.
- Runtime tree carries optional structured `openTitle` only when its mounted item matches an open tab. Navigator renders `TerminalTitleText` for that case and its readable fallback otherwise; cwd remains tooltip precedence.
- Browser target union must index `tabsWithLiveSession`, not raw `state.openTabs`. Open match carries both `label: tab.title.fullText` for existing string consumers and `openTitle: tab.title` for structured narrow rendering; mounted-only fallback has no `openTitle` and remains readable/unsuffixed. `sessionId` remains target/artifact/selection identity.

## Related code files

### Create

- `packages/ui/src/lib/terminal-title.ts` and `packages/ui/src/lib/terminal-title.test.ts` — define/test `OpenTerminalTitle`, generic `WithOpenTerminalTitle<T>`, readable free-label helper, and pure ordinal projection in a dependency-neutral module.
- `packages/ui/src/components/atoms/TerminalTitleText.tsx` — shared two-part visual/one-string accessibility renderer; no dependency or asset.
- `packages/ui/browser-tests/terminal-title-ordinals.browser.tsx` — Chromium coverage for real title consumers, constrained-width suffix geometry, free pending copy, reorder/removal, accessibility text, browser handoff labels, and `sessionId` actions.

### Modify: production

- `packages/ui/src/components/organisms/TerminalTabBar.tsx` — export `DisplayTabEntry = WithOpenTerminalTitle<TabEntry>`; render the legacy title with `TerminalTitleText`; keep base `TabEntry` state shape.
- `packages/ui/src/lib/terminal-auto-attach.ts` — use `freeTerminalBaseLabel()` for readable missing-index hydration; keep auto-attach state and labels base-only.
- `packages/ui/src/hooks/use-terminal-manager.ts` — use the shared free-label helper; refresh base tabs, then derive `DisplayTabEntry[]` once as `tabsWithLiveSession`; keep `state.openTabs` and mutations unsuffixed.
- `packages/ui/src/components/organisms/TabBar.tsx` — require `DisplayTabEntry` at render boundary and use `TerminalTitleText` without changing drag/select/pin/close/diagnostics IDs or controls.
- `packages/ui/src/components/organisms/MultiTerminalDisplay.tsx`, `packages/ui/src/components/organisms/SplitLayout.tsx`, `packages/ui/src/components/organisms/PaneContainer.tsx` — carry `DisplayTabEntry[]` through pane props so a renderer cannot receive an unprojected title; behavior unchanged.
- `packages/ui/src/components/organisms/ActiveTerminalRuntimeDisplay.tsx` — accept display tabs, resolve projected title by `activeSessionId`, and render it in shared compact/desktop title; preserve mounted-only/no-selection fallbacks.
- `packages/ui/src/lib/terminal-runtime-tree.ts` — accept display tabs and copy structured `openTitle` onto matching `RuntimeSessionItem`; retain readable mounted-only fallback label.
- `packages/ui/src/components/organisms/TerminalRuntimeNavigatorItem.tsx` — render `openTitle` structurally; when absent use readable fallback, never raw ID; preserve cwd tooltip precedence and target sizing.
- `packages/ui/src/components/pages/WorkspacePage.tsx` — build the open half of `browserTerminalTargets` from `tabsWithLiveSession`, carrying `openTitle: tab.title` plus `label: tab.title.fullText`; keep mounted-only fallback and all `sessionId` fields/actions unchanged.
- `packages/ui/src/lib/browser-terminal-handoff.ts` — add optional frontend-only `openTitle?: OpenTerminalTitle` to `BrowserTerminalTarget`; preserve `label`, readiness, and identity fields.
- `packages/ui/src/components/organisms/BrowserDebugTerminalTargetList.tsx` — structurally render `openTitle` so its suffix cannot truncate; retain readable string fallback and replace visible raw-ID ready status with `Ready`.
- `docs/frontend-components.md` — document current global open-list semantics, structured truncation/accessibility contract, `Terminal (starting…)`, mounted-only handoff exception, and identity boundary.

### Modify: focused tests

- `packages/ui/src/lib/terminal-auto-attach.test.ts` — indexed and missing-index free base-label hydration behavior.
- `packages/ui/src/hooks/use-terminal-manager.test.ts` — base `state.openTabs` remains unsuffixed; derived tabs carry structured ordinals; absent then present free index transitions from `Terminal (starting…)` to `Terminal X`.
- `packages/ui/src/components/organisms/TabBar.test.ts`, `packages/ui/src/components/organisms/TerminalTabBar.test.tsx` — visible separate suffix, full accessible title text, unchanged select/close/pin/diagnostics `sessionId`.
- `packages/ui/src/components/organisms/ActiveTerminalRuntimeDisplay.test.tsx` — projected open title in compact/desktop plus readable unsuffixed mounted-only and no-selection fallbacks.
- `packages/ui/src/lib/terminal-runtime-tree.test.ts`, `packages/ui/src/components/organisms/TerminalRuntimeNavigatorItem.test.tsx` — structured title propagation/rendering, mounted-only fallback, cwd tooltip precedence, no raw-ID title.
- `packages/ui/src/components/pages/WorkspacePage.test.tsx` — browser target union: open target carries `openTitle` plus ordinal `label`; mounted-only target has readable unsuffixed `label` and no `openTitle`; target/callback identity remains raw `sessionId`.
- `packages/ui/src/components/organisms/BrowserDebugTerminalHandoff.test.tsx`, `packages/ui/src/lib/browser-terminal-handoff.test.ts` — open structured target versus mounted-only fallback rendering/readiness and raw `sessionId` callback identity.

### Verify without expected production edits

- `packages/ui/src/components/organisms/TerminalKeepAliveHost.tsx` — notification ordinal convention remains independent and unchanged.
- `docs/system-architecture.md` — existing notification/global-order identity guidance remains valid; no duplicate component-level renderer detail needed.

### Explicit no-change boundaries

- Backend: `server/src/api/terminal.rs`, `server/src/pty/session.rs`, `server/src/pty/manager.rs`.
- REST/API client and types: `packages/ui/src/api/client.ts`.
- WebSocket/transport event names and payloads: unchanged.
- Database, migrations, persisted tab/pin/config data: unchanged.
- Dependencies, visual assets, server tests, deployment: unchanged. If implementation evidence disproves a boundary, stop and revise this plan rather than expanding scope.

## Implementation Steps

1. **Define title policy in a neutral module.** Add `terminal-title.ts` with `OpenTerminalTitle`, `WithOpenTerminalTitle<T>`, `freeTerminalBaseLabel(index?: number)`, and generic `applyTerminalTitleOrdinals(readonlyTabs)`. The free helper returns `Terminal ${index}` when present and `Terminal (starting…)` when absent. The projector copies each input and assigns `{ baseLabel: tab.label, ordinal: index + 1, fullText: `${tab.label} #${index + 1}` }`; it never modifies/parses `label` or mutates input.
2. **Use the readable pending base everywhere.** Call `freeTerminalBaseLabel()` from both `sessionTabLabel()` and the free branch of `useTerminalManager.tabLabel()` so launch and hydration cannot emit `Terminal ?`. In `TerminalTabBar.tsx`, retain base `TabEntry` and export `DisplayTabEntry = WithOpenTerminalTitle<TabEntry>`.
3. **Implement one title renderer.** Add `TerminalTitleText`: outer `flex min-w-0` wrapper; one `sr-only` `fullText`; `aria-hidden` visual base with `min-w-0 truncate`; `aria-hidden` `shrink-0` suffix containing ` #N`. Allow consumer width/text classes without allowing the suffix to shrink or enter the truncating node. This component is the only visual open-title renderer.
4. **Project once at the state owner.** In `useTerminalManager()`, rename the current mapped array to `baseTabsWithLiveSession`, keep free/live refresh there, and derive `tabsWithLiveSession = applyTerminalTitleOrdinals(baseTabsWithLiveSession)`. Change `TerminalManagerDerived.tabsWithLiveSession` to `DisplayTabEntry[]`; leave `TerminalManagerState.openTabs`, `setOpenTabs`, hydration, equality, pins, and actions base-only.
5. **Carry and render the required projection.** Change render-path prop types in `MultiTerminalDisplay`, `SplitLayout`, `PaneContainer`, `TabBar`, and legacy `TerminalTabBar` to `DisplayTabEntry[]`. Replace concatenated label spans in both tab bars with `TerminalTitleText`; retain existing outer max widths, overflow, controls, drag data, keys, and callback arguments.
6. **Unify runtime titles.** Make `ActiveTerminalRuntimeDisplay.openTabs` display tabs, resolve `activeOpenTab` by `activeSessionId`, and pass its structured title to the shared compact/desktop `RuntimeActiveSessionTitle`. If no open match exists, keep `${project}: ${command}` for a mounted session and `No terminal selected` otherwise. In `buildRuntimeTree()`, set `RuntimeSessionItem.openTitle` only from a matching display tab; navigator renders it structurally, otherwise the readable fallback. Its tooltip stays `cwd: …` when cwd exists, then `openTitle.fullText`, then readable fallback. Change no tree IDs/order or actions.
7. **Correct and render the browser target union.** Extend frontend `BrowserTerminalTarget` with optional `openTitle`. In `WorkspacePage.browserTerminalTargets`, build `tabsById` from `tabsWithLiveSession`; for open matches set `label: tab.title.fullText` and `openTitle: tab.title`; for mounted-only entries set the readable `${mounted.project} · ${mounted.command}` label and omit `openTitle`. Remove the opaque raw-ID label fallback. In `BrowserDebugTerminalTargetList`, make the first row a min-width-constrained flex layout: render `openTitle` through `TerminalTitleText` as the flexible title, otherwise render the readable fallback, and keep any `Current terminal` marker outside the truncating base. Show `Ready` instead of the visible raw session ID; keep DOM/radio IDs, `sessionId`, readiness, prepare/discard/insert, and selection logic unchanged.
8. **Add focused unit/component tests.** Cover projection data for one/duplicate/reordered/removed tabs, numeric ordinal, exact `fullText`, unsuffixed source labels, and fresh reprojection without doubling. Cover indexed and missing-index free labels on launch/hydration and manager derived output. For each renderer, assert full accessible title text plus visible separate `#N`; assert select/close/pin/drag/diagnostics callbacks still receive the original `sessionId`. Cover active and runtime mounted-only fallback branches.
9. **Add browser-mode proof.** Render actual split `DraggableTab`, runtime navigator item, active title, and legacy tab component using a deliberately long duplicate base inside constrained fixtures. At normal and narrow widths, assert each suffix node's bounding box is visible and fully inside its clipping host while the base node is genuinely truncated (`scrollWidth > clientWidth`); assert title accessibility exposes `fullText`. Rerender after removal/reorder; assert suffixes update and click actions return raw session IDs. Include `Terminal (starting…) #N`. Exercise browser handoff target rendering with an open target (`#N`) and mounted-only readable unsuffixed fallback.
10. **Validate, review, and finalize during `/code`.** Run only the focused commands in Success Criteria, then UI build. Manually smoke the actual web surface, capture the required screenshot/recording, update `docs/frontend-components.md`, and review for one projection/renderer, suffix geometry, fallback distinction, identity boundaries, and every side-effect checkbox. Leave server/config/deployment docs unchanged.

## Todo list

- [x] Replace `Terminal ?` with shared `Terminal (starting…)` fallback.
- [x] Add structured `OpenTerminalTitle`/`DisplayTabEntry` projection without changing base state.
- [x] Add shared base-truncating, suffix-fixed, full-accessible-text renderer.
- [x] Carry display tabs through pane, runtime, active-title, legacy, and browser-open-target paths.
- [x] Keep mounted-only browser/runtime fallbacks readable and unsuffixed.
- [x] Add focused unit/component and Chromium narrow-geometry coverage.
- [x] Run focused validation and real browser smoke during implementation.
- [x] Complete side-effect/code review, docs update, and evidence capture.

## Success Criteria

- Current open tabs derive ordinals only from global `openTabs`; duplicate bases show distinct `#1`/`#2`, pane-local sequences may be non-contiguous, and attach/hydration/reorder/close/removal refresh without stale or doubled titles.
- Every open-title datum is `{ baseLabel, ordinal, fullText }`; base `TabEntry.label` remains unsuffixed. No regex/string parsing, stored ordinal, raw-ID substitution, or consumer-local suffix formatting.
- On split tab, navigator, active compact/desktop header, and legacy tab tests, a long base is truncated while the complete `#N` suffix remains visibly inside the constrained title host at the narrow test width. `fullText` is exposed once for title accessibility.
- Indexed free tabs remain `Terminal X #N`; missing-index pending tabs deliberately read `Terminal (starting…) #N`; `Terminal ?` never appears.
- Browser targets backed by current open tabs carry ordinal-bearing `openTitle` and `label: openTitle.fullText`; target rows keep `#N` visible at narrow widths. Mounted-only union entries remain readable and unsuffixed; they are not open titles. Neither branch visibly substitutes raw `sessionId`; ready status reads `Ready`.
- Runtime mounted-only fallback and `No terminal selected` remain understandable; cwd tooltip precedence, `min-h-11` navigator target sizing, close/pin/save/drag targets, and keyboard behavior remain unchanged.
- Every key, callback, target, diagnostics action, PTY action, and browser artifact operation still uses raw stable `sessionId`; reordered/removed-tab action assertions reach the intended session.
- Backend, REST/API, WebSocket, database, migration, persistence, config, dependency, asset, server-test, and deployment diffs remain empty.
- Focused verification responsibilities for implementation:

```bash
pnpm --filter @dam-hopper/ui test -- \
  src/lib/terminal-title.test.ts \
  src/lib/terminal-auto-attach.test.ts \
  src/hooks/use-terminal-manager.test.ts \
  src/components/organisms/TabBar.test.ts \
  src/components/organisms/TerminalTabBar.test.tsx \
  src/components/organisms/ActiveTerminalRuntimeDisplay.test.tsx \
  src/components/organisms/TerminalRuntimeNavigatorItem.test.tsx \
  src/lib/terminal-runtime-tree.test.ts \
  src/lib/browser-terminal-handoff.test.ts \
  src/components/organisms/BrowserDebugTerminalHandoff.test.tsx \
  src/components/pages/WorkspacePage.test.tsx
pnpm --filter @dam-hopper/ui test:browser -- browser-tests/terminal-title-ordinals.browser.tsx
pnpm --filter @dam-hopper/ui build
```

- Browser smoke: start the actual UI/server; open two same-command terminals across panes and verify global visible `#1/#2` in pane tabs, runtime navigator, active header, and browser handoff picker. Narrow each title host, including the handoff picker, until the long base truncates; verify `#N` stays visible and full title remains available to accessibility inspection. Close the first and reorder if available; verify ordinals update, then select/close/pin/open diagnostics and confirm the intended session. Open a free terminal and observe readable pending/indexed copy. Legacy strip has no known live consumer, so its renderer contract is proved by focused component/browser fixture rather than fabricated manual reachability.

## Risk Assessment

| Risk | Impact | Mitigation |
|---|---|---|
| Concatenated title remains inside one truncating node | Distinguishing `#N` disappears at narrow widths | Required structured title plus shared flex renderer; browser asserts suffix geometry and actual base overflow. |
| Projected title is stored/reprojected | Stale/doubled ordinals | Keep `state.openTabs` base-only; project fresh from `baseTabsWithLiveSession`; assert source labels and rerenders. |
| Optional/loose tab typing lets an unprojected tab reach a renderer | Missing suffix or fallback drift | Require `DisplayTabEntry[]` through render-path props and `OpenTerminalTitle` in shared renderer. |
| Hidden visual fragments and accessibility copy are both announced | Duplicate/misleading screen-reader title | Hide visual fragments from accessibility; expose `fullText` once; assert accessible title content. |
| Missing free index produces `Terminal ?` or guessed number | Unexplained/incorrect transient UI | One shared `freeTerminalBaseLabel`; deliberate `Terminal (starting…)`; test missing-to-present transition. |
| Browser union keeps raw base tabs | Open handoff target lacks ordinal | Index `tabsWithLiveSession`; focused test open and mounted-only branches. |
| Mounted-only fallback is incorrectly forced into open ordinal sequence | False contract or unstable invented number | Add ordinal only on open-tab match; preserve readable unsuffixed mounted fallback and test it. |
| Pane-local indexing or ordinal used as identity | Conflicting numbers or wrong action target after reorder | Project before pane partitioning; preserve every key/callback/target `sessionId`; action tests after reorder/removal. |
| Active header/runtime tree keeps independent formatting | Cross-surface drift | Resolve/carry the same `OpenTerminalTitle`; no local concatenation; compact/desktop/tree tests. |
| Unexpected backend/transport dependency | Scope and compatibility regression | Stop and revise plan if implementation evidence disproves explicit frontend-only boundaries. |

## Security Considerations

- No auth, authorization, permission, CORS, API, WebSocket, or server-session changes.
- `fullText` combines the already-visible base label with a current list position; it introduces no new server/user data.
- Do not expose `SessionInfo.id`, incarnation, timestamps, terminal output, full command arguments, filesystem paths, secrets, or credentials in new titles/logs.
- Keep diagnostics and browser handoff identity opaque and stable internally (`sessionId`) but never substitute it for user-facing fallback text.
- Labels remain escaped React text nodes. Never parse user-controlled label text to recover ordinal or identity.

## Next steps

1. Implementation completed in `/code`; structured titles now flow through all listed surfaces.
2. Focused unit tests, Chromium title tests, the UI build, and live browser smoke completed. The package browser wrapper still reports unrelated existing SSH-switch and replay-import failures.
3. UX and code review completed with no remaining critical or major title-implementation findings.
4. `docs/frontend-components.md` updated; plan and phase closed.
5. No migration, rollout, flag, backend deployment, asset, or dependency work.

## Unresolved questions

None.
