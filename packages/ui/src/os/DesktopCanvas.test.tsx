// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { DesktopCanvas } from "./DesktopCanvas.js";
import { useWindowStore } from "./window-store.js";
import { createDefaultOsSession } from "./window-ops.js";
import { useCognitoModeStore } from "@/stores/cognito-mode.js";
import * as connectionsApi from "@/api/connections.js";
import type { OsDesktop, OsWindow } from "./types.js";

describe("DesktopCanvas Hologram Background", () => {
  let container: HTMLDivElement;
  let root: Root;
  let queryClient: QueryClient;

  beforeEach(() => {
    queryClient = new QueryClient({
      defaultOptions: { queries: { retry: false } },
    });
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
    useWindowStore.setState({
      session: createDefaultOsSession("desk-alpha", "Workspace Alpha"),
      viewport: { width: 1200, height: 750 },
    });
    useCognitoModeStore.getState().reset();
    vi.clearAllMocks();

    vi.spyOn(connectionsApi, "getConnectionSnapshot").mockImplementation(
      (profileId: string) => ({
        status: "connected",
        serverUrl: "http://localhost:3000",
        owner: { profileId, generation: 1 },
      }),
    );
  });

  afterEach(() => {
    act(() => {
      root.unmount();
    });
    container.remove();
  });

  function renderDesktop(
    desktopOverride?: OsDesktop,
    renderApp?: (win: OsWindow) => React.ReactNode,
  ) {
    const desktop =
      desktopOverride ?? useWindowStore.getState().session.desktops[0];
    act(() => {
      root.render(
        <QueryClientProvider client={queryClient}>
          <DesktopCanvas
            desktop={desktop}
            renderApp={
              renderApp ??
              ((win) => (
                <div data-testid={`app-${win.id}`}>{win.title} App</div>
              ))
            }
          />
        </QueryClientProvider>,
      );
    });
  }

  it("renders hologram background decorative layer with required attributes and classes", () => {
    renderDesktop();

    const hologramBg = container.querySelector(
      '[data-testid="desktop-hologram-bg-desk-alpha"]',
    );
    expect(hologramBg).not.toBeNull();
    expect(hologramBg?.getAttribute("aria-hidden")).toBe("true");
    expect(hologramBg?.className).toContain("os-hologram-bg");
    expect(hologramBg?.className).toContain("pointer-events-none");
    expect(hologramBg?.className).toContain("absolute inset-0");
    expect(hologramBg?.className).toContain("z-0");
    expect(hologramBg?.className).toContain("select-none");
  });

  it("renders dual-scale cyber grid and central focal reticle SVG", () => {
    renderDesktop();

    const grid = container.querySelector(".os-hologram-grid");
    expect(grid).not.toBeNull();
    expect(grid?.className).toContain("absolute inset-0");

    const reticleSvg = container.querySelector("svg");
    expect(reticleSvg).not.toBeNull();
    expect(reticleSvg?.getAttribute("viewBox")).toBe("0 0 400 400");

    // Verify circles and crosshairs inside SVG
    const circles = reticleSvg?.querySelectorAll("circle");
    expect(circles?.length).toBeGreaterThanOrEqual(4);

    const lines = reticleSvg?.querySelectorAll("line");
    expect(lines?.length).toBeGreaterThanOrEqual(4);
  });

  it("renders corner HUD reticles and coordinate telemetry text", () => {
    renderDesktop();

    const hologramBg = container.querySelector(
      '[data-testid="desktop-hologram-bg-desk-alpha"]',
    );
    expect(hologramBg?.textContent).toContain("DH//OS · SYS.GRID // WORKSPACE ALPHA");
    expect(hologramBg?.textContent).toContain("SEC // 01");
    expect(hologramBg?.textContent).toContain("GRID // 64PX");
    expect(hologramBg?.textContent).toContain("SYNC // NOMINAL");

    // Verify corner brackets exist
    const cornerBrackets = hologramBg?.querySelectorAll(
      ".border-t, .border-b",
    );
    expect(cornerBrackets?.length).toBeGreaterThanOrEqual(4);
  });

  it("masks desktop name under Cognito mode and restores it on deactivation", () => {
    renderDesktop();

    const hologramBg = container.querySelector(
      '[data-testid="desktop-hologram-bg-desk-alpha"]',
    );
    expect(hologramBg?.textContent).toContain("DH//OS · SYS.GRID // WORKSPACE ALPHA");
    expect(hologramBg?.textContent).not.toContain("PROTECTED");

    // Activate Cognito mode dynamically
    act(() => {
      useCognitoModeStore.getState().toggle("KeyC");
    });

    expect(hologramBg?.textContent).toContain("DH//OS · SYS.GRID // PROTECTED");
    expect(hologramBg?.textContent).not.toContain("WORKSPACE ALPHA");

    // Deactivate Cognito mode
    act(() => {
      useCognitoModeStore.getState().toggle("KeyC");
    });

    expect(hologramBg?.textContent).toContain("DH//OS · SYS.GRID // WORKSPACE ALPHA");
    expect(hologramBg?.textContent).not.toContain("PROTECTED");
  });

  it("preserves DesktopContextMenu and window layers alongside hologram background", () => {
    renderDesktop();

    const canvas = container.querySelector(
      '[data-testid="desktop-canvas-desk-alpha"]',
    );
    expect(canvas).not.toBeNull();

    const contextTrigger = container.querySelector(
      '[data-testid="desktop-context-trigger-desk-alpha"]',
    );
    expect(contextTrigger).not.toBeNull();

    const hologramBg = container.querySelector(
      '[data-testid="desktop-hologram-bg-desk-alpha"]',
    );
    expect(hologramBg).not.toBeNull();

    // Verify hologram is before context trigger or sibling in canvas
    expect(canvas?.contains(hologramBg!)).toBe(true);
    expect(canvas?.contains(contextTrigger!)).toBe(true);
  });
});
