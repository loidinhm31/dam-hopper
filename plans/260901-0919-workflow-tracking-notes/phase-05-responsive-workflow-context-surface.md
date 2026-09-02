# Phase 05 — Responsive Workflow Context Surface

## Context Links
- [Plan](./plan.md)
- [Responsive/Antigravity research](./research/researcher-02-antigravity-responsive-ui.md)
- [Phase 04](./phase-04-client-types-transport-and-query-state.md)
- [Frontend components](../../docs/frontend-components.md)
- [Mobile shell](../../packages/ui/src/components/templates/MobileWorkspaceShell.tsx)
- Depends on: Phase 04. Enables Phase 06.

## Overview
- **Date:** 2026-09-01
- **Description:** Build an accessible ambient context row that expands into a desktop deck or safe-area mobile sheet with project, work-item, and execution views.
- **Priority:** P2
- **Implementation status:** Complete / DONE (2026-09-02)
- **Review status:** Approved (Score: 9.8/10)

## Key Insights
- Antigravity's ambient → peek → full disclosure fits, but its bottom ribbon conflicts with terminal accessory controls. Use the existing 40px `toolbarActions` companion row directly below `TopNav`; preserve the idea, not the speculative placement.
- Desktop can show three panes only when each remains readable. Mobile must show one segment at a time in a bottom sheet.
- Existing `Button`, `Select`, CSS variables, and Radix `Dialog` own styling/focus primitives. Do not introduce a design system or new dependency.
- Workflow state updates must not rerender/unmount `TerminalKeepAliveHost`, xterm panes, or editor tabs.
- Plan is the primary resumable object. Its status, latest note/next action, sessions, terminal links, and harness links remain useful when no Phase or Task exists.

## Requirements
- Ambient row shows active configured project + selected worktree label, active Plan (or standalone Task), latest note/next action, elapsed time from its manual session start, optional factual tracked-Task count, and blocked/stale/resource-failure attention.
- Desktop activation opens a non-modal context deck below the companion row, height clamp 320–440px. At ≥1100px: Projects | Plans & Work | Execution; at 760–1099px: two panes with Execution as details; below compact breakpoint use sheet.
- Mobile activation opens a labeled modal bottom sheet with compact (35dvh) and expanded (90dvh) states, drag handle/toggle, one segment (`Projects|Plans & Work|Execution`), 44px controls, `dvh`, safe inline/bottom padding.
- Primary capture creates a minimal Plan from title + project/target; status, note/next action, session, Phase, and Task are optional. Secondary capture creates an optional Phase under a Plan, Task under a Plan/Phase, or standalone Task. No placeholder children.
- Plan detail prioritizes manual status, latest note/next action, last/current session, and linked execution. A Plan with no breakdown displays `Breakdown not tracked`, never `0%`.
- When Tasks exist, show `x/y tracked tasks done`; do not label it total Plan completion. Plan/Phase status remains manual even if child counts differ, with at most a non-blocking inconsistency hint.
- Session controls attach directly to the selected Plan/Phase/Task and expose editable manual start/end fields with adjacent **Now** actions, explicit abandon, terminal link/unlink, and manual harness label/run ID. Observed terminal exit is separate and never auto-applies.
- Loading keeps row/deck geometry via skeletons. Empty distinguishes no items from unavailable backend. Error is inline, scoped, retryable, and does not hide unaffected cached rows.
- Status uses icon + text + color. All titles/notes wrap/truncate with accessible full text; no raw paths by default.

## Architecture
- `WorkflowContextSurface` owns open state, mobile segment/snap state, selected project/Plan/item/session, manual timestamp drafts, harness-link drafts, and one elapsed clock.
- `WorkflowContextRibbon` is the toolbar action content and trigger (`aria-expanded`, active Plan/attention summary).
- `WorkflowContextDeck` is desktop-only presentation; `WorkflowContextSheet` uses existing `Dialog` portal/focus return.
- Three focused panes receive normalized DTOs/callbacks; do not call APIs themselves. Plan detail works without children; optional breakdown and execution remain progressively disclosed.
- Render caps: ambient one target/Plan, project pane 100 summaries, Plans & Work pane 200 rows with explicit truncation, execution 100 current/recent rows; event history loads pages of 50 on demand.

## Related Code Files
### Modify
- `packages/ui/src/index.css` — only reusable workflow surface dimensions/safe-area variables that Tailwind cannot express clearly.
- `packages/ui/src/components/ui/Dialog.tsx` — unchanged unless current API cannot express labeled snap sheet; prefer composition.
### Create
- `packages/ui/src/components/organisms/WorkflowContextSurface.tsx` — orchestration and state ownership.
- `packages/ui/src/components/molecules/WorkflowContextRibbon.tsx` — ambient summary/trigger.
- `packages/ui/src/components/organisms/WorkflowContextDeck.tsx` — responsive desktop deck.
- `packages/ui/src/components/organisms/WorkflowContextSheet.tsx` — mobile segmented sheet.
- `packages/ui/src/components/molecules/WorkflowItemList.tsx` — Plan-first list/detail, optional Phase/direct Task children, standalone Tasks, factual tracked counts, status edits.
- `packages/ui/src/components/molecules/WorkflowExecutionList.tsx` — direct Plan/item sessions, observed resource health/suggestions, terminal and harness links, provenance.
- `packages/ui/src/components/molecules/WorkflowQuickCapture.tsx` — minimal Plan-first form plus explicitly optional breakdown placement.
- `packages/ui/src/lib/workflow-focus.ts` — focus ownership and shortcut guard.
- Focused `*.test.tsx`/`workflow-focus.test.ts` files beside each component/helper.
### Delete
- None.

