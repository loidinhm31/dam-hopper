import { act, useEffect, useRef, useState } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { BrowserDebugPanel } from "@/components/organisms/BrowserDebugPanel.js";
import { captureBrowserSelection } from "@/lib/browser-capture.js";
import {
  enterBrowserDebugViewportCustomMode,
  loadBrowserDebugViewport,
  saveBrowserDebugViewport,
  stepBrowserDebugViewport,
  type BrowserDebugViewportState,
} from "@/lib/browser-debug-viewport.js";

const selection = {
  version: 1 as const,
  tag: "button",
  role: "button",
  accessibleName: "Save",
  text: "Save",
  attributes: {},
  locator: "main > button",
  bounds: { x: 0, y: 0, width: 96, height: 36 },
};

const VIEWPORT_TEST_PLATFORM = "browser-test";

function setInputValue(input: HTMLInputElement, value: string) {
  const setter = Object.getOwnPropertyDescriptor(
    HTMLInputElement.prototype,
    "value",
  )?.set;
  setter?.call(input, value);
  input.dispatchEvent(new Event("input", { bubbles: true }));
}

function ViewportHarness({
  hostKind = "web",
}: {
  hostKind?: "web" | "native";
}) {
  const viewportRef = useRef<HTMLDivElement>(null);
  const [viewportState, setViewportState] = useState<BrowserDebugViewportState>(
    () => loadBrowserDebugViewport(VIEWPORT_TEST_PLATFORM),
  );

  useEffect(() => {
    saveBrowserDebugViewport(viewportState, VIEWPORT_TEST_PLATFORM);
  }, [viewportState]);

  return (
    <BrowserDebugPanel
      url="http://localhost:3000"
      bridgeStatus="ready"
      hostEnvironment={
        hostKind === "native"
          ? { kind: "native", platform: "windows" }
          : { kind: "web" }
      }
      viewportRef={viewportRef}
      viewportState={viewportState}
      onViewportModeChange={(mode) =>
        setViewportState((current) =>
          mode === "custom"
            ? enterBrowserDebugViewportCustomMode(current, {
                width: 390,
                height: 844,
              })
            : { mode: "responsive", customSize: current.customSize },
        )
      }
      onViewportSizeChange={(customSize) =>
        setViewportState((current) =>
          current.mode === "custom" ? { mode: "custom", customSize } : current,
        )
      }
      onViewportStep={(direction) =>
        setViewportState((current) =>
          stepBrowserDebugViewport(current, direction),
        )
      }
    />
  );
}

