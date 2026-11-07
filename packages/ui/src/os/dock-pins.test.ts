// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  _reloadDockPinsFromStorageForTesting,
  getDockPinsSnapshot,
  handleDockPinsStorageEvent,
  resetDockPins,
  setDockPins,
  subscribeDockPins,
  toggleDockPin,
} from "./dock-pins.js";
import {
  DEFAULT_DOCK_PINS,
  notifyDockPinsImported,
  OS_DOCK_STORAGE_KEY,
} from "./persistence.js";
import type { OsAppId } from "./types.js";

describe("dock-pins", () => {
  beforeEach(() => {
    localStorage.clear();
    _reloadDockPinsFromStorageForTesting();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("returns default pins when storage is empty", () => {
    const pins = getDockPinsSnapshot();
    expect(pins).toEqual(DEFAULT_DOCK_PINS);
  });

  it("provides a reference-stable snapshot when unchanged", () => {
    const snap1 = getDockPinsSnapshot();
    const snap2 = getDockPinsSnapshot();
    expect(snap1).toBe(snap2);
  });

  it("persists valid pins and notifies subscribers", () => {
    const listener = vi.fn();
    const unsubscribe = subscribeDockPins(listener);

    const result = setDockPins(["editor", "terminals"]);
    expect(result).toEqual({ persisted: true });
    expect(getDockPinsSnapshot()).toEqual(["editor", "terminals"]);
    expect(listener).toHaveBeenCalledTimes(1);

    expect(JSON.parse(localStorage.getItem(OS_DOCK_STORAGE_KEY)!)).toEqual([
      "editor",
      "terminals",
    ]);

    unsubscribe();
  });

  it("preserves valid empty pins array [] (does not fall back to defaults)", () => {
    const result = setDockPins([]);
    expect(result).toEqual({ persisted: true });
    expect(getDockPinsSnapshot()).toEqual([]);
    expect(localStorage.getItem(OS_DOCK_STORAGE_KEY)).toBe("[]");

    // Re-reading from storage should still preserve []
    _reloadDockPinsFromStorageForTesting();
    expect(getDockPinsSnapshot()).toEqual([]);
  });

  it("filters unknown IDs and removes duplicates preserving first-seen order", () => {
    // "not-an-app" should be filtered; "terminals" duplicate should be removed
    const dirty = [
      "terminals",
      "nonexistent-app",
      "editor",
      "terminals",
      "files",
    ] as unknown as OsAppId[];

    const result = setDockPins(dirty);
    expect(result).toEqual({ persisted: true });
    expect(getDockPinsSnapshot()).toEqual(["terminals", "editor", "files"]);
    expect(JSON.parse(localStorage.getItem(OS_DOCK_STORAGE_KEY)!)).toEqual([
      "terminals",
      "editor",
      "files",
    ]);
  });

  it("toggles pins correctly (add when absent, remove when present)", () => {
    setDockPins(["terminals", "files"]);

    // Add browser
    const resAdd = toggleDockPin("browser");
    expect(resAdd).toEqual({ persisted: true });
    expect(getDockPinsSnapshot()).toEqual(["terminals", "files", "browser"]);

    // Remove files
    const resRemove = toggleDockPin("files");
    expect(resRemove).toEqual({ persisted: true });
    expect(getDockPinsSnapshot()).toEqual(["terminals", "browser"]);
  });

  it("handles storage write errors honestly and preserves prior snapshot", () => {
    setDockPins(["terminals", "editor"]);
    const prior = getDockPinsSnapshot();

    const setItemSpy = vi
      .spyOn(Storage.prototype, "setItem")
      .mockImplementation(() => {
        throw new Error("QuotaExceededError");
      });

    const result = setDockPins(["browser"]);
    expect(result.persisted).toBe(false);
    if (!result.persisted) {
      expect(result.reason).toContain("QuotaExceededError");
    }

    // Prior snapshot is retained
    expect(getDockPinsSnapshot()).toBe(prior);
    expect(getDockPinsSnapshot()).toEqual(["terminals", "editor"]);

    setItemSpy.mockRestore();
  });

  it("handles storage events from other tabs and updates snapshot without write-back", () => {
    const listener = vi.fn();
    const unsubscribe = subscribeDockPins(listener);
    const setItemSpy = vi.spyOn(Storage.prototype, "setItem");

    // Storage event for other key is ignored
    handleDockPinsStorageEvent({
      key: "unrelated-key",
      newValue: JSON.stringify(["terminals"]),
      storageArea: localStorage,
    } as StorageEvent);
    expect(listener).not.toHaveBeenCalled();

    // Storage event for OS_DOCK_STORAGE_KEY with new pins
    handleDockPinsStorageEvent({
      key: OS_DOCK_STORAGE_KEY,
      newValue: JSON.stringify(["git", "changes"]),
      storageArea: localStorage,
    } as StorageEvent);

    expect(getDockPinsSnapshot()).toEqual(["git", "changes"]);
    expect(listener).toHaveBeenCalledTimes(1);

    // Verified that handleDockPinsStorageEvent did NOT write back to localStorage
    expect(setItemSpy).not.toHaveBeenCalled();

    // Key cleared (newValue: null) resets to defaults
    handleDockPinsStorageEvent({
      key: OS_DOCK_STORAGE_KEY,
      newValue: null,
      storageArea: localStorage,
    } as StorageEvent);
    expect(getDockPinsSnapshot()).toEqual(DEFAULT_DOCK_PINS);

    unsubscribe();
  });

  it("synchronizes via persistence import notification seam", () => {
    const listener = vi.fn();
    const unsubscribe = subscribeDockPins(listener);

    notifyDockPinsImported(["settings", "recipes"]);
    expect(getDockPinsSnapshot()).toEqual(["settings", "recipes"]);
    expect(listener).toHaveBeenCalledTimes(1);

    unsubscribe();
  });

  it("can reset back to default pins", () => {
    setDockPins(["git"]);
    expect(getDockPinsSnapshot()).toEqual(["git"]);

    resetDockPins();
    expect(getDockPinsSnapshot()).toEqual(DEFAULT_DOCK_PINS);
  });
});
