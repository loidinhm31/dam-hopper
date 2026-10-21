// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
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
    "opens $targetId and replaces the active terminal workspace panel on toggle",
    ({ activePanelId, targetId }) => {
      expect(
        resolveTerminalWorkspacePanelActivation({
          activePanelId,
          targetId,
          intent: "toggle",
        }),
      ).toBe(targetId);
    },
  );

  it.each(["git", "ports", "project", "terminals"] as const)(
    "closes %s when its active target is toggled again",
    (targetId) => {
      expect(
        resolveTerminalWorkspacePanelActivation({
          activePanelId: targetId,
          targetId,
          intent: "toggle",
        }),
      ).toBeNull();
    },
  );

  it.each(["git", "ports", "project", "terminals"] as const)(
    "keeps %s open when requested with reveal intent even if already active",
    (targetId) => {
      expect(
        resolveTerminalWorkspacePanelActivation({
          activePanelId: targetId,
          targetId,
          intent: "reveal",
        }),
      ).toBe(targetId);
    },
  );

  it("switches to targetId with reveal intent when a different panel was active", () => {
    expect(
      resolveTerminalWorkspacePanelActivation({
        activePanelId: "ports",
        targetId: "git",
        intent: "reveal",
      }),
    ).toBe("git");
  });
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

