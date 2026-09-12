export type HtmlMode = "edit" | "split" | "preview";

export const HTML_VIEW_MODE_STORAGE_KEY = "dam-hopper:html-view-mode:v1";
export const DEFAULT_HTML_MODE: HtmlMode = "edit";

export interface HtmlViewModeStorage {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
}

function defaultStorage(): HtmlViewModeStorage | undefined {
  try {
    return globalThis.localStorage;
  } catch {
    return undefined;
  }
}

export function isHtmlMode(value: unknown): value is HtmlMode {
  return value === "edit" || value === "split" || value === "preview";
}

export function loadHtmlViewMode(
  storage: HtmlViewModeStorage | undefined = defaultStorage(),
): HtmlMode {
  try {
    const value = storage?.getItem(HTML_VIEW_MODE_STORAGE_KEY);
    return isHtmlMode(value) ? value : DEFAULT_HTML_MODE;
  } catch {
    return DEFAULT_HTML_MODE;
  }
}

export function saveHtmlViewMode(
  mode: HtmlMode,
  storage: HtmlViewModeStorage | undefined = defaultStorage(),
): void {
  if (!isHtmlMode(mode)) return;

  try {
    storage?.setItem(HTML_VIEW_MODE_STORAGE_KEY, mode);
  } catch {
    // Browser storage is optional UI state.
  }
}
