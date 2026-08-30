# Phase 01: Project-Scoped Terminal Title Ordinals

## Context links

- [Plan overview](./plan.md)
- [Correction preflight](../reports/preflight-260829-2226-project-scoped-terminal-title-ordinals.md)
- [Completed prior plan](../260829-2106-terminal-title-ordinals/plan.md) and [prior phase](../260829-2106-terminal-title-ordinals/phase-01-terminal-title-ordinal-display.md)
- Scout evidence: `agent://ScoutProjectScopedOrdinals` and `history://ScoutProjectScopedOrdinals`
- [Repository guidance](../../AGENTS.md)
- [Frontend behavior](../../docs/frontend-components.md)
- [System architecture](../../docs/system-architecture.md)

## Overview

- **Date:** 2026-08-29
- **Priority:** P2
- **Plan status:** Completed
- **Phase status:** Completed
- **Effort:** 3h
- **Outcome:** Open-terminal titles retain current structured rendering but receive a 1-based ordinal within their exact project group, evaluated in global `openTabs` order.

## Key Insights

- `buildTerminalDisplayTabs()` currently refreshes labels/session data, then `applyTerminalTitleOrdinals()` uses global array index. Projection location is correct; grouping is not.
- `TabEntry` lacks project metadata. `openTerminalTab(project, ...)` already receives the stable project but discards it after label construction. `tabForSession()` has `SessionInfo` and `sessionProject()` but also discards the project.
- Labels are presentation strings: profile underscores are transformed, command labels are reduced, and project/profile text can contain separators. Never parse `label` to recover a project.
- Global `openTabs` remains the order authority. Iterate it once; maintain one counter per grouping key. Do not sort, partition, or mutate tabs.
- Free/projectless tabs share one module-stable sentinel that cannot collide with a real project string. Their `Terminal X`/pending labels are not grouping keys.
- Title order and notification order are intentionally different: titles count per project; `TerminalKeepAliveHost` keeps global `openTabs.findIndex(...) + 1` notification `terminalOrder`.
- `OpenTerminalTitle`, `TerminalTitleText`, every current renderer, browser open-title handoff, and mounted-only fallback are already correct. Avoid a second renderer or consumer-local suffix logic.

## Requirements

### Preflight contract

- Group by exact stable project key; preserve current global `openTabs` order within every group; assign 1-based ordinals.
- Interleaved `[A1, B1, A2, B2]` displays ordinals `[1, 1, 2, 2]`. Reorder/close/removal/hydration recomputes from current metadata and order.
- Add `project?: string` (or equally explicit optional project field) to `TabEntry`. Populate it on all production creation/hydration paths; do not require all test fixtures to set it.
- Pending project tabs use the `project` already passed to `openTerminalTab()`. Hydrated/auto-attached project tabs use authoritative `SessionInfo.project`, with existing `sessionProject()` parsed-session fallback where needed.
- Free or otherwise projectless tabs use one stable internal sentinel. Empty/missing metadata must never use the display label or `sessionId` as the project key.
- Keep base `label` unsuffixed. Preserve structured `{ baseLabel, ordinal, fullText }`; `fullText` stays `${baseLabel} #${ordinal}`.
- Preserve `sessionId` as identity for React keys, selection, close, pin, drag, diagnostics, PTY attachment, notification navigation, and browser artifacts.
- Existing suffix-safe renderer/consumers remain. Mounted-only browser/runtime fallbacks stay readable and unsuffixed.
- No backend/API/WebSocket/PTY/database/persistence/config/dependency changes. No notification-order changes.

### Side-effect review checklist

