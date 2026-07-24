import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { BrowserDebugPanel } from "@/components/organisms/BrowserDebugPanel.js";

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

describe("BrowserDebugPanel capture controls in Chromium", () => {
  let container: HTMLDivElement;
  let root: Root;

  beforeEach(async () => {
    container = document.createElement("div");
    document.body.append(container);
    root = createRoot(container);
  });

  afterEach(async () => {
    await act(async () => root.unmount());
    container.remove();
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
            targets: [
              {
                sessionId: "shell:demo",
                label: "Demo shell",
                mounted: true,
                registered: true,
                alive: true,
                current: false,
              },
            ],
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

    await act(async () =>
      container.querySelector<HTMLInputElement>("input[type=radio]")?.click(),
    );
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
