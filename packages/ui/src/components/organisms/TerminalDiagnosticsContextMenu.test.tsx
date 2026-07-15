import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  clampTerminalDiagnosticsContextMenuPosition,
  TerminalDiagnosticsContextMenu,
} from "./TerminalDiagnosticsContextMenu.js";

describe("TerminalDiagnosticsContextMenu", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("clamps both menu edges inside the viewport", () => {
    expect(
      clampTerminalDiagnosticsContextMenuPosition(-20, -10, 1280, 960),
    ).toEqual({ x: 8, y: 8 });
    expect(
      clampTerminalDiagnosticsContextMenuPosition(1250, 940, 1280, 960),
    ).toEqual({ x: 1080, y: 856 });
  });

  it("renders pending and error feedback without exposing another action", () => {
    vi.stubGlobal("window", { innerWidth: 1280, innerHeight: 960 });

    const markup = renderToStaticMarkup(
      <TerminalDiagnosticsContextMenu
        x={40}
        y={60}
        isPending
        error="Export unavailable"
        onExport={vi.fn()}
        onClose={vi.fn()}
      />,
    );

    expect(markup).toContain("Exporting…");
    expect(markup).toContain("Export unavailable");
    expect(markup).toContain("disabled");
    expect(markup.match(/role="menuitem"/g)).toHaveLength(1);
  });
});
