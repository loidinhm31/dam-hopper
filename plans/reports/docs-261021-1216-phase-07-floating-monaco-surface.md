# Phase 07 Documentation Management Report: Floating Monaco Surface

**Date:** 2026-10-21  
**Author:** Phase07DocsManager  
**Scope:** Phase 07 Floating Monaco Surface documentation across System Architecture, Code Standards, Codebase Summary, Workbench Components, Terminal & IDE Components, Workbench Files & Git Architecture, and Project Overview PDR.  
**File Output:** `plans/reports/docs-261021-1216-phase-07-floating-monaco-surface.md`

---

## 1. Current State Assessment

Phase 07 delivered the cross-shell floating Monaco conflict resolver surface (`ConflictResolverPanel`), unified floating panel stacking identity across `WorkspacePage` and `TerminalWorkspaceShell`, scoped Escape key arbitration, responsive narrow tabbed mode, in-memory model routing, region-ID actions, and component browser tests:
- **Floating Host (`ConflictResolverPanel` & `ConflictResolverToolbar`):** Implemented in `packages/ui/src/components/organisms/ConflictResolverPanel.tsx` and `ConflictResolverToolbar.tsx`. Mounted in `WorkspacePage` above shell branching (`IdeShell`, `TerminalWorkspaceShell`, `MobileWorkspaceShell`). Hiding the panel retains draft state in memory; when conflicts exist while hidden, a floating conflict pill button (`bottom-4 right-4 z-40`) indicates conflict count and reopens the panel.
- **Unified Floating Panel Stacking Identity (`terminal-workspace-panel.ts`):** `TerminalFloatingPanelId` expanded to `"files" | "tool" | "resolver"`. Functions `updateFloatingPanelStack`, `resolveFloatingPanelStackZIndex` (`TERMINAL_FLOATING_PANEL_BASE_Z_INDEX = 20`, +2 per stack depth), and `isTopmostFloatingPanel` coordinate logical depth ordering across `WorkspacePage` and `TerminalWorkspaceShell`.
- **Scoped Escape Key Arbitration (`conflict-resolver-panel-state.ts`):** Monaco widgets and menus (`.suggest-widget.visible`, `.find-widget.visible`, `.monaco-menu-container`) consume Escape before panel dismissal. `handleResolverPanelKeyDown` enforces that Escape hides the panel only if: (1) `isTopmost === true`, (2) focus is inside the panel element or at document body, and (3) no Monaco overlay widget/menu is active. Unconsumed Escape events call `stopImmediatePropagation()`, `stopPropagation()`, and `preventDefault()` to prevent terminal PTY key leakage.
- **Responsive Narrow Mode (`MergeConflictEditor.tsx`):** A `ResizeObserver` observing the editor container element (`containerNode`) dynamically switches between wide multi-column layout ($\ge 768\text{px}$) and narrow tabbed layout ($< 768\text{px}$). Wide layout renders `Theirs` (readonly), `Result` (editable), `Ours` (readonly), and optional `Base`. Narrow layout provides an accessible tablist (`Theirs`, `Result*`, `Ours`, `Base`) without resetting or unmounting draft models or in-progress text edits.
- **In-Memory Monaco Model Routing & Target Scoping Gap:** Editors mount to in-memory URIs: `inmemory://${projectName}/${filePath}/theirs`, `/result`, `/ours`, and `/base` with `keepCurrentModel: true`. Note: Current URIs do not encode profile ID, connection generation, or worktree path, leaving owner-qualified URI isolation as an open gate for multi-target workflows.
- **Region-ID Keyed Navigation & Actions (`ConflictRegionNav.tsx`):** Exposes chunk navigation chips and actions (`onAcceptSide`, `onAcceptBoth`, `onIgnoreSide`, `onMarkReviewed`) keyed strictly by stable `region.id`.
- **Public Delta Decorations (`conflict-editor-decorations.ts`):** `buildResultDecorations` and `buildSourceDecorations` apply public Monaco delta decorations using CSS rules injected once via `injectConflictStylesOnce()`.
- **Documentation Gaps Prior to This Task:**
  - `docs/codebase-summary.md` and `docs/system-architecture.md` lacked Phase 07 surface architecture, panel stacking, scoped Escape handling, responsive narrow mode, in-memory model paths, and browser test coverage.
  - `docs/code-standards.md` lacked normative standards for floating surface hosting outside editor tabs, unified panel stacking identities, scoped Escape arbitration, container-width responsive narrow mode, in-memory model URI isolation, and region-ID action routing.
  - `docs/frontend-components/workbench.md` had no section for `ConflictResolverPanel`, `ConflictResolverToolbar`, and `ConflictRegionNav`.
  - `docs/frontend-components/terminal-and-ide.md` lacked cross-references guiding readers from Git workspace views to the floating resolution surface.
  - `docs/architecture/workbench-files-editor-and-git.md` lacked conflict resolver entries in its source map table.
  - `docs/project-overview-pdr.md` PR-003 status did not reflect Phase 07 floating surface delivery.

