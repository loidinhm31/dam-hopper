import { describe, expect, it, vi } from "vitest";
import {
  clampEditorTabContextMenuPosition,
  getEditorTabContextMenuItems,
} from "./EditorTabContextMenu.js";

describe("editor tab context menu helpers", () => {
  it("clamps the menu inside the viewport", () => {
    expect(clampEditorTabContextMenuPosition(1200, 900, 1280, 960)).toEqual({
      x: 1090,
      y: 830,
    });
    expect(clampEditorTabContextMenuPosition(40, 60, 1280, 960)).toEqual({
      x: 40,
      y: 60,
    });
  });

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
