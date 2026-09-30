import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  activateTerminalWebglRenderer,
  createTerminalRendererController,
} from "./terminal-renderer.js";
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

describe("createTerminalRendererController", () => {
  beforeEach(() => {
    diagCalls.length = 0;
  });

  it("controls transitions between WebGL and DOM renderers", () => {
    const { addon, terminal } = rendererFixture();
    let createdCount = 0;
    const controller = createTerminalRendererController(terminal, {
      createAddon: () => {
        createdCount++;
        return addon;
      },
    });

    expect(controller.currentRenderer).toBe("dom");

    // Commit WebGL
    const first = controller.commitRenderer("webgl");
    expect(first).toBe("webgl");
    expect(controller.currentRenderer).toBe("webgl");
    expect(createdCount).toBe(1);
    expect(terminal.loadAddon).toHaveBeenCalledOnce();

    // Idempotent when already WebGL
    const second = controller.commitRenderer("webgl");
    expect(second).toBe("webgl");
    expect(createdCount).toBe(1);

    // Commit DOM (revert to DOM)
    const reverted = controller.commitRenderer("dom");
    expect(reverted).toBe("dom");
    expect(controller.currentRenderer).toBe("dom");
    expect(addon.dispose).toHaveBeenCalledOnce();

    // Dispose cleans up safely
    controller.dispose();
    expect(controller.currentRenderer).toBe("dom");
  });

  it("latches failed WebGL attempt and does not retry every fit until mode transitions", () => {
    const { terminal } = rendererFixture();
    let attempts = 0;
    const controller = createTerminalRendererController(terminal, {
      createAddon: () => {
        attempts++;
        throw new Error("WebGL init failed");
      },
    });

    // First attempt fails and falls back to DOM
    expect(controller.commitRenderer("webgl")).toBe("dom");
    expect(controller.currentRenderer).toBe("dom");
    expect(attempts).toBe(1);

    // Subsequent fits with desired="webgl" are latched and do not retry
    expect(controller.commitRenderer("webgl")).toBe("dom");
    expect(attempts).toBe(1);

    // Mode transitions to DOM
    expect(controller.commitRenderer("dom")).toBe("dom");

    // Mode transitions back to WebGL -> retries
    expect(controller.commitRenderer("webgl")).toBe("dom");
    expect(attempts).toBe(2);
  });

  it("accurately updates currentRenderer to DOM and disposes on context loss without retry until transition", () => {
    const { addon, terminal, loseContext } = rendererFixture();
    let attempts = 0;
    const controller = createTerminalRendererController(terminal, {
      createAddon: () => {
        attempts++;
        return addon;
      },
    });

    expect(controller.commitRenderer("webgl")).toBe("webgl");
    expect(controller.currentRenderer).toBe("webgl");
    expect(attempts).toBe(1);

    // Context loss occurs
    loseContext();
    expect(controller.currentRenderer).toBe("dom");
    expect(addon.dispose).toHaveBeenCalled();

    // Subsequent fits with desired="webgl" do not re-attempt WebGL while in current mode
    expect(controller.commitRenderer("webgl")).toBe("dom");
    expect(attempts).toBe(1);

    // Explicit mode transition to DOM then WebGL allows fresh attempt
    controller.commitRenderer("dom");
    controller.commitRenderer("webgl");
    expect(attempts).toBe(2);
  });
});
