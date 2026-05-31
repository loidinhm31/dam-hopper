import { describe, expect, it, vi } from "vitest";
import { activateTerminalWebglRenderer } from "./terminal-renderer.js";

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
  it("activates WebGL when WebGL2 is supported", () => {
    const { addon, terminal } = rendererFixture();

    const handle = activateTerminalWebglRenderer(terminal, {
      supportsWebgl2: () => true,
      createAddon: () => addon,
    });

    expect(handle.renderer).toBe("webgl");
    expect(terminal.loadAddon).toHaveBeenCalledWith(addon);
  });

  it("keeps the DOM renderer when WebGL2 is unavailable", () => {
    const { addon, terminal } = rendererFixture();

    const handle = activateTerminalWebglRenderer(terminal, {
      supportsWebgl2: () => false,
      createAddon: () => addon,
    });

    expect(handle.renderer).toBe("dom");
    expect(terminal.loadAddon).not.toHaveBeenCalled();
  });

  it("falls back when WebGL addon initialization fails", () => {
    const { addon, terminal } = rendererFixture();
    terminal.loadAddon.mockImplementation(() => {
      throw new Error("webgl init failed");
    });

    const handle = activateTerminalWebglRenderer(terminal, {
      supportsWebgl2: () => true,
      createAddon: () => addon,
    });

    expect(handle.renderer).toBe("dom");
    expect(addon.dispose).toHaveBeenCalledOnce();
  });

  it("disposes WebGL and refreshes the DOM viewport after context loss", () => {
    const { addon, terminal, loseContext } = rendererFixture();
    activateTerminalWebglRenderer(terminal, {
      supportsWebgl2: () => true,
      createAddon: () => addon,
    });

    loseContext();

    expect(addon.dispose).toHaveBeenCalledOnce();
    expect(terminal.refresh).toHaveBeenCalledWith(0, 23);
  });
});
