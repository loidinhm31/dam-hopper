// @vitest-environment jsdom
import { describe, expect, it, vi, beforeEach } from "vitest";
import { createElement, act } from "react";
import { createRoot } from "react-dom/client";
import type { OsWindow } from "../types.js";

let mockProjects: Array<{ name: string; path: string }> = [];
const mockUpdateAppState = vi.fn();
const mockUpdateWindowContext = vi.fn();
const mockDispatchedIntents: Array<{ action: string; payload: unknown }> = [];

vi.mock("@/api/queries.js", () => ({
  useProjects: () => ({
    data: mockProjects,
    isLoading: false,
    isError: false,
  }),
  useWorkspaceStatus: () => ({
    data: { workspaceEpoch: 1 },
  }),
}));

vi.mock("../window-context.js", () => ({
  useWindowOwner: () => ({
    profileId: "profile-1",
    generation: 1,
  }),
}));

vi.mock("../window-store.js", () => ({
  useWindowStore: Object.assign(
    (selector: (state: Record<string, unknown>) => unknown) =>
      selector({
        updateWindowContext: mockUpdateWindowContext,
        updateAppState: mockUpdateAppState,
      }),
    {
      getState: () => ({
        updateWindowContext: mockUpdateWindowContext,
        updateAppState: mockUpdateAppState,
      }),
    },
  ),
}));

vi.mock("@/stores/workspace.js", () => ({
  useWorkspaceStore: () => vi.fn(),
}));

let lastRenderedFileTreeProps: Record<string, unknown> | null = null;
vi.mock("@/components/organisms/FileTree.js", () => ({
  FileTree: (props: Record<string, unknown>) => {
    lastRenderedFileTreeProps = props;
    return createElement("div", {
      "data-testid": "mock-file-tree",
      "data-mode": props.mode,
      "data-target-kind": (props.target as { kind?: string } | undefined)?.kind,
    });
  },
}));

vi.mock("../intents.js", () => ({
  dispatchIntent: vi.fn(async (intent: { action: string; payload: unknown }) => {
    mockDispatchedIntents.push(intent);
    return { status: "handled" };
  }),
  createIntent: (action: string, payload: unknown, sourceWindowId?: string) => ({
    action,
    payload,
    sourceWindowId,
    timestamp: Date.now(),
  }),
  registerIntentHandler: vi.fn(() => () => undefined),
}));

import { FilesApp } from "./FilesApp.js";

