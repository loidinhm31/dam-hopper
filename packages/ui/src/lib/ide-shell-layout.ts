import type React from "react";

/**
 * Layout decisions for the IDE bottom tool panel area, derived from the
 * session-only `bottomMaximized` state. Extracted as a pure function so the
 * maximize/restore/reset-on-close layout contract is unit-testable without a
 * DOM environment (the workspace test harness is SSR-only via
 * `renderToStaticMarkup`).
 *
 * The returned class strings are pre-merged (equivalent to what `cn()` produces
 * for these non-conflicting Tailwind utilities) so `IdeShell` can apply them
 * directly.
 */
export interface BottomPanelLayoutInput {
  /** Session-only maximize flag for the bottom tool panel. */
  bottomMaximized: boolean;
  /** Persisted bottom panel height in px — ignored while maximized. */
  bottomHeight: number;
}

export interface BottomPanelLayout {
  /** ClassName for the top-area container (explorer / editor / right panels). */
  topAreaClassName: string;
  /** ClassName for the bottom-area outer container. */
  bottomOuterClassName: string;
  /** Whether the vertical resize handle should render. */
  showResizeHandle: boolean;
  /** Inline style for the bottom inner height div (undefined when maximized). */
  innerStyle: React.CSSProperties | undefined;
  /** ClassName for the bottom inner height div. */
  innerClassName: string;
}

const TOP_AREA_BASE = "flex-1 flex min-w-0 min-h-0 overflow-clip";
const BOTTOM_OUTER_BASE = "flex flex-col bg-[var(--color-surface)]";
const INNER_BASE =
  "flex min-h-0 border-t border-[var(--color-border)] overflow-clip";

/**
 * Resolve the bottom panel layout for the given maximize state.
 *
 * - Non-maximized: top area visible, bottom outer `shrink-0`, resize handle
 *   shown, inner div uses the fixed `bottomHeight`.
 * - Maximized: top area hidden, bottom outer `flex-1`, resize handle hidden,
 *   inner div stretches (`flex-1`, no fixed height).
 *
 * Restore (toggle back to non-maximized) and reset-on-close both reduce to the
 * non-maximized branch, which is what the close helpers in `IdeShell` produce by
 * clearing `bottomMaximized`.
 */
export function resolveBottomPanelLayout({
  bottomMaximized,
  bottomHeight,
}: BottomPanelLayoutInput): BottomPanelLayout {
  if (bottomMaximized) {
    return {
      topAreaClassName: `${TOP_AREA_BASE} hidden`,
      bottomOuterClassName: `${BOTTOM_OUTER_BASE} flex-1`,
      showResizeHandle: false,
      innerStyle: undefined,
      innerClassName: `${INNER_BASE} flex-1`,
    };
  }
  return {
    topAreaClassName: TOP_AREA_BASE,
    bottomOuterClassName: `${BOTTOM_OUTER_BASE} shrink-0`,
    showResizeHandle: true,
    innerStyle: { height: bottomHeight },
    innerClassName: INNER_BASE,
  };
}

// ── Maximize state transitions ─────────────────────────────────────────────
// Pure decision helpers for the bottom panel maximize toggle and top-tool
// activity bar clicks. Kept alongside the layout helper so the full maximize
// contract (layout + state transitions) is unit-testable under the SSR harness.

/**
 * Decide the side effects of toggling the bottom panel maximize state.
 *
 * Entering maximize (false -> true) clears the active top tool IDs on both
 * sides so the activity bar no longer highlights them while the bottom panel
 * covers the top area. Leaving maximize (true -> false) leaves top tool
 * selection untouched (the restore button only flips the layout).
 */
export interface MaximizeToggleInput {
  bottomMaximized: boolean;
}
export interface MaximizeToggleOutcome {
  nextBottomMaximized: boolean;
  /** Whether the caller should clear the active left/right top tool IDs. */
  clearTopActive: boolean;
}
export function resolveMaximizeToggle({
  bottomMaximized,
}: MaximizeToggleInput): MaximizeToggleOutcome {
  const nextBottomMaximized = !bottomMaximized;
  return {
    nextBottomMaximized,
    clearTopActive: nextBottomMaximized,
  };
}

/**
 * Decide the outcome of clicking a top tool in the activity bar.
 *
 * Activating a top tool (toggling it on) while the bottom panel is maximized
 * restores the normal layout by reverting maximize. Toggling an already-active
 * top tool off does not touch maximize.
 */
export interface TopToolToggleInput {
  currentActiveId: string | null;
  clickedId: string;
  bottomMaximized: boolean;
}
export interface TopToolToggleOutcome {
  nextActiveId: string | null;
  /** Whether the caller should revert the bottom maximize state. */
  revertMaximize: boolean;
}
export function resolveTopToolToggle({
  currentActiveId,
  clickedId,
  bottomMaximized,
}: TopToolToggleInput): TopToolToggleOutcome {
  const willActivate = currentActiveId !== clickedId;
  return {
    nextActiveId: willActivate ? clickedId : null,
    revertMaximize: willActivate && bottomMaximized,
  };
}

export type TerminalPanelToolId = "git" | "ports" | "project" | "terminals";

export interface TerminalPanelShortcutInput {
  targetId: TerminalPanelToolId;
  activeLeftBottomId: string | null;
  activeRightTopId: string | null;
  bottomMaximized: boolean;
}

export interface TerminalPanelShortcutOutcome {
  nextActiveLeftBottomId: string | null;
  nextActiveRightTopId: string | null;
  nextBottomMaximized: boolean;
}

/**
 * Toggle one of the keyboard-accessible terminal panels. Git and Ports share
 * the left bottom slot; Fleet Terminal owns the right top slot. Only those
 * three target IDs are made mutually exclusive—other tools remain intact.
 */
export function resolveTerminalPanelShortcut({
  targetId,
  activeLeftBottomId,
  activeRightTopId,
  bottomMaximized,
}: TerminalPanelShortcutInput): TerminalPanelShortcutOutcome {
  if (targetId === "project") {
    const isActive = activeRightTopId === "project-info";
    return {
      nextActiveLeftBottomId: activeLeftBottomId,
      nextActiveRightTopId: isActive ? null : "project-info",
      nextBottomMaximized: bottomMaximized,
    };
  }

  if (targetId === "terminals") {
    const isActive = activeRightTopId === targetId;
    return {
      nextActiveLeftBottomId:
        isActive || !["git", "ports"].includes(activeLeftBottomId ?? "")
          ? activeLeftBottomId
          : null,
      nextActiveRightTopId: isActive ? null : targetId,
      nextBottomMaximized: isActive ? false : bottomMaximized,
    };
  }

  const isActive = activeLeftBottomId === targetId;
  return {
    nextActiveLeftBottomId: isActive ? null : targetId,
    nextActiveRightTopId:
      !isActive && activeRightTopId === "terminals" ? null : activeRightTopId,
    nextBottomMaximized: isActive ? false : bottomMaximized,
  };
}
