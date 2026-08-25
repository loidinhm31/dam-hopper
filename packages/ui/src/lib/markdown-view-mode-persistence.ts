export type MarkdownMode = "edit" | "split" | "preview";

export const MARKDOWN_VIEW_MODE_STORAGE_KEY =
  "dam-hopper:markdown-view-mode:v1";
export const DEFAULT_MARKDOWN_MODE: MarkdownMode = "split";

export interface MarkdownViewModeStorage {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
}

function defaultStorage(): MarkdownViewModeStorage | undefined {
  try {
    return globalThis.localStorage;
  } catch {
    return undefined;
  }
}

export function isMarkdownMode(value: unknown): value is MarkdownMode {
  return value === "edit" || value === "split" || value === "preview";
}

export function loadMarkdownViewMode(
  storage: MarkdownViewModeStorage | undefined = defaultStorage(),
): MarkdownMode {
  try {
    const value = storage?.getItem(MARKDOWN_VIEW_MODE_STORAGE_KEY);
    return isMarkdownMode(value) ? value : DEFAULT_MARKDOWN_MODE;
  } catch {
    return DEFAULT_MARKDOWN_MODE;
  }
}

export function saveMarkdownViewMode(
  mode: MarkdownMode,
  storage: MarkdownViewModeStorage | undefined = defaultStorage(),
): void {
  if (!isMarkdownMode(mode)) return;

  try {
    storage?.setItem(MARKDOWN_VIEW_MODE_STORAGE_KEY, mode);
  } catch {
    // Browser storage is optional UI state.
  }
}
