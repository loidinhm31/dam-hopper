// @vitest-environment jsdom
import { describe, expect, it } from "vitest";
import {
  resolveTerminalFloatingPanelZIndex,
  resolveTerminalWorkspacePanelActivation,
  TERMINAL_FLOATING_PANEL_BASE_Z_INDEX,
  TERMINAL_FLOATING_PANEL_FRONT_Z_INDEX,
} from "@/lib/terminal-workspace-panel.js";

describe("resolveTerminalFloatingPanelZIndex", () => {
  it("keeps both floating panels at the baseline before activation", () => {
    expect(resolveTerminalFloatingPanelZIndex(null, "files")).toBe(
      TERMINAL_FLOATING_PANEL_BASE_Z_INDEX,
    );
    expect(resolveTerminalFloatingPanelZIndex(null, "tool")).toBe(
      TERMINAL_FLOATING_PANEL_BASE_Z_INDEX,
    );
  });

  it.each(["files", "tool"] as const)(
    "raises only the active %s panel above its peer",
    (panelId) => {
      const peer = panelId === "files" ? "tool" : "files";
      expect(resolveTerminalFloatingPanelZIndex(panelId, panelId)).toBe(
        TERMINAL_FLOATING_PANEL_FRONT_Z_INDEX,
      );
      expect(resolveTerminalFloatingPanelZIndex(panelId, peer)).toBe(
        TERMINAL_FLOATING_PANEL_BASE_Z_INDEX,
      );
    },
  );
});

describe("resolveTerminalWorkspacePanelActivation", () => {
  it.each([
    { activePanelId: "ports", targetId: "git" },
    { activePanelId: "git", targetId: "ports" },
    { activePanelId: "git", targetId: "project" },
    { activePanelId: "ports", targetId: "terminals" },
  ] as const)(
    "opens $targetId and replaces the active terminal workspace panel",
    ({ activePanelId, targetId }) => {
      expect(
        resolveTerminalWorkspacePanelActivation({ activePanelId, targetId }),
      ).toBe(targetId);
    },
  );

  it.each(["git", "ports", "project", "terminals"] as const)(
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
