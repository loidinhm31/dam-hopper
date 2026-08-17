import { beforeEach, describe, expect, it, vi } from "vitest";

const editorStore = vi.hoisted(() => ({
  markTargetUnavailable: vi.fn(),
}));

vi.mock("@tanstack/react-query", () => ({
  useMutation: vi.fn(),
  useQuery: vi.fn(),
  useQueryClient: vi.fn(),
}));
vi.mock("@/api/transport.js", () => ({ getTransport: vi.fn() }));
vi.mock("@/stores/editor.js", () => ({
  useEditorStore: {
    getState: () => ({
      markTargetUnavailable: editorStore.markTargetUnavailable,
      tabs: [],
    }),
  },
}));

import { markTargetUnavailableIfNeeded } from "./queries.js";
import { useProjectTargetStore } from "@/stores/project-target.js";

const target = { project: "demo", worktreePath: "/tmp/demo-worktree" };

beforeEach(() => {
  useProjectTargetStore.getState().resetTarget(target.project);
  editorStore.markTargetUnavailable.mockReset();
});

describe("markTargetUnavailableIfNeeded", () => {
  it("recognizes a plain-string target error", () => {
    markTargetUnavailableIfNeeded(target, "WORKSPACE_TARGET_UNAVAILABLE");

    expect(useProjectTargetStore.getState().unavailableTargetByProject).toEqual(
      { demo: target.worktreePath },
    );
    expect(editorStore.markTargetUnavailable).toHaveBeenCalledWith(target);
  });

  it("recognizes a structured filesystem target error", () => {
    markTargetUnavailableIfNeeded(target, {
      ok: false,
      code: "WORKSPACE_TARGET_UNAVAILABLE",
    });

    expect(useProjectTargetStore.getState().unavailableTargetByProject).toEqual(
      { demo: target.worktreePath },
    );
    expect(editorStore.markTargetUnavailable).toHaveBeenCalledWith(target);
  });
});
