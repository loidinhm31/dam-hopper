// @vitest-environment jsdom

import * as React from "react";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { HtmlPreview } from "./HtmlPreview.js";

(
  globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;

let root: Root | null = null;

beforeEach(() => {
  vi.useFakeTimers();
});

afterEach(() => {
  act(() => root?.unmount());
  root = null;
  document.body.innerHTML = "";
  vi.useRealTimers();
});

async function mount(content: string, debounceMs?: number) {
  const container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
  await act(async () => {
    root?.render(
      <HtmlPreview content={content} debounceMs={debounceMs} />,
    );
  });
}

describe("HtmlPreview", () => {
  it("renders a sandboxed iframe without allow-same-origin", async () => {
    await mount("<h1>Hello World</h1>", 0);

    const iframe = document.querySelector("iframe");
    expect(iframe).not.toBeNull();
    expect(iframe?.getAttribute("sandbox")).toBe(
      "allow-scripts allow-modals allow-forms allow-popups allow-pointer-lock",
    );
    expect(iframe?.getAttribute("sandbox")).not.toContain("allow-same-origin");
    expect(iframe?.getAttribute("title")).toBe("HTML Preview");
  });

  it("updates debounced content after debounce delay", async () => {
    await mount("<p>Initial</p>", 200);

    let iframe = document.querySelector("iframe");
    expect(iframe?.getAttribute("srcdoc")).toContain("<p>Initial</p>");
    expect(iframe?.getAttribute("srcdoc")).toContain("data-dam-hopper-preview-shim");

    // Re-render with new content
    await act(async () => {
      root?.render(<HtmlPreview content="<p>Updated</p>" debounceMs={200} />);
    });

    iframe = document.querySelector("iframe");
    // Before timer advances, still initial
    expect(iframe?.getAttribute("srcdoc")).toContain("<p>Initial</p>");

    // Advance timer past debounceMs
    await act(async () => {
      vi.advanceTimersByTime(200);
    });

    iframe = document.querySelector("iframe");
    expect(iframe?.getAttribute("srcdoc")).toContain("<p>Updated</p>");
  });

  it("remounts iframe on reload button click", async () => {
    await mount("<p>Test</p>", 0);

    const firstIframe = document.querySelector("iframe");
    const reloadButton = document.querySelector('button[aria-label="Reload preview"]');
    expect(reloadButton).not.toBeNull();

    await act(async () => {
      reloadButton?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });

    const secondIframe = document.querySelector("iframe");
    expect(secondIframe).not.toBeNull();
    // React should replace the iframe node due to the changed key
    expect(secondIframe).not.toBe(firstIframe);
  });
});