- [x] **Identity:** `sessionId` and identity-bearing keys/callbacks unchanged; project metadata is display grouping only.
- [x] **Ordering semantics:** `openTabs` array order unchanged; title counters are per project; notification `terminalOrder` remains global.
- [x] **Metadata coverage:** pending project tabs, hydrated existing tabs, auto-attached tabs, and live `SessionInfo` refresh all produce a stable grouping value.
- [x] **Fallbacks:** free/projectless tabs share one collision-safe sentinel; no label parsing and no opaque ID exposure.
- [x] **Rendering/accessibility:** existing `TerminalTitleText` keeps base truncation, visible non-shrinking suffix, and one accessible `fullText`.
- [x] **Browser/runtime:** open handoff target keeps `openTitle` plus `label: fullText`; mounted-only fallback remains unsuffixed; actions still return the same `sessionId`.
- [x] **Auth/security/privacy:** no auth, permission, transport, terminal output, secret, logging, or telemetry change.
- [x] **Persistence/data:** no schema, migration, durable ordinal, storage key, or server-session lifecycle change.
- [x] **Performance:** one O(n) projection and O(p) counter map, where `p` is visible project groups; no sorting, effects, timers, network, or extra render state.
- [x] **Operations:** no config, dependency, deployment, onboarding, asset, notification, or architecture-boundary change.

## Architecture

```text
openTabs: TabEntry[] (global current order; sessionId identity)
  |
  +-- creation: openTerminalTab(project) --------> TabEntry.project
  +-- hydration: SessionInfo -> sessionProject() -> TabEntry.project
  +-- free/projectless --------------------------> missing project metadata
  |
  `-- buildTerminalDisplayTabs(): refresh base label/session/project
        |
        `-- applyTerminalTitleOrdinals(baseTabs)
              counters: Map<exact project string | stable sentinel, number>
              A1 -> #1, B1 -> #1, A2 -> #2, B2 -> #2
              title = { baseLabel, ordinal, fullText }
                    |
                    +-- existing TerminalTitleText consumers
                    `-- existing browser open-title handoff

