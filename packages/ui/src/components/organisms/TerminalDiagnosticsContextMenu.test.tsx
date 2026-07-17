// @vitest-environment jsdom

import * as React from "react";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  openTerminalDiagnosticsContextMenu,
  TerminalDiagnosticsContextMenu,
} from "./TerminalDiagnosticsContextMenu.js";

(
  globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;

let root: Root | null = null;

describe("TerminalDiagnosticsContextMenu", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("opens the exact session menu target and suppresses the browser menu", () => {
    const preventDefault = vi.fn();
    const stopPropagation = vi.fn();
    const onOpenDiagnosticsMenu = vi.fn();

    openTerminalDiagnosticsContextMenu(
      { clientX: 120, clientY: 80, preventDefault, stopPropagation },
      "session-bash-2",
      onOpenDiagnosticsMenu,
    );

    expect(preventDefault).toHaveBeenCalledOnce();
    expect(stopPropagation).toHaveBeenCalledOnce();
    expect(onOpenDiagnosticsMenu).toHaveBeenCalledWith(
      "session-bash-2",
      120,
      80,
    );
  });

  it("renders pending and error feedback without exposing another action", async () => {
    const container = document.createElement("div");
    document.body.append(container);
    root = createRoot(container);

    await act(async () => {
      root?.render(
        <TerminalDiagnosticsContextMenu
          x={40}
          y={60}
          isPending
          error="Export unavailable"
          onExport={vi.fn()}
          onClose={vi.fn()}
        />,
      );
    });

    expect(document.body.textContent).toContain("Exporting…");
    expect(document.body.textContent).toContain("Export unavailable");
    expect(
      document
        .querySelector('[role="menuitem"]')
        ?.hasAttribute("data-disabled"),
    ).toBe(true);
    expect(document.querySelectorAll('[role="menuitem"]')).toHaveLength(1);
  });

  afterEach(() => {
    act(() => root?.unmount());
    root = null;
    document.body.innerHTML = "";
  });
});
