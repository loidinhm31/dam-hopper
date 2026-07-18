import { describe, expect, it, vi } from "vitest";
import { getTreeContextMenuItems } from "./TreeContextMenu.js";

function baseHandlers() {
  return {
    onCopyAbsolutePath: vi.fn(),
    onCopyRelativePath: vi.fn(),
    onNewFile: vi.fn(),
    onNewFolder: vi.fn(),
    onRename: vi.fn(),
    onDelete: vi.fn(),
    onDownload: vi.fn(),
    onUpload: vi.fn(),
  };
}

function labels(items: ReturnType<typeof getTreeContextMenuItems>) {
  return items.map((i) => [i.label, Boolean(i.disabled)] as const);
}

describe("getTreeContextMenuItems", () => {
  it("always leads with both copy items for files and folders", () => {
    for (const isDir of [true, false]) {
      const items = getTreeContextMenuItems({ ...baseHandlers(), isDir });
      expect(items[0]).toMatchObject({ label: "Copy Absolute Path" });
      expect(items[1]).toMatchObject({ label: "Copy Relative Path" });
    }
  });

  it("shows directory actions for folders", () => {
    const items = getTreeContextMenuItems({
      ...baseHandlers(),
      isDir: true,
    });
    expect(labels(items)).toEqual([
      ["Copy Absolute Path", false],
      ["Copy Relative Path", false],
      ["New File", false],
      ["New Folder", false],
      ["Upload Here", false],
      ["Rename", false],
      ["Delete", false],
    ]);
  });

  it("shows download instead of directory actions for files", () => {
    const items = getTreeContextMenuItems({
      ...baseHandlers(),
      isDir: false,
    });
    expect(labels(items)).toEqual([
      ["Copy Absolute Path", false],
      ["Copy Relative Path", false],
      ["Rename", false],
      ["Download", false],
      ["Delete", false],
    ]);
  });

  it("disables only the absolute copy when the project root is unknown", () => {
    const items = getTreeContextMenuItems({
      ...baseHandlers(),
      isDir: false,
      absolutePathDisabled: true,
    });
    expect(items[0]).toMatchObject({
      label: "Copy Absolute Path",
      disabled: true,
    });
    expect(items[1]).toMatchObject({ label: "Copy Relative Path" });
    expect(items[1].disabled).toBeFalsy();
  });

  it("wires the copy onClick handlers", () => {
    const h = baseHandlers();
    const items = getTreeContextMenuItems({ ...h, isDir: false });
    items[0].onClick();
    items[1].onClick();
    expect(h.onCopyAbsolutePath).toHaveBeenCalledTimes(1);
    expect(h.onCopyRelativePath).toHaveBeenCalledTimes(1);
  });

  it("wires directory creation to the originating menu callback", () => {
    const h = baseHandlers();
    const items = getTreeContextMenuItems({ ...h, isDir: true });
    items.find((item) => item.label === "New File")?.onClick();
    items.find((item) => item.label === "New Folder")?.onClick();

    expect(h.onNewFile).toHaveBeenCalledOnce();
    expect(h.onNewFolder).toHaveBeenCalledOnce();
  });
});