describe("TerminalWorkspaceShell floating panel activation lifecycle", () => {
  let container: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
  });

  afterEach(async () => {
    await act(async () => {
      root.unmount();
    });
    container.remove();
  });

  it("invokes onActivateFloatingPanel with tool on reveal request and synchronizes topmost state", async () => {
    const onActivate = vi.fn();
    const onDeactivate = vi.fn();

    await act(async () => {
      root.render(
        <TerminalWorkspaceShell
          terminalContent={<div data-testid="term-content">Terminal</div>}
          fleetContent={<div>Fleet</div>}
          gitContent={<div data-testid="git-panel-body">Git Panel Content</div>}
          projectContent={<div>Project</div>}
          workspaceMode="terminal"
          onWorkspaceModeChange={() => {}}
          floatingPanelStack={["files"]}
          onActivateFloatingPanel={onActivate}
          onDeactivateFloatingPanel={onDeactivate}
          activatePanelRequest={{
            nonce: 1,
            targetId: "git",
            intent: "reveal",
          }}
        />,
      );
    });

    expect(onActivate).toHaveBeenCalledTimes(1);
    expect(onActivate).toHaveBeenCalledWith("tool");
    expect(onDeactivate).not.toHaveBeenCalled();
    expect(container.querySelector('[data-testid="git-panel-body"]')).not.toBeNull();
  });

  it("settles in active state when mounted with a reveal request without immediate deactivation", async () => {
    const onActivate = vi.fn();
    const onDeactivate = vi.fn();

    await act(async () => {
      root.render(
        <TerminalWorkspaceShell
          terminalContent={<div>Terminal</div>}
          fleetContent={<div>Fleet</div>}
          gitContent={<div>Git</div>}
          projectContent={<div>Project</div>}
          workspaceMode="terminal"
          onWorkspaceModeChange={() => {}}
          onActivateFloatingPanel={onActivate}
          onDeactivateFloatingPanel={onDeactivate}
          activatePanelRequest={{
            nonce: 1,
            targetId: "git",
            intent: "reveal",
          }}
        />,
      );
    });

    expect(onActivate).toHaveBeenCalledWith("tool");
    expect(onDeactivate).not.toHaveBeenCalled();
  });

  it("does not replay activation on unrelated parent rerenders with unchanged request nonce", async () => {
    const onActivate = vi.fn();
    const onDeactivate = vi.fn();
    const request = { nonce: 10, targetId: "git" as const, intent: "reveal" as const };

    await act(async () => {
      root.render(
        <TerminalWorkspaceShell
          terminalContent={<div>Terminal</div>}
          fleetContent={<div>Fleet</div>}
          gitContent={<div>Git</div>}
          projectContent={<div>Project</div>}
          workspaceMode="terminal"
          onWorkspaceModeChange={() => {}}
          onActivateFloatingPanel={onActivate}
          onDeactivateFloatingPanel={onDeactivate}
          activatePanelRequest={request}
        />,
      );
    });

    expect(onActivate).toHaveBeenCalledTimes(1);

    // Rerender with newly constructed object containing same nonce
    await act(async () => {
      root.render(
        <TerminalWorkspaceShell
          terminalContent={<div>Terminal Updated</div>}
          fleetContent={<div>Fleet</div>}
          gitContent={<div>Git</div>}
          projectContent={<div>Project</div>}
          workspaceMode="terminal"
          onWorkspaceModeChange={() => {}}
          onActivateFloatingPanel={onActivate}
          onDeactivateFloatingPanel={onDeactivate}
          activatePanelRequest={{ ...request }}
        />,
      );
    });

    expect(onActivate).toHaveBeenCalledTimes(1);
    expect(onDeactivate).not.toHaveBeenCalled();
  });

  it("calls onDeactivateFloatingPanel with tool when side panel is closed", async () => {
    const onActivate = vi.fn();
    const onDeactivate = vi.fn();

    await act(async () => {
      root.render(
        <TerminalWorkspaceShell
          terminalContent={<div>Terminal</div>}
          fleetContent={<div>Fleet</div>}
          gitContent={<div>Git</div>}
          projectContent={<div>Project</div>}
          workspaceMode="terminal"
          onWorkspaceModeChange={() => {}}
          onActivateFloatingPanel={onActivate}
          onDeactivateFloatingPanel={onDeactivate}
          activatePanelRequest={{
            nonce: 1,
            targetId: "git",
            intent: "reveal",
          }}
        />,
      );
    });

    expect(onActivate).toHaveBeenCalledWith("tool");

    // Close side panel via close button
    const closeBtn = container.querySelector('button[aria-label="Close Git panel"]');
    expect(closeBtn).not.toBeNull();
    await act(async () => {
      closeBtn?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });

    expect(onDeactivate).toHaveBeenCalledWith("tool");
  });

  it("allows subsequent reveal with new nonce after side panel closure", async () => {
    const onActivate = vi.fn();
    const onDeactivate = vi.fn();

    await act(async () => {
      root.render(
        <TerminalWorkspaceShell
          terminalContent={<div>Terminal</div>}
          fleetContent={<div>Fleet</div>}
          gitContent={<div>Git</div>}
          projectContent={<div>Project</div>}
          workspaceMode="terminal"
          onWorkspaceModeChange={() => {}}
          onActivateFloatingPanel={onActivate}
          onDeactivateFloatingPanel={onDeactivate}
          activatePanelRequest={{
            nonce: 1,
            targetId: "git",
            intent: "reveal",
          }}
        />,
      );
    });

    expect(onActivate).toHaveBeenCalledTimes(1);
    expect(onActivate).toHaveBeenLastCalledWith("tool");

    // Close side panel via close button
    const closeBtn = container.querySelector('button[aria-label="Close Git panel"]');
    await act(async () => {
      closeBtn?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });
    expect(onDeactivate).toHaveBeenCalledTimes(1);
    expect(onDeactivate).toHaveBeenLastCalledWith("tool");

    // New reveal request with incremented nonce 2
    await act(async () => {
      root.render(
        <TerminalWorkspaceShell
          terminalContent={<div>Terminal</div>}
          fleetContent={<div>Fleet</div>}
          gitContent={<div>Git</div>}
          projectContent={<div>Project</div>}
          workspaceMode="terminal"
          onWorkspaceModeChange={() => {}}
          onActivateFloatingPanel={onActivate}
          onDeactivateFloatingPanel={onDeactivate}
          activatePanelRequest={{
            nonce: 2,
            targetId: "git",
            intent: "reveal",
          }}
        />,
      );
    });

    expect(onActivate).toHaveBeenCalledTimes(2);
    expect(onActivate).toHaveBeenLastCalledWith("tool");
  });
});
