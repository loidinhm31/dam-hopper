# Responsive UI research: workflow tracking in `WorkspacePage`

## Evidence and scope
- Planning-only research; no source code, route, or navigation changes.
- `README.md` positions DamHopper as a single UI for a global project registry, bulk Git, builds, interactive PTY terminals, Git worktrees, workspace switching, and an agent store.
- Target `WorkspacePage.tsx` imports `IdeShell`, `MobileWorkspaceShell`, `TerminalWorkspaceShell`, `TerminalFloatingFilePanel`, browser-debug panels, `Button`/`inputClass`, `Select`, TanStack Query, Suspense/lazy, `useSearchParams`, and workspace/editor stores. These are the existing responsive/shell seams; do not replace them.
- `docs/` has `frontend-components.md`, `code-standards.md`, and `system-architecture.md`; no dedicated `design-guidelines.md` exists. Architecture describes `/ws` terminal I/O/events and target references that let several project/worktree panels and terminal sessions coexist.
- The worktree model is project-root plus optional worktree target. Planning metadata should reference that target, never invent a second active-project concept.

## Antigravity consultation (attribution)
- I ran `agy --print` with the exact DamHopper feature brief and requested recommendations, not a transcript.
- Useful independent concepts: an ambient 40px status ribbon that expands into a context deck; a three-stage disclosure model (ambient, peek, full); a Project -> Task/Phase -> Execution (terminal/agent) binding; bottom-sheet mobile adaptation; command-driven quick capture; explicit telemetry/error badges; and avoiding a global unbound terminal dump.
- Antigravity proposed a persistent split-rail command deck (preferred) versus a floating command palette/PiP matrix. I retain the binding and disclosure ideas, but reject speculative auto-booting of terminals/agents from natural-language capture: planning capture should be reversible and non-destructive.

## Layout concepts and choice
### A. Context rail / expandable deck (preferred)
Desktop wireframe: existing WorkspacePage header and canvas remain full width; a slim bottom ribbon shows active target, active task, session elapsed time, and counts for running terminals/agents. Clicking or keyboard-toggle expands a 360-440px-high deck: left project/worktree list, center task/phase timeline, right execution list. Each pane has its own scroll container. A selected row opens details inline rather than a route.

Mobile wireframe: the same ribbon becomes a sticky bottom bar above `env(safe-area-inset-bottom)`; tapping or swiping up opens a modal bottom sheet with snap points near 35% and 90% viewport height. Use a segmented top switch for Projects, Tasks, and Execution instead of three squeezed columns. Terminal output opens a second sheet or full-height in-sheet inspector; preserve the running session underneath.

Tradeoffs: excellent peripheral awareness and explicit target binding; costs vertical space while expanded and requires careful scroll/focus management.

### B. Spotlight + floating status cards
Desktop keeps the canvas nearly unchanged. `Cmd/Ctrl+K` opens a searchable planning matrix; small non-blocking cards expose active sessions and agent failures. Mobile uses a FAB plus full-screen sheet. Tradeoffs: minimal persistent clutter and fast for keyboard users, but poor cross-project peripheral awareness, weaker spatial memory, and high touch friction. Do not choose as the sole surface.

## Interaction model
1. Level 0 ribbon: target (project + worktree), current task, phase fraction, timer, and only actionable warnings.
2. Level 1 peek: one-row project cards with task count, last terminal state, and next phase; no logs or full task trees.
3. Level 2 deck/sheet: details, filtering, task create/edit, phase checklist, terminal/agent associations, and session history.
4. Entry points: an unobtrusive "Plan"/workflow icon in the existing WorkspacePage toolbar, ribbon click, and keyboard shortcut. Do not add a route or change browser history; preserve existing `useSearchParams` semantics.
5. Quick capture: inline field in the deck plus desktop shortcut (`Cmd/Ctrl+N`) and mobile thumb-zone FAB. Capture title, target, phase, and optional notes first; show an undo toast. Avoid hidden side effects such as starting a process or assigning an agent without confirmation.
6. Cross-project view: default sort by active/running, then blocked, then stale; allow project/worktree filter and a compact "attention" mode. Keep one selected target visually primary while other projects remain summarized.
7. Association: every planning item displays project/worktree identity and may link to zero or more terminal/agent sessions. Existing PTY IDs remain stable; selecting a bound session opens the existing terminal panel, not a duplicate terminal.
8. Timeline/progress: phase chips plus a thin segmented progress track; show completed, active, blocked, and not-started with text labels/icons as well as color. Session records show start, pause/resume, end, and duration; manual stop is always available.

