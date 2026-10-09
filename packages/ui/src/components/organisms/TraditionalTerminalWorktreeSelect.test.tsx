// @vitest-environment jsdom

import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Worktree } from "@/api/client.js";
import { useProjectTargetStore } from "@/stores/project-target.js";
import {
  distinguishWorktreePath,
  TraditionalTerminalWorktreeSelect,
} from "./TraditionalTerminalWorktreeSelect.js";

const mocks = vi.hoisted(() => {
  const refetch = vi.fn();
  const worktrees: Worktree[] = [
    {
      path: "/repos/demo/main",
      repositoryPath: "/repos/demo/.git",
      branch: "main",
      commitHash: "1111111",
      isMain: true,
      isLocked: false,
      isDetached: false,
      isBare: false,
      isPrunable: false,
      isAvailable: true,
    },
    {
      path: "/repos/demo/wt-feature",
      repositoryPath: "/repos/demo/.git",
      branch: "feature/login",
      commitHash: "2222222",
      isMain: false,
      isLocked: false,
      isDetached: false,
      isBare: false,
      isPrunable: false,
      isAvailable: true,
    },
    {
      path: "/repos/demo/wt-detached",
      repositoryPath: "/repos/demo/.git",
      branch: "",
      commitHash: "3333333",
      isMain: false,
      isLocked: true,
      isDetached: true,
      isBare: false,
      isPrunable: false,
      isAvailable: true,
    },
    {
      path: "/repos/demo/wt-prunable",
      repositoryPath: "/repos/demo/.git",
      branch: "stale",
      commitHash: "4444444",
      isMain: false,
      isLocked: false,
      isDetached: false,
      isBare: false,
      isPrunable: true,
      isAvailable: true,
    },
    {
      path: "/repos/demo/wt-bare",
      repositoryPath: "/repos/demo/.git",
      branch: "bare-wt",
      commitHash: "5555555",
      isMain: false,
      isLocked: false,
      isDetached: false,
      isBare: true,
      isPrunable: false,
      isAvailable: false,
    },
  ];

  return {
    refetch,
    worktrees,
    useWorktrees: vi.fn(() => ({
      data: worktrees,
      dataUpdatedAt: 100,
      isFetched: true,
      isFetching: false,
      isError: false,
      refetch,
    })),
  };
});

vi.mock("@/api/queries.js", () => ({
  useWorktrees: mocks.useWorktrees,
}));

describe("distinguishWorktreePath", () => {
  it("returns unique basename when no collision exists", () => {
    const paths = ["/repos/demo/wt-a", "/repos/demo/wt-b"];
    expect(distinguishWorktreePath(paths[0]!, paths)).toBe("wt-a");
    expect(distinguishWorktreePath(paths[1]!, paths)).toBe("wt-b");
  });

  it("prefixes parent directory name when duplicate basenames exist across paths", () => {
    const paths = ["/client-1/feature", "/client-2/feature"];
    expect(distinguishWorktreePath(paths[0]!, paths)).toBe("client-1/feature");
    expect(distinguishWorktreePath(paths[1]!, paths)).toBe("client-2/feature");
  });
});

describe("TraditionalTerminalWorktreeSelect", () => {
  let container: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    window.HTMLElement.prototype.scrollIntoView = vi.fn();
    window.HTMLElement.prototype.hasPointerCapture = vi.fn();
    window.HTMLElement.prototype.setPointerCapture = vi.fn();
    window.HTMLElement.prototype.releasePointerCapture = vi.fn();
    useProjectTargetStore.getState().resetTarget("demo");
    mocks.refetch.mockClear();
    mocks.useWorktrees.mockReturnValue({
      data: mocks.worktrees,
      dataUpdatedAt: 100,
      isFetched: true,
      isFetching: false,
      isError: false,
      refetch: mocks.refetch,
    });
    container = document.createElement("div");
    document.body.append(container);
    root = createRoot(container);
  });

  afterEach(() => {
    act(() => root.unmount());
    container.remove();
    useProjectTargetStore.getState().resetTarget("demo");
  });

  function renderSelect(props: Partial<Parameters<typeof TraditionalTerminalWorktreeSelect>[0]> = {}) {
    act(() => {
      root.render(
        <TraditionalTerminalWorktreeSelect
          projectName="demo"
          {...props}
        />,
      );
    });
  }

  it("renders trigger showing root by default and triggers refetch on open", () => {
    renderSelect();
    const trigger = container.querySelector<HTMLButtonElement>('[role="combobox"]')!;
    expect(trigger).not.toBeNull();
    expect(trigger.getAttribute("aria-label")).toBe("Worktree for demo: root");
    expect(trigger.textContent).toContain("root");

    // Clicking trigger opens and refetches
    act(() => {
      trigger.click();
    });
    expect(mocks.refetch).toHaveBeenCalled();
  });

  it("reflects selected worktree branch and distinguished short path in trigger", () => {
    useProjectTargetStore.getState().selectTarget("demo", "/repos/demo/wt-feature");
    renderSelect();

    const trigger = container.querySelector<HTMLButtonElement>('[role="combobox"]')!;
    expect(trigger.getAttribute("aria-label")).toContain("feature/login (wt-feature)");
    expect(trigger.textContent).toContain("feature/login (wt-feature)");
  });

  it("shows (unavailable) and warning styling when target is marked unavailable", () => {
    useProjectTargetStore.getState().markTargetUnavailable("demo", "/repos/demo/wt-missing");
    renderSelect();

    const trigger = container.querySelector<HTMLButtonElement>('[role="combobox"]')!;
    expect(trigger.getAttribute("aria-label")).toBe("Worktree for demo: root");
    // Fallback notice is rendered in polite live region
    const status = container.querySelector('[role="status"]');
    expect(status?.textContent).toContain("Worktree /repos/demo/wt-missing is unavailable");
  });

  it("applies touch-optimized sizing when touchOptimized is true", () => {
    renderSelect({ touchOptimized: true });
    const trigger = container.querySelector<HTMLButtonElement>('[role="combobox"]')!;
    expect(trigger.className).toContain("min-h-11");
  });

  it("stops click propagation from bubbling outside the select container", () => {
    const parentClick = vi.fn();
    act(() => {
      root.render(
        <div onClick={parentClick}>
          <TraditionalTerminalWorktreeSelect projectName="demo" />
        </div>,
      );
    });

    const trigger = container.querySelector<HTMLButtonElement>('[role="combobox"]')!;
    act(() => {
      trigger.click();
    });

    expect(parentClick).not.toHaveBeenCalled();
  });

  it("qualifies target selection by profileId when supplied", () => {
    const profileId = "profile-prod";
    renderSelect({ profileId });
    const trigger = container.querySelector<HTMLButtonElement>('[role="combobox"]')!;
    expect(trigger.getAttribute("aria-label")).toBe("Worktree for demo: root");

    // Select a worktree under profile-prod
    act(() => {
      useProjectTargetStore.getState().selectTarget({ profileId, project: "demo" }, "/repos/demo/wt-feature");
    });
    renderSelect({ profileId });

    const updatedTrigger = container.querySelector<HTMLButtonElement>('[role="combobox"]')!;
    expect(updatedTrigger.getAttribute("aria-label")).toContain("feature/login (wt-feature)");
  });
});
