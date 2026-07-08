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

const TOP_AREA_BASE = "flex-1 flex min-w-0 overflow-hidden";
const BOTTOM_OUTER_BASE = "flex flex-col bg-[var(--color-surface)]";
const INNER_BASE = "flex border-t border-[var(--color-border)] overflow-hidden";

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