---

## 2. Changes Made

This documentation task synchronized 7 documentation files across `docs/` and generated 1 compaction artifact:

### A. Codebase Summary (`docs/codebase-summary.md`)
- Synchronized line 83: Recorded Phase 07 floating Monaco surface and unified panel stacking added, detailing `ConflictResolverPanel`, `floatingPanelStack` (`TerminalFloatingPanelId`: `"files" | "tool" | "resolver"`), scoped Escape arbitration with Monaco widget priority, responsive narrow layout (768px container breakpoint) with accessible tabbed pane switching (`Theirs`, `Result`, `Ours`, `Base`), exact `region.id`-keyed actions, public Monaco delta decorations, and component browser tests (`git-conflict-resolver.browser.tsx`).
- Maintained explicit listing of open safety and integration gates: history authority unification (`JointHistoryAuthority` vs `draft.history`), capacity check bypasses on metadata history entries, typing coalescing ordering, decision-only redo dirtiness, diff3 bounds on large files, workspace integration/cutover (Phase 08), and Phase 01 native-history/Monaco byte-fidelity qualification.
- Synchronized line 97: Recorded updated repomix compaction artifact (`repomix-output.xml`, 3,042 files, 7,528,317 tokens packed).

### B. Code Standards (`docs/code-standards.md`)
- Added durable normative standards under `### Git conflict discovery, snapshots, and client mutations`:
  - **Shared Host Boundary:** Floating conflict resolver (`ConflictResolverPanel`) mounts as a single host in `WorkspacePage` above shell selection (`IdeShell`, `TerminalWorkspaceShell`, `MobileWorkspaceShell`), never inside editor tabs or diff viewers.
  - **Unified Panel Stacking Contract:** Floating panels (`TerminalFloatingPanelId`: `"files" | "tool" | "resolver"`) participate in a single ordered stack (`floatingPanelStack`) managed via `updateFloatingPanelStack`, with z-index computed via `resolveFloatingPanelStackZIndex` (`BASE_Z_INDEX = 20`, +2 per stack depth), coordinating logical ordering across `WorkspacePage` and `TerminalWorkspaceShell`. Host containers must ensure compatible ancestor CSS stacking contexts to avoid visual clipping or inversion.
  - **Scoped Escape & Focus Arbitration:** Monaco widgets and context menus (`.suggest-widget.visible`, `.find-widget.visible`, `.monaco-menu-container`) must consume Escape before panel dismissal. The Escape shortcut closes or hides the floating resolver only if it is the topmost floating panel, focus is inside the panel (or document root), and no Monaco overlay is active. Unconsumed Escape events must stop propagation to prevent terminal key leakage or multiple panel closures.
  - **Responsive Narrow Mode Transitions:** Container width $< 768\text{px}$ (measured via `ResizeObserver` observing the editor container) switches from multi-column grid to accessible tabbed pane switching (`Theirs`, `Result`, `Ours`, `Base`) without losing in-progress edits or region decision state.
  - **Monaco Model Path Isolation & Open Target Gap:** Editor instances must use deterministic in-memory model URIs (`inmemory://${project}/${filePath}/${pane}`) with `keepCurrentModel: true`. Current URI paths isolate panes within a project and path, but do not encode profile ID, connection generation, or worktree path; full owner-qualified URI scoping remains an open isolation gate for multi-target workflows.
  - **Region-ID Keyed Navigation & Actions:** Conflict chunk navigation and merge actions (`onAcceptSide`, `onAcceptBoth`, `onIgnoreSide`, `onMarkReviewed`) must bind strictly to stable `region.id` keys rather than volatile line numbers or array indices.