## Responsive, keyboard, accessibility
- Desktop: 3 panes only at a width where each keeps readable minimums; otherwise collapse the execution pane before shrinking text. Use `min-h-0`, independent overflow, and a fixed deck max height.
- Mobile/tablet: one sheet, one active segment at a time; 44px minimum touch targets, visible drag handle, `dvh` sizing, and bottom padding for `env(safe-area-inset-bottom)`. Avoid horizontal page scroll.
- Keyboard: toolbar Plan button is focusable; `Cmd/Ctrl+N` capture, `Cmd/Ctrl+`` deck toggle, Escape closes the sheet/returns focus, Tab follows visual order (target -> task -> execution), Enter opens, Space toggles only when a task row is focused. Do not steal shortcuts while a terminal/editor input owns focus.
- Accessibility: named complementary ribbon and labeled regions for each pane; roving focus only within list widgets; visible focus rings; `aria-expanded` on deck trigger; polite live region for task/session changes and assertive only for terminal failure. Never use color alone; expose status text and icons. Mobile sheet needs focus return and a real dialog label.

## States and visual hierarchy
- Empty: explain that no planning items are bound to this target; primary Quick capture, secondary "link existing worktree/session". Do not imply a missing backend error.
- Loading: preserve ribbon/deck geometry with skeleton rows; keep existing terminal loading independent so streamed output does not reset planning state.
- Error: target/session-specific inline error with retry and affected ID; keep other projects usable. Failed terminal/agent state persists as a labeled warning in the ribbon until acknowledged.
- Hierarchy: target and attention state first, task/phase second, telemetry third, metadata last. Reuse existing Button, Select, shell spacing, typography, and color tokens from `packages/ui`; avoid new card/chrome styles.
- Density guardrails: show summaries by default, cap visible rows, paginate/virtualize long logs, lazy-load details, and keep only one pane expanded on narrow desktop. Keep high-frequency terminal output out of the project overview.

## Concrete integration points
- Compose the workflow surface inside `packages/ui/src/components/pages/WorkspacePage.tsx`, adjacent to the existing shell selection, rather than creating a route.
- Reuse the imported `IdeShell`, `MobileWorkspaceShell`, `TerminalWorkspaceShell`, `TerminalFloatingFilePanel`, `Button`/`inputClass`, and `Select`; expose the deck through the shell's existing toolbar/content slot if available.
- Read target identity from the workspace target/store path already used by editor/terminal panels; pass project plus optional worktreePath with each planning/session association.
- Keep terminal events on the existing WebSocket/query path and isolate high-frequency stream updates from summary rows. New presentation pieces should be small local components only if existing component patterns do not cover them.

## Anti-patterns
- Three full-width tables or three columns forced onto mobile.
- A second global active-worktree state that conflicts with terminal/editor target selection.
- Detached terminal/agent rows with no project, worktree, or task context.
- Nested modal chains, route changes, or losing PTY input/buffer on deck transitions.
- NLP capture that silently runs commands, creates worktrees, or starts agents.
- Color-only statuses, tiny icon-only controls, focus traps on desktop, or streaming re-render of the entire page.
- Auto-checking phases from telemetry without provenance, undo, and explicit user trust.

## Unresolved questions
- Which existing WorkspacePage toolbar/content slot is the supported insertion seam, and what are its exact breakpoint classes?
- Is workflow metadata persisted by the Rust API, local storage, or a new store; what is the authoritative session clock?
- Are agent harness IDs and terminal IDs already exposed together in the current query/WebSocket payloads?
- Should a planning-only first release support one active timer globally or one timer per project/worktree?
