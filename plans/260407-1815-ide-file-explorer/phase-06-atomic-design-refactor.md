# Phase 06 — Atomic design refactor of `packages/web/src/components/`

## Context links

- Parent: [plan.md](./plan.md)
- Related: [phase-03-web-ide-shell-readonly.md](./phase-03-web-ide-shell-readonly.md) (consumes clean tiers)
- Sequencing: SHOULD merge BEFORE Phase 03 ships so new IDE files land in correct tiers (avoid double-move). Phase number kept as 06 to avoid renumber churn.

## Overview

Date: 2026-04-07. Status: done (2026-04-08). Pure refactor — zero behavior change. Eliminates two domain-named folders (`agent-store/`, `server-connection/`) and the lone kebab-case file. Reclassifies misplaced organisms. Establishes atomic-design rules for all future components (including IDE work in Phases 03-05).

Priority: P3 (blocker for Phase 03 placement quality, but not for feature). Implementation: done (2026-04-08). Review: done (2026-04-08).

## Key Insights

- `agent-store/` and `server-connection/` are domain folders, not atomic tiers — violate the existing `atoms/molecules/organisms/templates/` convention.
- Only **2 consumer files** import from these dirs (`pages/AgentStorePage.tsx`, `organisms/Sidebar.tsx`) — codemod is trivial.
- 7 of 8 `agent-store/*` files are organisms (data-fetching, dialogs, complex panels). `HealthStatus` also organism (calls `useAgentStoreHealth`).
- `server-settings-dialog.tsx` is the only kebab-case file in components — rename to `ServerSettingsDialog.tsx` for consistency.
- `OverviewCard` is a true molecule (icon atom + text, no fetching) — keep.
- `PassphraseDialog` is an organism (controlled form, validation, callbacks) — keep.
- New IDE components (Phase 03-05) should land in tiers from day one: `IdeShell` → template, `FileTree`/`MonacoHost`/`LargeFileViewer`/`EditorTabs` → organisms, `EditorTab` → molecule.

## Requirements

**Functional**
- All component files live under exactly one of: `atoms/`, `molecules/`, `organisms/`, `templates/`.
- No domain-named subfolders under `components/`.
- All component files PascalCase.
- All imports updated; `pnpm build` + `pnpm lint` green.

**Non-functional**
- Zero runtime behavior change.
- No new dependencies.
- Single PR, mergeable in <1 day.

## Architecture

**Classification rules**
- **Atom**: single-purpose, primitive props only, no hooks beyond `useState` for local UI, no data fetching, no business logic.
- **Molecule**: ≤3 atoms composed for one focused purpose, minimal local state, no global data fetching.
- **Organism**: complex state, data fetching (`useQuery`/`useMutation`), forms, dialogs, panels composing many molecules/atoms.
- **Template**: page-level layout, slot/children based, no business logic. (`AppLayout`, future `IdeShell`)
- **Page**: route-level — lives in `pages/`, NOT `components/`.

**Target tree**

```
packages/web/src/components/
├── atoms/         # 8 existing + future FileIcon (TBD)
├── molecules/     # OverviewCard + future EditorTab
├── organisms/     # 11 existing + 7 from agent-store + ServerSettingsDialog + future FileTree, MonacoHost, etc.
└── templates/     # AppLayout + future IdeShell
```

## Related code files

**Move (rename + relocate)**

| Source | Target | Reason |
|---|---|---|
| `components/agent-store/DistributionMatrix.tsx` | `components/organisms/DistributionMatrix.tsx` | data-fetching panel |
| `components/agent-store/HealthStatus.tsx` | `components/organisms/HealthStatus.tsx` | uses `useAgentStoreHealth` |
| `components/agent-store/ImportDialog.tsx` | `components/organisms/ImportDialog.tsx` | dialog + form + mutations |
| `components/agent-store/ItemDetail.tsx` | `components/organisms/ItemDetail.tsx` | data fetching + actions |
| `components/agent-store/MemoryEditor.tsx` | `components/organisms/MemoryEditor.tsx` | editor + mutations |
| `components/agent-store/ShipDialog.tsx` | `components/organisms/ShipDialog.tsx` | dialog + form |
| `components/agent-store/StoreInventory.tsx` | `components/organisms/StoreInventory.tsx` | list + filters |
| `components/server-connection/server-settings-dialog.tsx` | `components/organisms/ServerSettingsDialog.tsx` | dialog + form + PascalCase rename |

**Audit (verify existing placement; no move expected)**
- `atoms/*` — all 8 confirmed atoms.
- `molecules/OverviewCard.tsx` — confirmed molecule.
- `organisms/PassphraseDialog.tsx` — confirmed organism (form, validation).
- `organisms/ConfigEditor.tsx`, `GlobalConfigEditor.tsx`, `ProjectInfoPanel.tsx`, `Sidebar.tsx`, `WorkspaceSwitcher.tsx`, `TerminalPanel.tsx`, `TerminalTabBar.tsx`, `TerminalTreeView.tsx`, `MultiTerminalDisplay.tsx`, `ProgressList.tsx` — confirmed organisms.
- `templates/AppLayout.tsx` — confirmed template.