### C. System Architecture (`docs/system-architecture.md`)
- Updated section heading to `### Git Conflict Resolver Architecture (Phase 07 Floating Monaco Surface Added; Downstream Integration Gates Open)`.
- Added comprehensive documentation for Phase 07 architecture:
  - **Shared Floating Host (`ConflictResolverPanel` & `ConflictResolverToolbar`):** Details lifecycle, fixed boundary (`inset-0 z-40`), and floating conflict pill button (`bottom-4 right-4 z-40`).
  - **Unified Floating Panel Stacking Identity (`terminal-workspace-panel.ts`):** Details `TerminalFloatingPanelId`, `updateFloatingPanelStack`, `resolveFloatingPanelStackZIndex`, and `isTopmostFloatingPanel`.
  - **Scoped Keyboard Arbitration & Escape Priority (`conflict-resolver-panel-state.ts`):** Details 3-part guard (topmost check, DOM subtree containment, Monaco widget visibility check) and propagation stoppage.
  - **Panel Geometry & Clamping (`use-floating-panel-geometry.ts`, `conflict-resolver-panel-state.ts`):** Default bounds `1040x700`, min `480x360`, 12px margin, dragging and corner resizing.
  - **Responsive Narrow Layout (768px Container Breakpoint):** Details `ResizeObserver` on `containerNode`, wide multi-column layout, narrow tablist selector (`Theirs`, `Result*`, `Ours`, `Base`), and state invariance across tab switches.
  - **In-Memory Model URI Isolation:** Isolated URIs (`inmemory://${projectName}/${filePath}/${pane}`) with `keepCurrentModel: true`.
  - **Region-ID Keyed Navigation & Actions (`ConflictRegionNav.tsx`):** Stable region.id chunk navigation and decision actions.
  - **Monaco Public Delta Decorations (`conflict-editor-decorations.ts`):** Public delta decorations and single style injection (`injectConflictStylesOnce`).
  - **Open Safety & Downstream Gates:** Preserved open gates: history authority unification, capacity check bypasses on metadata-only history entries, typing coalescing ordering, decision-only redo dirtiness, diff3 complexity bounds, and Phase 08 workspace cutover.

### D. Workbench Components (`docs/frontend-components/workbench.md`)
- Added comprehensive section `## Floating Git Conflict Resolver Panel`:
  - Detailed component roles: `ConflictResolverPanel`, `ConflictResolverToolbar`, `MergeConflictEditor`, `ConflictRegionNav`, and floating conflict pill button.
  - Detailed unified panel stacking with `terminal-workspace-panel.ts`.
  - Detailed keyboard arbitration safety boundaries and Monaco widget priority.
  - Detailed container-width responsive narrow layout ($< 768\text{px}$) with accessible tablist.
  - Detailed in-memory model paths, public decorations, and Android Chrome native input policy enforcement (`isAndroidChromeNativeInputSuppressed`).

