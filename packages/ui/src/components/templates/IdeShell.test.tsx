import type { ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { Terminal } from "lucide-react";
import type { ToolWindowDef } from "@/types/ide.js";

/**
 * IdeShell is tested with the same SSR-only harness used across the workspace
 * (renderToStaticMarkup). The resize/collapse hooks are mocked so the shell
 * renders deterministically without a DOM; only the real ToolPanel /
 * SidebarBottomGroup / ActivityBar trees run, which is what the maximize
 * contract depends on.
 */

vi.mock("@/components/organisms/TopNav.js", () => ({
  TopNav: () => <div data-testid="top-nav" />,
}));

vi.mock("@/hooks/use-sidebar-collapse.js", () => ({
  useSidebarCollapse: () => ({ collapsed: false, toggle: vi.fn() }),
}));

vi.mock("@/hooks/use-resize-handle.js", () => ({
  useResizeHandle: () => ({
    width: 240,
    handleProps: { onMouseDown: vi.fn() },
    isDragging: false,
  }),
}));

vi.mock("@/hooks/use-vertical-resize-handle.js", () => ({
  useVerticalResizeHandle: () => ({
    height: 300,
    handleProps: { onMouseDown: vi.fn() },
    isDragging: false,
  }),
}));

import { IdeShell } from "./IdeShell.js";

const localStorageState = new Map<string, string>();
const localStorageMock = {
  getItem: vi.fn((key: string) => localStorageState.get(key) ?? null),
  setItem: vi.fn((key: string, value: string) => {
    localStorageState.set(key, value);
  }),
  removeItem: vi.fn((key: string) => {
    localStorageState.delete(key);
  }),
  clear: vi.fn(() => {
    localStorageState.clear();
  }),
};

function makeTool(
  id: string,
  label: string,
  position: "top" | "bottom",
): ToolWindowDef {
  return {
    id,
    label,
    icon: Terminal,
    content: <div data-tool-content={id}>{label} content</div>,
    position,
    defaultActive: true,
  };
}

function renderShell(
  leftTools: ToolWindowDef[],
  rightTools: ToolWindowDef[] = [],
  editor: ReactNode = <div>editor</div>,
) {
  return renderToStaticMarkup(
    <IdeShell
      leftTools={leftTools}
      rightTools={rightTools}
      editor={editor}
    />,
  );
}

describe("IdeShell bottom panel maximize toggle", () => {
  beforeEach(() => {
    localStorageState.clear();
    localStorageMock.getItem.mockClear();
    localStorageMock.setItem.mockClear();
    localStorageMock.removeItem.mockClear();
    localStorageMock.clear.mockClear();
    vi.stubGlobal("localStorage", localStorageMock);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("renders a maximize button on the bottom tool panel header", () => {
    const leftTools = [makeTool("terminal", "Terminal", "bottom")];
    const markup = renderShell(leftTools);

    expect(markup).toContain('aria-label="Maximize panel"');
    expect(markup).toContain("Terminal content");
  });

  it("does not render a maximize button on top tool panels", () => {
    const leftTools = [makeTool("explorer", "Explorer", "top")];
    const markup = renderShell(leftTools);

    expect(markup).not.toContain('aria-label="Maximize panel"');
    expect(markup).not.toContain('aria-label="Restore panel"');
  });

  it("renders no maximize button when no bottom tool is active", () => {
    const leftTools = [makeTool("explorer", "Explorer", "top")];
    const markup = renderShell(leftTools);

    expect(markup).not.toContain('aria-label="Maximize panel"');
    expect(markup).not.toContain('aria-label="Restore panel"');
    // Top tool panel still renders its close button, just not maximize.
    expect(markup).toContain('title="Close Explorer"');
  });

  it("shows the non-maximized layout by default (fixed bottom height + resize handle)", () => {
    const leftTools = [
      makeTool("explorer", "Explorer", "top"),
      makeTool("terminal", "Terminal", "bottom"),
    ];
    const markup = renderShell(leftTools);

    // Bottom height is mocked to 300 -> inline style on the inner div.
    expect(markup).toContain("height:300px");
    // Resize handle is rendered in the non-maximized state.
    expect(markup).toContain("cursor-row-resize");
    // Maximize (not restore) is the initial affordance.
    expect(markup).toContain('aria-label="Maximize panel"');
    expect(markup).not.toContain('aria-label="Restore panel"');
  });

  it("keeps the editor and top tool visible alongside the bottom panel when not maximized", () => {
    const leftTools = [
      makeTool("explorer", "Explorer", "top"),
      makeTool("terminal", "Terminal", "bottom"),
    ];
    const markup = renderShell(leftTools);

    expect(markup).toContain("Explorer content");
    expect(markup).toContain("editor");
    expect(markup).toContain("Terminal content");
  });
});
