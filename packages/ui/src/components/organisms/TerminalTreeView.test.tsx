// @vitest-environment jsdom

import { act } from "react";
import { createRoot } from "react-dom/client";
import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { TreeProject } from "@/hooks/use-terminal-tree.js";
import { TerminalTreeView } from "./TerminalTreeView.js";


vi.mock("@/api/queries.js", () => ({
  useGlobalConfig: vi.fn(() => ({ data: { ui: {} } })),
  useUpdateUiConfig: vi.fn(() => ({ mutate: vi.fn() })),
}));

const projects: TreeProject[] = [
  {
    name: "web",
    type: "pnpm",
    path: "/workspace/web",
    commands: [
      {
        key: "build",
        label: "Build",
        type: "build",
        command: "pnpm build",
        sessionId: "build:web",
      },
      {
        key: "terminal:Dev",
        label: "Dev",
        type: "terminal",
        command: "pnpm dev",
        sessionId: "terminal:web:Dev:",
        profileName: "Dev",
        sessions: [],
      },
      {
        key: "custom",
        label: "Custom",
        type: "custom",
        command: "echo custom",
        sessionId: "custom:web",
      },
    ],
    activeCount: 0,
  },
];

function storageStub() {
  const storage = new Map<string, string>();
  return {
    getItem: vi.fn((key: string) => storage.get(key) ?? null),
    setItem: vi.fn((key: string, value: string) => {
      storage.set(key, value);
    }),
    removeItem: vi.fn((key: string) => {
      storage.delete(key);
    }),
    clear: vi.fn(() => {
      storage.clear();
    }),
  };
}

function treeElement(
  freeTerminals: Array<{
    id: string;
    command: string;
    cwd: string;
    type: "free";
    alive: boolean;
    startedAt: number;
  }> = [],
  projectList: TreeProject[] = projects,
) {
  return (
    <TerminalTreeView
      projects={projectList}
      freeTerminals={freeTerminals}
      activeProjectName="web"
      selectedId={null}
      onSelectProject={() => {}}
      onSelectTerminal={() => {}}
      onLaunchTerminal={() => {}}
      onKillTerminal={() => {}}
      onAddShell={() => {}}
      onLaunchProfile={() => {}}
      onDeleteProfile={() => {}}
      onLaunchSuggestedCommand={() => {}}
      onAddFreeTerminal={() => {}}
      onLaunchFreeWithCommand={() => {}}
      onSelectFreeTerminal={() => {}}
      onKillFreeTerminal={() => {}}
      onRemoveFreeTerminal={() => {}}
      onSaveFreeTerminal={() => {}}
      onUpdateProfile={async () => {}}
      onUpdateCustomCommand={async () => {}}
    />
  );
}

function renderTree(
  freeTerminals: Array<{
    id: string;
    command: string;
    cwd: string;
    type: "free";
    alive: boolean;
    startedAt: number;
  }> = [],
  projectList: TreeProject[] = projects,
) {
  return renderToStaticMarkup(treeElement(freeTerminals, projectList));
}

describe("TerminalTreeView mobile actions", () => {
  beforeEach(() => {
    vi.stubGlobal("localStorage", storageStub());
  });

  it("keeps desktop Fleet launch actions hover-revealed", () => {
    const markup = renderTree();

    expect(markup).toContain('title="Launch build"');
    expect(markup).toContain("opacity-0 group-hover:opacity-100");
    expect(markup).toContain("p-0.5 hover:bg-green-500/20");
  });


  it("labels a live session whose worktree is unavailable", () => {
    const orphanedProject: TreeProject = {
      ...projects[0],
      commands: projects[0].commands.map((command) =>
        command.key === "terminal:Dev"
          ? {
              ...command,
              sessions: [
                {
                  id: "terminal:web:Dev:1",
                  project: "web",
                  command: "pnpm dev",
                  cwd: "/workspace/web-feature",
                  type: "terminal",
                  alive: true,
                  startedAt: 1,
                  orphaned: true,
                },
              ],
            }
          : command,
      ),
    };

    expect(renderTree([], [orphanedProject])).toContain(">orphaned</span>");
  });

});
