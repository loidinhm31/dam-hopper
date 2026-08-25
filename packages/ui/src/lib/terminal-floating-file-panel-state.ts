import type { WorkspaceMode } from "@/lib/workspace-mode.js";

export const TERMINAL_FILE_PANEL_OPEN_KEY =
  "dam-hopper:terminal-floating-file-panel-open";
export const TERMINAL_FILE_PANEL_WIDTH_KEY =
  "dam-hopper:terminal-floating-file-panel-width";
export const TERMINAL_FILE_PANEL_HEIGHT_KEY =
  "dam-hopper:terminal-floating-file-panel-height";
export const TERMINAL_FILE_PANEL_TOP_KEY =
  "dam-hopper:terminal-floating-file-panel-top";
export const TERMINAL_FILE_PANEL_LEFT_KEY =
  "dam-hopper:terminal-floating-file-panel-left";
export const TERMINAL_FILE_PANEL_TREE_WIDTH_KEY =
  "dam-hopper:terminal-floating-file-panel-tree-width";

export const TERMINAL_FILE_PANEL_MARGIN = 16;
export const TERMINAL_FILE_PANEL_MIN_WIDTH = 720;
export const TERMINAL_FILE_PANEL_DEFAULT_WIDTH = 960;
export const TERMINAL_FILE_PANEL_MIN_HEIGHT = 420;
export const TERMINAL_FILE_PANEL_DEFAULT_HEIGHT = 680;
export const TERMINAL_FILE_PANEL_DEFAULT_TOP = TERMINAL_FILE_PANEL_MARGIN;

export const TERMINAL_FILE_PANEL_TREE_MIN_WIDTH = 220;
export const TERMINAL_FILE_PANEL_TREE_MAX_WIDTH = 420;
export const TERMINAL_FILE_PANEL_TREE_DEFAULT_WIDTH = 280;

export interface TerminalFloatingFilePanelLayout {
  width: number;
  height: number;
  top: number;
  left: number | null;
}

export interface TerminalFloatingPanelConstraints {
  minWidth: number;
  maxWidth: number;
  minHeight: number;
  maxHeight: number;
  margin?: number;
}

function loadStoredNumber(key: string, fallback: number) {
  try {
    const stored = localStorage.getItem(key);
    if (!stored) return fallback;
    const parsed = parseInt(stored, 10);
    return Number.isNaN(parsed) ? fallback : parsed;
  } catch {
    return fallback;
  }
}

export function loadTerminalFilePanelOpen() {
  try {
    return localStorage.getItem(TERMINAL_FILE_PANEL_OPEN_KEY) === "true";
  } catch {
    return false;
  }
}

export function saveTerminalFilePanelOpen(open: boolean) {
  try {
    localStorage.setItem(TERMINAL_FILE_PANEL_OPEN_KEY, String(open));
  } catch {}
}

export function clampTerminalFloatingPanelLayout(
  layout: TerminalFloatingFilePanelLayout,
  bounds: {
    width: number;
    height: number;
  },
  {
    minWidth,
    maxWidth,
    minHeight,
    maxHeight,
    margin = TERMINAL_FILE_PANEL_MARGIN,
  }: TerminalFloatingPanelConstraints,
) {
  const widthLimit = Math.max(
    minWidth,
    bounds.width - margin * 2,
  );
  const heightLimit = Math.max(
    minHeight,
    bounds.height - margin * 2,
  );
  const width = Math.min(
    Math.max(layout.width, minWidth),
    Math.min(maxWidth, widthLimit),
  );
  const height = Math.min(
    Math.max(layout.height, minHeight),
    Math.min(maxHeight, heightLimit),
  );
  const top = Math.min(
    Math.max(layout.top, margin),
    Math.max(margin, bounds.height - height - margin),
  );
  const left =
    layout.left === null
      ? null
      : Math.min(
          Math.max(layout.left, margin),
          Math.max(
            margin,
            bounds.width - width - margin,
          ),
        );

  return {
    width,
    height,
    top,
    left,
  };
}

export function clampTerminalFloatingFilePanelLayout(
  layout: TerminalFloatingFilePanelLayout,
  bounds: {
    width: number;
    height: number;
  },
) {
  return clampTerminalFloatingPanelLayout(layout, bounds, {
    minWidth: TERMINAL_FILE_PANEL_MIN_WIDTH,
    maxWidth: Number.POSITIVE_INFINITY,
    minHeight: TERMINAL_FILE_PANEL_MIN_HEIGHT,
    maxHeight: Number.POSITIVE_INFINITY,
  });
}

export function loadTerminalFloatingFilePanelLayout() {
  return {
    width: loadStoredNumber(
      TERMINAL_FILE_PANEL_WIDTH_KEY,
      TERMINAL_FILE_PANEL_DEFAULT_WIDTH,
    ),
    height: loadStoredNumber(
      TERMINAL_FILE_PANEL_HEIGHT_KEY,
      TERMINAL_FILE_PANEL_DEFAULT_HEIGHT,
    ),
    top: loadStoredNumber(
      TERMINAL_FILE_PANEL_TOP_KEY,
      TERMINAL_FILE_PANEL_DEFAULT_TOP,
    ),
    left: (() => {
      try {
        const stored = localStorage.getItem(TERMINAL_FILE_PANEL_LEFT_KEY);
        if (!stored) return null;
        const parsed = parseInt(stored, 10);
        return Number.isNaN(parsed) ? null : parsed;
      } catch {
        return null;
      }
    })(),
  } satisfies TerminalFloatingFilePanelLayout;
}

export function saveTerminalFloatingFilePanelLayout(
  layout: TerminalFloatingFilePanelLayout,
) {
  try {
    localStorage.setItem(TERMINAL_FILE_PANEL_WIDTH_KEY, String(layout.width));
    localStorage.setItem(TERMINAL_FILE_PANEL_HEIGHT_KEY, String(layout.height));
    localStorage.setItem(TERMINAL_FILE_PANEL_TOP_KEY, String(layout.top));
    if (layout.left === null) {
      localStorage.removeItem(TERMINAL_FILE_PANEL_LEFT_KEY);
    } else {
      localStorage.setItem(TERMINAL_FILE_PANEL_LEFT_KEY, String(layout.left));
    }
  } catch {}
}

export function shouldAutoOpenTerminalFilePanel(
  workspaceMode: WorkspaceMode,
  isCompactWorkspace: boolean,
) {
  return workspaceMode === "terminal" && !isCompactWorkspace;
}
