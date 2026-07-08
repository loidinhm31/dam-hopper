import { WebglAddon } from "@xterm/addon-webgl";
import type { IDisposable, ITerminalAddon, Terminal } from "@xterm/xterm";
import { logger } from "@dam-hopper/shared/logger";
import { recordClientDiagnostic } from "@/lib/diagnostics-client.js";

interface WebglAddonLike extends ITerminalAddon {
  readonly onContextLoss: (listener: () => void) => IDisposable;
}

interface TerminalRendererOptions {
  createAddon?: () => WebglAddonLike;
  supportsWebgl2?: () => boolean;
}

export interface TerminalRendererHandle {
  renderer: "dom" | "webgl";
  dispose: () => void;
}

function supportsWebgl2(): boolean {
  if (typeof document === "undefined") return false;

  try {
    return document.createElement("canvas").getContext("webgl2") !== null;
  } catch {
    return false;
  }
}

export function activateTerminalWebglRenderer(
  terminal: Pick<Terminal, "loadAddon" | "refresh" | "rows">,
  options: TerminalRendererOptions = {},
): TerminalRendererHandle {
  const isSupported = options.supportsWebgl2 ?? supportsWebgl2;
  if (!isSupported()) {
    logger.debug("TerminalRenderer", "WebGL2 unavailable; using DOM renderer");
    recordClientDiagnostic("custom", "terminal-renderer", "renderer:dom", {
      reason: "webgl2_unavailable",
    });
    return { renderer: "dom", dispose: () => {} };
  }

  const createAddon = options.createAddon ?? (() => new WebglAddon());
  let addon: WebglAddonLike | null = null;
  let contextLossDisposable: IDisposable | null = null;

  const disposeAddon = () => {
    contextLossDisposable?.dispose();
    contextLossDisposable = null;
    addon?.dispose();
    addon = null;
  };

  try {
    addon = createAddon();
    contextLossDisposable = addon.onContextLoss(() => {
      logger.warn(
        "TerminalRenderer",
        "WebGL context lost; falling back to DOM renderer",
      );
      recordClientDiagnostic("custom", "terminal-renderer", "renderer:dom", {
        reason: "webgl_context_loss",
      });
      disposeAddon();
      try {
        terminal.refresh(0, Math.max(0, terminal.rows - 1));
      } catch {
        logger.debug(
          "TerminalRenderer",
          "terminal disposed before DOM renderer refresh",
        );
      }
    });
    terminal.loadAddon(addon);
    recordClientDiagnostic("custom", "terminal-renderer", "renderer:webgl", {});
    return { renderer: "webgl", dispose: disposeAddon };
  } catch (error) {
    disposeAddon();
    logger.warn(
      "TerminalRenderer",
      "WebGL renderer initialization failed; using DOM renderer",
      { error },
    );
    recordClientDiagnostic("custom", "terminal-renderer", "renderer:dom", {
      reason: "webgl_init_failed",
    });
    return { renderer: "dom", dispose: () => {} };
  }
}
