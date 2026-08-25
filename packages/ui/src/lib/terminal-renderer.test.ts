import { beforeEach, describe, expect, it, vi } from "vitest";
import { activateTerminalWebglRenderer } from "./terminal-renderer.js";

const diagCalls: Array<{
  type: string;
  scope: string;
  message: string;
  metadata?: unknown;
}> = [];

vi.mock("@/lib/diagnostics-client.js", () => ({
  recordClientDiagnostic: (
    type: string,
    scope: string,
    message: string,
    metadata?: unknown,
  ) => {
    diagCalls.push({ type, scope, message, metadata });
  },
}));

function rendererFixture() {
  let onContextLoss = () => {};
  const addon = {
    activate: vi.fn(),
    dispose: vi.fn(),
    onContextLoss: vi.fn((listener: () => void) => {
      onContextLoss = listener;
      return { dispose: vi.fn() };
    }),
  };
  const terminal = {
    loadAddon: vi.fn(),
    refresh: vi.fn(),
    rows: 24,
  };

  return { addon, terminal, loseContext: () => onContextLoss() };
}

describe("activateTerminalWebglRenderer", () => {
  beforeEach(() => {
    diagCalls.length = 0;
  });

  it("activates WebGL when the addon can attach", () => {
    const { addon, terminal } = rendererFixture();

    const handle = activateTerminalWebglRenderer(terminal, {
      createAddon: () => addon,
    });

    expect(handle.renderer).toBe("webgl");
    expect(terminal.loadAddon).toHaveBeenCalledWith(addon);
    expect(diagCalls).toContainEqual({
      type: "custom",
      scope: "terminal-renderer",
      message: "renderer:webgl",
      metadata: {},
    });
  });

  it("releases the WebGL addon when its visible pane is disabled", () => {
    const { addon, terminal } = rendererFixture();

    const handle = activateTerminalWebglRenderer(terminal, {
      createAddon: () => addon,
    });
    handle.dispose();

    expect(addon.dispose).toHaveBeenCalledOnce();
  });

  it("uses addon construction as the WebGL capability check", () => {
    const { terminal } = rendererFixture();

    const handle = activateTerminalWebglRenderer(terminal, {
      createAddon: () => {
        throw new Error("webgl init failed");
      },
    });

    expect(handle.renderer).toBe("dom");
    expect(terminal.loadAddon).not.toHaveBeenCalled();
    expect(diagCalls).toContainEqual({
      type: "custom",
      scope: "terminal-renderer",
      message: "renderer:dom",
      metadata: { reason: "webgl_init_failed" },
    });
  });

  it("falls back and disposes when addon loading fails", () => {
    const { addon, terminal } = rendererFixture();
    terminal.loadAddon.mockImplementation(() => {
      throw new Error("webgl init failed");
    });

    const handle = activateTerminalWebglRenderer(terminal, {
      createAddon: () => addon,
    });

    expect(handle.renderer).toBe("dom");
    expect(addon.dispose).toHaveBeenCalledOnce();
  });

  it("disposes WebGL and refreshes the DOM viewport after context loss", () => {
    const { addon, terminal, loseContext } = rendererFixture();
    activateTerminalWebglRenderer(terminal, {
      createAddon: () => addon,
    });

    loseContext();

    expect(addon.dispose).toHaveBeenCalledOnce();
    expect(terminal.refresh).toHaveBeenCalledWith(0, 23);
    expect(diagCalls).toContainEqual({
      type: "custom",
      scope: "terminal-renderer",
      message: "renderer:dom",
      metadata: { reason: "webgl_context_loss" },
    });
  });
});
