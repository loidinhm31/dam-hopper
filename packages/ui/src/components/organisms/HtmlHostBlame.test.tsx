vi.mock("@/lib/monaco-setup.js", () => ({}));
// @vitest-environment jsdom

import * as React from "react";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { HtmlHost } from "./HtmlHost.js";

interface CapturedMonacoProps {
  sourceActive?: boolean;
  onRevealCommit?: (commitHash: string, rootId: string) => void;
}

const capturedMonacoProps: CapturedMonacoProps[] = [];

vi.mock("@/components/organisms/MonacoHost.js", () => ({
  MonacoHost: (props: CapturedMonacoProps) => {
    capturedMonacoProps.push(props);
    return (
      <div data-testid="monaco-host">
        <button
          type="button"
          data-testid="monaco-reveal-btn"
          onClick={() => props.onRevealCommit?.("html-commit-99", "root-html")}
        >
          Reveal
        </button>
      </div>
    );
  },
}));

vi.mock("@/lib/html-view-mode-persistence.js", () => ({
  loadHtmlViewMode: () => "edit",
  saveHtmlViewMode: vi.fn(),
  isHtmlMode: (val: unknown) => val === "edit" || val === "split" || val === "preview",
  HTML_VIEW_MODE_CHANGED_EVENT: "dam-hopper:html-view-mode-changed",
}));

(
  globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;

let root: Root | null = null;
let container: HTMLDivElement | null = null;

beforeEach(() => {
  capturedMonacoProps.length = 0;
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
});

afterEach(() => {
  act(() => root?.unmount());
  root = null;
  container?.remove();
  container = null;
  document.body.innerHTML = "";
});

async function flushLazy(): Promise<void> {
  await act(async () => {
    const { promise, resolve } = Promise.withResolvers<void>();
    setTimeout(resolve, 0);
    await promise;
  });
}

describe("HtmlHost Blame Integration", () => {
  it("renders MonacoHost in Edit mode with sourceActive=true and forwards onRevealCommit", async () => {
    const onRevealCommit = vi.fn();

    await act(async () => {
      root?.render(
        <HtmlHost
          tabKey="tab-html-1"
          path="index.html"
          content="<!DOCTYPE html><html><body>Test</body></html>"
          tier="normal"
          sourceActive={true}
          onRevealCommit={onRevealCommit}
          onChange={vi.fn()}
          onSave={vi.fn()}
          onViewStateChange={vi.fn()}
        />,
      );
    });

    await flushLazy();

    expect(capturedMonacoProps.length).toBeGreaterThan(0);
    const lastProps = capturedMonacoProps[capturedMonacoProps.length - 1];
    expect(lastProps?.sourceActive).toBe(true);

    act(() => {
      lastProps?.onRevealCommit?.("html-commit-99", "root-html");
    });

    expect(onRevealCommit).toHaveBeenCalledWith("html-commit-99", "root-html");
  });

  it("passes sourceActive=false to MonacoHost when HtmlHost sourceActive is false", async () => {
    await act(async () => {
      root?.render(
        <HtmlHost
          tabKey="tab-html-2"
          path="index.html"
          content="<!DOCTYPE html><html><body>Test</body></html>"
          tier="normal"
          sourceActive={false}
          onChange={vi.fn()}
          onSave={vi.fn()}
          onViewStateChange={vi.fn()}
        />,
      );
    });

    await flushLazy();

    expect(capturedMonacoProps.length).toBeGreaterThan(0);
    const lastProps = capturedMonacoProps[capturedMonacoProps.length - 1];
    expect(lastProps?.sourceActive).toBe(false);
  });

  it("unmounts MonacoHost and pauses blame work when Preview mode is selected", async () => {
    await act(async () => {
      root?.render(
        <HtmlHost
          tabKey="tab-html-3"
          path="index.html"
          content="<!DOCTYPE html><html><body>Test</body></html>"
          tier="normal"
          sourceActive={true}
          onChange={vi.fn()}
          onSave={vi.fn()}
          onViewStateChange={vi.fn()}
        />,
      );
    });

    await flushLazy();
    expect(capturedMonacoProps.length).toBeGreaterThan(0);

    // Switch to Preview mode
    const previewBtn = container?.querySelector('button[aria-pressed="false"]:nth-of-type(3)') as HTMLButtonElement | null;
    expect(previewBtn).not.toBeNull();
    expect(previewBtn?.textContent).toBe("Preview");

    capturedMonacoProps.length = 0;
    await act(async () => {
      previewBtn?.click();
    });

    await flushLazy();

    // MonacoHost is unmounted in Preview mode
    const monacoEl = container?.querySelector('[data-testid="monaco-host"]');
    expect(monacoEl).toBeNull();

    // Switch back to Edit mode
    const editBtn = container?.querySelector('button:nth-of-type(1)') as HTMLButtonElement | null;
    expect(editBtn?.textContent).toBe("Edit");

    await act(async () => {
      editBtn?.click();
    });

    await flushLazy();

    // MonacoHost is remounted with sourceActive=true
    expect(capturedMonacoProps.length).toBeGreaterThan(0);
    const lastProps = capturedMonacoProps[capturedMonacoProps.length - 1];
    expect(lastProps?.sourceActive).toBe(true);
  });
});
