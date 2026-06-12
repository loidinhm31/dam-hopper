import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { TreeProject } from "@/hooks/use-terminal-tree.js";
import { TerminalTreeView } from "./TerminalTreeView.js";

let coarsePointer = false;

vi.mock("@/hooks/use-coarse-pointer.js", () => ({
  useCoarsePointer: () => coarsePointer,
}));

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

function renderTree() {
  return renderToStaticMarkup(
    <TerminalTreeView
      projects={projects}
      freeTerminals={[]}
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
    />,
  );
}

describe("TerminalTreeView mobile actions", () => {
  beforeEach(() => {
    coarsePointer = false;
    vi.stubGlobal("localStorage", storageStub());
  });

  it("keeps desktop Fleet launch actions hover-revealed", () => {
    const markup = renderTree();

    expect(markup).toContain('title="Launch build"');
    expect(markup).toContain("opacity-0 group-hover:opacity-100");
    expect(markup).toContain("p-0.5 hover:bg-green-500/20");
  });

  it("shows larger Fleet launch actions on coarse pointer devices", () => {
    coarsePointer = true;

    const markup = renderTree();

    expect(markup).toContain('title="Launch build"');
    expect(markup).toContain("opacity-100");
    expect(markup).toContain("h-8 w-8 items-center justify-center");
  });
});
