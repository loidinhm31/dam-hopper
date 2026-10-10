import { act, useEffect, useMemo, useRef, useState } from "react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { MemoryRouter, useLocation } from "react-router-dom";
import { expect, vi } from "vitest";
import { page } from "vitest/browser";
import { TraditionalTerminalProjectsDisplay } from "@/components/organisms/TraditionalTerminalProjectsDisplay.js";
import type { MountedSession } from "@/components/organisms/MultiTerminalDisplay.js";
import type { TabEntry } from "@/components/organisms/TerminalTabBar.js";
import { createApiClient, type SessionInfo } from "@/api/client.js";
import type { TerminalAgentStatusRow } from "@/api/agent-status-types.js";
import {
  __setConnectionSnapshotForTests,
  getConnectionSnapshot,
} from "@/api/connections.js";
import {
  clearActiveProfile,
  getActiveProfileId,
  getProfiles,
  saveProfiles,
  setActiveProfile,
  type ServerProfile,
} from "@/api/server-config.js";
import { terminalKey, type TerminalRef } from "@/api/ownership.js";
import type { Transport } from "@/api/transport.js";
import {
  beginAgentStatusConnection,
  installAgentStatusSnapshot,
  useAgentStatusStore,
} from "@/stores/agent-status.js";

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
    incarnation: 1,
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

export const agentFixtureRefs = {
  alpha: { profileId: "browser-alpha", id: "shared-agent" },
  alphaShell: { profileId: "browser-alpha", id: "alpha-shell" },
  beta: { profileId: "browser-beta &+=", id: "shared-agent" },
  betaShell: { profileId: "browser-beta &+=", id: "beta-shell" },
  claude: { profileId: "browser-beta &+=", id: "claude-agent" },
} as const satisfies Record<string, TerminalRef>;

const agentFixtureProfiles: ServerProfile[] = [
  {
    id: agentFixtureRefs.alpha.profileId,
    name: "Server A",
    url: "http://localhost:4800",
    authType: "basic",
    createdAt: 1,
    autoConnect: false,
  },
  {
    id: agentFixtureRefs.beta.profileId,
    name: "Server B",
    url: "http://localhost:4801",
    authType: "basic",
    createdAt: 1,
    autoConnect: false,
  },
];

const agentFixtureTabs: TabEntry[] = ([
  [agentFixtureRefs.alpha, "alpha", "alpha first", true],
  [agentFixtureRefs.alphaShell, "alpha", "alpha second", false],
  [agentFixtureRefs.betaShell, "beta", "beta shell", false],
  [agentFixtureRefs.beta, "beta", "beta agent", false],
  [agentFixtureRefs.claude, "beta", "beta Claude", false],
] as const).map(([terminalRef, project, label, pinned]) => ({
  sessionId: terminalKey(terminalRef),
  terminalRef,
  profileId: terminalRef.profileId,
  label,
  session: session(terminalKey(terminalRef), project, true),
  isPinned: pinned,
}));

const agentFixtureMounted: MountedSession[] = agentFixtureTabs.map((tab) => ({
  sessionId: tab.sessionId,
  terminalRef: tab.terminalRef,
  profileId: tab.profileId,
  project: tab.session!.project ?? "",
  command: "bash",
  cwd: tab.session!.cwd,
}));

function agentStatusRow(
  ref: TerminalRef,
  agentKind: TerminalAgentStatusRow["agentKind"],
): TerminalAgentStatusRow {
  return {
    id: ref.id,
    incarnation: 1,
    agentKind,
    agentSessionId: `fixture-${agentKind}`,
    reporterEpoch: 1,
    attentionRevision: 0,
    state: "idle",
    source: agentKind === "omp" ? "lifecycle" : "hook",
    lastOutcome: "ended",
  };
}

