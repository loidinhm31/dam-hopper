export const BROWSER_DEBUG_VIEWPORT_STORAGE_VERSION = 1;
export const BROWSER_DEBUG_VIEWPORT_STORAGE_PREFIX =
  "dam-hopper:browser-debug-viewport:v1";
export const BROWSER_DEBUG_VIEWPORT_MIN_WIDTH = 160;
export const BROWSER_DEBUG_VIEWPORT_MIN_HEIGHT = 160;
export const BROWSER_DEBUG_VIEWPORT_MAX_WIDTH = 4096;
export const BROWSER_DEBUG_VIEWPORT_MAX_HEIGHT = 4096;
export const BROWSER_DEBUG_VIEWPORT_RESIZE_STEP = 16;
export const BROWSER_DEBUG_VIEWPORT_DIMENSION_ERROR =
  "Enter a whole number from 160 to 4096 CSS pixels.";

export interface BrowserDebugViewportSize {
  width: number;
  height: number;
}

export type BrowserDebugViewportState =
  | {
      mode: "responsive";
      customSize: BrowserDebugViewportSize | null;
    }
  | {
      mode: "custom";
      customSize: BrowserDebugViewportSize;
    };

export interface BrowserDebugViewportStorage {
  getItem: (key: string) => string | null;
  setItem: (key: string, value: string) => void;
}

export const DEFAULT_BROWSER_DEBUG_VIEWPORT: BrowserDebugViewportState = {
  mode: "responsive",
  customSize: null,
};

function defaultStorage(): BrowserDebugViewportStorage | undefined {
  try {
    return globalThis.localStorage;
  } catch {
    return undefined;
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

export function browserDebugViewportStorageKey(platform?: string): string {
  const normalized = (platform ?? "native")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9_-]+/g, "-")
    .replace(/^-+|-+$/g, "");
  return `${BROWSER_DEBUG_VIEWPORT_STORAGE_PREFIX}:${normalized || "native"}`;
}

export function isBrowserDebugViewportSize(
  value: unknown,
): value is BrowserDebugViewportSize {
  return (
    isRecord(value) &&
    typeof value.width === "number" &&
    typeof value.height === "number" &&
    Number.isSafeInteger(value.width) &&
    Number.isSafeInteger(value.height) &&
    value.width >= BROWSER_DEBUG_VIEWPORT_MIN_WIDTH &&
    value.width <= BROWSER_DEBUG_VIEWPORT_MAX_WIDTH &&
    value.height >= BROWSER_DEBUG_VIEWPORT_MIN_HEIGHT &&
    value.height <= BROWSER_DEBUG_VIEWPORT_MAX_HEIGHT
  );
}

export function clampBrowserDebugViewportSize(
  value: Pick<BrowserDebugViewportSize, "width" | "height">,
): BrowserDebugViewportSize | null {
  if (!Number.isFinite(value.width) || !Number.isFinite(value.height)) {
    return null;
  }

  return {
    width: Math.min(
      BROWSER_DEBUG_VIEWPORT_MAX_WIDTH,
      Math.max(BROWSER_DEBUG_VIEWPORT_MIN_WIDTH, Math.round(value.width)),
    ),
    height: Math.min(
      BROWSER_DEBUG_VIEWPORT_MAX_HEIGHT,
      Math.max(BROWSER_DEBUG_VIEWPORT_MIN_HEIGHT, Math.round(value.height)),
    ),
  };
}

function parsePersistedState(value: unknown): BrowserDebugViewportState | null {
  if (
    !isRecord(value) ||
    value.version !== BROWSER_DEBUG_VIEWPORT_STORAGE_VERSION
  ) {
    return null;
  }

  if (value.mode === "responsive") {
    if (
      value.customSize !== null &&
      !isBrowserDebugViewportSize(value.customSize)
    ) {
      return null;
    }
    return {
      mode: "responsive",
      customSize: value.customSize as BrowserDebugViewportSize | null,
    };
  }

  if (value.mode === "custom" && isBrowserDebugViewportSize(value.customSize)) {
    return { mode: "custom", customSize: value.customSize };
  }
  return null;
}

