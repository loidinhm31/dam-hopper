import { describe, expect, it } from "vitest";
import {
  addBrowserTab,
  browserTabSlotKey,
  createBlankBrowserTab,
  createInitialBrowserWindowState,
  findBrowserTab,
  getActiveBrowserTab,
  parseBrowserTabSlotKey,
  patchBrowserTab,
  removeBrowserTab,
  selectBrowserTab,
  setBrowserTabDraft,
} from "./browser-tab-state.js";

describe("browser-tab-state", () => {
  it("initializes blank tab group with stable version, unique tabId, and active selection", () => {
    const state = createInitialBrowserWindowState();
    expect(state.browserStateVersion).toBe(1);
    expect(state.tabs).toHaveLength(1);
    expect(state.tabs[0]?.kind).toBe("ordinary");
    expect(state.tabs[0]?.phase).toBe("new-tab");
    expect(state.tabs[0]?.draft).toEqual({ value: "", dirty: false });
    expect(state.activeTabId).toBe(state.tabs[0]?.tabId);
    expect(getActiveBrowserTab(state)).toBe(state.tabs[0]);
  });

  it("deduplicates duplicate or whitespace initial tabIds and repairs invalid activeTabId", () => {
    const a = createBlankBrowserTab({ tabId: "tab-a" });
    const dupA = createBlankBrowserTab({ tabId: "tab-a", draftValue: "ignored" });
    const ws = { ...createBlankBrowserTab(), tabId: "   " };
    const b = createBlankBrowserTab({ tabId: "tab-b" });

    const state = createInitialBrowserWindowState({
      tabs: [ws, a, dupA, b],
      activeTabId: "missing-tab",
    });

    expect(state.tabs).toEqual([a, b]);
    expect(state.activeTabId).toBe("tab-a");
  });

  it("preserves tab order, supports insertion after a tab, and rejects duplicate tabIds", () => {
    const initial = createInitialBrowserWindowState({
      tabs: [
        createBlankBrowserTab({ tabId: "t1" }),
        createBlankBrowserTab({ tabId: "t3" }),
      ],
      activeTabId: "t1",
    });

    const inserted = addBrowserTab(initial, {
      tab: createBlankBrowserTab({ tabId: "t2", kind: "popup" }),
      afterTabId: "t1",
      activate: false,
    });
    expect(inserted.state.tabs.map((t) => t.tabId)).toEqual(["t1", "t2", "t3"]);
    expect(inserted.state.activeTabId).toBe("t1");

    const appended = addBrowserTab(inserted.state, {
      tab: createBlankBrowserTab({ tabId: "t4" }),
    });
    expect(appended.state.tabs.map((t) => t.tabId)).toEqual(["t1", "t2", "t3", "t4"]);
    expect(appended.state.activeTabId).toBe("t4");

    expect(() =>
      addBrowserTab(appended.state, { tab: createBlankBrowserTab({ tabId: "t2" }) }),
    ).toThrow(/Duplicate browser tabId/);
    expect(() => createBlankBrowserTab({ tabId: "   " })).toThrow(/non-empty/);
    expect(() =>
      addBrowserTab(appended.state, { tab: { ...createBlankBrowserTab(), tabId: "" } }),
    ).toThrow(/non-empty/);
  });

  it("retains independent per-tab drafts across selection and immutable patches", () => {
    const t1 = {
      ...createBlankBrowserTab({ tabId: "t1" }),
      committedUrl: "https://one.test/",
      phase: "live" as const,
      draft: { value: "https://one.test/", dirty: false },
    };
    const t2 = {
      ...createBlankBrowserTab({ tabId: "t2" }),
      committedUrl: "https://two.test/",
      phase: "live" as const,
      draft: { value: "https://two.test/", dirty: false },
    };

    let state = createInitialBrowserWindowState({ tabs: [t1, t2], activeTabId: "t1" });
    state = setBrowserTabDraft(state, "t1", "https://draft.test");
    state = selectBrowserTab(state, "t2");
    state = setBrowserTabDraft(state, "t2", "https://other-draft.test");
    state = selectBrowserTab(state, "t1");

    expect(findBrowserTab(state, "t1")?.draft).toEqual({
      value: "https://draft.test",
      dirty: true,
    });
    expect(findBrowserTab(state, "t1")?.committedUrl).toBe("https://one.test/");
    expect(findBrowserTab(state, "t2")?.draft).toEqual({
      value: "https://other-draft.test",
      dirty: true,
    });

    // Patch is immutable and preserves tabId even if updater tries to alter it
    const patched = patchBrowserTab(state, "t2", (tab) => ({
      ...tab,
      tabId: "forged-id",
      title: "Page Two",
    }));
    expect(findBrowserTab(patched, "t2")?.title).toBe("Page Two");
    expect(findBrowserTab(patched, "forged-id")).toBeUndefined();
    expect(findBrowserTab(state, "t2")?.title).toBeUndefined();
    // Returning draft to committedUrl clears dirty; selecting unknown tab is a no-op
    const reverted = setBrowserTabDraft(patched, "t1", "https://one.test/");
    expect(findBrowserTab(reverted, "t1")?.draft).toEqual({
      value: "https://one.test/",
      dirty: false,
    });
    expect(selectBrowserTab(reverted, "nonexistent")).toBe(reverted);
  });

  it("selects nearest surviving tab on active close and creates blank New Tab when last tab closes", () => {
    const t1 = createBlankBrowserTab({ tabId: "t1" });
    const t2 = createBlankBrowserTab({ tabId: "t2" });
    const t3 = createBlankBrowserTab({ tabId: "t3" });

    // Remove inactive tab keeps active unchanged
    let state = createInitialBrowserWindowState({ tabs: [t1, t2, t3], activeTabId: "t1" });
    state = removeBrowserTab(state, "t3");
    expect(state.tabs.map((t) => t.tabId)).toEqual(["t1", "t2"]);
    expect(state.activeTabId).toBe("t1");

    // Remove middle active tab falls back to right neighbor
    state = createInitialBrowserWindowState({ tabs: [t1, t2, t3], activeTabId: "t2" });
    state = removeBrowserTab(state, "t2");
    expect(state.tabs.map((t) => t.tabId)).toEqual(["t1", "t3"]);
    expect(state.activeTabId).toBe("t3");
    expect(removeBrowserTab(state, "missing-tab")).toBe(state);

    // preferredActiveTabId overrides default neighbor fallback when present in surviving tabs
    const withPreferred = removeBrowserTab(
      createInitialBrowserWindowState({ tabs: [t1, t2, t3], activeTabId: "t2" }),
      "t2",
      { preferredActiveTabId: "t1" },
    );
    expect(withPreferred.activeTabId).toBe("t1");

    // Remove last-position active tab falls back to left neighbor
    state = removeBrowserTab(state, "t3");
    expect(state.tabs.map((t) => t.tabId)).toEqual(["t1"]);
    expect(state.activeTabId).toBe("t1");
    // Remove final tab yields a fresh blank New Tab in the same window
    const single = createInitialBrowserWindowState({
      tabs: [
        {
          ...createBlankBrowserTab({ tabId: "t1" }),
          committedUrl: "https://example.test/",
          sessionId: "sess-1",
          phase: "live",
          draft: { value: "dirty", dirty: true },
        },
      ],
      activeTabId: "t1",
    });
    const afterLastClose = removeBrowserTab(single, "t1", {
      replacementBlankTabId: "fresh-blank",
    });
    expect(afterLastClose.tabs).toHaveLength(1);
    expect(afterLastClose.activeTabId).toBe("fresh-blank");
    expect(afterLastClose.tabs[0]).toEqual({
      tabId: "fresh-blank",
      kind: "ordinary",
      phase: "new-tab",
      draft: { value: "", dirty: false },
      actionSequence: 0,
    });
  });

  it("encodes unambiguous (windowId, tabId) viewer keys without delimiter collisions", () => {
    const k1 = browserTabSlotKey("win:a", "tab");
    const k2 = browserTabSlotKey("win", "a:tab");
    expect(k1).not.toBe(k2);
    expect(parseBrowserTabSlotKey(k1)).toEqual({ windowId: "win:a", tabId: "tab" });
    expect(parseBrowserTabSlotKey(k2)).toEqual({ windowId: "win", tabId: "a:tab" });
    expect(parseBrowserTabSlotKey("win:tab")).toBeNull();
    expect(parseBrowserTabSlotKey(JSON.stringify(["", "tab"]))).toBeNull();

    // Two tabs sharing identical URL/sessionId retain distinct slot keys
    const tabA = { ...createBlankBrowserTab({ tabId: "tab-a" }), sessionId: "shared-s" };
    const tabB = { ...createBlankBrowserTab({ tabId: "tab-b" }), sessionId: "shared-s" };
    expect(browserTabSlotKey("w1", tabA.tabId)).not.toBe(
      browserTabSlotKey("w1", tabB.tabId),
    );
  });
});
