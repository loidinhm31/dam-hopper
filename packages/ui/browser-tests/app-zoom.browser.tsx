import { act, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { AppZoomProvider, useAppZoom } from "@/contexts/AppZoomContext.js";
import { BrowserDebugHostProvider } from "@/contexts/BrowserDebugHostContext.js";
import { BrowserDebugKeepAliveHost } from "@/components/organisms/BrowserDebugKeepAliveHost.js";
import { useCompactWorkspace } from "@/hooks/use-compact-workspace.js";
import type { BrowserDebugController } from "@/hooks/use-browser-debug.js";
import type {
  BrowserDebugHost,
  BrowserDebugHostViewport,
} from "@/lib/browser-debug-host.js";
import { APP_ZOOM_STORAGE_KEY } from "@/lib/app-zoom.js";
import { getBrowserDebugViewportGeometry } from "@/lib/browser-debug-keep-alive.js";
import {
  getCompactWorkspaceEffectiveWidth,
  readCompactWorkspaceMatch,
} from "@/hooks/compact-workspace-media-query.js";
import { TopNavAppZoomControls } from "@/components/atoms/TopNavAppZoomControls.js";
import "@/index.css";

function PortalFixture() {
  const [clicks, setClicks] = useState(0);
  return createPortal(
    <button
      type="button"
      data-testid="app-zoom-portal-button"
      style={{ height: "20px", width: "100px" }}
      onClick={() => setClicks((current) => current + 1)}
    >
      Portal clicks: {clicks}
    </button>,
    document.body,
  );
}

function ZoomHarness() {
  const { level } = useAppZoom();
  return (
    <main>
      <div data-testid="app-zoom-level">{level}%</div>
      <TopNavAppZoomControls />
      <div
        data-testid="app-zoom-viewport"
        style={{ height: "180px", width: "320px" }}
      />
      <div className="app-screen-height" data-testid="app-zoom-screen" />
      <PortalFixture />
    </main>
  );
}

function BrowserGeometryHarness() {
  const { level } = useAppZoom();
  const viewportRef = useRef<HTMLDivElement>(null);
  const viewportStageRef = useRef<HTMLDivElement>(null);
  const [viewport, setViewport] = useState<BrowserDebugHostViewport | null>(
    null,
  );
  const host = useMemo<BrowserDebugHost>(
    () => ({
      setTarget: () => {},
      setViewport,
      command: () => {},
      subscribe: () => () => {},
      destroy: () => {},
    }),
    [],
  );
  const browser = useMemo(
    () => ({ target: null }) as BrowserDebugController,
    [],
  );

  return (
    <BrowserDebugHostProvider host={host} environment={{ kind: "native" }}>
      <TopNavAppZoomControls />
      <div
        ref={viewportStageRef}
        style={{ height: "400px", width: "600px" }}
      >
        <div
          ref={viewportRef}
          style={{ height: "180px", width: "320px" }}
        />
      </div>
      <BrowserDebugKeepAliveHost
        browser={browser}
        viewportRef={viewportRef}
        viewportStageRef={viewportStageRef}
        viewportVersion={level}
        isViewportVisible
      />
      <output data-testid="browser-host-viewport">
        {viewport
          ? `${Math.round(viewport.width)}x${Math.round(viewport.height)}`
          : "none"}
      </output>
    </BrowserDebugHostProvider>
  );
}

function ResponsiveModeHarness() {
  const { level } = useAppZoom();
  const isCompactWorkspace = useCompactWorkspace();

  return (
    <>
      <TopNavAppZoomControls />
      <output data-testid="app-responsive-mode">
        {isCompactWorkspace ? "compact" : "desktop"}
      </output>
      <output data-testid="app-responsive-level">{level}%</output>
      <output data-testid="app-responsive-effective-width">
        {getCompactWorkspaceEffectiveWidth(window, level)}
      </output>
      <output data-testid="app-responsive-direct-match">
        {readCompactWorkspaceMatch(window, level) ? "compact" : "desktop"}
      </output>
    </>
  );
}

describe("shared app layout zoom in Chromium", () => {
  let container: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    localStorage.removeItem(APP_ZOOM_STORAGE_KEY);
    document.documentElement.style.zoom = "";
    container = document.createElement("div");
    document.body.append(container);
    root = createRoot(container);
  });

  afterEach(async () => {
    await act(async () => root.unmount());
    container.remove();
    localStorage.removeItem(APP_ZOOM_STORAGE_KEY);
    document.documentElement.style.zoom = "";
  });

  async function renderHarness() {
    await act(async () =>
      root.render(
        <AppZoomProvider>
          <ZoomHarness />
        </AppZoomProvider>,
      ),
    );
  }

  it("applies root zoom to ordinary content and a usable body portal", async () => {
    await renderHarness();

    const portal = document.querySelector<HTMLButtonElement>(
      '[data-testid="app-zoom-portal-button"]',
    );
    expect(document.documentElement.style.zoom).toBe("100%");
    expect(getComputedStyle(document.documentElement).zoom).toBeTruthy();
    expect(portal?.parentElement).toBe(document.body);
    expect(document.documentElement.contains(portal)).toBe(true);

    await act(async () => portal?.click());
    expect(portal?.textContent).toBe("Portal clicks: 1");

    const initialWidth = portal?.getBoundingClientRect().width ?? 0;
    const viewport = container.querySelector<HTMLElement>(
      '[data-testid="app-zoom-viewport"]',
    );
    const increase = container.querySelector<HTMLButtonElement>(
      '[data-testid="top-nav-app-zoom-increase"]',
    );
    await act(async () => increase?.click());
    expect(document.documentElement.style.zoom).toBe("110%");
    expect(portal?.getBoundingClientRect().width).toBeGreaterThan(initialWidth);
    expect(getBrowserDebugViewportGeometry(viewport)?.frame.width).toBeCloseTo(
      320,
    );
    expect(getBrowserDebugViewportGeometry(viewport)?.frame.height).toBeCloseTo(
      180,
    );
    expect(
      container
        .querySelector<HTMLElement>('[data-testid="app-zoom-screen"]')
        ?.getBoundingClientRect().height,
    ).toBeCloseTo(window.innerHeight);
  });

  it("steps, persists across remount, saturates, and leaves browser dimensions unchanged", async () => {
    await renderHarness();
    const outerWidth = window.outerWidth;
    const outerHeight = window.outerHeight;
    const increase = () =>
      container
        .querySelector<HTMLButtonElement>(
          '[data-testid="top-nav-app-zoom-increase"]',
        )
        ?.click();
    const decrease = () =>
      container
        .querySelector<HTMLButtonElement>(
          '[data-testid="top-nav-app-zoom-decrease"]',
        )
        ?.click();

    await act(async () => increase());
    expect(
      container.querySelector('[data-testid="app-zoom-level"]')?.textContent,
    ).toBe("110%");
    expect(localStorage.getItem(APP_ZOOM_STORAGE_KEY)).toContain('"zoom":110');

    await act(async () => root.render(null));
    await renderHarness();
    expect(
      container.querySelector('[data-testid="app-zoom-level"]')?.textContent,
    ).toBe("110%");

    await act(async () => {
      increase();
      increase();
    });
    expect(document.documentElement.style.zoom).toBe("120%");
    expect(
      container.querySelector<HTMLButtonElement>(
        '[data-testid="top-nav-app-zoom-increase"]',
      )?.disabled,
    ).toBe(true);

    await act(async () => {
      decrease();
      decrease();
      decrease();
      decrease();
      decrease();
      decrease();
      decrease();
    });
    expect(document.documentElement.style.zoom).toBe("50%");
    expect(
      container.querySelector<HTMLButtonElement>(
        '[data-testid="top-nav-app-zoom-decrease"]',
      )?.disabled,
    ).toBe(true);
    expect(window.outerWidth).toBe(outerWidth);
    expect(window.outerHeight).toBe(outerHeight);
  });

  it("recomputes Browser Debug host bounds after internal zoom changes", async () => {
    await act(async () =>
      root.render(
        <AppZoomProvider>
          <BrowserGeometryHarness />
        </AppZoomProvider>,
      ),
    );

    expect(
      container.querySelector("[data-testid=browser-host-viewport]")
        ?.textContent,
    ).toBe("320x180");

    await act(async () => {
      container
        .querySelector<HTMLButtonElement>(
          '[data-testid="top-nav-app-zoom-increase"]',
        )
        ?.click();
    });

    expect(document.documentElement.style.zoom).toBe("110%");
    expect(
      container.querySelector("[data-testid=browser-host-viewport]")
        ?.textContent,
    ).toBe("320x180");
  });

  it("lets decreased zoom cross the compact workspace breakpoint", async () => {
    const innerWidthDescriptor = Object.getOwnPropertyDescriptor(
      window,
      "innerWidth",
    );
    Object.defineProperty(window, "innerWidth", {
      configurable: true,
      value: 700,
    });

    try {
      await act(async () =>
        root.render(
          <AppZoomProvider>
            <ResponsiveModeHarness />
          </AppZoomProvider>,
        ),
      );

      expect(
        container.querySelector("[data-testid=app-responsive-mode]")
          ?.textContent,
      ).toBe("compact");

      await act(async () => {
        for (let index = 0; index < 5; index += 1) {
          container
            .querySelector<HTMLButtonElement>(
              '[data-testid="top-nav-app-zoom-decrease"]',
            )
            ?.click();
        }
      });

      expect(
        container.querySelector("[data-testid=app-responsive-level]")
          ?.textContent,
      ).toBe("50%");
      expect(
        container.querySelector("[data-testid=app-responsive-effective-width]")
          ?.textContent,
      ).toBe("1400");
      expect(
        container.querySelector("[data-testid=app-responsive-direct-match]")
          ?.textContent,
      ).toBe("desktop");
      expect(
        container.querySelector("[data-testid=app-responsive-mode]")
          ?.textContent,
      ).toBe("desktop");

      await act(async () => {
        Object.defineProperty(window, "innerWidth", {
          configurable: true,
          value: 639,
        });
        window.dispatchEvent(new Event("resize"));
      });
      expect(
        container.querySelector("[data-testid=app-responsive-mode]")
          ?.textContent,
      ).toBe("compact");

      await act(async () => {
        Object.defineProperty(window, "innerWidth", {
          configurable: true,
          value: 641,
        });
        window.dispatchEvent(new Event("resize"));
      });
      expect(
        container.querySelector("[data-testid=app-responsive-mode]")
          ?.textContent,
      ).toBe("desktop");
    } finally {
      if (innerWidthDescriptor) {
        Object.defineProperty(window, "innerWidth", innerWidthDescriptor);
      }
    }
  });
});
