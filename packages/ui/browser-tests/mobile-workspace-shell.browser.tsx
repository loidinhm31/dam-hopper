import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { useState } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { page, userEvent } from "vitest/browser";
import {
  Files,
  Folder,
  GitMerge,
  Globe2,
  LayoutGrid,
  Radio,
  Search,
  Terminal,
} from "lucide-react";
import { MobileWorkspaceShell } from "@/components/templates/MobileWorkspaceShell.js";
import "@/index.css";

vi.mock("@/components/organisms/TopNav.js", () => ({
  TopNav: () => <div data-testid="top-nav" />,
}));

vi.mock("@/hooks/use-sidebar-collapse.js", () => ({
  useSidebarCollapse: () => ({ collapsed: true, toggle: vi.fn() }),
}));

(
  globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;

const surfaces = [
  {
    id: "explorer",
    label: "Explorer",
    icon: Files,
    content: <div data-testid="surface-explorer">Explorer content</div>,
  },
  {
    id: "search",
    label: "Search",
    icon: Search,
    content: <div data-testid="surface-search">Search content</div>,
  },
  {
    id: "terminal",
    label: "Terminal",
    icon: Terminal,
    content: <div data-testid="surface-terminal">Terminal content</div>,
  },
  {
    id: "editor",
    label: "Editor",
    icon: LayoutGrid,
    content: <div data-testid="surface-editor">Editor content</div>,
  },
  {
    id: "browser",
    label: "Browser",
    icon: Globe2,
    content: <div data-testid="surface-browser">Browser content</div>,
  },
  {
    id: "git",
    label: "Git",
    icon: GitMerge,
    content: <div data-testid="surface-git">Git content</div>,
  },
  {
    id: "fleet",
    label: "Fleet",
    icon: LayoutGrid,
    content: <div data-testid="surface-fleet">Fleet content</div>,
  },
  {
    id: "ports",
    label: "Ports",
    icon: Radio,
    content: <div data-testid="surface-ports">Ports content</div>,
  },
  {
    id: "project",
    label: "Project",
    icon: Folder,
    content: <div data-testid="surface-project">Project content</div>,
  },
];

const ideSurfaceIds = new Set([
  "explorer",
  "search",
  "editor",
  "terminal",
  "browser",
  "git",
  "project",
]);
const terminalSurfaceIds = new Set([
  "terminal",
  "fleet",
  "ports",
  "browser",
  "git",
  "project",
]);
const ideSurfaces = surfaces.filter((surface) => ideSurfaceIds.has(surface.id));
const terminalSurfaces = surfaces.filter((surface) =>
  terminalSurfaceIds.has(surface.id),
);

function Harness({
  workspaceMode = "ide",
}: {
  workspaceMode?: "ide" | "terminal";
}) {
  const [activeSurfaceId, setActiveSurfaceId] = useState("terminal");
  const activeSurfaces =
    workspaceMode === "ide" ? ideSurfaces : terminalSurfaces;

  return (
    <>
      <MobileWorkspaceShell
        surfaces={activeSurfaces}
        activeSurfaceId={activeSurfaceId}
        onSurfaceChange={setActiveSurfaceId}
        workspaceMode={workspaceMode}
        onWorkspaceModeChange={() => {}}
        toolbarActions={<button type="button">Action</button>}
      />
      {workspaceMode === "terminal" && (
        <div
          data-testid="terminal-accessory-fixture"
          aria-hidden="true"
          style={{
            position: "fixed",
            right: 0,
            bottom: 0,
            left: 0,
            height: "369px",
            pointerEvents: "none",
          }}
        />
      )}
    </>
  );
}

describe("mobile workspace shell in Chromium", () => {
  let container: HTMLDivElement;
  let root: Root;

  beforeEach(async () => {
    container = document.createElement("div");
    document.body.append(container);
    root = createRoot(container);
    await act(async () => root.render(<Harness />));
  });

  afterEach(async () => {
    await act(async () => root.unmount());
    container.remove();
    document.body.innerHTML = "";
  });

  function trigger() {
    const result =
      document.querySelector<HTMLButtonElement>('[role="combobox"]');
    expect(result).not.toBeNull();
    return result as HTMLButtonElement;
  }

  async function openMenu() {
    await userEvent.click(page.getByRole("combobox"));
    await vi.waitFor(() =>
      expect(document.querySelector('[role="listbox"]')).not.toBeNull(),
    );
    return document.querySelector('[role="listbox"]') as HTMLElement;
  }

  it("keeps the floating trigger and menu inside narrow viewports", async () => {
    for (const width of [320, 375, 666]) {
      await page.viewport(width, 700);
      const rect = trigger().getBoundingClientRect();

      expect(rect.width).toBeGreaterThanOrEqual(44);
      expect(rect.height).toBeGreaterThanOrEqual(44);
      expect(rect.left).toBeGreaterThanOrEqual(0);
      expect(rect.right).toBeLessThanOrEqual(window.innerWidth);
      expect(document.documentElement.scrollWidth).toBeLessThanOrEqual(
        window.innerWidth,
      );

      const listbox = await openMenu();
      const menuRect = listbox.getBoundingClientRect();
      expect(menuRect.left).toBeGreaterThanOrEqual(0);
      expect(menuRect.right).toBeLessThanOrEqual(window.innerWidth);
      expect(menuRect.top).toBeGreaterThanOrEqual(0);
      expect(menuRect.bottom).toBeLessThanOrEqual(window.innerHeight);
      expect(listbox.className).toContain("z-40");
      expect(listbox.className).toContain("motion-reduce:animate-none");
      for (const label of [
        "Explorer",
        "Search",
        "Editor",
        "Terminal",
        "Browser",
        "Git",
        "Project",
      ]) {
        expect(listbox.textContent).toContain(label);
      }
      await userEvent.keyboard("{Escape}");
      await vi.waitFor(() =>
        expect(document.querySelector('[role="listbox"]')).toBeNull(),
      );
    }
    expect(trigger().className).toContain("z-[40]");
  });

  it("keeps the trigger visible in short terminal viewports", async () => {
    await page.viewport(375, 420);
    await act(async () => root.render(<Harness workspaceMode="terminal" />));

    const rect = trigger().getBoundingClientRect();
    expect(rect.top).toBeGreaterThanOrEqual(0);
    expect(rect.bottom).toBeLessThanOrEqual(window.innerHeight);
    expect(rect.height).toBeGreaterThanOrEqual(44);
  });

  it("drags the trigger without reopening the menu and clamps it to the viewport", async () => {
    await page.viewport(375, 700);
    const button = trigger();
    const initialRect = button.getBoundingClientRect();
    const pointerId = 41;
    await act(async () => {
      button.dispatchEvent(
        new PointerEvent("pointerdown", {
          bubbles: true,
          button: 0,
          buttons: 1,
          isPrimary: true,
          pointerId,
          pointerType: "mouse",
          clientX: initialRect.left + 12,
          clientY: initialRect.top + 12,
        }),
      );
    });
    await act(async () => {
      button.dispatchEvent(
        new PointerEvent("pointermove", {
          bubbles: true,
          buttons: 1,
          isPrimary: true,
          pointerId,
          pointerType: "mouse",
          clientX: 9999,
          clientY: 9999,
        }),
      );
    });
    expect(button.getAttribute("data-dragging")).toBe("true");
    await act(async () => {
      button.dispatchEvent(
        new PointerEvent("pointerup", {
          bubbles: true,
          isPrimary: true,
          pointerId,
          pointerType: "mouse",
          clientX: 9999,
          clientY: 9999,
        }),
      );
    });

    await vi.waitFor(() =>
      expect(document.querySelector('[role="listbox"]')).toBeNull(),
    );
    const movedRect = trigger().getBoundingClientRect();
    expect(movedRect.left).toBeGreaterThan(initialRect.left);
    expect(movedRect.top).toBeGreaterThan(initialRect.top);
    expect(movedRect.right).toBeLessThanOrEqual(window.innerWidth);
    expect(movedRect.bottom).toBeLessThanOrEqual(window.innerHeight);

    await act(async () => root.render(<Harness workspaceMode="terminal" />));
    await vi.waitFor(() => {
      const accessoryRect = document
        .querySelector<HTMLElement>(
          '[data-testid="terminal-accessory-fixture"]',
        )
        ?.getBoundingClientRect();
      expect(accessoryRect).toBeDefined();
      expect(trigger().getBoundingClientRect().bottom).toBeLessThanOrEqual(
        accessoryRect?.top ?? 0,
      );
    });

    await page.viewport(320, 420);
    await vi.waitFor(() => {
      const resizedRect = trigger().getBoundingClientRect();
      expect(resizedRect.left).toBeGreaterThanOrEqual(0);
      expect(resizedRect.top).toBeGreaterThanOrEqual(0);
      expect(resizedRect.right).toBeLessThanOrEqual(window.innerWidth);
      expect(resizedRect.bottom).toBeLessThanOrEqual(window.innerHeight);
    });
  });

  it("switches surfaces, dismisses, and restores trigger focus", async () => {
    await page.viewport(375, 700);
    const listbox = await openMenu();
    const terminal = [
      ...listbox.querySelectorAll<HTMLElement>("[role=option]"),
    ].find((option) => option.textContent?.includes("Terminal"));
    expect(terminal?.getAttribute("aria-selected")).toBe("true");

    const search = [
      ...listbox.querySelectorAll<HTMLElement>("[role=option]"),
    ].find((option) => option.textContent?.includes("Search"));
    expect(search).not.toBeUndefined();
    await userEvent.click(page.getByRole("option", { name: "Search" }));
    await vi.waitFor(() =>
      expect(document.querySelector('[role="listbox"]')).toBeNull(),
    );
    expect(
      document.querySelector('[data-testid="surface-search"]'),
    ).not.toBeNull();
    expect(document.activeElement).toBe(trigger());

    await openMenu();
    await act(async () => {
      document.activeElement?.dispatchEvent(
        new KeyboardEvent("keydown", {
          bubbles: true,
          cancelable: true,
          key: "Escape",
        }),
      );
    });
    await vi.waitFor(() =>
      expect(document.querySelector('[role="listbox"]')).toBeNull(),
    );
    expect(document.activeElement).toBe(trigger());

    await openMenu();
    await act(async () =>
      document.body.dispatchEvent(
        new PointerEvent("pointerdown", { bubbles: true }),
      ),
    );
    await vi.waitFor(() =>
      expect(document.querySelector('[role="listbox"]')).toBeNull(),
    );
    expect(document.activeElement).toBe(trigger());

    trigger().focus();
    await userEvent.keyboard("{ArrowDown}");
    await vi.waitFor(() =>
      expect(document.querySelector('[role="listbox"]')).not.toBeNull(),
    );
    await userEvent.keyboard("Terminal");
    await vi.waitFor(() =>
      expect(document.activeElement?.textContent).toContain("Terminal"),
    );
    await userEvent.keyboard("{Escape}");
    await vi.waitFor(() =>
      expect(document.querySelector('[role="listbox"]')).toBeNull(),
    );
  });

  it("keeps the terminal surface set clear of the expanded accessory fixture", async () => {
    await page.viewport(375, 700);
    await act(async () => root.render(<Harness workspaceMode="terminal" />));

    const listbox = await openMenu();
    for (const label of [
      "Terminal",
      "Fleet",
      "Ports",
      "Browser",
      "Git",
      "Project",
    ]) {
      expect(listbox.textContent).toContain(label);
    }

    const triggerRect = trigger().getBoundingClientRect();
    const accessoryRect = document
      .querySelector<HTMLElement>('[data-testid="terminal-accessory-fixture"]')
      ?.getBoundingClientRect();
    expect(accessoryRect).toBeDefined();
    expect(triggerRect.bottom).toBeLessThanOrEqual(accessoryRect?.top ?? 0);
  });
});
