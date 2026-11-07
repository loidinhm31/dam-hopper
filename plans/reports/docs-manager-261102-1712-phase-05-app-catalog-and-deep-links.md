# Documentation Update Report: Phase 05 Application Catalog & Deep Links

Date: 2026-11-02
Scope: AI Dev OS Redesign — Phase 05 (Migrate application catalog and deep links)
Status: Administratively closed baseline documented; technical acceptance incomplete (open review findings W0–W10 carried forward to Phase 09)

## Current State Assessment

Phase 05 migrated existing workbench and management panels into the OS windowing architecture:
1. 14 retained application manifests statically registered in `packages/ui/src/os/app-registry.ts`.
2. 11 new application adapter components under `packages/ui/src/os/apps/` wrapping existing organism and page bodies (`FilesApp`, `SearchApp`, `ChangesApp`, `GitApp`, `ConflictResolverApp`, `SessionChangesApp`, `WorkflowPlansApp`, `PortsTunnelsApp`, `ProjectInfoApp`, `AgentStoreApp`, `SettingsApp`).
3. Window deduplication engine `findExistingWindowForApp` implementing 6 instancing rules (`single-instance`, `profile-instance`, `project-instance`, `worktree-instance`, `tuple-instance`, `multi-instance`).
4. Typed deep link query parser `parseOsDeepLink` in `packages/ui/src/os/deep-links.ts` evaluating `/os?<query>` queries with known-profile validation, minimum context enforcement, canonical positive-integer decimal line parsing, and Session Changes full tuple requirements.
5. Standard project desktop template `createProjectDesktopTemplate` in `packages/ui/src/os/desktop-templates.ts` establishing the approved 60/40 binary split layout.
6. Hardened single-transport routing and generation fencing in `DiffViewer.tsx`, `use-file-search.ts`, `use-search-panel-replace.ts`, `use-ports.ts`, and `SessionChangesApp.tsx`.

Documentation in `docs/` required synchronization with this delivered infrastructure while truthfully framing it as an administratively closed implementation baseline with carried-forward technical review findings (Cycle 5 code review score 5/10, warnings W0–W10) and downstream visual/journey qualification gates.

## Changes Made

1. **Compaction Generation (`repomix`):**
   - Executed Repomix 1.18.0 compaction generating `./repomix-output.xml` (3,985 files packed, 9,697,653 tokens, 42,137,195 chars; 10 scanner-excluded test/config files). Output is local and gitignored.

2. **`docs/architecture/os-application-catalog-and-deep-links.md` (New, 167 LOC):**
   - Documented the 14-application catalog manifest table with exact metadata (`appId`, `displayName`, `instancing`, `minimumCtx`, `defaultPlacement`, `minSize`, `intents`, and adapter component).
   - Documented the adapter architecture composing canonical organisms without duplicate domain logic.
   - Detailed the 6 instancing rules and deduplication logic in `findExistingWindowForApp`.
   - Detailed the deep link URL query parameter matrix, known-profile validation fence, canonical positive-integer decimal line validation, and intent synthesis without process execution.
   - Detailed the approved 60/40 binary split layout structure (60% Terminals left pane; 40% side split: Files/Search top 50% above Git/Changes bottom 50%).
   - Detailed single-transport routing and generation-fencing hardening, explicitly distinguishing partial hardening from open review findings (W0a DiffViewer post-write revision check, W0b Search Replace All generation grouping, W2 offscreen review retirement, W3 focus trap and background PTY input containment, W5 management target independence, W10 tunnel installer failed-owner scope).
   - Documented verification evidence (70 automated tests reported passed across 12 files by Cycle 5 tester) and carried-forward review findings (W0–W10).

3. **`docs/system-architecture.md` (707 LOC):**
   - Added `## AI Dev OS Application Catalog & Deep Link Infrastructure (Phase 05)` summarizing the 14-app catalog, adapter composition, instancing models, typed deep link protocol, 60/40 binary split layout, and single-transport hardening.
   - Accurately described DiffViewer hardening as partial (checking generation after `fsRead` and after `fsWriteFile`, with open gap W0a where revision is not rechecked post-write and pre-write revision mismatches leave saving state locked).
   - Linked directly to `docs/architecture/os-application-catalog-and-deep-links.md`.

4. **`docs/project-overview-pdr.md` (163 LOC):**
   - Added requirement `PR-032: AI Dev OS Application Catalog & Deep Links (Phase 05)` in the PDR matrix, status: "DONE per user direction; technical acceptance incomplete (open review findings W0–W10 and browser journey oracles carried forward to Phase 09)".

