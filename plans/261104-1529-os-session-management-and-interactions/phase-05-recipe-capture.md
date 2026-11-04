# P05 — Explicit Recipe source, target and capture preview

Priority P2 · Status pending · Effort 12h · Owner RecipeOwner.

## Context, parallelization and prerequisites
Read [C4](architecture-contracts.md), [Recipe evidence](reports/recipe-interaction-evidence.md), [approved source/target requirements](../reports/brainstorm-261104-1231-os-session-management-and-interactions.md#workstream-b-recipe-target-and-capture-usability), existing `RecipeEditor.tsx:28-87,249-376`, `recipe-engine.ts:32-120,446-505`, schema/types/persistence and current browser/Recipe tests.
After completed `freeze-shared-contracts`, concurrent with P02/P03/P06. RecipeOwner exclusive; no shared OsShell/types/store/primitive edits. No unfinished discovery/schema prerequisite: existing aggregate project/profile APIs are read-only inputs. P04 waits this branch terminal.

## Requirements and architecture
Selected source desktop is explicit local capture state independent of active navigation. Candidate pairs derive ONLY from actual project-bearing windows on that source, canonical `(profileId,projectId)`, including same-project worktrees. Discovery decorates/supplements; never creates match authority or overwrites deliberate choices. Local capture may work offline; launch gate stays separate. Preserve RecipeV1/persistence and terminal-only executor limits.

### Task `recipe-source-target-capture`
**Modify:** `packages/ui/src/os/recipes/RecipeEditor.tsx`, `packages/ui/src/os/recipes/recipe-engine.ts`, `packages/ui/src/os/recipes/recipe-engine.test.ts`, `packages/ui/src/os/apps/RecipesApp.tsx`, `packages/ui/browser-tests/os-recipes.browser.tsx`. **Create:** `packages/ui/src/os/recipes/recipe-source-context.ts`, `packages/ui/src/os/recipes/recipe-source-context.test.ts`. **Delete:** none. New pure candidate projection is the actual seam shared by selector and exclusion preview, not a generic discovery abstraction. Existing `types.ts`, `schema.ts`, `persistence.ts`, `LaunchReview.tsx`, `launch-records.ts` intentionally unchanged: no required persisted projection or executor fix is identified.

1. Pass available desktops and window contexts to editor from RecipesApp; initialize explicit `sourceDesktopId` once. Navigating shell does not reset it or authored commands. Source deleted or no longer valid -> actionable source-unavailable state, not auto-rebind; changing source explicitly recomputes candidates and preview without moving windows.
2. Project actual source windows into counted canonical pairs. Exclude contextless/fleet utilities from eligibility, including `recipes`, `system-monitor`, `settings`, `agent-hub`. Show server/project readable names, stable ID suffix/disambiguator for duplicate names, counts and disconnected/missing-profile indicators. Include same-project worktrees without inventing new project contexts. Missing profile remains an offline eligible local identity with warning, not rebound to a configured profile sharing its name.
3. Controlled Source desktop -> Server -> Project selectors using installed Select patterns; no raw internal-ID entry for normal flow. Initial default only when source desktop default matches an eligible pair, otherwise sole eligible pair; mixed candidates require explicit choice. Selecting server narrows project choices; never independently compose ambient profile/project. Actual profile/project context identity determines matching, not display name.
4. Existing project discovery supplements options/labels with explicit zero matches; list source-context suggestions first. Track user selection revision so late discovery or reconnect cannot overwrite deliberate context or command text. Discovery failure/offline not a capture blocker when local source matches. No new poll loop; reuse available project/profile data. Save gate requires nonempty included subset; launch connectivity gate unchanged.
5. Preview EVERY source window as included/excluded, with name and reason: matched canonical context, different server/project, contextless/fleet utility, missing context/unsupported capture. Display same-project worktree inclusion. Fleet-only/no project windows, valid windows on different desktop and different selected context are distinct empty states with explicit source/context choices. No silent omissions, automatic context switching, empty save or source mutation.
6. Preserve required user-authored terminal commands and bind confirmation to exact current command value (`confirmedCommandByStep` stores confirmed text/value fingerprint, not boolean detached from text). Every edit invalidates that step's confirmation; undo to previously confirmed text only accepted after explicit review per current editor action, not stale checkbox. Source/context change must not misassociate step-key confirmation with a different command/window. JSON import inert; export retains warning that commands/paths may contain secrets. Do not claim exports secret-free.
7. State clearly capture/specification != complete execution/restoration. Keep AC8 missing app/layout/live-adoption and F1 unknown-create/concurrency/post-await limitations documented as predecessor gates. No executor or launch-lock/storage transaction repair in this phase.
8. Tests: pure projection/default/exclusion cases with hand-written independent expected sets; delayed discovery and value-bound confirmation in rendered browser editor. Cover empty, fleet-only, sole/mixed pairs, duplicate names, same-project worktrees, offline/missing profile, different source desktop, source removal, late results and command edits. Replace old raw-field/incidental-default assertions instead of re-pinning. Do not add tests that merely restate schema or wiring.

## Consumer-visible acceptance and exact future checks
A sole eligible context saves without typing IDs; mixed contexts require counted explicit choice; user selection survives navigation/discovery. All exclusions visible before Save, local offline capture works, and source windows remain byte-for-byte unchanged in layout/ownership.
P08: `pnpm --filter @dam-hopper/ui test -- src/os/recipes/recipe-source-context.test.ts src/os/recipes/recipe-engine.test.ts src/os/recipes/schema.test.ts src/os/recipes/launch-records.test.ts`; `pnpm --filter @dam-hopper/ui test:browser -- browser-tests/os-recipes.browser.tsx`; authenticated row 2 plus actual import/edit/save/export app journey P08. Existing schema/launch-record tests remain regression evidence only, never certification of AC8/F1.

## Failure, rollback, security and resources
A stale/deleted source or empty match disables Save with recovery choices; never fetch/launch to manufacture candidates. Offline labels avoid leaking credentials or relabeling identity. No persisted format change, automatic launch, new resources or backend mutation for capture. Rollback returns previous editor code only as whole scoped change; never restore silently composed ambient defaults in a partially deployed feature. Retain user drafts when choices invalidate. Human review must inspect compact viewport selectors/preview without clipped controls.

All checks below are FUTURE implementation checks, executed once by P08 after branches and integration land, not by this plan author or mid-flight workers. Read installed test principles before execution; retain failures/skips/blocks. No Git, dependencies, release or implementation authorization is conveyed by this phase. Root for all literal paths: `/home/loidinh/WS/dam-hopper`. Escalate any additional writable path before editing; no directory-wide permissions. No source file deletions unless explicitly listed. Existing incidental-wording/default assertions must be replaced/deleted for changed semantics, not re-pinned; add permanent tests only for named behavioral risks.

## Durable tasks

```evcrate-tasks
[
  {
    "id": "recipe-source-target-capture",
    "title": "Implement explicit Recipe source, canonical targets and exclusion preview",
    "blocked_by": [
      "freeze-shared-contracts"
    ],
    "allowed_files": [
      "packages/ui/src/os/recipes/RecipeEditor.tsx",
      "packages/ui/src/os/recipes/recipe-engine.ts",
      "packages/ui/src/os/recipes/recipe-engine.test.ts",
      "packages/ui/src/os/apps/RecipesApp.tsx",
      "packages/ui/browser-tests/os-recipes.browser.tsx",
      "packages/ui/src/os/recipes/recipe-source-context.ts",
      "packages/ui/src/os/recipes/recipe-source-context.test.ts"
    ],
    "constraints": [
      "RecipeOwner only; no shared shell/window/types/schema writes.",
      "Preserve RecipeV1 and executor; do not claim AC8/F1 fixed."
    ],
    "acceptance": [
      "Explicit source and canonical counted target choices handle sole/mixed/empty/offline/late discovery without rebinding.",
      "Preview accounts for every source window; no empty save or source layout mutation.",
      "Command edits invalidate value-bound confirmation; imports inert and exports warn."
    ],
    "verification": [
      "P08 run P05 exact unit/browser commands and authenticated row 2 actual capture/import/save/export scenarios."
    ]
  }
]
```

- [ ] <!-- evcrate-task:recipe-source-target-capture --> Implement explicit Recipe source, canonical targets and exclusion preview
