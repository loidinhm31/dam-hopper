# Phase 04 — Dashboard and Document Details

## Context links
- [Parent](./plan.md), [contracts sections 6–9](./contracts.md), [frontend design](./research/frontend-contract.md).
- Dependency: [Phase 03](./phase-03-owner-bound-client-and-refresh.md) owner-bound query/watch/read lifecycle.
- [Current surface](../../docs/workflow-context-surface.md), [frontend standards](../../docs/code-standards.md#react-and-typescript).

## Overview
- Date: 2026-10-06. Priority: P2. Estimate: 10h, not a commitment.
- Implementation status: completed. Review status: passed.
- Expand existing Plan surface with folder-first browsing, one selected plan's Overview/Timeline and basic read-only details. Keep Manual tracking and shell/terminal/editor state intact; no project-wide Board/comparison.

## Key Insights
- Current surface is a toolbar ribbon plus inline Deck/mobile Sheet, not a workspace route. Do not introduce a second navigation/store/root convention.
- File plans and SQLite manual plans have different authority/identity/mutations; rendering file plans as ItemDto would create false editing/session behavior.
- Existing MarkdownPreview provides GFM/Mermaid rendering, but relative browser links do not resolve captured server documents.
- A truthful timeline must also handle milestones/Undated/invalid ranges, not fabricate one-day duration to fill every row.

## Requirements
- Initial view lists folder names only; opening a group browses it, opening a plan loads only its normalized report. Selected Overview/Timeline expose source labels/diagnostics/unknown counts.
- Manual controls/notes/session actions remain existing callbacks; file entries have no edit/status/drag/import/run actions.
- Basic Plan/Progress tabs and evidence/declared-phase Markdown links; reuse GFM/Mermaid, local images always accessible notices. No universal filesystem browser/full reader clone/media integration.
- Keyboard/focus/scroll/accessibility at desktop/mobile/narrow viewport; themes inherited from current app.
- File API/manual overview failures independent. No whole-surface early return when only one source unavailable.

## Architecture
- `ProjectPlansDashboard` composes folder browser, selected Overview/Timeline and document detail with Phase 03 hook.
- Focused `ProjectPlanFolderBrowser`, `ProjectPlanTimeline`, `ProjectPlanDocument` consume normalized DTOs/captured context. Selected Overview can stay inline; no collection Board/card abstraction or Gantt/chart dependency.
- Existing Surface owns view/target selection and forwards shared content to Deck/Sheet. Keep manual region mounted while open; hidden when file views selected to preserve local drafts.
- Desktop Deck proposed height min(70dvh,720px), minimum320px. Mobile Sheet existing90dvh expanded state; same dashboard inside Plans segment.
- Existing WorkspacePage profile key and terminal reveal/target callbacks unchanged. Key only file-dashboard subtree by owner/target.

## Related code files
Under `/home/loidinh/WS/dam-hopper/`:
- Create `packages/ui/src/components/organisms/ProjectPlansDashboard.tsx`.
- Create `ProjectPlanFolderBrowser.tsx`, `ProjectPlanTimeline.tsx`, `ProjectPlanDocument.tsx` in same organisms directory. Do not create obsolete ProjectPlansBoard or duplicate Markdown renderer.
- Modify `WorkflowContextSurface.tsx`, `WorkflowContextDeck.tsx`, `WorkflowContextSheet.tsx`: shared dashboard slots/tabs, geometry and independent availability.
- Modify `packages/ui/src/components/molecules/WorkflowContextRibbon.tsx` only for Plan entry/accessibility intent; manual summary behavior preserved.
- Modify `packages/ui/src/components/organisms/MarkdownPreview.tsx`: optional target-aware link/image policy, default behavior unchanged for current consumers.
- Create focused `packages/ui/src/lib/project-plans-timeline.ts` only for nontrivial precision/range projection shared by render/tests; do not create a general scheduling framework.
- Create `packages/ui/browser-tests/plans-dashboard.browser.tsx`; focused uncertain behavior regressions adjacent to dashboard/document/date helpers.
- Intentionally unchanged `WorkspacePage.tsx`, IdeShell/terminal/native hosts, workflow manual action hooks and existing editor/PTY lifecycle.

## Implementation Steps
1. Use LSP references before exported props or renderer changes. Trace Surface -> Deck/Sheet -> manual callbacks and preserve all existing actions. Read any affected tests; delete wording/incidental-implementation assertions rather than re-pin new labels.
2. Add narrow file-only browse/selected-plan/document/tab state. Existing ribbon manual summary stays truthful. Real configured target required; never use manual `default` fallback as a file target.
3. Integrate File plans / Manual tracking switch into Deck and mobile Plans segment. File plans starts at folders; selected plan offers Overview/Timeline/Documents and Back. Keep manual region mounted and terminal/editor state untouched.
4. Render panel-local loading/auth/unsupported/error/missing/empty/no-name-matches/truncated-listing/stale-watcher states. File/manual failure never suppresses the other source. Folder rows show names/paths only, not unrequested statuses or invented metadata.
5. Implement breadcrumbs and immediate-folder name filter/Refresh. Clicking a group browses it; clicking a plan loads exactly that plan. No status/priority/tag collection filter, sibling prefetch or load-all option. Back restores originating row focus without opening another plan.
6. Selected Overview shows optional title/description/priority/tags/issue/branch, current source/raw diagnostics, known-completed/declared plus unknown/conflict counts, freshness and declared phase rows. Missing title uses explicitly labelled directory identifier, not fabricated metadata. Keep unknown phases visible; no status writes.
7. Implement selected plan's outlined scheduled/solid actual bars, non-color-only legend, textual precision/source and creation/start/end milestones or Undated state. No cross-plan comparison/phase schedule. Open actual only for qualifying in-progress explicit start and labelled Now/Today; update now only when visible open bar requires it.
8. Preserve inclusive calendar day strings and explicit instant display timezone. Never substitute mtime, Published, effort, directory naming or current time for a missing endpoint. Timeline horizontal scroll stays inside dashboard; undated plans retain document/overview access.
9. Detail shows Plan/Progress tabs plus source/historical snapshot banner. Absent/unreadable/changed/oversize progress has explicit unavailable/error state. File content fetched through captured Phase 03 strict read; never optimistic local status edits or writable editor fallback.
10. Extend MarkdownPreview with optional link/image policy, retaining GFM/Mermaid and defaults for other consumers. Resolve local Markdown inside captured target; reject escapes/absolute/NUL/malformed encoding/unsafe schemes. Fragments scroll to deterministic heading IDs; local Markdown stays read-only. External http/https uses noopener/noreferrer. Local images always accessible alt/source notices, with no browser-relative fetch or new media ticket capability; non-Markdown links explicitly unsupported.
11. Keep receipt/evidence text as reported data, not verified completion. No new controller calls, phase execution, automatic target switches, branch switch or fabricated issue URL. Project-local docs/UI review Markdown remains readable even outside plans/.
12. Keyboard: folder rows/breadcrumbs/tabs/Refresh/Back reachable; focus follows deliberate selection and returns to originating row. Escape preserves Deck/Sheet close behavior. Long names/Markdown tables/timeline scroll inside the surface, never widen workspace.
13. Add real Chromium cases for focus, tab/draft preservation, duplicate target identities, conflicting source/date states and safe local links. Test behavior/bounds/transitions, not source text or incidental style/wording. Phase 05 runs actual application path and human-reviewed visuals after all slices integrate.

## Todo list
- [x] Shared folder-first/selected-plan/manual integration and independent errors.
- [x] Folder navigation and selected source-aware progress/metadata.
- [x] Selected explicit-date bars/milestones/Undated/precision semantics.
- [x] Target-contained read-only details and safe links.
- [x] Keyboard/focus/geometry and behavioral browser coverage.

## Verification Evidence
74/74 targeted tests passing across 12 unit test files and 1 Playwright Chromium browser test suite (100% pass rate), with zero monorepo regressions:

### 1. Targeted Unit Tests (69/69 passed across 12 files, 2.29s)
- `packages/ui/src/lib/project-plans-timeline.test.ts` (11 tests):
  - Strictly parses valid `YYYY-MM-DD` day dates as UTC start of day.
  - Rejects invalid calendar days (e.g. `2026-02-31`).
  - Strictly parses valid RFC3339 instants with timezone (`Z` or numeric offset) and rejects bare instant strings without timezone.
  - Preserves literal day strings and formats instants with explicit UTC indicators.
  - Returns `isUndated: true` when all date fields are absent.
  - Computes planned and actual closed bars with matching day precision.
  - Computes open actual bar extending to Today when plan is in-progress without `actualEnd`.
  - Rejects precision mismatch between planned start and end dates.
  - Correctly treats creation-only date as a creation milestone.
- `packages/ui/src/components/organisms/MarkdownPreview.test.tsx` (12 tests):
  - Generates deterministic heading anchor slug IDs (`slugifyHeading`).
  - Resolves sibling and parent relative markdown paths within captured target.
  - Rejects directory traversal escapes (`../../etc/passwd` above target root).
  - Rejects unsafe URI schemes (`javascript:`, `file:`) and null bytes (`\0`).
  - Marks non-markdown local files with `isMarkdown: false` and renders them as unclickable muted `<span>` elements (no enclosing `<a>`).
  - Renders local images as accessible `<span role="note">` notices without issuing local media fetch tickets.
  - Preserves external HTTP/HTTPS image rendering.
- `packages/ui/src/components/organisms/ProjectPlanFolderBrowser.test.tsx` (6 tests):
  - Renders folder rows with name and navigation buttons.
  - Renders breadcrumbs accurately for nested browsing paths.
  - Renders loading skeleton when data is pending and error state on failure.
  - Displays missing folder notice when `folderState === "missing"`.
  - Displays truncation warning banner when listing is incomplete (`hasMore: true`).
- `packages/ui/src/components/organisms/ProjectPlanTimeline.test.tsx` (4 tests):
  - Renders explicit "Undated Plan" state when all date fields are absent.
  - Renders planned (outlined/dashed) and actual (solid) bars with textual precision indicators.
  - Renders open in-progress bar extending to Today when status is in-progress.
  - Renders milestone diamond badges for standalone instant/day dates.
- `packages/ui/src/components/organisms/ProjectPlanDocument.test.tsx` (5 tests):
  - Renders Plan (`plan.md`) and Progress (`progress.md`) tabs with Read-Only Snapshot banner.
  - Renders absent notice when optional `progress.md` does not exist.
  - Renders oversize warning banner when document snapshot exceeds size bounds.
  - Renders loading spinner and error notice on fetch failure.
- `packages/ui/src/components/organisms/ProjectPlanOverview.test.tsx` (3 tests):
  - Renders plan title, description, priority, tags, git branch, and sanitized external issue URL.
  - Renders phase inventory grid and known-completed progression fraction.
  - Displays explicitly labelled directory identifier when plan title is null.
- `packages/ui/src/components/organisms/ProjectPlansDashboard.test.tsx` (2 tests):
  - Renders initial folder browser view listing available folder entries.
  - Navigates into selected plan view on folder item click.
- `packages/ui/src/components/organisms/WorkflowContextDeck.test.tsx` (4 tests):
  - Renders desktop deck constrained to viewport bounds (`h-[min(70dvh,720px)]`).
  - Restores focus to trigger on close button click and on Escape key.
  - Forwards `onDeleteItem` and renders item controls.
- `packages/ui/src/components/organisms/WorkflowContextSheet.test.tsx` (3 tests):
  - Renders mobile sheet at 90dvh with segmented navigation (Plans, Items, Notes).
  - Switches active segment cleanly on button click.
  - Forwards deletion callback in items segment.
- `packages/ui/src/components/organisms/WorkflowContextSurface.test.tsx` (10 tests):
  - Toggles desktop deck from ribbon trigger.
  - Gracefully hides workflow controls when active profile lacks overview route without breaking file plans.
  - Global `Mod+Shift+W` keyboard shortcut toggles surface.
  - Performs optimistic CAS item status updates using `item.updatedAt`.
  - Reactively handles item and note deletion.
  - Reactively updates on plan creation/deletion without full page reload.
  - Handles profile-scoped connection snapshots.
- `packages/ui/src/components/molecules/WorkflowContextRibbon.test.tsx` (5 tests):
  - Renders loading skeleton and error state with retry button.
  - Explains profile-scoped workflow unavailability without controls.
  - Displays active plan title and next note preview.
  - Toggles deck on ribbon click.
- `packages/ui/src/components/organisms/WorkflowPlansIntegration.test.tsx` (4 tests):
  - Renders "File plans" and "Manual tracking" tabs in deck header.
  - Preserves mounted manual quick-capture draft when switching to File plans and back (via CSS `hidden`).
  - Keeps File plans reachable even when manual workflow service is unavailable.
  - Prompts for configured project when target is unconfigured "default".

### 2. Chromium Real-Browser Observations (5/5 passed, 1.64s)
Executed via `pnpm --filter @dam-hopper/ui exec vitest run --config vitest.browser.config.ts browser-tests/plans-dashboard.browser.tsx`:
1. **Keyboard Focus Restoration**:
   - In `browser-tests/plans-dashboard.browser.tsx`, folder rows render as `button[role="listitem"]`. Clicking row `261001-sample` enters selected plan view. Clicking the Back button (`button[aria-label="Back to folder browser"]`) returns to folder browser and restores keyboard focus directly to originating row (`document.activeElement === restoredRow`), confirming WCAG accessibility and predictable keyboard navigation.
2. **Immediate Substring Filtering**:
   - Filtering via `input[placeholder="Filter folders by name..."]` applies immediate client-side substring matching; typing `"other"` instantly isolates `261002-other` and excludes `261001-sample` from the DOM without latency or server re-query.
3. **Tab Transitions Across Plan Views**:
   - Clicking between Overview, Timeline, and Documents tabs cleanly switches views: Overview displays plan metadata and phase table; Timeline renders "Planned Schedule" with non-color legend; Documents renders `plan.md` and the "Read-Only Snapshot" banner without re-querying or disrupting state.
4. **Markdown Link Security & Safe Local Image Notices**:
   - Deterministic heading anchor slugs are generated (`id="heading-1"`). Safe relative local markdown link (`./phase-01.md`) resolves and invokes `onNavigateLocalMarkdown`. Disallowed/non-markdown link (`./binary.bin`) renders as an inert, unclickable `<span>` (no enclosing `<a>`). Local image reference (`./diagram.png`) renders an accessible `<span role="note">[Image: Local Diagram]</span>` note preventing unsolicited local file fetch tickets.
5. **Horizontal Timeline Containment & Graceful Date Conflict Handling**:
   - A plan with conflicting dates (`plannedStart: 2026-10-10`, `plannedEnd: 2026-10-01`) renders an accessible `role="alert"` displaying the `DATE_CONFLICT` diagnostic banner without unhandled exceptions or UI disruption, falling back gracefully to "Undated Plan" state inside an `overflow-x-auto` horizontal scroll container.

### 3. TypeScript Compilation Build (Clean Pass)
- Command: `pnpm --filter @dam-hopper/ui build` (`tsc -p tsconfig.json`)
- Result: Exit code 0, 0 errors, 0 warnings (8.58s duration).

### 4. Monorepo UI Full Regression Pass (2,731/2,731 Passed)
- **Full Unit Test Suite**: `pnpm --filter @dam-hopper/ui test`
  - 312/312 test files passed (100%), 2,394/2,394 tests passed, 0 failures (18.09s).
- **Full Browser Test Suite**: `pnpm --filter @dam-hopper/ui test:browser`
  - 52/54 files passed (2 skipped by design), 263/267 tests passed (4 skipped by design, 0 failures) (54.87s).
- **Total Verified Tests**: 2,735 tests across unit and browser suites with zero regressions.

## Success Criteria
- A02–A08/A10 display portions, A13/A14 preservation and A15/A16 on-demand/reader portions exercised in actual app.
- Switching folders/selected tabs/Manual preserves manual drafts/notes/session controls and terminal/editor state.
- Initial view opens no plan document; selection loads one only. Unknown progress/no dates remain explicit rather than discarded.
- Local evidence Markdown outside plans but within target works; escape cannot fetch another target or open editor. Mermaid renders and local images produce notices without media fetch.
- Desktop/mobile/narrow layouts show source warnings/date legends with usable keyboard/focus/scroll behavior.

## Risk Assessment
- Deck growth can obscure workspace: constrain existing inline surface and its scroll/focus, never remount underlying shell.
- Manual overview unavailable currently closes surface: split availability paths carefully so valid file dashboard remains reachable.
- Renderer changes affect all consumers: optional policy only, LSP callsite review, preserve current defaults.
- Date arithmetic/timezones: day and instant precision never mixed; deterministic projection cases, no Date conversion of bare calendar dates.

## Security Considerations
- Raw Markdown HTML stays non-executable; link policy denies schemes/absolute paths/escapes. Server strict read is final authorization.
- All document/selection callbacks carry captured owner/target; no delayed ambient profile lookup.
- No status writes, PTY inputs, agent/controller operations or inferred implementation permission from document content.

## Next steps
- Phase 05 qualifies actual watcher-to-UI flow, ownership, manual behavior and visual evidence; only then update maintained docs/changelog.
- Unresolved questions: none requiring product input. Actual layout/platform proof remains implementation qualification.