5. **`docs/code-standards.md` (217 LOC):**
   - Added `### AI Dev OS Application Adapters & Deep Link Protocols` under `Domain-specific invariants` detailing:
     - Adapter composition over duplication.
     - Exact instancing granularity requirements (`single-instance`, `profile-instance`, `project-instance`, `worktree-instance`, `tuple-instance`, `multi-instance`).
     - Deep link fail-closed known-profile validation, positive-integer decimal line checks, and ambient command execution prevention.
     - Single-transport and generation-fencing invariants across search, diff, ports, and session changes.

6. **`docs/codebase-summary.md` (286 LOC):**
   - Refreshed Repomix metadata and summary metrics for pre-edit working tree snapshot.
   - Added `## AI Dev OS Application Catalog & Deep Links Phase 05 Implementation Checkpoint (2026-11-02)` table mapping delivered subsystems to source paths and architectural invariants.
   - Updated `packages/ui/src/os/` inventory in Shared UI Map to 50 files, ~10.2k LOC.
   - Updated Browser Component Regressions to include `os-workspace-apps.browser.tsx`, `os-review-apps.browser.tsx`, and `os-management-apps.browser.tsx`.
   - Refreshed Codebase Compaction Snapshot section.

7. **File Ownership Honors:**
   - Left `docs/project-roadmap.md` and `plans/261101-1738-ai-dev-os-redesign/*` untouched per coordination with `Phase05ProjectManager` (PM updated roadmap and phase plan independently).

## Gaps Identified

1. **DiffViewer Post-Write Revision Invalidation (W0a):**
   - Revision equality is checked after `fsRead` but not after `fsWriteFile`. Edits occurring while write I/O is in-flight can be marked clean by the completing save. Pre-write revision invalidation returns without clearing `saveState = "saving"`.
2. **Search Replace All Generation Grouping (W0b):**
   - Replace Next checks match generation against current connection snapshot, but Replace All groups matches without verifying originating generation for each match.
3. **Intent Consumers & Payload Delivery (W1):**
   - Production consumers for remaining catalog actions (terminal focus, file edit, browser preview, Changes actions, Git commit reveal, conflict reveal) and reactive payload delivery across cold vs reused windows remain open.
4. **Session Changes Focus Containment & Offscreen Retirement (W2, W3):**
   - Claim-denied root lacks ref; loading branch has zero tabbable controls (allowing Tab to escape); negative-tabindex controls are not excluded; background terminal writes are not intercepted at the PTY dispatch layer; unmounted/hidden reviews do not retire or purge cache until mounted.
5. **Management Window Target Reactivity (W5):**
   - Settings singleton target updates are ignored by local component state; Agent Store retains route-query coupling; Devices explicit profile is initial-only.
6. **Qualification Boundary:**
   - Real-browser Playwright journeys and human visual qualification remain open downstream gates in Phase 09.

## Recommendations

1. Address W0a (`DiffViewer.tsx`) by separating operation lifetime from edit identity, rechecking revision immediately before setting `saveState = "idle"` and clearing dirty state, and ensuring superseded stat preflights release `"saving"` state.
2. Address W0b (`use-search-panel-replace.ts`) by grouping and validating match generations before batch replace execution.
3. Complete caller wiring for remaining intent consumers and canonical payload delivery in Phase 06/07.
4. Ensure `repomix-output.xml` remains gitignored.

## Metrics

- Files Checked by Validator:
  - `docs/`: 35 files (353 working internal links, 0 broken links; 2,049 heuristic code-reference warnings and 436 config-key warnings on historical CHANGELOG/Android notes).
  - `docs/architecture/`: 11 files (55 working internal links, 0 broken links; 651 code-reference warnings and 138 config-key warnings on historical notes).
- Modified/Created Docs Line Counts:
  - `docs/architecture/os-application-catalog-and-deep-links.md`: 167 LOC (limit 800)
  - `docs/system-architecture.md`: 707 LOC (limit 800)
  - `docs/code-standards.md`: 217 LOC (limit 800)
  - `docs/project-overview-pdr.md`: 163 LOC (limit 800)
  - `docs/codebase-summary.md`: 286 LOC (limit 800)
  - All doc files strictly under `docs.maxLoc` (800 LOC ceiling).
- Verification Reference:
  - 70 unit and browser tests reported passing across 12 files in `plans/reports/tester-261102-1706-phase-05-cycle-5.md` (61 unit, 9 browser component tests, 0 type errors); not independently re-executed during this documentation update.

## Unresolved Questions

None.
