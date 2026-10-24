import { describe, expect, it } from "vitest";
import {
  isTopmostFloatingPanel,
  resolveFloatingPanelStackZIndex,
  resolveTerminalFloatingPanelZIndex,
  resolveTerminalWorkspacePanelActivation,
  updateFloatingPanelStack,
  TERMINAL_FLOATING_PANEL_BASE_Z_INDEX,
  TERMINAL_FLOATING_PANEL_FRONT_Z_INDEX,
  type TerminalFloatingPanelId,
} from "./terminal-workspace-panel.js";

describe("terminal-workspace-panel stacking and identity", () => {
  it("resolves basic z-index for front vs background panels", () => {
    expect(resolveTerminalFloatingPanelZIndex("tool", "tool")).toBe(
      TERMINAL_FLOATING_PANEL_FRONT_Z_INDEX,
    );
    expect(resolveTerminalFloatingPanelZIndex("files", "tool")).toBe(
      TERMINAL_FLOATING_PANEL_BASE_Z_INDEX,
    );
    expect(resolveTerminalFloatingPanelZIndex("resolver", "resolver")).toBe(
      TERMINAL_FLOATING_PANEL_FRONT_Z_INDEX,
    );
    expect(resolveTerminalFloatingPanelZIndex(null, "resolver")).toBe(
      TERMINAL_FLOATING_PANEL_BASE_Z_INDEX,
    );
  });

  it("identifies topmost floating panel", () => {
    expect(isTopmostFloatingPanel("resolver", "resolver")).toBe(true);
    expect(isTopmostFloatingPanel("tool", "resolver")).toBe(false);
    expect(isTopmostFloatingPanel("files", null)).toBe(false);
  });

  it("maintains an ordered stack of floating panels", () => {
    let stack: TerminalFloatingPanelId[] = [];

    // Bring files to front
    stack = updateFloatingPanelStack(stack, "files", "bringToFront");
    expect(stack).toEqual(["files"]);

    // Bring tool to front
    stack = updateFloatingPanelStack(stack, "tool", "bringToFront");
    expect(stack).toEqual(["files", "tool"]);

    // Bring resolver to front
    stack = updateFloatingPanelStack(stack, "resolver", "bringToFront");
    expect(stack).toEqual(["files", "tool", "resolver"]);

    // Bring files to front again -> moves to the end of the stack
    stack = updateFloatingPanelStack(stack, "files", "bringToFront");
    expect(stack).toEqual(["tool", "resolver", "files"]);

    // Remove tool
    stack = updateFloatingPanelStack(stack, "tool", "remove");
    expect(stack).toEqual(["resolver", "files"]);
  });

  it("calculates hierarchical z-indexes based on panel stack order", () => {
    const stack: TerminalFloatingPanelId[] = ["files", "tool", "resolver"];

    const filesZ = resolveFloatingPanelStackZIndex("files", stack);
    const toolZ = resolveFloatingPanelStackZIndex("tool", stack);
    const resolverZ = resolveFloatingPanelStackZIndex("resolver", stack);

    expect(filesZ).toBeLessThan(toolZ);
    expect(toolZ).toBeLessThan(resolverZ);
    expect(resolverZ).toBe(TERMINAL_FLOATING_PANEL_BASE_Z_INDEX + 6);

    // Unstacked panel gets base z-index
    expect(resolveFloatingPanelStackZIndex("files", [])).toBe(
      TERMINAL_FLOATING_PANEL_BASE_Z_INDEX,
    );
  });

  it("resolves workspace panel activation and toggling", () => {
    // Reveal intent sets target unconditionally
    expect(
      resolveTerminalWorkspacePanelActivation({
        activePanelId: null,
        targetId: "git",
        intent: "reveal",
      }),
    ).toBe("git");

    expect(
      resolveTerminalWorkspacePanelActivation({
        activePanelId: "git",
        targetId: "git",
        intent: "reveal",
      }),
    ).toBe("git");

    // Toggle intent toggles off if same, switches if different
    expect(
      resolveTerminalWorkspacePanelActivation({
        activePanelId: "git",
        targetId: "git",
        intent: "toggle",
      }),
    ).toBe(null);

    expect(
      resolveTerminalWorkspacePanelActivation({
        activePanelId: "git",
        targetId: "ports",
        intent: "toggle",
      }),
    ).toBe("ports");
  });
});