// Component data only: this deliberately does not impersonate real CLI ingress.
export function seedTraditionalAgentFixture(transport: Transport): () => void {
  const originalProfiles = getProfiles();
  const originalActiveProfile = getActiveProfileId();
  const originalStatusProfiles = useAgentStatusStore.getState().profiles;
  saveProfiles(agentFixtureProfiles);
  setActiveProfile(agentFixtureRefs.alpha.profileId);
  for (const profile of agentFixtureProfiles) {
    const owner = { profileId: profile.id, generation: 1 };
    __setConnectionSnapshotForTests(profile.id, {
      owner,
      status: "connected",
      serverUrl: profile.url,
      transport,
      api: createApiClient(owner, transport),
    });
    beginAgentStatusConnection(owner);
    installAgentStatusSnapshot(owner, {
      version: 1,
      serverEpoch: 1,
      revision: 1,
      availability: "ready",
      terminals:
        profile.id === agentFixtureRefs.alpha.profileId
          ? [agentStatusRow(agentFixtureRefs.alpha, "omp")]
          : [
              agentStatusRow(agentFixtureRefs.beta, "codex"),
              agentStatusRow(agentFixtureRefs.claude, "claude"),
            ],
    });
  }
  return () => {
    for (const profile of agentFixtureProfiles) {
      __setConnectionSnapshotForTests(profile.id, null);
    }
    useAgentStatusStore.setState({ profiles: originalStatusProfiles });
    saveProfiles(originalProfiles);
    if (originalActiveProfile) setActiveProfile(originalActiveProfile);
    else clearActiveProfile();
  };
}

export function updateTraditionalAgentFixtureStatus(
  ref: TerminalRef,
  patch: Partial<TerminalAgentStatusRow>,
) {
  const profile = useAgentStatusStore.getState().profiles.get(ref.profileId);
  const owner = getConnectionSnapshot(ref.profileId)?.owner;
  if (!profile || !owner) throw new Error("Agent fixture profile is missing");
  installAgentStatusSnapshot(owner, {
    version: 1,
    serverEpoch: profile.epoch ?? 1,
    revision: profile.revision + 1,
    availability: "ready",
    terminals: [...profile.rows.values()].map((row) =>
      row.id === ref.id ? { ...row, ...patch } : row,
    ),
  });
}

interface TraditionalProjectsFixtureProps {
  initialActiveSessionId?: string;
  initialCurrentProjectName?: string | null;
  syncWorkspaceProjectOnTerminalSelection?: boolean;
  withAgents?: boolean;
  terminalMetadataRevision?: number;
  republishMountedMetadata?: boolean;
}

