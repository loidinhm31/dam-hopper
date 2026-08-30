import { act, useEffect, useRef, useState } from "react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { expect, vi } from "vitest";
import { page } from "vitest/browser";
import { TraditionalTerminalProjectsDisplay } from "@/components/organisms/TraditionalTerminalProjectsDisplay.js";
import type { MountedSession } from "@/components/organisms/MultiTerminalDisplay.js";
import type { TabEntry } from "@/components/organisms/TerminalTabBar.js";
import type { SessionInfo } from "@/api/client.js";

import { buildTerminalDisplayTabs } from "@/hooks/use-terminal-manager.js";
import { deriveTerminalAutoAttachState } from "@/lib/terminal-auto-attach.js";
import {
  registerTerminalOutputActivity,
  type TerminalOutputActivityRegistration,
} from "@/lib/terminal-output-activity.js";

function session(id: string, project: string, alive: boolean): SessionInfo {
  return {
    id,
    project,
    command: "bash",
    cwd: `/workspace/${project}`,
    type: "custom",
    alive,
    startedAt: 1,
  };
}

const initialMountedSessions: MountedSession[] = [
  {
    sessionId: "alpha-1",
    project: "alpha",
    command: "bash",
    cwd: "/workspace/alpha",
  },
  {
    sessionId: "alpha-2",
    project: "alpha",
    command: "bash",
    cwd: "/workspace/alpha",
  },
  {
    sessionId: "beta-1",
    project: "beta",
    command: "bash",
    cwd: "/workspace/beta",
  },
];

const initialTabs: TabEntry[] = [
  {
    sessionId: "alpha-1",
    label: "alpha first",
    session: session("alpha-1", "alpha", true),
    isPinned: true,
  },
  {
    sessionId: "alpha-2",
    label: "alpha second",
    session: session("alpha-2", "alpha", false),
  },
  {
    sessionId: "beta-1",
    label: "beta shell",
    session: session("beta-1", "beta", false),
  },
];

interface TraditionalProjectsFixtureProps {
  initialActiveSessionId?: string;
  initialCurrentProjectName?: string | null;
  syncWorkspaceProjectOnTerminalSelection?: boolean;
}

function TraditionalProjectsFixtureContent({
  initialActiveSessionId = "alpha-1",
  initialCurrentProjectName = "alpha",
  syncWorkspaceProjectOnTerminalSelection = true,
}: TraditionalProjectsFixtureProps) {
  const [activeSessionId, setActiveSessionId] = useState(
    initialActiveSessionId,
  );
  const [currentProjectName, setCurrentProjectName] = useState(
    initialCurrentProjectName,
  );
  const [currentProjectRevision, setCurrentProjectRevision] = useState(0);
  const [tabs, setTabs] = useState(initialTabs);
  const [mountedSessions, setMountedSessions] = useState(
    initialMountedSessions,
  );
  const [newTerminalProject, setNewTerminalProject] = useState("none");
  const displayTabs = buildTerminalDisplayTabs(
    tabs,
    new Map<string, SessionInfo>(
      tabs.flatMap((tab) =>
        tab.session ? [[tab.sessionId, tab.session]] : [],
      ),
    ),
    new Set(),
    new Map(),
  );
  const alphaActivityRef = useRef<TerminalOutputActivityRegistration | null>(
    null,
  );
  useEffect(() => {
    const activity = registerTerminalOutputActivity("alpha-1");
    activity.setStreamReady(true);
    activity.markOutput();
    alphaActivityRef.current = activity;
    return () => {
      alphaActivityRef.current = null;
      activity.dispose();
    };
  }, []);

  function changeCurrentProject(projectName: string | null) {
    if (currentProjectName === projectName) return;
    setCurrentProjectName(projectName);
    setCurrentProjectRevision((revision) => revision + 1);
  }

  function selectTab(sessionId: string) {
    setActiveSessionId(sessionId);
    if (syncWorkspaceProjectOnTerminalSelection) {
      changeCurrentProject(
        mountedSessions.find((session) => session.sessionId === sessionId)
          ?.project ?? null,
      );
    }
  }

  function closeTab(sessionId: string) {
    const remainingTabs = tabs.filter((tab) => tab.sessionId !== sessionId);
    setTabs(remainingTabs);
    setMountedSessions((current) =>
      current.filter((session) => session.sessionId !== sessionId),
    );
    setActiveSessionId((current) =>
      current === sessionId ? (remainingTabs[0]?.sessionId ?? null) : current,
    );
  }

  function togglePin(sessionId: string) {
    setTabs((current) =>
      current.map((tab) =>
        tab.sessionId === sessionId
          ? { ...tab, isPinned: tab.isPinned !== true }
          : tab,
      ),
    );
  }

  return (
    <div
      data-testid="traditional-projects-fixture"
      className="h-full"
      style={{ height: "640px" }}
    >
      <output data-testid="fixture-active-session">
        {activeSessionId ?? "none"}
      </output>
      <output data-testid="fixture-current-project">
        {currentProjectName}
      </output>
      <button
        type="button"
        data-testid="select-global-beta-project"
        onClick={() => changeCurrentProject("beta")}
      >
        Select beta workspace project
      </button>
      <button
        type="button"
        data-testid="select-global-alpha-project"
        onClick={() => changeCurrentProject("alpha")}
      >
        Select alpha workspace project
      </button>
      <button
        type="button"
        data-testid="clear-global-project"
        onClick={() => changeCurrentProject(null)}
      >
        Clear workspace project
      </button>
      <button
        type="button"
        data-testid="remove-alpha-session"
        onClick={() => {
          const sessionSnapshot = tabs.flatMap((tab) =>
            tab.sessionId === "alpha-1" || !tab.session ? [] : [tab.session],
          );
          const next = deriveTerminalAutoAttachState({
            sessions: sessionSnapshot,
            openTabs: tabs,
            mountedSessions,
            activeTab: activeSessionId,
            profileSessionIds: new Set(),
            freeTerminalIndexMap: new Map(),
          });
          setTabs(next.openTabs);
          setMountedSessions(next.mountedSessions);
          setActiveSessionId(next.activeTab);
        }}
      >
        Remove alpha session
      </button>
      <button
        type="button"
        data-testid="set-alpha-output-quiet"
        onClick={() => {
          alphaActivityRef.current?.setStreamReady(false);
          alphaActivityRef.current?.setStreamReady(true);
        }}
      >
        Set alpha output quiet
      </button>
      <output data-testid="fixture-new-terminal-project">
        {newTerminalProject}
      </output>
      <TraditionalTerminalProjectsDisplay
        activeSessionId={activeSessionId}
        mountedSessions={mountedSessions}
        terminalTabs={displayTabs}
        currentProjectName={currentProjectName}
        currentProjectRevision={currentProjectRevision}
        renderTerminals={false}
        onSelectTab={selectTab}
        onCloseTab={closeTab}
        onToggleTabPin={togglePin}
        onSessionExit={() => {}}
        onNewProjectTerminal={setNewTerminalProject}
        onNewFreeTerminal={() => setNewTerminalProject("free")}
      />
    </div>
  );
}