## Implementation Steps
1. Implement pure selectors for active Plan/target summary, attention sorting (manual running → blocked → stale resource), Plan-first grouping, standalone Tasks, and factual tracked-Task labels.
2. Build ribbon with stable 40px-compatible layout, skeleton/error/empty variants, active Plan/last-note context, text labels, and polite live region. Hide metadata before showing misleading fallback.
3. Build project/Plans & Work/execution panes with independent `min-h-0 overflow-y-auto`, stable keyed rows, selected state, and typed action callbacks.
4. Build minimal Plan creation requiring only title/project/target. Keep status, note/next action, Phase/Task breakdown, and session start optional; never generate placeholder children.
5. Build Plan detail that supports direct note/session/terminal/harness actions and shows `Breakdown not tracked` without warning. Render `x/y tracked tasks done` only when Tasks exist.
6. Build manual timestamp fields, adjacent **Now** actions, manual harness link inputs, optional Phase/Task capture, and item edits with existing controls, labels, validation, pending disable, scoped errors, and server-confirmed announcements.
7. Present observed terminal state/suggested end time beside—but never inside—the manual end draft. Applying a suggestion requires an explicit labeled action and remains editable before submit.
8. Build deck as non-modal complementary region. Escape closes and returns focus; Tab follows visual order. No focus trap on desktop.
9. Build sheet with real dialog title/description, 35/90dvh states, safe areas, one segment, contained overscroll, and focus return.
10. Add shortcut `Ctrl/Cmd+Shift+W` for toggle only when `isWorkflowShortcutOwner` confirms focus is outside input/select/textarea/contenteditable, Monaco, xterm helper textarea, dialog, or native-input suppression. No global quick-create shortcut in MVP.
11. Wire terminal navigation and explicit terminal/manual-harness link controls; exclude target-mismatched terminals before submit and never auto-detect a harness.
12. Memoize pane rows and tick one shared visible timer. Pause timer when document hidden or no manually running labels are visible.
13. Test Plan-only creation/resume, direct notes/sessions, no fake percentage, optional Phase/direct Task, standalone Task, factual count copy, typed time/**Now**, observed-suggestion non-application, harness inputs, focus return, shortcut, row caps, safe areas, mobile segmentation, and text-only rendering.

## Todo List
- [x] Plan-only creation/resume and direct note/session/execution flows require no breakdown maintenance.
- [x] Optional Phase/direct Task/standalone Task organization and factual count copy are clear.
- [x] Typed and **Now** timestamps share one explicit form path; observed suggestions never auto-apply.
- [x] Ambient row has truthful summary/loading/error/empty states.
- [x] Desktop deck adapts three-to-two panes without squeezed content.
- [x] Mobile sheet respects safe areas, focus, touch targets, and `dvh`.
- [x] Forms expose explicit reversible actions only.
- [x] Shortcut guard protects terminal/editor/form ownership.

## Success Criteria
- A developer can orient, create/resume a Plan, add a note, start/end/abandon direct Plan work, link execution, and optionally add breakdown without leaving WorkspacePage.
- A Plan with no children shows status, last activity/note, session, and execution context plus neutral `Breakdown not tracked`; it never shows `0%` or an incomplete warning.
- 360px mobile has no horizontal page scroll; sheet content remains reachable above safe area.
- Terminal/editor typing, Ctrl/Cmd shortcuts, selection, scroll, and IME are unchanged while surface is closed or open.
- Loading/error/empty/stale/blocked states are distinguishable by accessible text, not color alone.
- One-second elapsed updates do not rerender terminal hosts or every hidden history row.

## Risk Assessment
- **Accessory collision:** use established top companion row, not bottom overlay; mobile sheet overlays only after explicit activation.
- **Focus theft:** centralized guard, focus-return tests, no desktop trap, no global create shortcut.
- **Dense UI:** Plan-only summary is the default; optional breakdown uses progressive disclosure, row caps, two-pane collapse, and one mobile segment.
- **Component proliferation:** components map directly to independent visual/behavioral concerns and remain under 200 lines.

## Security Considerations
- Render text only; no Markdown/HTML interpretation of notes.
- Full absolute path appears only in an explicit details disclosure when already authorized by current profile; ambient labels use branch/basename.
- Never place notes/paths in DOM data attributes, analytics, toast logs, or ARIA live announcements beyond the changed title/status.
- Link selector shows only terminals returned by the current profile and matching validated project/target.

## Next Steps
- Phase 06 mounts one surface through each shell's existing companion-row prop and wires current target/terminal actions.
- Phase 07 browser-verifies real focus, geometry, terminal continuity, and mobile safe-area behavior.

## Unresolved Questions
None.