describe("FilesApp Dual Modes & Zero-Project Safe Root", () => {
  beforeEach(() => {
    mockProjects = [];
    mockDispatchedIntents.length = 0;
    mockUpdateAppState.mockClear();
    mockUpdateWindowContext.mockClear();
    lastRenderedFileTreeProps = null;
  });

  it("removes 0-projects blocking screen and renders workspace mode immediately", async () => {
    mockProjects = []; // 0 projects configured!

    const mockWindow: OsWindow = {
      id: "win-files-1",
      appId: "files",
      title: "Files",
      ctx: { profileId: "profile-1" },
      mode: "tile",
      desktopId: "d1",
      maximized: false,
      minimized: false,
      appState: {},
    };

    const container = document.createElement("div");
    document.body.appendChild(container);
    const root = createRoot(container);

    await act(async () => {
      root.render(createElement(FilesApp, { window: mockWindow }));
    });

    // Verify blocking screen "No Projects Found" is NOT rendered
    expect(container.textContent).not.toContain("No Projects Found");

    // Verify FileTree is rendered with mode="workspace" and workspace target
    const fileTree = container.querySelector('[data-testid="mock-file-tree"]');
    expect(fileTree).not.toBeNull();
    expect(fileTree?.getAttribute("data-mode")).toBe("workspace");
    expect(fileTree?.getAttribute("data-target-kind")).toBe("workspace");

    root.unmount();
    container.remove();
  });

  it("provides mode toggle and persists mode into window appState", async () => {
    mockProjects = [
      { name: "web-ui", path: "packages/ui" },
      { name: "server", path: "server" },
    ];

    const mockWindow: OsWindow = {
      id: "win-files-2",
      appId: "files",
      title: "Files",
      ctx: { profileId: "profile-1" },
      mode: "tile",
      desktopId: "d1",
      maximized: false,
      minimized: false,
      appState: { mode: "workspace" },
    };

    const container = document.createElement("div");
    document.body.appendChild(container);
    const root = createRoot(container);

    await act(async () => {
      root.render(createElement(FilesApp, { window: mockWindow }));
    });

    const workspaceBtn = container.querySelector(
      '[data-testid="mode-toggle-workspace"]',
    ) as HTMLButtonElement | null;
    const projectsBtn = container.querySelector(
      '[data-testid="mode-toggle-projects"]',
    ) as HTMLButtonElement | null;

    expect(workspaceBtn).not.toBeNull();
    expect(projectsBtn).not.toBeNull();

    // Click Projects button
    await act(async () => {
      projectsBtn?.click();
    });

    expect(mockUpdateAppState).toHaveBeenCalledWith("win-files-2", {
      mode: "projects",
      projectFilter: "all",
    });

    root.unmount();
    container.remove();
  });

  it("dispatches folder terminal intent with workspace target and folder CWD", async () => {
    const mockWindow: OsWindow = {
      id: "win-files-3",
      appId: "files",
      title: "Files",
      ctx: { profileId: "profile-1" },
      mode: "tile",
      desktopId: "d1",
      maximized: false,
      minimized: false,
      appState: { mode: "workspace" },
    };

    const container = document.createElement("div");
    document.body.appendChild(container);
    const root = createRoot(container);

    await act(async () => {
      root.render(createElement(FilesApp, { window: mockWindow }));
    });

    // Trigger onOpenTerminal from FileTree props
    expect(lastRenderedFileTreeProps).not.toBeNull();
    const onOpenTerminal = lastRenderedFileTreeProps?.onOpenTerminal as (
      cwd?: string,
    ) => void;
    expect(typeof onOpenTerminal).toBe("function");

    await act(async () => {
      onOpenTerminal("packages/ui/src");
    });

    expect(mockDispatchedIntents.length).toBe(1);
    const intent = mockDispatchedIntents[0];
    expect(intent.action).toBe("terminal:open");
    expect(intent.payload).toMatchObject({
      profileId: "profile-1",
      target: { kind: "workspace", profileId: "profile-1" },
      cwd: "packages/ui/src",
    });

    root.unmount();
    container.remove();
  });

  it("preserves persisted projects mode across a cold query when projects list is empty", async () => {
    mockProjects = []; // cold query, empty on first mount

    const mockWindow: OsWindow = {
      id: "win-files-cold",
      appId: "files",
      title: "Files",
      ctx: { profileId: "profile-1" },
      mode: "tile",
      desktopId: "d1",
      maximized: false,
      minimized: false,
      appState: { mode: "projects", projectFilter: "server" },
    };

    const container = document.createElement("div");
    document.body.appendChild(container);
    const root = createRoot(container);

    await act(async () => {
      root.render(createElement(FilesApp, { window: mockWindow }));
    });

    expect(lastRenderedFileTreeProps?.mode).toBe("projects");
    expect(lastRenderedFileTreeProps?.projectFilter).toBe("server");

    root.unmount();
    container.remove();
  });

  it("preserves project ownership when opening files in All Projects mode", async () => {
    mockProjects = [
      { name: "web-ui", path: "packages/ui" },
      { name: "server", path: "server" },
    ];

    const mockWindow: OsWindow = {
      id: "win-files-all",
      appId: "files",
      title: "Files",
      ctx: { profileId: "profile-1" },
      mode: "tile",
      desktopId: "d1",
      maximized: false,
      minimized: false,
      appState: { mode: "projects", projectFilter: "all" },
    };

    const container = document.createElement("div");
    document.body.appendChild(container);
    const root = createRoot(container);

    await act(async () => {
      root.render(createElement(FilesApp, { window: mockWindow }));
    });

    const onFileOpen = lastRenderedFileTreeProps?.onFileOpen as (node: {
      id: string;
      name: string;
    }) => void;
    expect(typeof onFileOpen).toBe("function");

    // Open file from web-ui project root
    await act(async () => {
      onFileOpen({ id: "web-ui/src/main.ts", name: "main.ts" });
    });

    expect(mockDispatchedIntents.length).toBe(1);
    expect(mockDispatchedIntents[0]).toMatchObject({
      action: "file:open",
      payload: {
        profileId: "profile-1",
        projectId: "web-ui",
        filePath: "src/main.ts",
        target: {
          kind: "project",
          profileId: "profile-1",
          project: "web-ui",
        },
      },
    });

    // Open file from server project root
    await act(async () => {
      onFileOpen({ id: "server/src/lib.rs", name: "lib.rs" });
    });

    expect(mockDispatchedIntents.length).toBe(2);
    expect(mockDispatchedIntents[1]).toMatchObject({
      action: "file:open",
      payload: {
        profileId: "profile-1",
        projectId: "server",
        filePath: "src/lib.rs",
        target: {
          kind: "project",
          profileId: "profile-1",
          project: "server",
        },
      },
    });

    root.unmount();
    container.remove();
  });

  it("resolves project target and CWD when launching terminal from a project tree", async () => {
    mockProjects = [{ name: "server", path: "server" }];

    const mockWindow: OsWindow = {
      id: "win-files-proj",
      appId: "files",
      title: "Files",
      ctx: { profileId: "profile-1", projectId: "server" },
      mode: "tile",
      desktopId: "d1",
      maximized: false,
      minimized: false,
      appState: { mode: "projects", projectFilter: "server" },
    };

    const container = document.createElement("div");
    document.body.appendChild(container);
    const root = createRoot(container);

    await act(async () => {
      root.render(createElement(FilesApp, { window: mockWindow }));
    });

    const onOpenTerminal = lastRenderedFileTreeProps?.onOpenTerminal as (
      cwd?: string,
    ) => void;
    await act(async () => {
      onOpenTerminal("src/api");
    });

    expect(mockDispatchedIntents.length).toBe(1);
    expect(mockDispatchedIntents[0]).toMatchObject({
      action: "terminal:open",
      payload: {
        profileId: "profile-1",
        projectId: "server",
        target: {
          kind: "project",
          profileId: "profile-1",
          project: "server",
        },
        cwd: "src/api",
      },
    });

    root.unmount();
    container.remove();
  });
});
