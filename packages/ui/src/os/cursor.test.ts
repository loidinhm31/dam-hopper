// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  CURSOR_DEFAULT_VAR,
  CURSOR_POINTER_VAR,
  CURSOR_THEME_ATTR,
  DEFAULT_CURSOR_CSS_VALUE,
  POINTER_CURSOR_CSS_VALUE,
  applyCursorThemeToElement,
  isForcedColorsActive,
  resolveEffectiveCursorTheme,
  syncCursorTheme,
} from "./cursor.js";

describe("cursor helper (C8)", () => {
  let shellRoot: HTMLDivElement;
  let portalContainer: HTMLDivElement;
  let originalMatchMedia: typeof window.matchMedia;

  beforeEach(() => {
    shellRoot = document.createElement("div");
    shellRoot.id = "os-shell-root";
    portalContainer = document.createElement("div");
    portalContainer.id = "owned-portal-container";
    document.body.appendChild(shellRoot);
    document.body.appendChild(portalContainer);

    originalMatchMedia = window.matchMedia;
  });

  afterEach(() => {
    shellRoot.remove();
    portalContainer.remove();
    window.matchMedia = originalMatchMedia;
    vi.restoreAllMocks();
  });

  it("applies theme mode with auto and pointer fallbacks to explicit roots only", () => {
    const cleanup = syncCursorTheme({
      theme: "theme",
      shellRoot,
      portalContainers: [portalContainer],
    });

    expect(shellRoot.getAttribute(CURSOR_THEME_ATTR)).toBe("theme");
    expect(shellRoot.style.getPropertyValue(CURSOR_DEFAULT_VAR)).toBe(
      DEFAULT_CURSOR_CSS_VALUE,
    );
    expect(shellRoot.style.getPropertyValue(CURSOR_POINTER_VAR)).toBe(
      POINTER_CURSOR_CSS_VALUE,
    );
    expect(DEFAULT_CURSOR_CSS_VALUE).toContain(", auto");
    expect(POINTER_CURSOR_CSS_VALUE).toContain(", pointer");

    expect(portalContainer.getAttribute(CURSOR_THEME_ATTR)).toBe("theme");
    expect(portalContainer.style.getPropertyValue(CURSOR_DEFAULT_VAR)).toBe(
      DEFAULT_CURSOR_CSS_VALUE,
    );

    // document.body must NEVER be touched (scoped capability only)
    expect(document.body.hasAttribute(CURSOR_THEME_ATTR)).toBe(false);
    expect(document.body.style.getPropertyValue(CURSOR_DEFAULT_VAR)).toBe("");

    cleanup();

    // Cleanup removes attributes and CSS variables
    expect(shellRoot.hasAttribute(CURSOR_THEME_ATTR)).toBe(false);
    expect(shellRoot.style.getPropertyValue(CURSOR_DEFAULT_VAR)).toBe("");
    expect(shellRoot.style.getPropertyValue(CURSOR_POINTER_VAR)).toBe("");
    expect(portalContainer.hasAttribute(CURSOR_THEME_ATTR)).toBe(false);
  });

  it("cleans up attributes and custom properties when switching to system theme", () => {
    syncCursorTheme({
      theme: "theme",
      shellRoot,
      portalContainers: [portalContainer],
    });

    expect(shellRoot.getAttribute(CURSOR_THEME_ATTR)).toBe("theme");

    // Switch to system
    syncCursorTheme({
      theme: "system",
      shellRoot,
      portalContainers: [portalContainer],
    });

    expect(shellRoot.hasAttribute(CURSOR_THEME_ATTR)).toBe(false);
    expect(shellRoot.style.getPropertyValue(CURSOR_DEFAULT_VAR)).toBe("");
    expect(shellRoot.style.getPropertyValue(CURSOR_POINTER_VAR)).toBe("");
    expect(portalContainer.hasAttribute(CURSOR_THEME_ATTR)).toBe(false);
  });

  it("forces system fallback when forced-colors: active matches", () => {
    window.matchMedia = vi.fn().mockImplementation((query: string) => ({
      matches: query === "(forced-colors: active)",
      media: query,
      onchange: null,
      addListener: vi.fn(),
      removeListener: vi.fn(),
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
      dispatchEvent: vi.fn(),
    }));

    expect(isForcedColorsActive()).toBe(true);
    expect(resolveEffectiveCursorTheme("theme")).toBe("system");

    syncCursorTheme({
      theme: "theme",
      shellRoot,
      portalContainers: [portalContainer],
    });

    // Forced colors takes precedence -> remains system (no theme attributes)
    expect(shellRoot.hasAttribute(CURSOR_THEME_ATTR)).toBe(false);
    expect(shellRoot.style.getPropertyValue(CURSOR_DEFAULT_VAR)).toBe("");
  });

  it("dynamically reacts to forced-colors media query changes", () => {
    let changeHandler: (() => void) | null = null;
    let forcedColorsMatches = false;

    window.matchMedia = vi.fn().mockImplementation((query: string) => ({
      get matches() {
        return query === "(forced-colors: active)" && forcedColorsMatches;
      },
      media: query,
      onchange: null,
      addListener: vi.fn(),
      removeListener: vi.fn(),
      addEventListener: vi.fn(
        (event: string, handler: EventListenerOrEventListenerObject) => {
          if (event === "change") {
            changeHandler = handler as () => void;
          }
        },
      ),
      removeEventListener: vi.fn(),
      dispatchEvent: vi.fn(),
    }));

    const cleanup = syncCursorTheme({
      theme: "theme",
      shellRoot,
    });

    expect(shellRoot.getAttribute(CURSOR_THEME_ATTR)).toBe("theme");

    // System changes to forced-colors: active
    forcedColorsMatches = true;
    changeHandler?.();

    expect(shellRoot.hasAttribute(CURSOR_THEME_ATTR)).toBe(false);

    // Forced-colors turns off
    forcedColorsMatches = false;
    changeHandler?.();

    expect(shellRoot.getAttribute(CURSOR_THEME_ATTR)).toBe("theme");

    cleanup();
  });

  it("prevents stale cleanup from unregistering a newer theme application on the same element", () => {
    const cleanup1 = syncCursorTheme({
      theme: "theme",
      shellRoot,
    });

    expect(shellRoot.getAttribute(CURSOR_THEME_ATTR)).toBe("theme");

    // A newer sync occurs (e.g. remount or settings change)
    syncCursorTheme({
      theme: "theme",
      shellRoot,
    });

    // Stale cleanup from first run is invoked
    cleanup1();

    // Newer application must NOT be erased
    expect(shellRoot.getAttribute(CURSOR_THEME_ATTR)).toBe("theme");
    expect(shellRoot.style.getPropertyValue(CURSOR_DEFAULT_VAR)).toBe(
      DEFAULT_CURSOR_CSS_VALUE,
    );
  });

  it("manages independent shell roots without cross-instance interference", () => {
    const rootA = document.createElement("div");
    const rootB = document.createElement("div");
    document.body.appendChild(rootA);
    document.body.appendChild(rootB);

    const cleanupA = syncCursorTheme({ theme: "theme", shellRoot: rootA });
    const cleanupB = syncCursorTheme({ theme: "system", shellRoot: rootB });

    expect(rootA.getAttribute(CURSOR_THEME_ATTR)).toBe("theme");
    expect(rootB.hasAttribute(CURSOR_THEME_ATTR)).toBe(false);

    cleanupA();
    expect(rootA.hasAttribute(CURSOR_THEME_ATTR)).toBe(false);

    cleanupB();
    rootA.remove();
    rootB.remove();
  });

  it("safely snapshots non-repeatable generator/Iterable portal containers", () => {
    function* containerGenerator() {
      yield portalContainer;
    }

    const cleanup = syncCursorTheme({
      theme: "theme",
      shellRoot,
      portalContainers: containerGenerator(),
    });

    expect(portalContainer.getAttribute(CURSOR_THEME_ATTR)).toBe("theme");

    cleanup();
    expect(portalContainer.hasAttribute(CURSOR_THEME_ATTR)).toBe(false);
  });

  it("always removes media query listener on cleanup even after overlapping syncs", () => {
    const removeEventListenerSpy = vi.fn();

    window.matchMedia = vi.fn().mockImplementation((query: string) => ({
      matches: false,
      media: query,
      onchange: null,
      addListener: vi.fn(),
      removeListener: vi.fn(),
      addEventListener: vi.fn(),
      removeEventListener: removeEventListenerSpy,
      dispatchEvent: vi.fn(),
    }));

    const cleanup1 = syncCursorTheme({ theme: "theme", shellRoot });
    const cleanup2 = syncCursorTheme({ theme: "theme", shellRoot });

    cleanup1();
    expect(removeEventListenerSpy).toHaveBeenCalledTimes(1);

    cleanup2();
    expect(removeEventListenerSpy).toHaveBeenCalledTimes(2);
  });

  it("applyCursorThemeToElement manages single element lifecycle", () => {
    const div = document.createElement("div");
    const cleanup = applyCursorThemeToElement(div, "theme");

    expect(div.getAttribute(CURSOR_THEME_ATTR)).toBe("theme");
    expect(div.style.getPropertyValue(CURSOR_DEFAULT_VAR)).toBe(
      DEFAULT_CURSOR_CSS_VALUE,
    );

    cleanup();
    expect(div.hasAttribute(CURSOR_THEME_ATTR)).toBe(false);
    expect(div.style.getPropertyValue(CURSOR_DEFAULT_VAR)).toBe("");
  });
});
