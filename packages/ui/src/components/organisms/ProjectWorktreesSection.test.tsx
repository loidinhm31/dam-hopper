// @vitest-environment jsdom

import { act, createElement } from "react";
import { createRoot } from "react-dom/client";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Worktree } from "@/api/client.js";
import {
  createProjectTargetSnapshot,
  useProjectTargetStore,
} from "@/stores/project-target.js";
import { ProjectWorktreesSection } from "./ProjectWorktreesSection.js";

const mutationMocks = vi.hoisted(() => ({
  add: { isPending: false, mutate: vi.fn() },
  remove: { isPending: false, mutate: vi.fn() },
}));

const worktree: Worktree = {
  path: "/tmp/demo-feature",
  repositoryPath: "/tmp/demo",
  branch: "feature/demo",
  commitHash: "abc123",
  isMain: false,
  isLocked: false,
  isDetached: false,
  isBare: false,
  isPrunable: false,
  isAvailable: true,
};

vi.mock("@/api/queries.js", () => ({
  useWorktrees: vi.fn(() => ({
    data: [worktree],
    isLoading: false,
    isFetching: false,
    isFetched: true,
    isError: false,
    refetch: vi.fn(),
  })),
  useAddWorktree: vi.fn(() => mutationMocks.add),
  useRemoveWorktree: vi.fn(() => mutationMocks.remove),
}));

(
  globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;

function renderSection() {
  const container = document.createElement("div");
  document.body.append(container);
  const root = createRoot(container);
  act(() => {
    root.render(
      createElement(ProjectWorktreesSection, {
        projectName: "demo-project",
        projectRoot: "/tmp/demo",
        target: createProjectTargetSnapshot("demo-project", null),
        isVisible: true,
      }),
    );
  });
  return { container, root };
}

describe("ProjectWorktreesSection mutation feedback", () => {
  beforeEach(() => {
    mutationMocks.add.mutate.mockClear();
    mutationMocks.remove.mutate.mockClear();
    useProjectTargetStore.getState().resetTarget("demo-project");
  });

  it("shows a visible error when removing a worktree fails", async () => {
    const { container, root } = renderSection();

    try {
      await act(async () => {
        container
          .querySelector<HTMLButtonElement>(
            'button[aria-label^="Remove worktree"]',
          )
          ?.click();
      });
      const options = mutationMocks.remove.mutate.mock.calls[0]?.[1] as {
        onError: (error: unknown) => void;
      };

      await act(async () => options.onError(new Error("remove failed")));

      expect(container.querySelector('[role="alert"]')?.textContent).toContain(
        "remove failed",
      );
    } finally {
      await act(async () => root.unmount());
      container.remove();
    }
  });

  it("shows a visible error when adding a worktree fails", async () => {
    const { container, root } = renderSection();

    try {
      await act(async () => {
        Array.from(container.querySelectorAll("button"))
          .find((button) => button.textContent?.includes("Add Worktree"))
          ?.click();
      });
      const pathInput =
        container.querySelector<HTMLInputElement>("#worktree-path");
      const branchInput =
        container.querySelector<HTMLInputElement>("#worktree-branch");
      expect(pathInput).not.toBeNull();
      expect(branchInput).not.toBeNull();

      await act(async () => {
        const setValue = Object.getOwnPropertyDescriptor(
          HTMLInputElement.prototype,
          "value",
        )!.set!;
        setValue.call(pathInput!, "/tmp/new-feature");
        pathInput!.dispatchEvent(new Event("input", { bubbles: true }));
        setValue.call(branchInput!, "feature/new");
        branchInput!.dispatchEvent(new Event("input", { bubbles: true }));
      });
      await act(async () =>
        Array.from(container.querySelectorAll("button"))
          .find((button) => button.textContent === "Add")
          ?.click(),
      );

      expect(mutationMocks.add.mutate).toHaveBeenCalledTimes(1);
      const options = mutationMocks.add.mutate.mock.calls[0]?.[1] as {
        onError: (error: unknown) => void;
      };
      await act(async () => options.onError(new Error("add failed")));

      expect(container.querySelector('[role="alert"]')?.textContent).toContain(
        "add failed",
      );
    } finally {
      await act(async () => root.unmount());
      container.remove();
    }
  });
});
