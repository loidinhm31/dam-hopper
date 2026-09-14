// @vitest-environment jsdom

import * as React from "react";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const saveModeMock = vi.fn();
const loadModeMock = vi.fn(() => "edit" as const);

vi.mock("@/components/organisms/MonacoHost.js", () => ({
  MonacoHost: ({ readOnly }: { readOnly?: boolean }) => (
    <div data-testid="monaco-host" data-readonly={readOnly ? "true" : "false"}>
      Monaco Editor Mock
    </div>
  ),
}));

vi.mock("@/lib/html-view-mode-persistence.js", () => ({
  HTML_VIEW_MODE_CHANGED_EVENT: "dam-hopper:html-view-mode-changed",
  isHtmlMode: (v: unknown) => v === "edit" || v === "split" || v === "preview",
  loadHtmlViewMode: () => loadModeMock(),
  saveHtmlViewMode: (mode: string) => saveModeMock(mode),
}));

import { HtmlHost, type HtmlHostProps } from "./HtmlHost.js";

(
  globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;

let root: Root | null = null;

beforeEach(() => {
  saveModeMock.mockClear();
  loadModeMock.mockReturnValue("edit");
});

afterEach(() => {
  act(() => root?.unmount());
  root = null;
  document.body.innerHTML = "";
});

async function mount(props?: Partial<HtmlHostProps>) {
  const container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
  await act(async () => {
    root?.render(
      <HtmlHost
        tabKey="tab-1"
        path="index.html"
        content="<h1>Test</h1>"
        tier="normal"
        onChange={vi.fn()}
        onSave={vi.fn()}
        onViewStateChange={vi.fn()}
        {...props}
      />,
    );
  });
}

describe("HtmlHost", () => {
  it("initializes with stored mode by default and renders edit mode", async () => {
    await mount();

    const host = document.querySelector('[data-testid="html-host"]');
    expect(host).not.toBeNull();

    const editBtn = document.querySelector('button[aria-pressed="true"]');
    expect(editBtn?.textContent).toBe("Edit");

    expect(document.querySelector('[data-testid="monaco-host"]')).not.toBeNull();
    expect(document.querySelector('[data-testid="html-preview-container"]')).toBeNull();
  });

  it("respects initialMode prop override", async () => {
    await mount({ initialMode: "preview" });

    const activeBtn = document.querySelector('button[aria-pressed="true"]');
    expect(activeBtn?.textContent).toBe("Preview");

    expect(document.querySelector('[data-testid="monaco-host"]')).toBeNull();
    expect(document.querySelector('[data-testid="html-preview-container"]')).not.toBeNull();
  });

  it("switches to Split mode and persists preference", async () => {
    await mount();

    const buttons = Array.from(document.querySelectorAll("button"));
    const splitBtn = buttons.find((b) => b.textContent === "Split");
    expect(splitBtn).toBeDefined();

    await act(async () => {
      splitBtn?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });

    expect(splitBtn?.getAttribute("aria-pressed")).toBe("true");
    expect(saveModeMock).toHaveBeenCalledWith("split");

    expect(document.querySelector('[data-testid="monaco-host"]')).not.toBeNull();
    expect(document.querySelector('[data-testid="html-preview-container"]')).not.toBeNull();
  });

  it("switches to Preview mode and persists preference", async () => {
    await mount();

    const buttons = Array.from(document.querySelectorAll("button"));
    const previewBtn = buttons.find((b) => b.textContent === "Preview");
    expect(previewBtn).toBeDefined();

    await act(async () => {
      previewBtn?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });

    expect(previewBtn?.getAttribute("aria-pressed")).toBe("true");
    expect(saveModeMock).toHaveBeenCalledWith("preview");

    expect(document.querySelector('[data-testid="monaco-host"]')).toBeNull();
    expect(document.querySelector('[data-testid="html-preview-container"]')).not.toBeNull();
  });

  it("switches from Preview back to Edit mode", async () => {
    await mount({ initialMode: "preview" });

    const buttons = Array.from(document.querySelectorAll("button"));
    const editBtn = buttons.find((b) => b.textContent === "Edit");
    expect(editBtn).toBeDefined();

    await act(async () => {
      editBtn?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });

    expect(editBtn?.getAttribute("aria-pressed")).toBe("true");
    expect(saveModeMock).toHaveBeenCalledWith("edit");

    expect(document.querySelector('[data-testid="monaco-host"]')).not.toBeNull();
    expect(document.querySelector('[data-testid="html-preview-container"]')).toBeNull();
  });

  it("forwards readOnly to MonacoHost", async () => {
    await mount({ readOnly: true });

    const monaco = document.querySelector('[data-testid="monaco-host"]');
    expect(monaco?.getAttribute("data-readonly")).toBe("true");
  });

  it("updates mode when HTML_VIEW_MODE_CHANGED_EVENT is dispatched", async () => {
    await mount();

    expect(
      document.querySelector('button[aria-pressed="true"]')?.textContent,
    ).toBe("Edit");

    await act(async () => {
      window.dispatchEvent(
        new CustomEvent("dam-hopper:html-view-mode-changed", {
          detail: "preview",
        }),
      );
    });

    expect(
      document.querySelector('button[aria-pressed="true"]')?.textContent,
    ).toBe("Preview");
    expect(document.querySelector('[data-testid="monaco-host"]')).toBeNull();
    expect(
      document.querySelector('[data-testid="html-preview-container"]'),
    ).not.toBeNull();
  });
});