### E. Terminal and IDE Components (`docs/frontend-components/terminal-and-ide.md`)
- Added cross-reference callout under `## Git Workspace Panel` directing readers to the floating `ConflictResolverPanel` in `workbench.md`.
- Maintained file length strictly below 800 LOC (758 lines).

### F. Workbench Files, Editor, Search, and Git Architecture (`docs/architecture/workbench-files-editor-and-git.md`)
- Updated the Source Map and Verification table with primary implementations for Git conflict discovery/snapshots, merge model/history/draft store, floating Monaco surface and stacking (`ConflictResolverPanel`, `ConflictResolverToolbar`, `ConflictRegionNav`, `MergeConflictEditor`, `use-floating-panel-geometry.ts`, `terminal-workspace-panel.ts`, `conflict-resolver-panel-state.ts`, `conflict-editor-decorations.ts`), and component browser tests (`git-conflict-resolver.browser.tsx`, `conflict-monaco-history.browser.tsx`).

### G. Project Overview and PDR (`docs/project-overview-pdr.md`)
- Updated PR-003 status narrowly: recorded floating Monaco resolution surface delivered with responsive narrow mode, unified stacking, and scoped Escape arbitration, while keeping workspace integration (Phase 08) and production qualification (Phase 09) explicitly identified as open gates.
- Updated Git safety acceptance criteria to cover floating conflict resolver surface mounting above workspace shells, unified panel stacking, Monaco widgets consuming Escape before panel dismissal, and responsive narrow tabbed mode without discarding draft state.

---

## 3. Metrics & File Line Counts

All documentation files remain strictly within the `docs.maxLoc` ceiling (< 800 LOC):

| File | Type | Lines of Code | Status vs 800 LOC Limit | Headroom |
|---|---|---:|---|---:|
| `docs/codebase-summary.md` | Modified | 97 | OK | 703 lines |
| `docs/code-standards.md` | Modified | 127 | OK | 673 lines |
| `docs/system-architecture.md` | Modified | 404 | OK | 396 lines |
| `docs/frontend-components/workbench.md` | Modified | 318 | OK | 482 lines |
| `docs/frontend-components/terminal-and-ide.md` | Modified | 758 | OK | 42 lines |
| `docs/architecture/workbench-files-editor-and-git.md` | Modified | 282 | OK | 518 lines |
| `docs/project-overview-pdr.md` | Modified | 117 | OK | 683 lines |

---

## 4. Verification and Validation Evidence

1. **Documentation Link & Consistency Validation:**
   - Command: `node .omp/evcrate/scripts/validate-docs.cjs docs/`.
   - Result: 70 markdown documents scanned. Check 1 (Internal links): 100% valid; 0 broken links. Check 2 (Config keys): 26 pre-existing baseline unverified environment key warnings preserved. Check 3 (Code references): 9 references noted (warnings only for DOM/utility methods `stopImmediatePropagation()` and `injectConflictStylesOnce()`). Zero new broken links or fatal errors.
2. **Codebase Cross-Referencing:**
   - Verified `ConflictResolverPanel.tsx` in `packages/ui/src/components/organisms/ConflictResolverPanel.tsx:1-164`.
   - Verified `ConflictResolverToolbar.tsx` in `packages/ui/src/components/organisms/ConflictResolverToolbar.tsx:1-104`.
   - Verified `ConflictRegionNav.tsx` in `packages/ui/src/components/organisms/ConflictRegionNav.tsx:1-161`.
   - Verified `MergeConflictEditor.tsx` in `packages/ui/src/components/organisms/MergeConflictEditor.tsx:1-1499` (including `ResizeObserver` observing `containerNode` for the 768px narrow layout breakpoint, in-memory model paths, and narrow tab switching).
   - Verified `useFloatingPanelGeometry` in `packages/ui/src/hooks/use-floating-panel-geometry.ts:1-176`.
   - Verified `TerminalFloatingPanelId`, `updateFloatingPanelStack`, `resolveFloatingPanelStackZIndex`, `isTopmostFloatingPanel` in `packages/ui/src/lib/terminal-workspace-panel.ts:1-88`.
   - Verified `clampResolverPanelLayout`, `handleResolverPanelKeyDown`, `INITIAL_RESOLVER_PANEL_LAYOUT` in `packages/ui/src/lib/conflict-resolver-panel-state.ts:1-78`.
   - Verified `injectConflictStylesOnce`, `buildResultDecorations`, `buildSourceDecorations` in `packages/ui/src/lib/conflict-editor-decorations.ts:1-126`.
   - Verified mounting and `floatingPanelStack` in `packages/ui/src/components/pages/WorkspacePage.tsx:805-845,2795-2835`.
   - Verified `floatingPanelStack` integration in `packages/ui/src/components/templates/TerminalWorkspaceShell.tsx:32-51,113-122`.
   - Verified component browser tests in `packages/ui/browser-tests/git-conflict-resolver.browser.tsx:1-396`.
