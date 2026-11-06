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
});