**Consumers needing import updates** (verified via grep)
- `packages/web/src/pages/AgentStorePage.tsx` — 7 imports from `@/components/agent-store/*`
- `packages/web/src/components/organisms/Sidebar.tsx` — 1 import from `@/components/server-connection/server-settings-dialog`

**Delete after move**
- `packages/web/src/components/agent-store/` (empty dir)
- `packages/web/src/components/server-connection/` (empty dir)

## Implementation Steps

1. **Verify zero in-flight branches touch `agent-store/` or `server-connection/`** — check `git branch -a` and any open PRs. If conflicts, coordinate merge order.
2. **Move agent-store files** — `git mv` each of the 7 files into `components/organisms/`. Preserves history.
3. **Move + rename server-settings-dialog** — `git mv components/server-connection/server-settings-dialog.tsx components/organisms/ServerSettingsDialog.tsx`.
4. **Update `pages/AgentStorePage.tsx`** — replace 7 import paths:
   - `@/components/agent-store/StoreInventory.js` → `@/components/organisms/StoreInventory.js`
   - (apply same pattern to ItemDetail, DistributionMatrix, ShipDialog, HealthStatus, MemoryEditor, ImportDialog)
5. **Update `components/organisms/Sidebar.tsx`** — replace import:
   - `@/components/server-connection/server-settings-dialog.js` → `@/components/organisms/ServerSettingsDialog.js`
6. **Codemod safety net** — `grep -rn "components/agent-store\|components/server-connection" packages/web/src` returns empty.
7. **Delete empty dirs** — `rmdir packages/web/src/components/agent-store packages/web/src/components/server-connection`.
8. **tsconfig / vite alias check** — `packages/web/tsconfig.json` and `packages/web/vite.config.ts` should reference only `@/*`. No tier-specific aliases expected; verify no hard-coded paths.
9. **Lint + build** — `pnpm lint` (web) + `pnpm build` (web). Both must pass.
10. **Manual smoke** — start dev server, navigate Agent Store page, open Ship dialog, open Settings dialog from Sidebar — all render unchanged.
11. **(Defer) barrel `index.ts`** — NOT introduced this phase. YAGNI; current explicit imports work fine. Reconsider only if tier sizes grow >20 files.

## Todo list

- [x] Branch coordination check
- [x] `git mv` 7 agent-store files → organisms
- [x] `git mv` + rename ServerSettingsDialog
- [x] Update AgentStorePage imports (7)
- [x] Update Sidebar import (1)
- [x] Verify grep returns empty
- [x] Delete empty dirs
- [x] tsconfig/vite alias audit
- [x] `pnpm lint`
- [x] `pnpm build`
- [x] Manual smoke test

## Success Criteria

- 0 files under `packages/web/src/components/` outside the 4 atomic tiers.
- 0 kebab-case files under `components/`.
- `grep -r "components/agent-store\|components/server-connection" packages/web/src` returns empty.
- `pnpm lint` exits 0.
- `pnpm build` exits 0.
- Agent Store page + Settings dialog render and function identically post-refactor.

## Risk Assessment

| Risk | Likelihood | Impact | Mitigation |
|---|---|---|---|
| Merge conflict with in-flight branches | M | M | Sequence: do refactor when no parallel feature touches these files; coordinate before starting |
| Missed import path | L | M | grep guard + build catches |
| Circular dep introduced by collapsing tiers | L | L | atoms→molecules→organisms→templates one-way only; existing imports already obey this |
| Loss of git history on rename | L | L | use `git mv`, not delete+create |
| IDE auto-imports stale during development | L | L | restart TS server post-merge |

## Sequencing options

**Option A — BEFORE Phase 03 (RECOMMENDED)**
- Pros: New IDE components (FileTree, MonacoHost, IdeShell, etc.) land in correct tiers from day one. Phase 03-05 dev sees clean tree. No double-move later.
- Cons: Adds ~0.5d delay before IDE work starts.

**Option B — AFTER Phase 05**
- Pros: IDE feature ships faster. Refactor runs on a stable codebase (no IDE flux).
- Cons: ~14 new IDE files would need to move. Doubles risk of import churn.

**Decision: Option A.** Refactor first.

## Security Considerations

None. Pure code reorganization — no auth, sandbox, or dependency surface changes.

## Next steps

After merge, Phase 03 starts with clean tier structure. New IDE components placed per Phase 03/04/05 "Related code files" sections (already updated to use atomic paths).
