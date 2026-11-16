// @vitest-environment jsdom

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { ProjectInfoApp } from "./ProjectInfoApp.js";
import { WindowContextProvider } from "../window-context.js";
import { useWindowStore } from "../window-store.js";
import { createDefaultOsSession } from "../window-ops.js";
import type { OsWindow } from "../types.js";

declare global {
  var IS_REACT_ACT_ENVIRONMENT: boolean | undefined;
}
globalThis.IS_REACT_ACT_ENVIRONMENT = true;

const mockState = vi.hoisted(() => ({
  projects: [
    { name: "alpha-api", path: "/srv/alpha", type: "cargo", services: [] },
    { name: "beta-web", path: "/srv/beta", type: "pnpm", services: [] },
  ] as Array<{ name: string; path: string; type: string; services: unknown[] }>,
  isProjectsLoading: false,
  isProjectsError: false,
}));

vi.mock("@/api/queries.js", () => ({
  useProjects: vi.fn(() => ({
    data: mockState.projects,
    isLoading: mockState.isProjectsLoading,
    isError: mockState.isProjectsError,
  })),
  useConfig: vi.fn(() => ({
    data: { workspaceRoot: "/srv", projects: [] },
    isLoading: false,
  })),
  useUpdateConfig: vi.fn(() => ({
    mutateAsync: vi.fn(),
    isPending: false,
  })),
}));

vi.mock("@/components/organisms/ProjectInfoPanel.js", () => ({
  ProjectInfoPanel: ({ projectName }: { projectName: string }) => (
    <div data-testid="mock-project-info-panel">{projectName}</div>
  ),
}));

vi.mock("@/components/organisms/ConfigEditor.js", () => ({
  ConfigEditor: () => <div data-testid="mock-config-editor">Config</div>,
}));

function makeWindow(overrides?: Partial<OsWindow>): OsWindow {
  return {
    id: "win-project-info-1",
    appId: "project-info",
    title: "Project Info",
    ctx: { profileId: "prof-1" },
    mode: "float",
    desktopId: "desktop-1",
    maximized: false,
    minimized: false,
    ...overrides,
  };
}

describe("ProjectInfoApp", () => {
  let container: HTMLDivElement;
  let root: Root;
  let queryClient: QueryClient;

  beforeEach(() => {
    mockState.projects = [
      { name: "alpha-api", path: "/srv/alpha", type: "cargo", services: [] },
      { name: "beta-web", path: "/srv/beta", type: "pnpm", services: [] },
    ];
    mockState.isProjectsLoading = false;
    mockState.isProjectsError = false;

    const session = createDefaultOsSession();
    const win = makeWindow();
    session.windows[win.id] = win;
    useWindowStore.setState({ session });

    queryClient = new QueryClient({
      defaultOptions: { queries: { retry: false, gcTime: 0 } },
    });
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
  });

  afterEach(() => {
    act(() => {
      root.unmount();
    });
    container.remove();
    queryClient.clear();
  });

  function renderApp(win: OsWindow) {
    act(() => {
      root.render(
        <QueryClientProvider client={queryClient}>
          <WindowContextProvider
            window={win}
            isFocused={true}
            isActiveDesktop={true}
          >
            <ProjectInfoApp window={win} />
          </WindowContextProvider>
        </QueryClientProvider>,
      );
    });
  }

  it("opens without window.ctx.projectId and defaults to the first available project", () => {
    const win =
      useWindowStore.getState().session.windows["win-project-info-1"]!;
    renderApp(win);

    const panel = container.querySelector(
      '[data-testid="mock-project-info-panel"]',
    );
    expect(panel?.textContent).toBe("alpha-api");

    const selectTrigger = container.querySelector(
      '[data-testid="project-info-project-select"]',
    );
    expect(selectTrigger?.textContent).toContain("alpha-api");
  });

  it("allows selecting a different project inside the app and persists selection to window appState", () => {
    const win =
      useWindowStore.getState().session.windows["win-project-info-1"]!;
    renderApp(win);

    const selectTrigger = container.querySelector(
      '[data-testid="project-info-project-select"]',
    ) as HTMLButtonElement | null;
    expect(selectTrigger).not.toBeNull();
    act(() => {
      selectTrigger?.dispatchEvent(
        new KeyboardEvent("keydown", { key: "Enter", bubbles: true }),
      );
    });

    const betaOption = Array.from(
      document.body.querySelectorAll('[role="option"]'),
    ).find((el) => el.textContent?.includes("beta-web")) as
      | HTMLElement
      | undefined;
    expect(betaOption).toBeDefined();

    act(() => {
      betaOption?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });
    const updatedWin =
      useWindowStore.getState().session.windows["win-project-info-1"]!;
    expect(updatedWin.appState?.selectedProject).toBe("beta-web");

    renderApp(updatedWin);
    const panel = container.querySelector(
      '[data-testid="mock-project-info-panel"]',
    );
    expect(panel?.textContent).toBe("beta-web");
  });

  it("renders empty state with Configuration button when no projects are configured", () => {
    mockState.projects = [];
    const win =
      useWindowStore.getState().session.windows["win-project-info-1"]!;
    renderApp(win);

    expect(container.textContent).toContain(
      "No projects configured in this workspace.",
    );
    const openConfigBtn = Array.from(container.querySelectorAll("button")).find(
      (b) => b.textContent?.includes("Open Configuration"),
    );
    expect(openConfigBtn).toBeDefined();

    act(() => {
      openConfigBtn?.click();
    });

    const updatedWin =
      useWindowStore.getState().session.windows["win-project-info-1"]!;
    expect(updatedWin.appState?.activeTab).toBe("config");
    renderApp(updatedWin);
    expect(
      container.querySelector('[data-testid="mock-config-editor"]'),
    ).not.toBeNull();
  });
});
