import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { MarkdownHost } from "@/components/organisms/MarkdownHost.js";
import { MARKDOWN_VIEW_MODE_STORAGE_KEY } from "@/lib/markdown-view-mode-persistence.js";
import "@/index.css";

vi.mock("@/components/organisms/MonacoHost.js", () => ({
  MonacoHost: () => <div data-testid="monaco-host" />,
}));

const MODES = ["Edit", "Split", "Preview"] as const;

function MarkdownFixture({ tabKey }: { tabKey: string }) {
  return (
    <MarkdownHost
      tabKey={tabKey}
      path={tabKey.split("::").slice(1).join("::")}
      content="# Persistence test"
      tier="normal"
      onChange={() => undefined}
      onSave={() => undefined}
      onViewStateChange={() => undefined}
    />
  );
}

describe("markdown view mode persistence in Chromium", () => {
  let container: HTMLDivElement;
  let root: Root;

  async function mount(tabKey: string) {
    root = createRoot(container);
    await act(async () => root.render(<MarkdownFixture tabKey={tabKey} />));
  }

  async function remount(tabKey: string) {
    await act(async () => root.unmount());
    await mount(tabKey);
  }

  async function update(tabKey: string) {
    await act(async () => root.render(<MarkdownFixture tabKey={tabKey} />));
  }

  function modeButton(label: string) {
    return [...container.querySelectorAll<HTMLButtonElement>("button")].find(
      (button) => button.textContent === label,
    );
  }

  function pressedModeLabels() {
    return [...container.querySelectorAll<HTMLButtonElement>("button")]
      .filter((button) => button.getAttribute("aria-pressed") === "true")
      .map((button) => button.textContent);
  }

  beforeEach(async () => {
    localStorage.removeItem(MARKDOWN_VIEW_MODE_STORAGE_KEY);
    container = document.createElement("div");
    document.body.append(container);
    await mount("alpha::README.md");
  });

  afterEach(async () => {
    await act(async () => root.unmount());
    container.remove();
    localStorage.removeItem(MARKDOWN_VIEW_MODE_STORAGE_KEY);
  });

  it("shares every mode across projects and workspaces", async () => {
    expect(pressedModeLabels()).toEqual(["Split"]);
    expect(localStorage.getItem(MARKDOWN_VIEW_MODE_STORAGE_KEY)).toBeNull();

    for (const label of MODES) {
      const button = modeButton(label);
      expect(button).not.toBeUndefined();
      await act(async () => button?.click());
      expect(pressedModeLabels()).toEqual([label]);
      expect(localStorage.getItem(MARKDOWN_VIEW_MODE_STORAGE_KEY)).toBe(
        label.toLowerCase(),
      );

      await update("project-beta::docs/guide.md");
      expect(pressedModeLabels()).toEqual([label]);

      await remount("workspace-two/project-gamma::README.md");
      expect(pressedModeLabels()).toEqual([label]);
    }
  });

  it("keeps the global mode when switching Markdown identities", async () => {
    await act(async () => modeButton("Preview")?.click());
    expect(pressedModeLabels()).toEqual(["Preview"]);

    await update("project-beta::README.md");
    expect(pressedModeLabels()).toEqual(["Preview"]);

    await update("workspace-two/project-gamma::README.md");
    expect(pressedModeLabels()).toEqual(["Preview"]);

    await act(async () => modeButton("Edit")?.click());
    await update("alpha::README.md");
    expect(pressedModeLabels()).toEqual(["Edit"]);
  });
});