notification terminalOrder = global openTabs index + 1 (separate; unchanged)
all keys/actions/navigation/artifacts = sessionId (unchanged)
```

- Keep grouping in the single outward projection before pane/runtime partitioning. This ensures all consumers see one title contract.
- Prefer a module-local `Symbol` sentinel (or another collision-proof constant) over a magic user-reachable string. Preserve project strings exactly; do not case-fold, trim, or use worktree path as a separate group.
- `buildTerminalDisplayTabs()` should use explicit `tab.project` first, then hydrated session project metadata for non-free tabs. `tabForSession()` should populate the existing `sessionProject()` result. Free tabs deliberately remain in the sentinel group.
- Include `project` in `sameOpenTabs()` equality so metadata hydration cannot be discarded as an apparently unchanged tab list.

## Related code files

### Modify

| Current path | Change |
|---|---|
| `packages/ui/src/components/organisms/TerminalTabBar.tsx` | Add documented optional project presentation-group metadata to `TabEntry`; keep `DisplayTabEntry` and renderer untouched. |
| `packages/ui/src/lib/terminal-title.ts` | Replace global index ordinal with one-pass exact-project counters plus collision-safe projectless sentinel; preserve output types and `fullText`. |
| `packages/ui/src/lib/terminal-title.test.ts` | Replace global-order assertion; cover same/cross-project sequences, reorder/removal, duplicate labels, sentinel fallback, immutability, identity. |
| `packages/ui/src/hooks/use-terminal-manager.ts` | Preserve project on pending creation, hydrate projection metadata from live sessions, and compare project in `sameOpenTabs()`. |
| `packages/ui/src/hooks/use-terminal-manager.test.ts` | Cover explicit pending project, `SessionInfo.project` fallback, interleaving, and free/projectless grouping. |
| `packages/ui/src/lib/terminal-auto-attach.ts` | Populate non-free `TabEntry.project` via existing `sessionProject()` during discovery/hydration; leave free tabs projectless. |
| `packages/ui/src/lib/terminal-auto-attach.test.ts` | Assert authoritative project and parsed fallback propagation, pending hydration, free projectless behavior. |
| `packages/ui/browser-tests/terminal-title-ordinals.browser.tsx` | Add two-project reset and reorder/close fixture; retain suffix geometry, accessible text, handoff, and callback identity assertions. |
| `docs/frontend-components.md` | Correct title section to per-project sequences and explicitly distinguish unchanged global notification ordering. |

### Review as explicit no-change boundaries

| Current path | Invariant |
|---|---|
| `packages/ui/src/components/atoms/TerminalTitleText.tsx` | Existing suffix-safe/accessibility renderer remains the only renderer. |
| `packages/ui/src/components/pages/WorkspacePage.tsx` | Open targets continue using projected `title/fullText`; mounted-only fallback remains unsuffixed. |
| `packages/ui/src/lib/terminal-runtime-tree.ts` | Continue forwarding projected `openTitle`; no grouping logic here. |
| `packages/ui/src/components/organisms/TerminalKeepAliveHost.tsx` | Preserve global notification `terminalOrder`. |
| `packages/ui/src/components/organisms/TerminalKeepAliveHost.test.tsx` | Existing global notification-order expectations remain unchanged. |
| `packages/ui/src/lib/browser-notification-service.test.ts` | Existing global notification title/order expectations remain unchanged. |
| `docs/system-architecture.md` | Existing global notification-order documentation remains correct; no architecture edit needed. |

### Create/delete

- Production/test/docs files created: none.
- Files deleted: none.
- Only these plan artifacts are new.

## Implementation Steps

1. **Extend the tab contract and production metadata paths.**
   - Add optional `project` metadata to `TabEntry` with a comment that it is frontend title-grouping context, never server identity.
   - In `openTerminalTab()`, set `project` for non-free project-backed sessions while preserving label, session, saveability, and insertion order.
   - In `tabForSession()`, set non-free `project` from `sessionProject(session)` so authoritative `SessionInfo.project` wins and the existing parsed-ID fallback remains available.
   - When `buildTerminalDisplayTabs()` obtains a newer session, resolve explicit tab metadata first and live session metadata second for non-free tabs; leave free/projectless tabs unset.
   - Add `project` to `sameOpenTabs()` equality. Do not add persistent or transport fields.

2. **Change only title grouping.**
   - Update the helper input constraint to accept optional project metadata.
   - Iterate once in supplied array order. Resolve grouping key to exact non-empty project or the module-stable projectless sentinel; increment that key's count.
   - Create fresh tab/title objects with unchanged `label` and `sessionId`; set `ordinal` and `fullText` from that group's count.
   - Do not sort, mutate, partition by pane, parse labels, or modify `OpenTerminalTitle`/`WithOpenTerminalTitle`.

3. **Lock metadata and algorithm contracts with focused unit tests.**
   - Helper: interleaved A/B (`#1,#1,#2,#2`), same-project duplicate labels (`#1/#2`), exact key behavior, reordered list, close/removal renumber, missing/empty/free sentinel, source immutability, preserved `sessionId`.
   - Manager: pending explicit metadata, live `SessionInfo.project` fallback, cross-project reset, pending free label and sentinel behavior.
   - Auto-attach: `SessionInfo.project` precedence, parsed project fallback when absent, existing-tab hydration, and free tab remaining projectless.

4. **Prove existing surfaces without changing their production renderers.**
   - Extend Chromium fixture to render interleaved projects and a state transition that reorders or closes a tab.
   - Assert project A shows `#1/#2`, project B independently shows `#1`; after close/reorder, only current within-project positions determine titles.
   - Keep narrow-width assertions: base actually truncates, suffix stays visible, and each title exposes exactly one accessible `fullText`.
   - Keep browser handoff assertions: open target uses corrected structured `openTitle`/`fullText`, mounted-only target stays readable and unsuffixed, and selecting/closing still emits the original `sessionId`.

5. **Correct documentation and run scoped verification.**
   - Update only `docs/frontend-components.md` title semantics. State clearly that title numbering is per project while notification context numbering remains global.
   - Run focused Vitest files for helper, manager, and auto-attach; run the title Chromium browser file.
   - Start the real web UI and open at least two projects with two terminals in one project and one in another. Observe A `#1/#2`, B `#1`; close/reorder and observe recomputation; inspect a narrow title and browser handoff row. Confirm actions affect the intended original session.
   - Do not run project-wide suites during implementation. Final integrator may run broader checks once all work lands.

## Todo list

