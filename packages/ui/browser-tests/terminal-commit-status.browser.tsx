import { act, useState } from "react";
import { createRoot, type Root } from "react-dom/client";
import { DndContext } from "@dnd-kit/core";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ActiveTerminalRuntimeDisplay } from "@/components/organisms/ActiveTerminalRuntimeDisplay.js";
import { PaneContainer } from "@/components/organisms/PaneContainer.js";
import type { GitStatus } from "@/api/client.js";
import type { MountedSession } from "@/components/organisms/MultiTerminalDisplay.js";
import type { PaneNode } from "@/types/terminal-layout.js";
import "@/index.css";

const settingsState = vi.hoisted(() => ({ enabled: false }));

const statuses: Record<string, GitStatus> = {
  alpha: {
    projectName: "alpha",
    branch: "feature/alpha",
    isClean: true,
    ahead: 0,
    behind: 0,
    staged: 0,
    modified: 0,
    untracked: 0,
    hasStash: false,
    lastCommit: {
      hash: "aaaaaaaa12345678",
      message: "Render latest Alpha change",
      date: "2026-07-26T12:30:00.000Z",
    },
  },
  beta: {
    projectName: "beta",
    branch: "fix/beta",
    isClean: true,
    ahead: 0,
    behind: 0,
    staged: 0,
    modified: 0,
    untracked: 0,
    hasStash: false,
    lastCommit: {
      hash: "bbbbbbbb12345678",
      message: "Show the Beta fix",
      date: "2026-07-25T12:30:00.000Z",
    },
  },
};

vi.mock("@/api/queries.js", () => ({
  useGlobalConfig: () => ({ data: undefined }),
  useProjectStatus: (project: string, enabled: boolean) => ({
    data: enabled ? statuses[project] : undefined,
    isLoading: false,
    isError: false,
  }),
  useUpdateUiConfig: () => ({ mutate: vi.fn() }),
}));

vi.mock("@/stores/settings.js", () => ({
  useSettingsStore: (
    selector: (state: { terminalCommitStatusEnabled: boolean }) => unknown,
  ) => selector({ terminalCommitStatusEnabled: settingsState.enabled }),
}));

vi.mock("@/hooks/use-compact-workspace.js", () => ({
  useCompactWorkspace: () => false,
}));

vi.mock("@/hooks/use-ports.js", () => ({
  usePorts: () => ({ ports: [], createTunnel: vi.fn(), stopTunnel: vi.fn() }),
}));

vi.mock("@/components/organisms/TerminalRuntimeNavigator.js", () => ({
  TerminalRuntimeNavigator: () => <div data-testid="runtime-navigator" />,
}));

vi.mock("@/components/organisms/TerminalRuntimeOutput.js", () => ({
  TerminalRuntimeOutput: () => <div data-testid="runtime-output" />,
}));

const mountedSessions: MountedSession[] = [
  {
    sessionId: "session-alpha",
    project: "alpha",
    command: "bash",
    cwd: "/workspace/alpha",
  },
  {
    sessionId: "session-beta",
    project: "beta",
    command: "bash",
    cwd: "/workspace/beta",
  },
];

const openTabs = mountedSessions.map((session) => ({
  sessionId: session.sessionId,
  label: `${session.project} shell`,
}));

function TerminalHeaderFixture() {
  const [splitSessionId, setSplitSessionId] = useState("session-alpha");
  const [runtimeSessionId, setRuntimeSessionId] = useState("session-alpha");
  const [, forceRender] = useState(0);
  const pane: PaneNode = {
    id: "pane-1",
    type: "pane",
    sessionIds: mountedSessions.map((session) => session.sessionId),
    activeSessionId: splitSessionId,
  };
  const layout = {
    focusedPaneId: pane.id,
    getPanes: () => [pane],
    setFocusedPaneId: vi.fn(),
    setActiveSession: (_paneId: string, sessionId: string) =>
      setSplitSessionId(sessionId),
    splitPane: vi.fn(),
    closePane: vi.fn(),
  };

  return (
    <>
      <button
        aria-label="Toggle latest commit"
        type="button"
        onClick={() => {
          settingsState.enabled = !settingsState.enabled;
          forceRender((value) => value + 1);
        }}
      >
        Toggle latest commit
      </button>
      <button
        aria-label="Switch split terminal"
        type="button"
        onClick={() => setSplitSessionId("session-beta")}
      >
        Switch split terminal
      </button>
      <button
        aria-label="Switch runtime terminal"
        type="button"
        onClick={() => setRuntimeSessionId("session-beta")}
      >
        Switch runtime terminal
      </button>
      <div data-testid="split-header">
        <DndContext>
          <PaneContainer
            layout={layout as never}
            mountedSessions={mountedSessions}
            node={pane}
            onCloseTab={() => {}}
            onNewTerminal={() => {}}
            onSelectTab={() => {}}
            onSessionExit={() => {}}
            openTabs={openTabs}
            suppressTerminalFocus
          />
        </DndContext>
      </div>
      <div data-testid="runtime-header">
        <ActiveTerminalRuntimeDisplay
          activeSessionId={runtimeSessionId}
          mountedSessions={mountedSessions}
          onNewFreeTerminal={() => {}}
          onNewProjectTerminal={() => {}}
          onSelectTab={() => {}}
          openTabs={openTabs}
        />
      </div>
    </>
  );
}

describe("Terminal latest commit status in Chromium", () => {
  let container: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    settingsState.enabled = false;
    container = document.createElement("div");
    document.body.append(container);
    root = createRoot(container);
  });

  afterEach(async () => {
    await act(async () => root.unmount());
    container.remove();
  });

  it("uses the persisted toggle and active session project in split and full-width terminal headers", async () => {
    await act(async () => root.render(<TerminalHeaderFixture />));

    expect(container.textContent).not.toContain("feature/alpha");

    await act(async () =>
      container
        .querySelector<HTMLButtonElement>('[aria-label="Toggle latest commit"]')
        ?.click(),
    );
    const splitHeader = container.querySelector('[data-testid="split-header"]');
    const runtimeHeader = container.querySelector(
      '[data-testid="runtime-header"]',
    );
    expect(splitHeader?.textContent).toContain("feature/alpha");
    expect(runtimeHeader?.textContent).toContain("feature/alpha");
    expect(runtimeHeader?.textContent).toContain("Render latest Alpha change");
    expect(runtimeHeader?.textContent).toContain("aaaaaaa");

    await act(async () =>
      container
        .querySelector<HTMLButtonElement>(
          '[aria-label="Switch split terminal"]',
        )
        ?.click(),
    );
    expect(splitHeader?.textContent).toContain("fix/beta");
    expect(splitHeader?.textContent).not.toContain("feature/alpha");

    await act(async () =>
      container
        .querySelector<HTMLButtonElement>(
          '[aria-label="Switch runtime terminal"]',
        )
        ?.click(),
    );
    expect(runtimeHeader?.textContent).toContain("fix/beta");
    expect(runtimeHeader?.textContent).toContain("Show the Beta fix");
    expect(runtimeHeader?.textContent).not.toContain("feature/alpha");
  });
});