export function loadBrowserDebugViewport(
  platform?: string,
  storage: BrowserDebugViewportStorage | undefined = defaultStorage(),
): BrowserDebugViewportState {
  try {
    const raw = storage?.getItem(browserDebugViewportStorageKey(platform));
    if (!raw) return DEFAULT_BROWSER_DEBUG_VIEWPORT;
    return (
      parsePersistedState(JSON.parse(raw)) ?? DEFAULT_BROWSER_DEBUG_VIEWPORT
    );
  } catch {
    return DEFAULT_BROWSER_DEBUG_VIEWPORT;
  }
}

export function saveBrowserDebugViewport(
  state: BrowserDebugViewportState,
  platform?: string,
  storage: BrowserDebugViewportStorage | undefined = defaultStorage(),
): void {
  if (
    (state.mode === "custom" &&
      !isBrowserDebugViewportSize(state.customSize)) ||
    (state.mode === "responsive" &&
      state.customSize !== null &&
      !isBrowserDebugViewportSize(state.customSize))
  ) {
    return;
  }

  try {
    storage?.setItem(
      browserDebugViewportStorageKey(platform),
      JSON.stringify({
        version: BROWSER_DEBUG_VIEWPORT_STORAGE_VERSION,
        ...state,
      }),
    );
  } catch {
    // Browser storage is optional UI state.
  }
}

export function enterBrowserDebugViewportCustomMode(
  state: BrowserDebugViewportState,
  responsiveSize: Pick<BrowserDebugViewportSize, "width" | "height"> | null,
): BrowserDebugViewportState {
  if (state.mode === "custom") return state;
  if (state.customSize) return { mode: "custom", customSize: state.customSize };
  if (!responsiveSize) return state;

  const customSize = clampBrowserDebugViewportSize(responsiveSize);
  if (!customSize || responsiveSize.width <= 0 || responsiveSize.height <= 0) {
    return state;
  }
  return { mode: "custom", customSize };
}

export function setBrowserDebugViewportMode(
  state: BrowserDebugViewportState,
  mode: BrowserDebugViewportState["mode"],
): BrowserDebugViewportState {
  if (mode === state.mode) return state;
  return mode === "responsive" ? { mode, customSize: state.customSize } : state;
}

export function updateBrowserDebugViewportSize(
  state: BrowserDebugViewportState,
  customSize: BrowserDebugViewportSize,
): BrowserDebugViewportState {
  if (state.mode !== "custom" || !isBrowserDebugViewportSize(customSize)) {
    return state;
  }
  return { mode: "custom", customSize };
}

export function stepBrowserDebugViewport(
  state: BrowserDebugViewportState,
  direction: "increase" | "decrease",
): BrowserDebugViewportState {
  if (state.mode !== "custom") return state;
  const delta =
    direction === "increase"
      ? BROWSER_DEBUG_VIEWPORT_RESIZE_STEP
      : -BROWSER_DEBUG_VIEWPORT_RESIZE_STEP;
  const customSize = clampBrowserDebugViewportSize({
    width: state.customSize.width + delta,
    height: state.customSize.height + delta,
  });
  if (!customSize) return state;
  return {
    mode: "custom",
    customSize,
  };
}

export function validateBrowserDebugViewportDimension(value: string): {
  value: number | null;
  error: string | null;
} {
  const trimmed = value.trim();
  if (!/^\d+$/.test(trimmed)) {
    return { value: null, error: BROWSER_DEBUG_VIEWPORT_DIMENSION_ERROR };
  }

  const parsed = Number(trimmed);
  if (
    !Number.isSafeInteger(parsed) ||
    parsed < BROWSER_DEBUG_VIEWPORT_MIN_WIDTH ||
    parsed > BROWSER_DEBUG_VIEWPORT_MAX_WIDTH
  ) {
    return { value: null, error: BROWSER_DEBUG_VIEWPORT_DIMENSION_ERROR };
  }
  return { value: parsed, error: null };
}