- [x] Add and populate optional `TabEntry.project` metadata on every production path.
- [x] Preserve project changes through `sameOpenTabs()` reconciliation.
- [x] Replace global index with exact-project counters and stable projectless sentinel.
- [x] Update helper, manager, and auto-attach unit coverage.
- [x] Extend Chromium cross-project/reorder/accessibility/handoff coverage.
- [x] Update frontend behavior docs; preserve notification architecture docs.
- [x] Run scoped unit and browser tests.
- [x] Complete actual two-project browser smoke and record observed results.
- [x] Review no-change boundaries and confirm no identity/transport/order drift.

## Success Criteria

- `[A1, B1, A2, B2]` projects to title ordinals `[1, 1, 2, 2]` without changing array order.
- Closing A1 makes A2 `#1`; B's current sequence remains derived only from B tabs. Reordering within a project recomputes that project's 1-based sequence.
- Pending tabs group by explicit creation project; hydrated tabs group by authoritative `SessionInfo.project`/existing `sessionProject()` fallback.
- Free, missing-project, and empty-project tabs use the documented stable sentinel policy; none derive grouping from label, transient `Terminal X`, or `sessionId`.
- Duplicate base labels inside one project remain distinguishable by `#1/#2`; identical labels across projects may each show `#1`.
- `baseLabel`, `fullText`, renderer geometry, one accessible full-title string, mounted-only fallback, and browser open-title behavior remain correct.
- Every identity-bearing assertion still observes the same `sessionId`; no title/project ordinal is used for identity.
- `TerminalKeepAliveHost` notification order remains the global open-list position and its existing tests remain unchanged.
- Focused unit/browser checks pass; actual Chromium smoke demonstrates two independent project sequences and close/reorder recomputation.
- Diff contains only listed frontend source/tests/doc plus this plan; no backend, API, WebSocket, PTY, database, config, dependency, or unrelated files.

## Risk Assessment

| Risk | Impact | Mitigation |
|---|---|---|
| Pending tab omits project before session hydration | Wrong sentinel `#N`, then visible jump | Populate at `openTerminalTab()` immediately; manager test pre-hydration state. |
| Hydration update lost by equality check | Stale grouping | Compare `project` in `sameOpenTabs()`; auto-attach/manager tests. |
| Real project name collides with fallback marker | Groups unrelated tabs | Use a collision-proof module-local sentinel, not a magic string. |
| Free tabs accidentally inherit active project | Free ordinals mix with project terminals | Explicit free-type branch leaves project unset; test with project-bearing `SessionInfo`. |
| Parsing display labels appears convenient | Ambiguous/lossy grouping | Ban label parsing in requirements and review; source project/session metadata only. |
| Helper sorts/groups the array | Pane order, drag, callbacks change | One-pass counters over input order; assert returned `sessionId` order. |
| Notification code adopts title semantics | Product behavior regression | No edits to keep-alive/notification tests; document separate order rules. |
| Consumer fixtures omit optional metadata | Accidental broad test churn | Keep field optional; sentinel provides deterministic fallback. |

## Security Considerations

- No new trust boundary, auth decision, permission, transport payload, persistence, or server input.
- Project metadata already exists in frontend session/tree state; use it only for presentation grouping. Do not expose raw session IDs, terminal output, commands, cwd, secrets, or worktree paths through titles.
- Exact project strings are data, not HTML. Continue React text rendering through existing `TerminalTitleText`; add no `dangerouslySetInnerHTML` or string-to-selector behavior.
- Ordinals and project names remain non-authoritative. All actions/navigation/browser artifacts continue validating and addressing stable `sessionId`.
- No new logs, diagnostics, telemetry, browser permission requests, or notification payload changes.

## Next steps

1. Implementation completed; metadata and per-project projection now flow through the existing title pipeline.
2. Scoped unit tests, Chromium fixture, UI TypeScript build, and live browser smoke passed. The live smoke opened two terminals in `clickstream`, one in `compare-diff`, observed `clickstream:bash #1/#2` and `compare-diff:bash #1`, then cleaned up those smoke sessions.
3. Code and UX reviews pass with no critical, major, or production-minor findings; only minor test-coverage gaps remain.
4. Existing frontend behavior documentation updated to distinguish title and notification numbering.
5. No migration, rollout, flag, backend deployment, asset, or dependency work.

## Unresolved questions

None. The preflight resolves project grouping, projectless/free sentinel behavior, notification separation, and identity preservation.