function TraditionalProjectsFixtureContent({
  initialActiveSessionId,
  initialCurrentProjectName = "alpha",
  syncWorkspaceProjectOnTerminalSelection = true,
  withAgents = false,
  terminalMetadataRevision = 0,
  republishMountedMetadata = false,
}: TraditionalProjectsFixtureProps) {
  const [activeSessionId, setActiveSessionId] = useState<string | null>(
    initialActiveSessionId ??
      (withAgents ? terminalKey(agentFixtureRefs.alpha) : "alpha-1"),
  );
  const [currentProjectName, setCurrentProjectName] = useState(
    initialCurrentProjectName,
  );
  const [currentProjectRevision, setCurrentProjectRevision] = useState(0);
  const [tabs, setTabs] = useState(withAgents ? agentFixtureTabs : initialTabs);
  const [mountedSessions, setMountedSessions] = useState(
    withAgents ? agentFixtureMounted : initialMountedSessions,
  );
  // Session hydration can also republish the canonical mounted metadata. Keep
  // this distinct from tab-only churn so the regression covers both app paths.
  const displayMountedSessions = useMemo(
    () => withAgents && republishMountedMetadata
      ? mountedSessions.map((mounted) => ({
          ...mounted,
          ...(mounted.sessionId === terminalKey(agentFixtureRefs.alphaShell)
            ? { name: `alpha metadata ${terminalMetadataRevision}` }
            : {}),
        }))
      : mountedSessions,
    [mountedSessions, withAgents, republishMountedMetadata, terminalMetadataRevision],
  );
  const [selectionCount, setSelectionCount] = useState(0);
  const [visibleSessionIds, setVisibleSessionIds] = useState<ReadonlySet<string>>(
    new Set(),
  );
  const [newTerminalProject, setNewTerminalProject] = useState("none");
  const displayTabs = buildTerminalDisplayTabs(
    tabs,
    new Map<string, SessionInfo>(
      tabs.flatMap((tab) =>
        tab.session
          ? [[tab.sessionId, {
              ...tab.session,
              // Republish hydrated application metadata, not mounted PTYs.
              // A visible shell rename proves the consumer received new tabs;
              // qualified ownership, incarnation and live membership stay put.
              ...(withAgents && terminalMetadataRevision > 0 &&
                tab.sessionId === terminalKey(agentFixtureRefs.alphaShell)
                ? { name: `alpha metadata ${terminalMetadataRevision}` }
                : {}),
            }]]
          : [],
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
    setSelectionCount((count) => count + 1);
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
      <output data-testid="fixture-selection-count">{selectionCount}</output>
      <output data-testid="fixture-visible-sessions">
        {JSON.stringify([...visibleSessionIds].sort())}
      </output>
      {withAgents && (
        <>
          <button
            type="button"
            data-testid="remove-agent-terminal"
            onClick={() => closeTab(terminalKey(agentFixtureRefs.alpha))}
          >
            Remove observed terminal
          </button>
          <button
            type="button"
            data-testid="restart-agent-terminal"
            onClick={() => {
              const id = terminalKey(agentFixtureRefs.alpha);
              const incarnation =
                (tabs.find((tab) => tab.sessionId === id)?.session?.incarnation ??
                  0) + 1;
              setTabs((current) =>
                current.map((tab) =>
                  tab.sessionId === id && tab.session
                    ? { ...tab, session: { ...tab.session, incarnation } }
                    : tab,
                ),
              );
              updateTraditionalAgentFixtureStatus(agentFixtureRefs.alpha, {
                incarnation,
              });
            }}
          >
            Restart observed terminal
          </button>
          <button
            type="button"
            data-testid="stop-agent-terminal"
            onClick={() =>
              setTabs((current) =>
                current.map((tab) =>
                  tab.sessionId === terminalKey(agentFixtureRefs.alpha) &&
                  tab.session
                    ? { ...tab, session: { ...tab.session, alive: false } }
                    : tab,
                ),
              )
            }
          >
            Stop observed terminal
          </button>
          <button
            type="button"
            data-testid="mismatch-agent-metadata"
            onClick={() =>
              setTabs((current) =>
                current.map((tab) =>
                  tab.sessionId === terminalKey(agentFixtureRefs.alpha) &&
                  tab.session
                    ? {
                        ...tab,
                        session: {
                          ...tab.session,
                          id: terminalKey(agentFixtureRefs.beta),
                        },
                      }
                    : tab,
                ),
              )
            }
          >
            Mismatch observed terminal metadata
          </button>
          <button
            type="button"
            data-testid="raw-agent-metadata"
            onClick={() =>
              setTabs((current) =>
                current.map((tab) =>
                  tab.sessionId === terminalKey(agentFixtureRefs.alpha) &&
                  tab.session
                    ? {
                        ...tab,
                        session: { ...tab.session, id: agentFixtureRefs.alpha.id },
                      }
                    : tab,
                ),
              )
            }
          >
            Supply raw observed terminal metadata
          </button>
        </>
      )}
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
        mountedSessions={displayMountedSessions}
        terminalTabs={displayTabs}
        currentProjectId={currentProjectName}
        currentProjectRevision={currentProjectRevision}
        renderTerminals={false}
        onSelectTab={selectTab}
        onCloseTab={closeTab}
        onToggleTabPin={togglePin}
        onVisibleSessionIdsChange={setVisibleSessionIds}
        onSessionExit={() => {}}
        onNewProjectTerminal={setNewTerminalProject}
        onNewFreeTerminal={() => setNewTerminalProject("free")}
      />
    </div>
  );
}

function FixtureRoute() {
  const location = useLocation();
  return (
    <output data-testid="fixture-route">
      {location.pathname + location.search}
    </output>
  );
}

const fixtureQueryClients = new Set<QueryClient>();

/** Wait for transport fixtures and their React Query publications under act. */
export async function settleTraditionalFixtureQueries() {
  await act(async () => {
    await vi.waitFor(() => {
      expect([...fixtureQueryClients].every((client) => client.isFetching() === 0))
        .toBe(true);
    });
  });
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
  useEffect(() => {
    fixtureQueryClients.add(queryClient);
    return () => {
      fixtureQueryClients.delete(queryClient);
      queryClient.clear();
    };
  }, [queryClient]);

  return (
    <QueryClientProvider client={queryClient}>
      <MemoryRouter>
        <FixtureRoute />
        <TraditionalProjectsFixtureContent {...props} />
      </MemoryRouter>
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
  // The pointer sensor intentionally retains document click suppression after
  // pointerup. Wait for actual target delivery, not a sleep or a second row click.
  const clickProbe = document.createElement("span");
  clickProbe.hidden = true;
  let clickDelivered = false;
  clickProbe.addEventListener("click", () => {
    clickDelivered = true;
  });
  document.body.append(clickProbe);
  try {
    await act(async () => {
      await vi.waitFor(() => {
        clickDelivered = false;
        clickProbe.dispatchEvent(new MouseEvent("click", { bubbles: true }));
        expect(clickDelivered).toBe(true);
      });
    });
  } finally {
    clickProbe.remove();
  }
}