3. **Repomix Compaction Artifact:**
   - Executed `npx repomix --style xml --output ./repomix-output.xml --ignore "target/**,**/node_modules/**,deploy/**,*.svg,*.png,*.wasm,*.lock"`.
   - Result: 3,042 files, 7,528,317 tokens packed. Output stored at `./repomix-output.xml` (verified gitignored).
4. **Advisor Consultation:**
   - Consulted on initial candidate direction and completion draft via `xd://ask_advisor`.
   - Incorporated all recommendations: preserved open safety and qualification gates explicitly; verified container-width `ResizeObserver` for the 768px narrow breakpoint; detailed scoped Escape priority where Monaco widgets consume Escape before panel dismissal; qualified that propagation-stop calls alone do not replace verified PTY isolation; updated PR-003 narrowly without claiming release completion; distinguished draft-state retention from un-unified Monaco command undo/redo; disclosed the in-memory model URI target scoping gap (lack of profile/generation/worktree in path); qualified that `floatingPanelStack` manages logical stack indices while ancestor CSS stacking contexts require alignment; placed component contracts in `workbench.md` with cross-references from `terminal-and-ide.md` and `workbench-files-editor-and-git.md`; refrained from appending to `CHANGELOG.md` to protect the 800-line limit.

---

## 5. Unresolved Questions & Open Safety Gates

1. **History Authority Unification:** In Phase 08, how will `JointHistoryAuthority` (standalone Monaco controller) and `ConflictDraftRegistry.draft.history` be unified so that undo/redo operations across Monaco keyboard shortcuts, toolbar buttons, and draft store persistence share a single transaction log?
2. **Model URI Owner Qualification:** Will in-memory model URIs be extended to `inmemory://${profileId}/${generation}/${project}/${worktreePath}/${filePath}/${pane}` to prevent cross-target model collisions when multiple profiles or worktrees share identical project and file names?
3. **Ancestor CSS Stacking Contexts:** Are host containers in `IdeShell`, `TerminalWorkspaceShell`, and `MobileWorkspaceShell` guaranteed to share a common stacking context root with `ConflictResolverPanel`'s fixed overlay, or can transformed parent containers invert visual stacking depths?
4. **Persisted Open Safety Defects:**
   - *Metadata history capacity bypass:* Metadata-only store actions push full text into history without passing `checkProspectiveEditGrowth` or incrementing `historyBytes`.
   - *Redo dirtiness evaluation:* Redo of an identical-text accept evaluates `isDirty` strictly against initial text, risking clean eviction under memory pressure or missed recovery.
   - *Typing coalescing sequence:* In text-changing store actions, `draft.canCoalesceHistory = false` is assigned after `updateResult`.
   - *Diff3 complexity bounds:* Main-thread `node-diff3` execution budget on large files remains unqualified.
   - *Monaco byte-fidelity qualification:* Phase 01 native-history and Monaco byte-fidelity gates remain open pending downstream release qualification.
