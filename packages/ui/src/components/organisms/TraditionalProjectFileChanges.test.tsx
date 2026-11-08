// @vitest-environment jsdom
import { describe, expect, it, vi } from "vitest";
import { createElement, act } from "react";
import { createRoot } from "react-dom/client";
import { TraditionalProjectFileChanges } from "./TraditionalProjectFileChanges.js";
import type { GitDiffResult } from "@/api/queries.js";

let mockDiffData: GitDiffResult | undefined = undefined;
let mockIsLoading = false;
let mockIsError = false;

vi.mock("@/api/queries.js", () => ({
  useGitDiff: () => ({
    data: mockDiffData,
    isLoading: mockIsLoading,
    isError: mockIsError,
    error: mockIsError ? new Error("Network error") : null,
  }),
}));

vi.mock("@/api/connections.js", () => ({
  useConnectionSnapshot: () => ({
    status: "connected",
    owner: { profileId: "prof-1", generation: 1 },
  }),
}));

vi.mock("@/hooks/use-project-target.js", () => ({
  useProjectTarget: () => null,
}));

describe("TraditionalProjectFileChanges", () => {
  it("renders loading state", async () => {
    mockIsLoading = true;
    mockDiffData = undefined;
    mockIsError = false;

    const container = document.createElement("div");
    document.body.appendChild(container);
    const root = createRoot(container);

    await act(async () => {
      root.render(
        createElement(TraditionalProjectFileChanges, {
          projectName: "demo-project",
        }),
      );
    });

    expect(container.textContent).toContain("Loading changes…");
    root.unmount();
    container.remove();
  });

  it("renders git not available message when gitAvailable is false", async () => {
    mockIsLoading = false;
    mockDiffData = { gitAvailable: false, entries: [] };
    mockIsError = false;

    const container = document.createElement("div");
    document.body.appendChild(container);
    const root = createRoot(container);

    await act(async () => {
      root.render(
        createElement(TraditionalProjectFileChanges, {
          projectName: "demo-project",
        }),
      );
    });

    expect(container.textContent).toContain("Git not available for this project");
    root.unmount();
    container.remove();
  });

  it("renders empty state when there are no changed files", async () => {
    mockIsLoading = false;
    mockDiffData = { gitAvailable: true, entries: [] };
    mockIsError = false;

    const container = document.createElement("div");
    document.body.appendChild(container);
    const root = createRoot(container);

    await act(async () => {
      root.render(
        createElement(TraditionalProjectFileChanges, {
          projectName: "demo-project",
        }),
      );
    });

    expect(container.textContent).toContain("No changed files");
    root.unmount();
    container.remove();
  });

  it("renders changed files with status badges, selects on click, and invokes onOpenFile on double click", async () => {
    mockIsLoading = false;
    mockDiffData = {
      gitAvailable: true,
      entries: [
        {
          path: "src/app.ts",
          status: "modified",
          staged: false,
          insertions: 5,
          deletions: 2,
        },
        {
          path: "src/new-feature.ts",
          status: "added",
          staged: true,
          insertions: 10,
          deletions: 0,
        },
      ],
    };
    mockIsError = false;

    const onOpenFile = vi.fn();
    const container = document.createElement("div");
    document.body.appendChild(container);
    const root = createRoot(container);

    await act(async () => {
      root.render(
        createElement(TraditionalProjectFileChanges, {
          projectName: "demo-project",
          profileId: "prof-1",
          onOpenFile,
        }),
      );
    });

    expect(container.textContent).toContain("app.ts");
    expect(container.textContent).toContain("new-feature.ts");

    const items = container.querySelectorAll('[role="listitem"]');
    expect(items).toHaveLength(2);

    // Click first item - selects it but does not open
    await act(async () => {
      (items[0] as HTMLElement).click();
    });
    expect(onOpenFile).not.toHaveBeenCalled();
    expect((items[0] as HTMLElement).className).toContain("bg-[var(--color-primary)]/15");

    // Double click first item - opens it
    await act(async () => {
      (items[0] as HTMLElement).dispatchEvent(
        new MouseEvent("dblclick", { bubbles: true, cancelable: true }),
      );
    });

    expect(onOpenFile).toHaveBeenCalledWith(
      expect.objectContaining({
        filePath: "src/app.ts",
        mode: "float",
        isDiff: true,
        fileStatus: "modified",
      }),
    );

    // Enter key on second item - opens it
    await act(async () => {
      (items[1] as HTMLElement).dispatchEvent(
        new KeyboardEvent("keydown", { key: "Enter", bubbles: true, cancelable: true }),
      );
    });

    expect(onOpenFile).toHaveBeenCalledWith(
      expect.objectContaining({
        filePath: "src/new-feature.ts",
        mode: "float",
        isDiff: true,
        fileStatus: "added",
      }),
    );
    root.unmount();
    container.remove();
  });
  it("supports context menu with Locate in files, Open diff, and Open file", async () => {
    mockIsLoading = false;
    mockDiffData = {
      gitAvailable: true,
      entries: [
        {
          path: "src/locate-me.ts",
          status: "modified",
          staged: false,
          insertions: 3,
          deletions: 1,
        },
        {
          path: "src/deleted.ts",
          status: "deleted",
          staged: false,
          insertions: 0,
          deletions: 10,
        },
      ],
    };
    mockIsError = false;

    const onOpenFile = vi.fn();
    const onLocateFile = vi.fn();
    const container = document.createElement("div");
    document.body.appendChild(container);
    const root = createRoot(container);

    await act(async () => {
      root.render(
        createElement(TraditionalProjectFileChanges, {
          projectName: "demo-project",
          profileId: "prof-1",
          onOpenFile,
          onLocateFile,
        }),
      );
    });

    const items = container.querySelectorAll('[role="listitem"]');
    expect(items).toHaveLength(2);

    // Open context menu on first item
    await act(async () => {
      (items[0] as HTMLElement).dispatchEvent(
        new MouseEvent("contextmenu", {
          bubbles: true,
          cancelable: true,
          clientX: 50,
          clientY: 50,
          button: 2,
        }),
      );
    });

    const menuItems = Array.from(document.body.querySelectorAll('[role="menuitem"]'));
    const locateItem = menuItems.find((el) => el.textContent?.includes("Locate in files"));
    const openDiffItem = menuItems.find((el) => el.textContent?.includes("Open diff"));
    const openFileItem = menuItems.find((el) => el.textContent?.includes("Open file"));

    expect(locateItem).toBeDefined();
    expect(openDiffItem).toBeDefined();
    expect(openFileItem).toBeDefined();

    // Click Locate in files
    await act(async () => {
      (locateItem as HTMLElement).click();
    });
    expect(onLocateFile).toHaveBeenCalledWith("src/locate-me.ts");

    root.unmount();
    container.remove();
  });

  it("disables locate and open file in context menu for deleted files", async () => {
    mockIsLoading = false;
    mockDiffData = {
      gitAvailable: true,
      entries: [
        {
          path: "src/removed.ts",
          status: "deleted",
          staged: false,
          insertions: 0,
          deletions: 5,
        },
      ],
    };

    const container = document.createElement("div");
    document.body.appendChild(container);
    const root = createRoot(container);

    await act(async () => {
      root.render(
        createElement(TraditionalProjectFileChanges, {
          projectName: "demo-project",
          profileId: "prof-1",
        }),
      );
    });

    const item = container.querySelector('[role="listitem"]')!;
    await act(async () => {
      item.dispatchEvent(
        new MouseEvent("contextmenu", {
          bubbles: true,
          cancelable: true,
          clientX: 50,
          clientY: 50,
          button: 2,
        }),
      );
    });

    const menuItems = Array.from(document.body.querySelectorAll('[role="menuitem"]'));
    const locateItem = menuItems.find((el) => el.textContent?.includes("Locate in files"));
    const openFileItem = menuItems.find((el) => el.textContent?.includes("Open file"));
    expect(locateItem).toBeDefined();
    expect(openFileItem).toBeDefined();
    expect(locateItem?.getAttribute("aria-disabled")).toBe("true");
    expect(openFileItem?.getAttribute("aria-disabled")).toBe("true");
    root.unmount();
    container.remove();
  });
});