export function TraditionalProjectsFixture(
  props: TraditionalProjectsFixtureProps = {},
) {
  const [queryClient] = useState(
    () =>
      new QueryClient({
        defaultOptions: { queries: { retry: false } },
      }),
  );

  return (
    <QueryClientProvider client={queryClient}>
      <TraditionalProjectsFixtureContent {...props} />
    </QueryClientProvider>
  );
}

function pointerEvent(
  type: "pointerdown" | "pointermove" | "pointerup",
  pointerId: number,
  clientX: number,
  clientY: number,
  buttons: number,
): PointerEvent {
  return new PointerEvent(type, {
    bubbles: true,
    cancelable: true,
    button: 0,
    buttons,
    clientX,
    clientY,
    isPrimary: true,
    pointerId,
    pointerType: "mouse",
  });
}

export async function dragSecondTraditionalTerminalToRight(): Promise<void> {
  const handle = document.querySelectorAll<HTMLElement>(".cursor-grab")[1];
  if (!handle) throw new Error("Second terminal drag handle is missing");
  const handleRect = handle.getBoundingClientRect();
  const pointerId = 71;
  await act(async () => {
    handle.dispatchEvent(
      pointerEvent(
        "pointerdown",
        pointerId,
        handleRect.left + 4,
        handleRect.top + 4,
        1,
      ),
    );
    document.dispatchEvent(
      pointerEvent(
        "pointermove",
        pointerId,
        handleRect.left + 24,
        handleRect.top + 24,
        1,
      ),
    );
  });

  await vi.waitFor(() =>
    expect(
      page.getByText("Split Right", { exact: true }).element(),
    ).not.toBeNull(),
  );
  const splitRightLabel = page
    .getByText("Split Right", { exact: true })
    .element();
  const splitRightTarget = splitRightLabel.parentElement;
  if (!splitRightTarget) throw new Error("Split-right drop target is missing");
  const targetRect = splitRightTarget.getBoundingClientRect();
  await act(async () => {
    document.dispatchEvent(
      pointerEvent(
        "pointermove",
        pointerId,
        targetRect.left + targetRect.width / 2,
        targetRect.top + targetRect.height / 2,
        1,
      ),
    );
  });
  await vi.waitFor(() =>
    expect(splitRightTarget.className).toContain("border-sky-300"),
  );
  await act(async () => {
    document.dispatchEvent(
      pointerEvent(
        "pointerup",
        pointerId,
        targetRect.left + targetRect.width / 2,
        targetRect.top + targetRect.height / 2,
        0,
      ),
    );
  });
}
