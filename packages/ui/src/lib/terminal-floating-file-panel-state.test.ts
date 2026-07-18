import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  clampTerminalFloatingFilePanelLayout,
  loadTerminalFloatingFilePanelLayout,
  loadTerminalFilePanelOpen,
  saveTerminalFilePanelOpen,
  saveTerminalFloatingFilePanelLayout,
  shouldAutoOpenTerminalFilePanel,
  TERMINAL_FILE_PANEL_DEFAULT_HEIGHT,
  TERMINAL_FILE_PANEL_DEFAULT_TOP,
  TERMINAL_FILE_PANEL_DEFAULT_WIDTH,
  TERMINAL_FILE_PANEL_HEIGHT_KEY,
  TERMINAL_FILE_PANEL_LEFT_KEY,
  TERMINAL_FILE_PANEL_OPEN_KEY,
  TERMINAL_FILE_PANEL_TOP_KEY,
  TERMINAL_FILE_PANEL_WIDTH_KEY,
} from "./terminal-floating-file-panel-state.js";

const localStorageMock = {
  getItem: vi.fn<(key: string) => string | null>(),
  setItem: vi.fn<(key: string, value: string) => void>(),
  removeItem: vi.fn<(key: string) => void>(),
};

describe("terminal-floating-file-panel-state", () => {
  beforeEach(() => {
    localStorageMock.getItem.mockReset();
    localStorageMock.setItem.mockReset();
    localStorageMock.removeItem.mockReset();
    vi.stubGlobal("localStorage", localStorageMock);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("loads the persisted open state from localStorage", () => {
    localStorageMock.getItem.mockReturnValue("true");

    expect(loadTerminalFilePanelOpen()).toBe(true);
    expect(localStorageMock.getItem).toHaveBeenCalledWith(
      TERMINAL_FILE_PANEL_OPEN_KEY,
    );
  });

  it("falls back closed when localStorage is unavailable", () => {
    localStorageMock.getItem.mockImplementation(() => {
      throw new Error("blocked");
    });

    expect(loadTerminalFilePanelOpen()).toBe(false);
  });

  it("persists the open state", () => {
    saveTerminalFilePanelOpen(true);

    expect(localStorageMock.setItem).toHaveBeenCalledWith(
      TERMINAL_FILE_PANEL_OPEN_KEY,
      "true",
    );
  });

  it("only auto-opens for desktop terminal mode", () => {
    expect(shouldAutoOpenTerminalFilePanel("terminal", false)).toBe(true);
    expect(shouldAutoOpenTerminalFilePanel("terminal", true)).toBe(false);
    expect(shouldAutoOpenTerminalFilePanel("ide", false)).toBe(false);
  });

  it("loads the persisted panel layout and falls back to defaults", () => {
    localStorageMock.getItem.mockImplementation((key: string) => {
      switch (key) {
        case TERMINAL_FILE_PANEL_WIDTH_KEY:
          return "1040";
        case TERMINAL_FILE_PANEL_HEIGHT_KEY:
          return "720";
        case TERMINAL_FILE_PANEL_TOP_KEY:
          return "32";
        case TERMINAL_FILE_PANEL_LEFT_KEY:
          return "48";
        default:
          return null;
      }
    });

    expect(loadTerminalFloatingFilePanelLayout()).toEqual({
      width: 1040,
      height: 720,
      top: 32,
      left: 48,
    });

    localStorageMock.getItem.mockReturnValue(null);
    expect(loadTerminalFloatingFilePanelLayout()).toEqual({
      width: TERMINAL_FILE_PANEL_DEFAULT_WIDTH,
      height: TERMINAL_FILE_PANEL_DEFAULT_HEIGHT,
      top: TERMINAL_FILE_PANEL_DEFAULT_TOP,
      left: null,
    });
  });

  it("persists panel layout and clears left when anchored to the right", () => {
    saveTerminalFloatingFilePanelLayout({
      width: 980,
      height: 640,
      top: 24,
      left: null,
    });

    expect(localStorageMock.setItem).toHaveBeenCalledWith(
      TERMINAL_FILE_PANEL_WIDTH_KEY,
      "980",
    );
    expect(localStorageMock.setItem).toHaveBeenCalledWith(
      TERMINAL_FILE_PANEL_HEIGHT_KEY,
      "640",
    );
    expect(localStorageMock.setItem).toHaveBeenCalledWith(
      TERMINAL_FILE_PANEL_TOP_KEY,
      "24",
    );
    expect(localStorageMock.removeItem).toHaveBeenCalledWith(
      TERMINAL_FILE_PANEL_LEFT_KEY,
    );
  });

  it("clamps panel layout to the available bounds", () => {
    expect(
      clampTerminalFloatingFilePanelLayout(
        {
          width: 4000,
          height: 1000,
          top: -20,
          left: 9999,
        },
        { width: 1200, height: 800 },
      ),
    ).toEqual({
      width: 1168,
      height: 768,
      top: 16,
      left: 16,
    });
  });

  it("allows Explorer to resize to the viewport bounds while preserving gutters", () => {
    expect(
      clampTerminalFloatingFilePanelLayout(
        {
          width: 4000,
          height: 2000,
          top: -20,
          left: 9999,
        },
        { width: 1920, height: 1080 },
      ),
    ).toEqual({
      width: 1888,
      height: 1048,
      top: 16,
      left: 16,
    });
  });
});
