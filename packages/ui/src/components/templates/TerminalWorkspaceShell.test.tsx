// @vitest-environment jsdom
import { describe, expect, it } from "vitest";
import { resolveTerminalWorkspacePanelActivation } from "@/lib/terminal-workspace-panel.js";

describe("resolveTerminalWorkspacePanelActivation", () => {
  it.each([
    { activePanelId: "ports", targetId: "git" },
    { activePanelId: "git", targetId: "ports" },
    { activePanelId: "ports", targetId: "terminals" },
  ] as const)(
    "opens $targetId and replaces the active terminal workspace panel",
    ({ activePanelId, targetId }) => {
      expect(
        resolveTerminalWorkspacePanelActivation({ activePanelId, targetId }),
      ).toBe(targetId);
    },
  );

  it.each(["git", "ports", "terminals"] as const)(
    "closes %s when its active target is selected again",
    (targetId) => {
      expect(
        resolveTerminalWorkspacePanelActivation({
          activePanelId: targetId,
          targetId,
        }),
      ).toBeNull();
    },
  );
});