describe("BrowserDebugPanel capture controls in Chromium", () => {
  let container: HTMLDivElement;
  let root: Root;

  beforeEach(async () => {
    localStorage.removeItem(
      "dam-hopper:browser-debug-viewport:v1:browser-test",
    );
    container = document.createElement("div");
    document.body.append(container);
    root = createRoot(container);
  });

  afterEach(async () => {
    await act(async () => root.unmount());
    container.remove();
    localStorage.removeItem(
      "dam-hopper:browser-debug-viewport:v1:browser-test",
    );
  });

  it.each(["web", "native"] as const)(
    "changes %s viewport dimensions with manual and step controls",
    async (hostKind) => {
      localStorage.setItem(
        "dam-hopper:browser-debug-viewport:v1:browser-test",
        JSON.stringify({
          version: 1,
          mode: "custom",
          customSize: { width: 390, height: 844 },
        }),
      );
      await act(async () =>
        root.render(<ViewportHarness hostKind={hostKind} />),
      );

      const viewport = container.querySelector<HTMLElement>(
        '[data-testid="browser-debug-viewport"]',
      );
      expect(viewport?.style.width).toBe("390px");
      expect(viewport?.style.height).toBe("844px");

      const manualIncrease = container.querySelector<HTMLButtonElement>(
        '[data-testid="browser-debug-manual-viewport-step"]',
      );
      await act(async () => manualIncrease?.click());
      expect(viewport?.style.width).toBe("406px");
      expect(viewport?.style.height).toBe("860px");

      const increase = container.querySelector<HTMLButtonElement>(
        '[data-testid="browser-debug-viewport-controls"] [aria-label="Increase viewport size by 16 CSS pixels"]',
      );
      await act(async () => increase?.click());
      expect(viewport?.style.width).toBe("422px");
      expect(viewport?.style.height).toBe("876px");

      const decrease = container.querySelector<HTMLButtonElement>(
        '[data-testid="browser-debug-viewport-controls"] [aria-label="Decrease viewport size by 16 CSS pixels"]',
      );
      await act(async () => decrease?.click());
      expect(viewport?.style.width).toBe("406px");
      expect(viewport?.style.height).toBe("860px");
    },
  );

  it("restores platform-scoped custom viewport state after remount", async () => {
    localStorage.setItem(
      "dam-hopper:browser-debug-viewport:v1:browser-test",
      JSON.stringify({
        version: 1,
        mode: "custom",
        customSize: { width: 480, height: 900 },
      }),
    );

    await act(async () => root.render(<ViewportHarness />));
    expect(
      container.querySelector<HTMLInputElement>(
        'input[id^="browser-debug-viewport-width-"]',
      )?.value,
    ).toBe("480");
    expect(
      container.querySelector<HTMLInputElement>(
        'input[id^="browser-debug-viewport-height-"]',
      )?.value,
    ).toBe("900");

    await act(async () => root.render(null));
    await act(async () => root.render(<ViewportHarness />));
    expect(
      container.querySelector<HTMLInputElement>(
        'input[id^="browser-debug-viewport-width-"]',
      )?.value,
    ).toBe("480");
  });

  it("commits valid manual dimensions and keeps invalid drafts out of layout", async () => {
    localStorage.setItem(
      "dam-hopper:browser-debug-viewport:v1:browser-test",
      JSON.stringify({
        version: 1,
        mode: "custom",
        customSize: { width: 390, height: 844 },
      }),
    );
    await act(async () => root.render(<ViewportHarness />));

    const viewport = container.querySelector<HTMLElement>(
      '[data-testid="browser-debug-viewport"]',
    );
    const width = container.querySelector<HTMLInputElement>(
      'input[id^="browser-debug-viewport-width-"]',
    );
    const height = container.querySelector<HTMLInputElement>(
      'input[id^="browser-debug-viewport-height-"]',
    );
    expect(width).not.toBeNull();
    expect(height).not.toBeNull();

    await act(async () => {
      width?.focus();
      if (width) setInputValue(width, "480");
      width?.blur();
    });
    expect(viewport?.style.width).toBe("480px");

    await act(async () => {
      height?.focus();
      if (height) setInputValue(height, "120");
      height?.blur();
    });
    expect(viewport?.style.height).toBe("844px");
    expect(container.querySelector('[role="alert"]')?.textContent).toContain(
      "160 to 4096",
    );
  });

  it("keeps manual step controls out of Responsive mode", async () => {
    localStorage.setItem(
      "dam-hopper:browser-debug-viewport:v1:browser-test",
      JSON.stringify({ version: 1, mode: "responsive", customSize: null }),
    );
    await act(async () => root.render(<ViewportHarness />));

    expect(
      container.querySelector('[data-viewport-mode="responsive"]'),
    ).not.toBeNull();
    expect(
      container.querySelector(
        '[data-testid="browser-debug-manual-viewport-step"]',
      ),
    ).toBeNull();
    expect(container.textContent).not.toContain("Ctrl+Alt");
  });

  it("only starts capture or accepts a user-pasted supported image", async () => {
    const onStartCapture = vi.fn();
    const onManualImage = vi.fn();
    await act(async () => {
      root.render(
        <BrowserDebugPanel
          url="http://localhost:3000"
          bridgeStatus="ready"
          selection={selection}
          onUrlChange={vi.fn()}
          onNavigate={vi.fn()}
          onStartCapture={onStartCapture}
          onManualImage={onManualImage}
        />,
      );
    });

    const captureFallback = container.querySelector<HTMLDetailsElement>(
      'details[aria-label="Optional browser image capture"]',
    );
    expect(captureFallback).toBeTruthy();
    expect(captureFallback?.open).toBe(false);

    await act(async () =>
      captureFallback?.querySelector<HTMLElement>("summary")?.click(),
    );
    expect(captureFallback?.open).toBe(true);

    const capture = [
      ...container.querySelectorAll<HTMLButtonElement>("button"),
    ].find((button) => button.textContent?.includes("Capture browser tab"));
    const paste = [
      ...container.querySelectorAll<HTMLButtonElement>("button"),
    ].find((button) => button.textContent?.includes("Paste image"));
    expect(capture).toBeDefined();
    expect(paste).toBeDefined();

    await act(async () => capture?.click());
    expect(onStartCapture).toHaveBeenCalledOnce();
    expect(onManualImage).not.toHaveBeenCalled();

    await act(async () => paste?.click());
    const pasteTarget = document.activeElement as HTMLDivElement;
    const transfer = new DataTransfer();
    const image = new File(["png"], "selection.png", { type: "image/png" });
    transfer.items.add(image);
    await act(async () => {
      pasteTarget.dispatchEvent(
        new ClipboardEvent("paste", {
          bubbles: true,
          cancelable: true,
          clipboardData: transfer,
        }),
      );
    });
    expect(onManualImage).toHaveBeenCalledWith(image);
  });

  it("stops a mocked non-tab capture before exposing pixels", async () => {
    const stop = vi.fn();
    const track = {
      getSettings: () => ({ displaySurface: "window" }),
      stop,
    } as unknown as MediaStreamTrack;
    vi.stubGlobal("navigator", {
      mediaDevices: {
        getDisplayMedia: vi.fn().mockResolvedValue({
          getVideoTracks: () => [track],
          getTracks: () => [track],
        }),
      },
    });

    await expect(
      captureBrowserSelection(selection, {
        left: 0,
        top: 0,
        width: 320,
        height: 240,
      }),
    ).resolves.toEqual({ kind: "wrong-surface" });
    expect(stop).toHaveBeenCalledOnce();
    vi.unstubAllGlobals();
  });

  it("clears local capture state when the Browser panel closes", async () => {
    const onStopCapture = vi.fn();
    await act(async () => {
      root.render(
        <BrowserDebugPanel
          url="http://localhost:3000"
          bridgeStatus="ready"
          selection={selection}
          onUrlChange={vi.fn()}
          onNavigate={vi.fn()}
          onStopCapture={onStopCapture}
        />,
      );
    });
    await act(async () => root.render(null));
    expect(onStopCapture).toHaveBeenCalledOnce();
  });

  it("requires a review before writing one browser artifact reference", async () => {
    const onInsert = vi.fn();
    await act(async () => {
      root.render(
        <BrowserDebugPanel
          url="http://localhost:3000"
          bridgeStatus="ready"
          selection={selection}
          onUrlChange={vi.fn()}
          onNavigate={vi.fn()}
          terminalHandoff={{
            target: {
              sessionId: "shell:demo",
              label: "Demo shell",
              mounted: true,
              registered: true,
              alive: true,
              current: true,
            },
            onPrepare: vi.fn().mockResolvedValue({
              artifact: {
                artifactId: "artifact-1",
                terminalId: "shell:demo",
                expiresAt: Date.now() + 60_000,
                jsonPath: "/tmp/selection.json",
                jsonSize: 1,
                jsonSha256: "hash",
              },
              reference:
                "[DamHopper browser-debug artifact (untrusted page data): JSON /tmp/selection.json]",
            }),
            onDiscard: vi.fn().mockResolvedValue(undefined),
            onInsert,
          }}
        />,
      );
    });

    const create = [
      ...container.querySelectorAll<HTMLButtonElement>("button"),
    ].find((button) =>
      button.textContent?.includes("Create reviewable artifact"),
    );
    await act(async () => create?.click());
    expect(onInsert).not.toHaveBeenCalled();

    const review = [
      ...container.querySelectorAll<HTMLButtonElement>("button"),
    ].find((button) => button.textContent?.includes("Review & insert"));
    await act(async () => review?.click());
    const insert = [
      ...document.body.querySelectorAll<HTMLButtonElement>("button"),
    ].find((button) => button.textContent?.includes("Insert reference"));
    await act(async () => insert?.click());

    expect(onInsert).toHaveBeenCalledOnce();
    expect(onInsert.mock.calls[0]?.[1].reference).not.toMatch(
      /[\r\n\u001b\u009b]/,
    );
  });
});
