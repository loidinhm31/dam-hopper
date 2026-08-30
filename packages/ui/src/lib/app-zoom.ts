export const APP_ZOOM_STORAGE_VERSION = 1;
export const APP_ZOOM_STORAGE_KEY = "dam-hopper:app-zoom:v1";
export const APP_ZOOM_CHANGE_EVENT = "dam-hopper:app-zoom-change";
export const APP_ZOOM_LEVELS = [50, 60, 70, 80, 90, 100, 110, 120] as const;
export const APP_ZOOM_MIN = APP_ZOOM_LEVELS[0];
export const APP_ZOOM_MAX = APP_ZOOM_LEVELS[APP_ZOOM_LEVELS.length - 1];
export const APP_ZOOM_STEP = 10;
export const DEFAULT_APP_ZOOM_LEVEL = 100;

export type AppZoomLevel = (typeof APP_ZOOM_LEVELS)[number];
export type AppZoomDirection = "increase" | "decrease";

export interface AppZoomStorage {
  getItem: (key: string) => string | null;
  setItem: (key: string, value: string) => void;
}

function defaultStorage(): AppZoomStorage | undefined {
  try {
    return globalThis.localStorage;
  } catch {
    return undefined;
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

export function isAppZoomLevel(value: unknown): value is AppZoomLevel {
  return (
    typeof value === "number" &&
    Number.isInteger(value) &&
    APP_ZOOM_LEVELS.includes(value as AppZoomLevel)
  );
}

export function stepAppZoom(
  level: unknown,
  direction: AppZoomDirection,
): AppZoomLevel {
  if (!isAppZoomLevel(level)) return DEFAULT_APP_ZOOM_LEVEL;
  const currentLevel = level;
  const currentIndex = APP_ZOOM_LEVELS.indexOf(currentLevel);
  const nextIndex =
    direction === "increase" ? currentIndex + 1 : currentIndex - 1;

  return APP_ZOOM_LEVELS[
    Math.min(APP_ZOOM_LEVELS.length - 1, Math.max(0, nextIndex))
  ];
}

export function loadAppZoom(
  storage: AppZoomStorage | undefined = defaultStorage(),
): AppZoomLevel {
  try {
    const raw = storage?.getItem(APP_ZOOM_STORAGE_KEY);
    if (!raw) return DEFAULT_APP_ZOOM_LEVEL;

    const parsed: unknown = JSON.parse(raw);
    if (
      !isRecord(parsed) ||
      parsed.version !== APP_ZOOM_STORAGE_VERSION ||
      !isAppZoomLevel(parsed.zoom)
    ) {
      return DEFAULT_APP_ZOOM_LEVEL;
    }
    return parsed.zoom;
  } catch {
    return DEFAULT_APP_ZOOM_LEVEL;
  }
}

export function saveAppZoom(
  level: unknown,
  storage: AppZoomStorage | undefined = defaultStorage(),
): void {
  if (!isAppZoomLevel(level)) return;

  try {
    storage?.setItem(
      APP_ZOOM_STORAGE_KEY,
      JSON.stringify({
        version: APP_ZOOM_STORAGE_VERSION,
        zoom: level,
      }),
    );
  } catch {
    // Browser storage is optional UI state.
  }
}

function parseZoomFactor(value: string): number | null {
  const normalized = value.trim();
  if (!normalized) return null;

  const parsed = Number.parseFloat(normalized);
  if (!Number.isFinite(parsed) || parsed <= 0) return null;

  return normalized.endsWith("%") ? parsed / 100 : parsed;
}

/**
 * Return the CSS zoom factor applied to the shared document root.
 *
 * Geometry APIs expose values after CSS zoom has been applied. DOM overlays
 * normalize those values back to logical CSS pixels; native child hosts use
 * this factor as their page zoom while positioning in rendered coordinates.
 */
export function getAppZoomFactor(): number {
  if (typeof document === "undefined") return 1;

  try {
    const root = document.documentElement;
    const inlineZoom = parseZoomFactor(root.style.zoom);
    if (inlineZoom !== null) return inlineZoom;

    const computedZoom = parseZoomFactor(getComputedStyle(root).zoom);
    return computedZoom ?? 1;
  } catch {
    return 1;
  }
}
