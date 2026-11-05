import defaultCursorSvg from "./assets/cursor-default.svg";
import pointerCursorSvg from "./assets/cursor-pointer.svg";

export type CursorTheme = "system" | "theme";

export const CURSOR_THEME_ATTR = "data-cursor-theme";
export const CURSOR_DEFAULT_VAR = "--os-cursor-default";
export const CURSOR_POINTER_VAR = "--os-cursor-pointer";

export const DEFAULT_CURSOR_HOTSPOT = "0 0";
export const POINTER_CURSOR_HOTSPOT = "5 0";

export const DEFAULT_CURSOR_CSS_VALUE = `url("${defaultCursorSvg}") ${DEFAULT_CURSOR_HOTSPOT}, auto`;
export const POINTER_CURSOR_CSS_VALUE = `url("${pointerCursorSvg}") ${POINTER_CURSOR_HOTSPOT}, pointer`;

export interface SyncCursorThemeOptions {
  theme: CursorTheme;
  shellRoot: HTMLElement | null;
  portalContainers?: Iterable<HTMLElement | null>;
}

/** Per-element ownership token to avoid cross-instance interference and stale cleanups. */
const activeElementTokens = new WeakMap<HTMLElement, symbol>();

export function isForcedColorsActive(): boolean {
  if (typeof window === "undefined" || typeof window.matchMedia !== "function") {
    return false;
  }
  return window.matchMedia("(forced-colors: active)").matches;
}

export function resolveEffectiveCursorTheme(theme: CursorTheme): CursorTheme {
  if (isForcedColorsActive()) {
    return "system";
  }
  return theme;
}

export function applyCursorThemeToElement(
  element: HTMLElement | null,
  theme: CursorTheme,
): () => void {
  if (!element) return () => {};
  const invocationToken = Symbol("element-cursor-sync");
  activeElementTokens.set(element, invocationToken);

  const effectiveTheme = resolveEffectiveCursorTheme(theme);
  if (effectiveTheme === "theme") {
    element.setAttribute(CURSOR_THEME_ATTR, "theme");
    element.style.setProperty(CURSOR_DEFAULT_VAR, DEFAULT_CURSOR_CSS_VALUE);
    element.style.setProperty(CURSOR_POINTER_VAR, POINTER_CURSOR_CSS_VALUE);
  } else {
    element.removeAttribute(CURSOR_THEME_ATTR);
    element.style.removeProperty(CURSOR_DEFAULT_VAR);
    element.style.removeProperty(CURSOR_POINTER_VAR);
  }

  return () => {
    if (activeElementTokens.get(element) === invocationToken) {
      activeElementTokens.delete(element);
      element.removeAttribute(CURSOR_THEME_ATTR);
      element.style.removeProperty(CURSOR_DEFAULT_VAR);
      element.style.removeProperty(CURSOR_POINTER_VAR);
    }
  };
}

export function syncCursorTheme({
  theme,
  shellRoot,
  portalContainers = [],
}: SyncCursorThemeOptions): () => void {
  const invocationToken = Symbol("sync-cursor-theme");

  // Snapshot portalContainers once to support non-repeatable Iterables/generators safely
  const containers = Array.from(portalContainers).filter(
    (c): c is HTMLElement => c instanceof HTMLElement,
  );

  const getTargets = (): HTMLElement[] => {
    const targets: HTMLElement[] = [];
    if (shellRoot instanceof HTMLElement) targets.push(shellRoot);
    for (const c of containers) {
      if (c instanceof HTMLElement) targets.push(c);
    }
    return targets;
  };

  const updateTargets = () => {
    const effective = resolveEffectiveCursorTheme(theme);
    const targets = getTargets();

    for (const el of targets) {
      activeElementTokens.set(el, invocationToken);
      if (effective === "theme") {
        el.setAttribute(CURSOR_THEME_ATTR, "theme");
        el.style.setProperty(CURSOR_DEFAULT_VAR, DEFAULT_CURSOR_CSS_VALUE);
        el.style.setProperty(CURSOR_POINTER_VAR, POINTER_CURSOR_CSS_VALUE);
      } else {
        el.removeAttribute(CURSOR_THEME_ATTR);
        el.style.removeProperty(CURSOR_DEFAULT_VAR);
        el.style.removeProperty(CURSOR_POINTER_VAR);
      }
    }
  };

  updateTargets();

  let mediaQuery: MediaQueryList | null = null;
  const onMediaChange = () => {
    updateTargets();
  };

  if (typeof window !== "undefined" && typeof window.matchMedia === "function") {
    mediaQuery = window.matchMedia("(forced-colors: active)");
    mediaQuery.addEventListener?.("change", onMediaChange);
  }

  return () => {
    // Unconditionally detach media-query listener to prevent leaks
    mediaQuery?.removeEventListener?.("change", onMediaChange);

    // Only clean up elements still owned by this invocation
    const targets = getTargets();
    for (const el of targets) {
      if (activeElementTokens.get(el) === invocationToken) {
        activeElementTokens.delete(el);
        el.removeAttribute(CURSOR_THEME_ATTR);
        el.style.removeProperty(CURSOR_DEFAULT_VAR);
        el.style.removeProperty(CURSOR_POINTER_VAR);
      }
    }
  };
}
