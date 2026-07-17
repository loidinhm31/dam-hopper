import { describe, expect, it, vi } from "vitest";
import { getEditorTabContextMenuItems } from "./EditorTabContextMenu.js";

describe("editor tab context menu helpers", () => {
  it("disables close others when only one tab is open", () => {
    const items = getEditorTabContextMenuItems({
      tabCount: 1,
      onCloseTab: vi.fn(),
      onCloseOthers: vi.fn(),
      onCloseAll: vi.fn(),
    });

    expect(items.map((item) => [item.label, Boolean(item.disabled)])).toEqual([
      ["Close", false],
      ["Close Other Tabs", true],
      ["Close All Tabs", false],
    ]);
  });

  it("wires close actions for multi-tab projects", () => {
    const onCloseTab = vi.fn();
    const onCloseOthers = vi.fn();
    const onCloseAll = vi.fn();
    const items = getEditorTabContextMenuItems({
      tabCount: 3,
      onCloseTab,
      onCloseOthers,
      onCloseAll,
    });

    items[0].onSelect();
    items[1].onSelect();
    items[2].onSelect();

    expect(onCloseTab).toHaveBeenCalledOnce();
    expect(onCloseOthers).toHaveBeenCalledOnce();
    expect(onCloseAll).toHaveBeenCalledOnce();
  });
});
