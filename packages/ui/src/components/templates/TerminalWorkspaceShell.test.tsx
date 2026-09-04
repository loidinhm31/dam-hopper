// @vitest-environment jsdom
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import {
  resolveTerminalFloatingPanelZIndex,
  resolveTerminalWorkspacePanelActivation,
  TERMINAL_FLOATING_PANEL_BASE_Z_INDEX,
  TERMINAL_FLOATING_PANEL_FRONT_Z_INDEX,
} from "@/lib/terminal-workspace-panel.js";
import { TerminalWorkspaceShell } from "./TerminalWorkspaceShell.js";

vi.mock("@/components/organisms/TopNav.js", () => ({
  TopNav: () => <div data-testid="top-nav" />,
}));

vi.mock("@/hooks/use-sidebar-collapse.js", () => ({
  useSidebarCollapse: () => ({ collapsed: false, toggle: vi.fn() }),
}));

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

describe("TerminalWorkspaceShell rendering", () => {
  it("renders toolbarActions as companion row above terminal content", () => {
    const markup = renderToStaticMarkup(
      <TerminalWorkspaceShell
        terminalContent={<div data-testid="term-content">Terminal Area</div>}
        fleetContent={<div>Fleet</div>}
        gitContent={<div>Git</div>}
        projectContent={<div>Project</div>}
        workspaceMode="terminal"
        onWorkspaceModeChange={() => {}}
        toolbarActions={<div data-testid="workflow-toolbar">Workflow Actions</div>}
      />,
    );

    expect(markup).toContain('data-testid="workflow-toolbar"');
    expect(markup).toContain('data-testid="term-content"');
    expect(markup).toContain("Workflow Actions");
  });
});
