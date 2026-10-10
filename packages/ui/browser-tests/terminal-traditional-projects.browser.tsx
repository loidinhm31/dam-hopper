import { act, type ComponentProps } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { page, userEvent as browserUserEvent } from "vitest/browser";
import { Terminal } from "@xterm/xterm";
import { FitAddon } from "@xterm/addon-fit";
import { SearchAddon } from "@xterm/addon-search";
import type { GitStatus, TerminalAgentNotifications, Worktree } from "@/api/client.js";
import {
  __setConnectionSnapshotForTests,
  getConnectionSnapshot,
} from "@/api/connections.js";
import {
  getActiveProfileId,
  getProfiles,
  saveProfiles,
} from "@/api/server-config.js";
import { projectKey, terminalKey } from "@/api/ownership.js";
import {
  applyAgentStatusChanged,
  beginAgentStatusConnection,
  installAgentStatusSnapshot,
  useAgentStatusStore,
} from "@/stores/agent-status.js";
import { useTerminalNotificationsStore } from "@/stores/terminal-notifications.js";
import { useProjectTargetStore } from "@/stores/project-target.js";
import { notifyTerminalAgent } from "@/lib/browser-notification-service.js";
import { playTerminalNotificationSound } from "@/lib/terminal-notification-sound.js";
import type * as BrowserNotificationService from "@/lib/browser-notification-service.js";
import type * as TerminalNotificationSound from "@/lib/terminal-notification-sound.js";
import { attachTerminalsToHost } from "@/lib/terminal-host-attachment.js";
import { scheduleTerminalFit } from "@/lib/terminal-fit-scheduler.js";
import type * as TerminalHostAttachment from "@/lib/terminal-host-attachment.js";
import type * as TerminalFitScheduler from "@/lib/terminal-fit-scheduler.js";
import {
  getTerminal,
  registerTerminal,
  removeTerminal,
  type TerminalEntry,
} from "@/lib/terminal-registry.js";
import { TerminalFindController } from "@/lib/terminal-find-controller.js";
import {
  initTransport,
  resetTransport,
  type Transport,
} from "@/api/transport.js";
import {
  TraditionalProjectsFixture,
  dragSecondTraditionalTerminalToRight,
  agentFixtureRefs,
  seedTraditionalAgentFixture,
  updateTraditionalAgentFixtureStatus,
  settleTraditionalFixtureQueries,
} from "./terminal-traditional-projects.browser-fixture.js";
import { traditionalTerminalLayoutStorageKey } from "@/lib/traditional-terminal-projects.js";
import "@/index.css";
import "@xterm/xterm/css/xterm.css";
// Browser mode actions run outside React. Keep the entire real interaction
// inside act so selection effects and modal focus/Presence updates settle.
const userEvent = {
  click: async (...args: Parameters<typeof browserUserEvent.click>) => {
    await act(async () => browserUserEvent.click(...args));
    await settleTraditionalFixtureQueries();
  },
  keyboard: async (...args: Parameters<typeof browserUserEvent.keyboard>) => {
    await act(async () => browserUserEvent.keyboard(...args));
    await settleTraditionalFixtureQueries();
  },
};

async function waitForProjectsSheetDismissal(opener: HTMLElement) {
  await act(async () => {
    await vi.waitFor(() => {
      expect(document.querySelector('[role="dialog"]')).toBeNull();
      expect(document.activeElement).toBe(opener);
    });
  });
}


const LONG_COMMIT_MESSAGE =
  "Preserve complete Traditional project commit context while resizing the terminal navigator";

const compactState = vi.hoisted(() => ({ value: false }));
const terminalCommitStatusState = vi.hoisted(() => ({ enabled: true }));
const notificationPolicy = vi.hoisted(() => {
  const policy = {
    enabled: false,
    toast: true,
    browser: true,
    sound: true,
    volume: 100,
    pattern: "default" as const,
  };
  return {
    version: 2 as const,
    agents: { omp: { ...policy }, codex: { ...policy }, claude: { ...policy } },
  };
});

function statusFor(projectName: string): GitStatus {
  return {
    projectName,
    branch: `${projectName}/main`,
    isClean: true,
    ahead: 0,
    behind: 0,
    staged: 0,
    modified: 0,
    untracked: 0,
    hasStash: false,
    pathExists: true,
    lastCommit: {
      hash: `${projectName}-commit-hash-123456789`,
      message:
        projectName === "alpha"
          ? LONG_COMMIT_MESSAGE
          : "Keep beta project available for switching",
      date: "2026-07-26T12:30:00.000Z",
    },
  };
}
export const alphaWorktrees: Worktree[] = [
  {
    path: "/workspace/alpha",
    repositoryPath: "/workspace/alpha/.git",
    branch: "alpha/main",
    commitHash: "alpha-commit-hash-123456789",
    isMain: true,
    isLocked: false,
    isDetached: false,
    isBare: false,
    isPrunable: false,
    isAvailable: true,
  },
  {
    path: "/workspace/alpha-feat",
    repositoryPath: "/workspace/alpha/.git",
    branch: "feature/alpha-ui",
    commitHash: "alpha-feat-hash-123",
    isMain: false,
    isLocked: false,
    isDetached: false,
    isBare: false,
    isPrunable: false,
    isAvailable: true,
  },
  {
    path: "/workspace/alpha-detached",
    repositoryPath: "/workspace/alpha/.git",
    branch: null,
    commitHash: "alpha-detached-hash-456",
    isMain: false,
    isLocked: false,
    isDetached: true,
    isBare: false,
    isPrunable: false,
    isAvailable: true,
  },
  {
    path: "/workspace/alpha-locked",
    repositoryPath: "/workspace/alpha/.git",
    branch: "feature/locked",
    commitHash: "alpha-locked-hash-789",
    isMain: false,
    isLocked: true,
    isDetached: false,
    isBare: false,
    isPrunable: false,
    isAvailable: true,
  },
  {
    path: "/workspace/alpha-bare",
    repositoryPath: "/workspace/alpha/.git",
    branch: "feature/bare",
    commitHash: "alpha-bare-hash-101",
    isMain: false,
    isLocked: false,
    isDetached: false,
    isBare: true,
    isPrunable: false,
    isAvailable: true,
  },
  {
    path: "/workspace/alpha-prunable",
    repositoryPath: "/workspace/alpha/.git",
    branch: "feature/prunable",
    commitHash: "alpha-prunable-hash-202",
    isMain: false,
    isLocked: false,
    isDetached: false,
    isBare: false,
    isPrunable: true,
    isAvailable: false,
  },
];

let customWorktrees: Record<string, Worktree[]> | null = null;
let worktreeDiscoveryError: Error | null = null;

function worktreesFor(projectName: string): Worktree[] {
  if (worktreeDiscoveryError) {
    throw worktreeDiscoveryError;
  }
  if (customWorktrees?.[projectName]) {
    return customWorktrees[projectName]!;
  }
  if (projectName === "alpha") {
    return alphaWorktrees;
  }
  return [
    {
      path: `/workspace/${projectName}`,
      repositoryPath: `/workspace/${projectName}/.git`,
      branch: `${projectName}/main`,
      commitHash: `${projectName}-commit-hash-123456789`,
      isMain: true,
      isLocked: false,
      isDetached: false,
      isBare: false,
      isPrunable: false,
      isAvailable: true,
    },
  ];
}

const invoke = vi.fn(async (channel: string, target?: unknown) => {
  if (channel === "git:worktrees") {
    if (typeof target !== "string") {
      throw new Error("Expected a project name for worktree discovery");
    }
    return worktreesFor(target);
  }
  if (channel !== "projects:status") {
    throw new Error(`Unexpected browser fixture transport channel: ${channel}`);
  }
  const projectName =
    typeof target === "object" &&
    target !== null &&
    "project" in target &&
    typeof target.project === "string"
      ? target.project
      : "unknown";
  return statusFor(projectName);
});

const projectStatusTransport = {
  invoke,
  onTerminalData: () => () => {},
  onTerminalExit: () => () => {},
  onEvent: () => () => {},
  terminalWrite: () => {},
  terminalResize: () => {},
} as unknown as Transport;

vi.mock("@/hooks/use-compact-workspace.js", () => ({
  useCompactWorkspace: () => compactState.value,
}));

vi.mock("@/hooks/use-coarse-pointer.js", () => ({
  useCoarsePointer: () => false,
}));

interface BrowserSettings {
  mobileCustomKeyboardEnabled: boolean;
  terminalCommitStatusEnabled: boolean;
  terminalAgentNotifications: TerminalAgentNotifications;
}

vi.mock("@/stores/settings.js", () => {
  const getState = (): BrowserSettings => ({
    mobileCustomKeyboardEnabled: false,
    terminalCommitStatusEnabled: terminalCommitStatusState.enabled,
    terminalAgentNotifications: notificationPolicy,
  });
  return {
    useSettingsStore: Object.assign(
      (selector: (state: BrowserSettings) => unknown) =>
        selector(getState()),
      { getState },
    ),
  };
});

vi.mock("@/lib/browser-notification-service.js", async (importOriginal) => ({
  ...(await importOriginal<typeof BrowserNotificationService>()),
  notifyTerminalAgent: vi.fn(),
}));

vi.mock("@/lib/terminal-notification-sound.js", async (importOriginal) => ({
  ...(await importOriginal<typeof TerminalNotificationSound>()),
  playTerminalNotificationSound: vi.fn(),
}));

vi.mock("@/contexts/AndroidChromeInputPolicyContext.js", () => ({
  useAndroidChromeInputPolicy: () => ({
    isAndroidChromeNativeInputSuppressed: false,
  }),
}));

// Observe the real consumer path without removing reparenting, geometry checks,
// animation-frame fitting or xterm autofocus. Most tests have no registry entry;
// the metadata focus regression below registers a real xterm.
vi.mock("@/lib/terminal-host-attachment.js", async (importOriginal) => {
  const actual = await importOriginal<typeof TerminalHostAttachment>();
  return { ...actual, attachTerminalsToHost: vi.fn(actual.attachTerminalsToHost) };
});

vi.mock("@/lib/terminal-fit-scheduler.js", async (importOriginal) => {
  const actual = await importOriginal<typeof TerminalFitScheduler>();
  return { ...actual, scheduleTerminalFit: vi.fn(actual.scheduleTerminalFit) };
});

vi.mock("@/lib/terminal-native-input-policy.js", () => ({
  syncNativeKeyboardSuppression: vi.fn(),
}));

vi.mock("@/components/organisms/MobileTerminalAccessoryBar.js", () => ({
  MobileTerminalAccessoryBar: () => null,
}));
const reactActEnvironment = globalThis as {
  IS_REACT_ACT_ENVIRONMENT?: boolean;
};
reactActEnvironment.IS_REACT_ACT_ENVIRONMENT = true;

describe("Traditional terminal projects in Chromium", () => {
  let container: HTMLDivElement;
  let root: Root;
  let cleanupAgentFixture: (() => void) | undefined;

  beforeEach(async () => {
    compactState.value = false;
    terminalCommitStatusState.enabled = true;
    for (const policy of Object.values(notificationPolicy.agents)) {
      policy.enabled = false;
    }
    invoke.mockClear();
    vi.mocked(notifyTerminalAgent).mockClear();
    vi.mocked(playTerminalNotificationSound).mockClear();
    useTerminalNotificationsStore.getState().clearNotifications();
    initTransport(projectStatusTransport);
    localStorage.removeItem(
      traditionalTerminalLayoutStorageKey("project:alpha"),
    );
    localStorage.removeItem(
      traditionalTerminalLayoutStorageKey("project:beta"),
    );
    localStorage.removeItem("dam-hopper:traditional-projects-navigator-width");
    customWorktrees = null;
    worktreeDiscoveryError = null;
    useProjectTargetStore.setState({
      activeTargetByProject: {},
      unavailableTargetByProject: {},
      unavailableTargetsByProject: {},
    });
    container = document.createElement("div");
    container.style.height = "640px";
    container.style.width = "1280px";
    document.body.append(container);
    root = createRoot(container);
    await act(async () => root.render(<TraditionalProjectsFixture />));
    await settleTraditionalFixtureQueries();
  });

  afterEach(async () => {
    await act(async () => root.unmount());
    cleanupAgentFixture?.();
    cleanupAgentFixture = undefined;
    for (const [profileId, project] of [
      [agentFixtureRefs.alpha.profileId, "alpha"],
      [agentFixtureRefs.beta.profileId, "beta"],
    ]) {
      localStorage.removeItem(
        traditionalTerminalLayoutStorageKey(projectKey({ profileId, project })),
      );
    }
    customWorktrees = null;
    worktreeDiscoveryError = null;
    useProjectTargetStore.setState({
      activeTargetByProject: {},
      unavailableTargetByProject: {},
      unavailableTargetsByProject: {},
    });
    resetTransport();
    container.remove();
    document.body.innerHTML = "";
  });

  async function selectProject(name: string) {
    await userEvent.click(page.getByRole("tab", { name: new RegExp(name) }));
    await vi.waitFor(() =>
      expect(
        document.querySelector('[data-testid="fixture-active-session"]'),
      ).not.toBeNull(),
    );
  }

  async function mountAgents(
    props: ComponentProps<typeof TraditionalProjectsFixture> = {},
  ) {
    await act(async () => {
      root.unmount();
      cleanupAgentFixture = seedTraditionalAgentFixture(projectStatusTransport);
      root = createRoot(container);
      root.render(<TraditionalProjectsFixture {...props} withAgents />);
    });
    await settleTraditionalFixtureQueries();
    if (compactState.value) {
      await expect
        .element(page.getByRole("button", { name: "Projects + Agents" }))
        .toBeVisible();
    } else {
      await expect
        .element(page.getByRole("list", { name: "Observed agents in open terminals" }))
        .toBeVisible();
    }
  }

  // Retain the real row's React click closure, not a new DOM dispatch that would
  // resolve the current props. This exercises callbacks queued before retirement.
  function retainAgentActivation(button: HTMLElement): () => void {
    const propsKey = Object.keys(button).find((key) =>
      key.startsWith("__reactProps$"),
    );
    if (!propsKey) throw new Error("React row click props are missing");
    const props = (button as unknown as Record<string, { onClick?: () => void }>)[
      propsKey
    ];
    if (!props?.onClick) throw new Error("Agent row click handler is missing");
    return props.onClick;
  }

  it("shows scoped project status, preserves each selection, and restores split layouts", async () => {
    await page.viewport(1280, 700);
    await expect
      .element(page.getByRole("heading", { name: "projects" }))
      .toBeVisible();
    await act(async () => {
      await vi.waitFor(() =>
        expect(
          document.querySelector(
            '[role="status"][aria-label^="Branch alpha/main"]',
          ),
        ).not.toBeNull(),
      );
    });
    const alphaMetadata = document.querySelector<HTMLElement>(
      '[role="status"][aria-label^="Branch alpha/main"]',
    );
    expect(alphaMetadata?.children).toHaveLength(3);
    expect(alphaMetadata?.children[0]?.querySelector("svg")).not.toBeNull();
    expect(alphaMetadata?.children[1]?.querySelector("svg")).not.toBeNull();
    expect(alphaMetadata?.children[2]?.querySelector("svg")).not.toBeNull();
    expect(alphaMetadata?.children[0]?.className).toContain(
      "text-[var(--color-info)]",
    );
    expect(alphaMetadata?.children[1]?.className).toContain(
      "text-[var(--color-text-muted)]",
    );
    expect(alphaMetadata?.children[2]?.className).toContain(
      "text-[var(--color-primary)]",
    );
    expect(alphaMetadata?.children[1]?.textContent).toContain(
      "/workspace/alpha",
    );
    expect(alphaMetadata?.children[2]?.textContent).toContain(
      LONG_COMMIT_MESSAGE,
    );
    expect(
      alphaMetadata?.children[2]?.querySelector(".break-words"),
    ).not.toBeNull();
    expect(alphaMetadata?.children[2]?.querySelector(".truncate")).toBeNull();
    const projectsNavigator = document.querySelector<HTMLElement>(
      'nav[aria-label="Terminal projects and agents"]',
    );
    const resizeHandle = document.querySelector<HTMLElement>(
      '[data-testid="traditional-projects-resize-handle"]',
    );
    expect(resizeHandle?.getAttribute("aria-label")).toBe(
      "Resize projects panel",
    );
    expect(resizeHandle?.tabIndex).toBe(0);
    expect(projectsNavigator?.style.width).toBe("224px");
    expect(resizeHandle?.getAttribute("aria-valuenow")).toBe("224");
    await act(async () => {
      resizeHandle?.dispatchEvent(
        new MouseEvent("mousedown", {
          bubbles: true,
          clientX: 100,
        }),
      );
      document.dispatchEvent(
        new MouseEvent("mousemove", {
          bubbles: true,
          clientX: 148,
        }),
      );
      document.dispatchEvent(
        new MouseEvent("mouseup", {
          bubbles: true,
          clientX: 148,
        }),
      );
    });
    expect(projectsNavigator?.style.width).toBe("272px");
    expect(resizeHandle?.getAttribute("aria-valuenow")).toBe("272");
    expect(
      localStorage.getItem("dam-hopper:traditional-projects-navigator-width"),
    ).toBe("272");
    await act(async () => {
      resizeHandle?.dispatchEvent(
        new KeyboardEvent("keydown", {
          bubbles: true,
          key: "ArrowLeft",
        }),
      );
    });
    expect(projectsNavigator?.style.width).toBe("256px");
    expect(resizeHandle?.getAttribute("aria-valuenow")).toBe("256");
    await act(async () => {
      resizeHandle?.dispatchEvent(
        new KeyboardEvent("keydown", {
          bubbles: true,
          key: "ArrowRight",
          shiftKey: true,
        }),
      );
    });
    expect(projectsNavigator?.style.width).toBe("288px");
    expect(resizeHandle?.getAttribute("aria-valuenow")).toBe("288");
    await act(async () => {
      resizeHandle?.dispatchEvent(
        new KeyboardEvent("keydown", {
          bubbles: true,
          key: "Home",
        }),
      );
    });
    expect(projectsNavigator?.style.width).toBe("220px");
    expect(resizeHandle?.getAttribute("aria-valuenow")).toBe("220");
    await act(async () => {
      resizeHandle?.dispatchEvent(
        new KeyboardEvent("keydown", {
          bubbles: true,
          key: "ArrowLeft",
        }),
      );
    });
    expect(projectsNavigator?.style.width).toBe("220px");
    await act(async () => {
      resizeHandle?.dispatchEvent(
        new KeyboardEvent("keydown", {
          bubbles: true,
          key: "End",
        }),
      );
    });
    expect(projectsNavigator?.style.width).toBe("520px");
    expect(resizeHandle?.getAttribute("aria-valuenow")).toBe("520");
    await act(async () => {
      resizeHandle?.dispatchEvent(
        new KeyboardEvent("keydown", {
          bubbles: true,
          key: "ArrowRight",
        }),
      );
    });
    expect(projectsNavigator?.style.width).toBe("520px");
    expect(
      localStorage.getItem("dam-hopper:traditional-projects-navigator-width"),
    ).toBe("520");
    await act(async () => {
      root.unmount();
      root = createRoot(container);
      root.render(<TraditionalProjectsFixture />);
    });
    const reloadedNavigator = document.querySelector<HTMLElement>(
      'nav[aria-label="Terminal projects and agents"]',
    );
    const reloadedResizeHandle = document.querySelector<HTMLElement>(
      '[data-testid="traditional-projects-resize-handle"]',
    );
    expect(reloadedNavigator?.style.width).toBe("520px");
    expect(reloadedResizeHandle?.getAttribute("aria-valuenow")).toBe("520");
    const projectTabs = document.querySelectorAll<HTMLElement>(
      'nav[aria-label="Terminal projects and agents"] [role="tab"]',
    );
    expect(projectTabs).toHaveLength(2);
    expect(Array.from(projectTabs, (tab) => tab.id)).toEqual([
      "traditional-terminal-project-tab-project%3Aalpha",
      "traditional-terminal-project-tab-project%3Abeta",
    ]);
    const alphaProjectTab = projectTabs[0];
    const betaProjectTab = projectTabs[1];
    const projectIndicator = (tab: HTMLElement | undefined) =>
      tab?.querySelector<HTMLElement>('span[aria-hidden="true"]');
    expect(alphaProjectTab?.textContent).toContain("Receiving terminal output");
    expect(projectIndicator(alphaProjectTab)?.getAttribute("title")).toBe(
      "Receiving terminal output",
    );
    expect(projectIndicator(alphaProjectTab)?.className).toContain(
      "bg-[var(--color-success)]",
    );
    expect(betaProjectTab?.textContent).toContain("No recent terminal output");
    expect(projectIndicator(betaProjectTab)?.getAttribute("title")).toBe(
      "No recent terminal output",
    );
    expect(projectIndicator(betaProjectTab)?.className).toContain(
      "bg-[var(--color-warning)]",
    );
    await userEvent.click(
      page.getByRole("button", { name: "New terminal in selected project" }),
    );
    expect(
      document.querySelector('[data-testid="fixture-new-terminal-project"]')
        ?.textContent,
    ).toBe("alpha");
    const selectedTab = document.querySelector<HTMLElement>(
      '[role="tab"][aria-selected="true"]',
    );
    const selectedPanel =
      document.querySelector<HTMLElement>('[role="tabpanel"]');
    expect(selectedTab?.getAttribute("aria-controls")).toBe(selectedPanel?.id);
    expect(selectedPanel?.getAttribute("aria-labelledby")).toBe(
      selectedTab?.id,
    );
    await expect
      .element(page.getByRole("heading", { name: "agents" }))
      .toBeVisible();
    await expect
      .element(page.getByText("No observed agents in open terminals.", { exact: false }))
      .toBeVisible();
    expect(
      page.getByRole("link", { name: "Agent Settings" }).element()
        .getAttribute("href"),
    ).toBe("/agent-store?tab=settings");
    await expect
      .element(page.getByText("alpha first", { exact: true }))
      .toBeVisible();
    await expect
      .element(page.getByText("alpha second", { exact: true }))
      .toBeVisible();
    expect(document.body.textContent).not.toContain("beta shell");

    await userEvent.click(page.getByText("alpha second", { exact: true }));
    expect(
      document.querySelector('[data-testid="fixture-active-session"]')
        ?.textContent,
    ).toBe("alpha-2");
    await selectProject("beta");
    await expect
      .element(page.getByText("beta shell", { exact: true }))
      .toBeVisible();
    await userEvent.click(
      page.getByRole("button", { name: "New terminal in selected project" }),
    );
    expect(
      document.querySelector('[data-testid="fixture-new-terminal-project"]')
        ?.textContent,
    ).toBe("beta");
    expect(document.body.textContent).not.toContain("alpha first");

    await selectProject("alpha");
    await expect
      .element(page.getByText("alpha second", { exact: true }))
      .toBeVisible();
    expect(
      document.querySelector('[data-testid="fixture-active-session"]')
        ?.textContent,
    ).toBe("alpha-2");

    await dragSecondTraditionalTerminalToRight();

    await vi.waitFor(() =>
      expect(
        document.querySelectorAll('[data-testid="terminal-pane-output-host"]'),
      ).toHaveLength(2),
    );
    const alphaLayoutKey = traditionalTerminalLayoutStorageKey("project:alpha");
    const persistedAlphaLayout = localStorage.getItem(alphaLayoutKey);
    expect(persistedAlphaLayout).toContain("alpha-2");
    expect(persistedAlphaLayout).not.toContain("beta-1");

    await selectProject("beta");
    await selectProject("alpha");
    expect(document.body.textContent).not.toContain("beta shell");
    expect(
      document.querySelectorAll('[data-testid="terminal-pane-output-host"]'),
    ).toHaveLength(2);
    expect(
      document.querySelector('[data-testid="fixture-active-session"]')
        ?.textContent,
    ).toBe("alpha-2");
  });

  it("routes the plus action to the current workspace project", async () => {
    await page.viewport(1280, 700);
    await userEvent.click(page.getByTestId("select-global-beta-project"));
    expect(
      document.querySelector('[data-testid="fixture-current-project"]')
        ?.textContent,
    ).toBe("beta");
    await userEvent.click(
      page.getByRole("button", { name: "New terminal in selected project" }),
    );
    expect(
      document.querySelector('[data-testid="fixture-new-terminal-project"]')
        ?.textContent,
    ).toBe("beta");
    await userEvent.click(
      page
        .getByTestId("multi-terminal-display-surface")
        .getByRole("button", { name: "New Terminal" }),
    );
    expect(
      document.querySelector('[data-testid="fixture-new-terminal-project"]')
        ?.textContent,
    ).toBe("beta");
  });

  it("routes plus to the active project when Traditional mounts on a later tab", async () => {
    await page.viewport(1280, 700);
    await act(async () => {
      root.unmount();
      root = createRoot(container);
      root.render(
        <TraditionalProjectsFixture
          initialActiveSessionId="beta-1"
          initialCurrentProjectName="alpha"
        />,
      );
    });
    await vi.waitFor(() =>
      expect(
        document.querySelector('[role="tab"][aria-selected="true"]')
          ?.textContent,
      ).toContain("beta"),
    );
    await userEvent.click(
      page.getByRole("button", { name: "New terminal in selected project" }),
    );
    expect(
      document.querySelector('[data-testid="fixture-new-terminal-project"]')
        ?.textContent,
    ).toBe("beta");
  });

  it("keeps explicit terminal selection as the plus target when global sync is off", async () => {
    await page.viewport(1280, 700);
    await act(async () => {
      root.unmount();
      root = createRoot(container);
      root.render(
        <TraditionalProjectsFixture
          syncWorkspaceProjectOnTerminalSelection={false}
        />,
      );
    });
    await selectProject("beta");
    expect(
      document.querySelector('[data-testid="fixture-current-project"]')
        ?.textContent,
    ).toBe("alpha");
    await userEvent.click(
      page.getByRole("button", { name: "New terminal in selected project" }),
    );
    expect(
      document.querySelector('[data-testid="fixture-new-terminal-project"]')
        ?.textContent,
    ).toBe("beta");
    await userEvent.click(
      page
        .getByTestId("multi-terminal-display-surface")
        .getByRole("button", { name: "New Terminal" }),
    );
    expect(
      document.querySelector('[data-testid="fixture-new-terminal-project"]')
        ?.textContent,
    ).toBe("beta");
  });

  it("routes plus to the latest global project after repeated changes", async () => {
    await page.viewport(1280, 700);
    await act(async () => {
      root.unmount();
      root = createRoot(container);
      root.render(
        <TraditionalProjectsFixture
          syncWorkspaceProjectOnTerminalSelection={false}
        />,
      );
    });
    await selectProject("beta");
    expect(
      document.querySelector('[data-testid="fixture-current-project"]')
        ?.textContent,
    ).toBe("alpha");
    await userEvent.click(page.getByTestId("select-global-beta-project"));
    await userEvent.click(page.getByTestId("select-global-alpha-project"));
    await userEvent.click(
      page.getByRole("button", { name: "New terminal in selected project" }),
    );
    expect(
      document.querySelector('[data-testid="fixture-new-terminal-project"]')
        ?.textContent,
    ).toBe("alpha");
    await userEvent.click(
      page
        .getByTestId("multi-terminal-display-surface")
        .getByRole("button", { name: "New Terminal" }),
    );
    expect(
      document.querySelector('[data-testid="fixture-new-terminal-project"]')
        ?.textContent,
    ).toBe("alpha");
  });

  it("routes plus to free terminals when the global project is cleared", async () => {
    await page.viewport(1280, 700);
    await userEvent.click(page.getByTestId("clear-global-project"));
    expect(
      document.querySelector('[data-testid="fixture-current-project"]')
        ?.textContent,
    ).toBe("");
    await userEvent.click(
      page.getByRole("button", { name: "New terminal in selected project" }),
    );
    expect(
      document.querySelector('[data-testid="fixture-new-terminal-project"]')
        ?.textContent,
    ).toBe("free");
    await userEvent.click(
      page
        .getByTestId("multi-terminal-display-surface")
        .getByRole("button", { name: "New Terminal" }),
    );
    expect(
      document.querySelector('[data-testid="fixture-new-terminal-project"]')
        ?.textContent,
    ).toBe("free");
  });
  it("does not keep a project green after its session disappears", async () => {
    await page.viewport(1280, 700);
    const alphaProjectTab = document.querySelector<HTMLElement>(
      '[role="tab"][id$="%3Aalpha"]',
    );
    expect(alphaProjectTab?.textContent).toContain("Receiving terminal output");
    const alphaIndicator = () =>
      alphaProjectTab?.querySelector<HTMLElement>('span[aria-hidden="true"]');
    expect(alphaIndicator()?.getAttribute("title")).toBe(
      "Receiving terminal output",
    );
    expect(alphaIndicator()?.className).toContain("bg-[var(--color-success)]");

    await userEvent.click(page.getByTestId("remove-alpha-session"));

    await vi.waitFor(() => {
      expect(alphaProjectTab?.textContent).toContain(
        "No recent terminal output",
      );
      expect(alphaIndicator()?.getAttribute("title")).toBe(
        "No recent terminal output",
      );
      expect(alphaIndicator()?.className).toContain(
        "bg-[var(--color-warning)]",
      );
    });
    await expect
      .element(page.getByText("alpha first", { exact: true }))
      .toBeVisible();
  });
  it("uses the same output status for the project item", async () => {
    await page.viewport(1280, 700);
    const alphaProjectTab = document.querySelector<HTMLElement>(
      '[role="tab"][id$="%3Aalpha"]',
    );
    expect(alphaProjectTab?.textContent).toContain("Receiving terminal output");

    await userEvent.click(page.getByTestId("set-alpha-output-quiet"));

    await vi.waitFor(() => {
      expect(
        alphaProjectTab?.querySelector<HTMLElement>('span[aria-hidden="true"]'),
      ).toMatchObject({
        title: "No recent terminal output",
      });
      expect(
        alphaProjectTab?.querySelector<HTMLElement>('span[aria-hidden="true"]')
          ?.className,
      ).toContain("bg-[var(--color-warning)]");
    });
  });

  it("uses the compact Projects sheet and handles project tab lifecycle", async () => {
    await page.viewport(375, 700);
    compactState.value = true;
    await act(async () => root.render(<TraditionalProjectsFixture />));

    await expect
      .element(page.getByRole("button", { name: "Projects + Agents" }))
      .toBeVisible();
    expect(
      document
        .querySelector<HTMLButtonElement>('button[aria-haspopup="dialog"]')
        ?.getAttribute("aria-expanded"),
    ).toBe("false");
    await userEvent.click(
      page.getByRole("button", { name: "New terminal in selected project" }),
    );
    expect(
      document.querySelector('[data-testid="fixture-new-terminal-project"]')
        ?.textContent,
    ).toBe("alpha");
    const compactPanel =
      document.querySelector<HTMLElement>('[role="tabpanel"]');
    expect(compactPanel?.getAttribute("aria-label")).toBe(
      "Selected terminal project",
    );
    expect(compactPanel?.getAttribute("aria-labelledby")).toBeNull();
    await userEvent.click(page.getByRole("button", { name: "Projects + Agents" }));
    await expect.element(page.getByRole("dialog")).toBeVisible();
    expect(
      document
        .querySelector<HTMLButtonElement>('button[aria-haspopup="dialog"]')
        ?.getAttribute("aria-expanded"),
    ).toBe("true");
    await userEvent.click(page.getByRole("tab", { name: /beta/ }));
    await vi.waitFor(() =>
      expect(document.querySelector('[role="dialog"]')).toBeNull(),
    );
    await expect
      .element(page.getByText("beta shell", { exact: true }))
      .toBeVisible();
    expect(document.body.textContent).not.toContain("alpha first");
    expect(
      document.querySelector('[data-testid="fixture-active-session"]')
        ?.textContent,
    ).toBe("beta-1");

    compactState.value = false;
    await act(async () => root.render(<TraditionalProjectsFixture />));
    await page.viewport(1280, 700);
    await selectProject("alpha");
    const closeButton = page.getByRole("button", { name: "Close terminal" });
    await expect.element(closeButton).toBeVisible();
    await userEvent.click(closeButton);
    await vi.waitFor(() =>
      expect(
        document.querySelector<HTMLElement>('[role="tab"][id$="%3Aalpha"]')
          ?.textContent,
      ).toContain("Receiving terminal output"),
    );
    await expect
      .element(page.getByText("alpha first", { exact: true }))
      .toBeVisible();
    expect(
      document.querySelector('[data-testid="terminal-pane-output-host"]')
        ?.textContent,
    ).not.toContain("alpha second");
    expect(
      document.querySelector('[data-testid="fixture-active-session"]')
        ?.textContent,
    ).toBe("alpha-1");
    expect(
      document.querySelectorAll('button[aria-label="Close terminal"]'),
    ).toHaveLength(0);

    await selectProject("beta");
    await expect
      .element(page.getByText("beta shell", { exact: true }))
      .toBeVisible();
    await userEvent.click(page.getByRole("button", { name: "Close terminal" }));
    await vi.waitFor(() =>
      expect(document.querySelector('[role="tab"][id$="%3Abeta"]')).toBeNull(),
    );
    expect(
      document.querySelector<HTMLElement>('[role="tab"][id$="%3Aalpha"]')
        ?.textContent,
    ).toContain("Receiving terminal output");
    expect(
      document.querySelector('[data-testid="fixture-active-session"]')
        ?.textContent,
    ).toBe("alpha-1");
  });

  it("selects the exact cross-project agent instead of the remembered shell and qualifies colliding remote IDs", async () => {
    await page.viewport(1280, 700);
    await mountAgents();
    const roster = page.getByRole("list", {
      name: "Observed agents in open terminals",
    });
    expect(roster.element().querySelectorAll("li")).toHaveLength(2);
    await expect
      .element(roster.getByRole("button", { name: /OMP: alpha first #1;.*Server A/ }))
      .toBeVisible();
    await expect
      .element(roster.getByRole("button", { name: /Codex, Claude: 2 agents;.*Server B/ }))
      .toBeVisible();
    expect(
      roster.getByRole("button", { name: /Codex, Claude: 2 agents;/ })
        .element()
        .querySelector('[data-testid="agent-count-badge"]')
        ?.textContent,
    ).toBe("2");
    expect(
      roster.getByRole("button", { name: /OMP: alpha first #1;/ })
        .element()
        .querySelector('[data-testid="agent-count-badge"]')
        ?.textContent,
    ).toBe("1");
    const nativeRow = roster
      .getByRole("button", { name: /Codex, Claude: 2 agents;/ })
      .element();
    const descriptionId = nativeRow.getAttribute("aria-describedby")!;
    expect(document.getElementById(descriptionId)?.textContent).toContain(
      "Hook observation (limited coverage; quiet reasoning and long waits become Unknown)",
    );
    expect(roster.element().textContent).not.toContain("alpha second");
    expect(roster.element().textContent).not.toContain("beta shell");
    expect(agentFixtureRefs.alpha.id).toBe(agentFixtureRefs.beta.id);
    expect(terminalKey(agentFixtureRefs.alpha)).not.toBe(
      terminalKey(agentFixtureRefs.beta),
    );

    await selectProject("beta");
    await userEvent.click(page.getByText("beta shell", { exact: true }));
    await selectProject("alpha");
    await selectProject("beta");
    await expect
      .element(page.getByTestId("fixture-active-session"))
      .toHaveTextContent(terminalKey(agentFixtureRefs.betaShell));
    await selectProject("alpha");
    await userEvent.click(
      roster.getByRole("button", { name: /Codex, Claude: 2 agents;/ }),
    );
    await expect
      .element(page.getByTestId("fixture-active-session"))
      .toHaveTextContent(terminalKey(agentFixtureRefs.beta));
    expect(
      roster.getByRole("button", { name: /Codex, Claude: 2 agents;/ }).element()
        .getAttribute("aria-current"),
    ).toBe("true");
    expect(
      roster.getByRole("button", { name: /OMP: alpha first #1;/ }).element()
        .getAttribute("aria-current"),
    ).toBeNull();
    await userEvent.click(
      page.getByRole("button", { name: "New terminal in selected project" }),
    );
    await expect
      .element(page.getByTestId("fixture-new-terminal-project"))
      .toHaveTextContent("beta");
    await userEvent.click(roster.getByRole("button", { name: /OMP: alpha first #1;/ }));
    await expect
      .element(page.getByTestId("fixture-active-session"))
      .toHaveTextContent(terminalKey(agentFixtureRefs.alpha));
  });

  it("groups same-project same-status agents into one item with cycling activation and splits on status change", async () => {
    await page.viewport(1280, 700);
    await mountAgents();
    const roster = page.getByRole("list", {
      name: "Observed agents in open terminals",
    });

    // Two agents in the same project (beta) and same status (Idle) render as one item with badge 2
    const betaGroup = roster.getByRole("button", {
      name: /^Codex, Claude: 2 agents;.*Project: beta;/,
    });
    await expect.element(betaGroup).toBeVisible();
    const badge = betaGroup.element().querySelector('[data-testid="agent-count-badge"]');
    expect(badge?.textContent).toBe("2");
    // Clicking it selects the first member (Codex: agentFixtureRefs.beta)
    await userEvent.click(betaGroup);
    await expect
      .element(page.getByTestId("fixture-active-session"))
      .toHaveTextContent(terminalKey(agentFixtureRefs.beta));

    // Clicking again selects the second member (Claude: agentFixtureRefs.claude)
    await userEvent.click(betaGroup);
    await expect
      .element(page.getByTestId("fixture-active-session"))
      .toHaveTextContent(terminalKey(agentFixtureRefs.claude));

    // Changing one agent's status splits it into two items with badges 1 and 1
    await act(async () => {
      updateTraditionalAgentFixtureStatus(agentFixtureRefs.claude, {
        state: "working",
        turnId: "claude-turn",
      });
    });

    const codexRow = roster.getByRole("button", {
      name: /^Codex: beta agent #2;.*Project: beta;/,
    });
    const claudeRow = roster.getByRole("button", {
      name: /^Claude: beta Claude #3;.*Project: beta;/,
    });
    await expect.element(codexRow).toBeVisible();
    await expect.element(claudeRow).toBeVisible();
    expect(
      codexRow.element().querySelector('[data-testid="agent-count-badge"]')?.textContent,
    ).toBe("1");
    expect(
      claudeRow.element().querySelector('[data-testid="agent-count-badge"]')?.textContent,
    ).toBe("1");
  });

  it("activates the existing nonfocused split pane without changing membership, layout or terminal hosts", async () => {
    await page.viewport(1280, 700);
    await mountAgents();
    await userEvent.click(page.getByText("alpha second", { exact: true }));
    await dragSecondTraditionalTerminalToRight();
    await vi.waitFor(() =>
      expect(
        document.querySelectorAll('[data-testid="terminal-pane-output-host"]'),
      ).toHaveLength(2),
    );
    const hosts = Array.from(
      document.querySelectorAll('[data-testid="terminal-pane-output-host"]'),
    );
    const layoutKey = traditionalTerminalLayoutStorageKey(
      projectKey({ profileId: agentFixtureRefs.alpha.profileId, project: "alpha" }),
    );
    const before = JSON.parse(localStorage.getItem(layoutKey)!);
    const focusedBefore = hosts.find((host) =>
      host.closest(".border")?.className.includes("border-[var(--color-primary)]/60"),
    );
    expect(focusedBefore).toBe(hosts[1]);
    const visibleBefore = page.getByTestId("fixture-visible-sessions")
      .element().textContent;
    await userEvent.click(page.getByRole("button", { name: /OMP: alpha first #1;/ }));
    await expect
      .element(page.getByTestId("fixture-active-session"))
      .toHaveTextContent(terminalKey(agentFixtureRefs.alpha));
    await vi.waitFor(() => {
      const after = JSON.parse(localStorage.getItem(layoutKey)!);
      expect(after.root).toEqual(before.root);
      const focusedAfter = hosts.find((host) =>
        host.closest(".border")?.className.includes("border-[var(--color-primary)]/60"),
      );
      expect(focusedAfter).toBe(hosts[0]);
      expect(focusedAfter).not.toBe(focusedBefore);
    });
    expect(
      Array.from(document.querySelectorAll('[data-testid="terminal-pane-output-host"]')),
    ).toEqual(hosts);
    expect(page.getByTestId("fixture-visible-sessions").element().textContent)
      .toBe(visibleBefore);
    await selectProject("beta");
    await selectProject("alpha");
    expect(document.querySelectorAll('[data-testid="terminal-pane-output-host"]'))
      .toHaveLength(2);
    expect(JSON.parse(localStorage.getItem(layoutKey)!).root).toEqual(before.root);
  });

  it.each([
    ["another profile's qualified metadata", "mismatch-agent-metadata"],
    ["a raw-ID alternate instead of application metadata", "raw-agent-metadata"],
  ])("rejects %s without forwarding a retained row action", async (_label, control) => {
    await mountAgents();
    const staleActivate = retainAgentActivation(
      page.getByRole("button", { name: /OMP: alpha first #1;/ }).element(),
    );
    await selectProject("beta");
    await userEvent.click(page.getByTestId(control));
    expect(
      useAgentStatusStore.getState().profiles
        .get(agentFixtureRefs.alpha.profileId)?.rows.has(agentFixtureRefs.alpha.id),
    ).toBe(true);
    expect(document.querySelector('button[aria-label^="OMP: alpha first #1;"]'))
      .toBeNull();
    const selectionCount = page.getByTestId("fixture-selection-count")
      .element().textContent;
    const activeId = page.getByTestId("fixture-active-session").element().textContent;
    await act(async () => staleActivate());
    expect(page.getByTestId("fixture-selection-count").element().textContent)
      .toBe(selectionCount);
    expect(page.getByTestId("fixture-active-session").element().textContent)
      .toBe(activeId);
    await expect
      .element(page.getByRole("button", { name: /Codex, Claude: 2 agents;/ }))
      .toBeVisible();
  });

  it("rejects a retained agent callback after terminal removal", async () => {
    await mountAgents();
    const staleActivate = retainAgentActivation(
      page.getByRole("button", { name: /OMP: alpha first #1;/ }).element(),
    );
    await userEvent.click(page.getByTestId("remove-agent-terminal"));
    const selectionCount = page.getByTestId("fixture-selection-count")
      .element().textContent;
    const activeId = page.getByTestId("fixture-active-session").element().textContent;
    expect(
      document.querySelector('button[aria-label^="OMP: alpha first #1;"]'),
    ).toBeNull();
    await act(async () => staleActivate());
    expect(page.getByTestId("fixture-selection-count").element().textContent)
      .toBe(selectionCount);
    expect(page.getByTestId("fixture-active-session").element().textContent)
      .toBe(activeId);
  });

  it("rejects the old incarnation callback after restart but allows the new row", async () => {
    await mountAgents();
    const oldButton = page.getByRole("button", { name: /OMP: alpha first #1;/ }).element();
    const staleActivate = retainAgentActivation(oldButton);
    await selectProject("beta");
    await userEvent.click(page.getByTestId("restart-agent-terminal"));
    const replacement = page.getByRole("button", { name: /OMP: alpha first #1;/ }).element();
    expect(replacement).toBe(oldButton);
    const selectionCount = page.getByTestId("fixture-selection-count")
      .element().textContent;
    const activeId = page.getByTestId("fixture-active-session").element().textContent;
    await act(async () => staleActivate());
    expect(page.getByTestId("fixture-selection-count").element().textContent)
      .toBe(selectionCount);
    expect(page.getByTestId("fixture-active-session").element().textContent)
      .toBe(activeId);
    await userEvent.click(replacement);
    await expect
      .element(page.getByTestId("fixture-active-session"))
      .toHaveTextContent(terminalKey(agentFixtureRefs.alpha));
  });

  it("rejects a retained callback when the mounted terminal is no longer live", async () => {
    await mountAgents();
    const staleActivate = retainAgentActivation(
      page.getByRole("button", { name: /OMP: alpha first #1;/ }).element(),
    );
    await selectProject("beta");
    await userEvent.click(page.getByTestId("stop-agent-terminal"));
    expect(
      useAgentStatusStore.getState().profiles
        .get(agentFixtureRefs.alpha.profileId)?.rows.has(agentFixtureRefs.alpha.id),
    ).toBe(true);
    expect(document.querySelector('button[aria-label^="OMP: alpha first #1;"]')).toBeNull();
    const selectionCount = page.getByTestId("fixture-selection-count")
      .element().textContent;
    const activeId = page.getByTestId("fixture-active-session").element().textContent;
    await act(async () => staleActivate());
    expect(page.getByTestId("fixture-selection-count").element().textContent)
      .toBe(selectionCount);
    expect(page.getByTestId("fixture-active-session").element().textContent)
      .toBe(activeId);
  });

  it("uses the latest tab handler when a retained callback still names the same live incarnation", async () => {
    await mountAgents({ syncWorkspaceProjectOnTerminalSelection: false });
    const retainedActivate = retainAgentActivation(
      page.getByRole("button", { name: /OMP: alpha first #1;/ }).element(),
    );
    await selectProject("beta");
    await userEvent.click(page.getByTestId("select-global-beta-project"));
    await act(async () =>
      updateTraditionalAgentFixtureStatus(agentFixtureRefs.alpha, {
        state: "working",
        turnId: "fixture-next-turn",
      }),
    );
    await act(async () => retainedActivate());
    await expect.element(page.getByTestId("fixture-active-session"))
      .toHaveTextContent(terminalKey(agentFixtureRefs.alpha));
    await expect.element(page.getByTestId("fixture-current-project"))
      .toHaveTextContent("beta");
    await userEvent.click(page.getByRole("button", { name: "New terminal in selected project" }));
    await expect.element(page.getByTestId("fixture-new-terminal-project"))
      .toHaveTextContent("alpha");
  });

  it("preserves focused row and xterm through same-membership metadata rebuilds and status updates", async () => {
    await page.viewport(1280, 700);
    await mountAgents();
    const ref = agentFixtureRefs.alpha;
    const id = terminalKey(ref);
    const host = page.getByTestId("terminal-pane-output-host").element();
    const boundary = document.createElement("div");
    boundary.style.cssText = "position:absolute;inset:0";
    host.append(boundary);
    const terminal = new Terminal({ cols: 80, rows: 24, fontSize: 13 });
    const fitAddon = new FitAddon();
    const searchAddon = new SearchAddon();
    terminal.loadAddon(fitAddon);
    terminal.loadAddon(searchAddon);
    terminal.open(boundary);
    const find = new TerminalFindController(searchAddon);
    const focus = vi.spyOn(terminal, "focus");
    const fit = vi.spyOn(fitAddon, "fit");
    // Drain the real attachment scheduler and the following rendering frame;
    // no timers, polling, synthetic focus replacement or inert fit mock.
    const settleTerminalFrames = () => act(async () => {
      await new Promise<void>((resolve) =>
        requestAnimationFrame(() => requestAnimationFrame(() => resolve())),
      );
    });
    try {
      let entry!: TerminalEntry;
      await act(async () => {
        entry = registerTerminal(ref, terminal, fitAddon, find, boundary);
      });
      await settleTerminalFrames();
      const xterm = terminal.element!;
      const input = xterm.querySelector<HTMLTextAreaElement>(".xterm-helper-textarea")!;
      // Positive control: PaneContainer's registry subscription invokes real
      // attachment -> scheduled fit({focus:true}) -> actual xterm input focus.
      expect(vi.mocked(attachTerminalsToHost)).toHaveBeenCalledWith(
        expect.objectContaining({ host, activeSessionId: id, suppressTerminalFocus: false }),
      );
      expect(vi.mocked(scheduleTerminalFit)).toHaveBeenCalledWith(entry, { focus: true });
      expect(fit).toHaveBeenCalled();
      expect(focus).toHaveBeenCalled();
      expect(document.activeElement).toBe(input);
      expect(boundary.parentElement).toBe(host);
      await new Promise<void>((resolve) => terminal.write("metadata-focus-buffer\r\n", resolve));
      terminal.select(0, 0, 8);

      const row = page.getByRole("button", { name: /OMP: alpha first #1;/ }).element();
      const list = page.getByRole("list", { name: "Observed agents in open terminals" }).element();
      const buttons = Array.from(list.querySelectorAll("button"));
      const activeId = page.getByTestId("fixture-active-session").element().textContent;
      const selectionCount = page.getByTestId("fixture-selection-count").element().textContent;
      const visibleIds = page.getByTestId("fixture-visible-sessions").element().textContent;
      const layoutKey = traditionalTerminalLayoutStorageKey(
        projectKey({ profileId: ref.profileId, project: "alpha" }),
      );
      const layout = localStorage.getItem(layoutKey);
      const geometry = host.getBoundingClientRect().toJSON();
      const buffer = terminal.buffer.active;
      const contents = Array.from(
        { length: buffer.length },
        (_, index) => buffer.getLine(index)?.translateToString(),
      );
      const terminalSelection = terminal.getSelection();
      expect(contents.join("\n")).toContain("metadata-focus-buffer");
      expect(terminalSelection).toBe("metadata");
      const attachmentsBefore = vi.mocked(attachTerminalsToHost).mock.calls.length;
      const schedulesBefore = vi.mocked(scheduleTerminalFit).mock.calls.length;
      const fitsBefore = fit.mock.calls.length;
      const focusBefore = focus.mock.calls.length;
      await act(async () => row.focus());
      expect(document.activeElement).toBe(row);
      expect(row.textContent).toContain("Done (turn ended)");
      expect(row.querySelector('[title^="Last turn ended"]')).not.toBeNull();
      let previousRow = row;
      let metadataRevision = 0;
      for (const { patch, label, unchanged } of [
        { patch: {}, label: "Idle", unchanged: true },
        { patch: { state: "working" as const, turnId: "fixture-turn" }, label: "Working" },
        { patch: { state: "blocked" as const, reason: "approval" as const }, label: "Needs attention: Approval" },
        { patch: { state: "unknown" as const, turnId: undefined }, label: "Unknown" },
        { patch: { state: "idle" as const, lastOutcome: "interrupted" as const }, label: "Idle" },
        { patch: { state: "unknown" as const, lastOutcome: "ended" as const }, label: "Unknown" },
        { patch: { state: "idle" as const, turnId: undefined, reason: undefined,
            lastOutcome: "ended" as const }, label: "Idle" },
      ]) {
        metadataRevision += 1;
        await act(async () => {
          if (Object.keys(patch).length > 0) {
            updateTraditionalAgentFixtureStatus(ref, patch);
          }
          // First republish tabs/groups only, then canonical mounted names too,
          // as session hydration after a public rename does. Neither publication
          // changes registered owner, live PTY membership or incarnation.
          root.render(
            <TraditionalProjectsFixture
              withAgents
              terminalMetadataRevision={metadataRevision}
              republishMountedMetadata={metadataRevision > 4}
            />,
          );
        });
        await settleTraditionalFixtureQueries();
        await settleTerminalFrames();
        // Actual pane-tab title, not a fixture revision echo, proves metadata arrived.
        expect(page.getByText(`alpha metadata ${metadataRevision}`, { exact: true }).element()).toBeVisible();
        const currentRow = page.getByRole("button", { name: /OMP: alpha first #1;/ }).element();
        expect(currentRow.getAttribute("aria-label")).toContain(label);
        if (unchanged) {
          expect(currentRow).toBe(previousRow);
          expect(document.activeElement).toBe(currentRow);
          expect(Array.from(list.querySelectorAll("button"))).toEqual(buttons);
        } else {
          expect(currentRow).not.toBe(previousRow);
          expect(document.activeElement).not.toBe(currentRow);
          expect(list.querySelectorAll("button")).toHaveLength(2);
          expect(list.querySelectorAll("button")[1]).toBe(buttons[1]);
        }
        previousRow = currentRow;
        expect(currentRow.textContent?.includes("Done (turn ended)")).toBe(metadataRevision === 1 || metadataRevision === 7);
        expect(getTerminal(ref)).toBe(entry);
        expect(terminal.element).toBe(xterm);
        expect(host.querySelector(".xterm")).toBe(xterm);
        expect(xterm.querySelector(".xterm-helper-textarea")).toBe(input);
        expect(boundary.parentElement).toBe(host);
        expect(page.getByTestId("terminal-pane-output-host").element()).toBe(host);
        expect(host.getBoundingClientRect().toJSON()).toEqual(geometry);
        expect(terminal.buffer.active).toBe(buffer);
        expect(Array.from(
          { length: terminal.buffer.active.length },
          (_, index) => terminal.buffer.active.getLine(index)?.translateToString(),
        )).toEqual(contents);
        expect(terminal.getSelection()).toBe(terminalSelection);
        expect(localStorage.getItem(layoutKey)).toBe(layout);
        expect(page.getByTestId("fixture-active-session").element().textContent).toBe(activeId);
        expect(page.getByTestId("fixture-selection-count").element().textContent).toBe(selectionCount);
        expect(page.getByTestId("fixture-visible-sessions").element().textContent).toBe(visibleIds);
        expect(vi.mocked(attachTerminalsToHost)).toHaveBeenCalledTimes(attachmentsBefore);
        expect(vi.mocked(scheduleTerminalFit)).toHaveBeenCalledTimes(schedulesBefore);
        expect(fit).toHaveBeenCalledTimes(fitsBefore);
        expect(focus).toHaveBeenCalledTimes(focusBefore);
      }
    } finally {
      await act(async () => removeTerminal(ref));
      focus.mockRestore();
      fit.mockRestore();
      find.dispose();
      terminal.dispose();
      boundary.remove();
    }
  });

  it("reacts to generation-only replacement before the status bridge and waits for a fresh baseline", async () => {
    notificationPolicy.agents.omp.enabled = true;
    await mountAgents();
    const previousProfiles = useAgentStatusStore.getState().profiles;
    const owner = { profileId: agentFixtureRefs.alpha.profileId, generation: 2 };
    await act(async () =>
      __setConnectionSnapshotForTests(owner.profileId, { owner, status: "connected" }),
    );
    expect(useAgentStatusStore.getState().profiles).toBe(previousProfiles);
    const unavailableRow = page.getByRole("button", { name: /OMP: alpha first #1;/ }).element();
    expect(unavailableRow.textContent).toContain("Unavailable");
    expect(unavailableRow.textContent).not.toContain("Done (turn ended)");
    await act(async () => beginAgentStatusConnection(owner));
    expect(page.getByRole("button", { name: /OMP: alpha first #1;/ }).element().textContent).toContain("Unavailable");
    const retained = useAgentStatusStore.getState().profiles.get(owner.profileId)!;
    await act(async () =>
      installAgentStatusSnapshot(owner, {
        version: 1,
        serverEpoch: 2,
        revision: 0,
        availability: "ready",
        terminals: [...retained.rows.values()],
      }),
    );
    const idleRow = page.getByRole("button", { name: /OMP: alpha first #1;/ }).element();
    expect(idleRow.textContent).toContain("Idle");
    expect(idleRow.textContent).toContain("Done (turn ended)");
    await act(async () =>
      __setConnectionSnapshotForTests(owner.profileId, { status: "disconnected" }),
    );
    const disconnectedRow = page.getByRole("button", { name: /OMP: alpha first #1;/ }).element();
    expect(disconnectedRow.textContent).toContain("Unavailable");
    expect(disconnectedRow.textContent).not.toContain("Done (turn ended)");
    expect(vi.mocked(notifyTerminalAgent)).not.toHaveBeenCalled();
    expect(vi.mocked(playTerminalNotificationSound)).not.toHaveBeenCalled();
    expect(useTerminalNotificationsStore.getState().notifications).toHaveLength(0);
  });

  it("prunes authoritative snapshot membership and rejects its retained row callback", async () => {
    await mountAgents();
    const staleActivate = retainAgentActivation(
      page.getByRole("button", { name: /OMP: alpha first #1;/ }).element(),
    );
    const owner = getConnectionSnapshot(agentFixtureRefs.alpha.profileId)!.owner;
    await act(async () =>
      installAgentStatusSnapshot(owner, {
        version: 1,
        serverEpoch: 2,
        revision: 0,
        availability: "ready",
        terminals: [],
      }),
    );
    expect(document.querySelector('button[aria-label^="OMP: alpha first #1;"]')).toBeNull();
    const selectionCount = page.getByTestId("fixture-selection-count")
      .element().textContent;
    await act(async () => staleActivate());
    expect(page.getByTestId("fixture-selection-count").element().textContent)
      .toBe(selectionCount);
    expect(
      page.getByRole("list", { name: "Observed agents in open terminals" })
        .element().querySelectorAll("li"),
    ).toHaveLength(1);
    await expect
      .element(page.getByRole("button", { name: /Codex, Claude: 2 agents;/ }))
      .toBeVisible();
    await expect.element(page.getByText("alpha first", { exact: true })).toBeVisible();
  });

  it("shows live status and ended facts even when notification policies are disabled", async () => {
    await mountAgents();
    const owner = getConnectionSnapshot(agentFixtureRefs.alpha.profileId)!.owner;
    const profile = useAgentStatusStore.getState().profiles.get(owner.profileId)!;
    const initialRow = profile.rows.get(agentFixtureRefs.alpha.id)!;
    expect(notificationPolicy.agents.omp.enabled).toBe(false);
    await act(async () => {
      expect(
        applyAgentStatusChanged(owner, {
          serverEpoch: profile.epoch!,
          revision: profile.revision + 1,
          row: { ...initialRow, state: "working", turnId: "fixture-turn" },
        }),
      ).toBe("applied");
    });
    const workingRow = page.getByRole("button", { name: /OMP: alpha first #1;/ }).element();
    expect(workingRow.textContent).toContain("Working");
    expect(workingRow.textContent).not.toContain("Done (turn ended)");
    await act(async () => {
      expect(
        applyAgentStatusChanged(owner, {
          serverEpoch: profile.epoch!,
          revision: profile.revision + 2,
          row: { ...initialRow, attentionRevision: 1 },
          attention: {
            id: `${profile.epoch}:${initialRow.id}:${initialRow.incarnation}:1`,
            kind: "turn-ended",
            terminalId: initialRow.id,
            incarnation: initialRow.incarnation,
            agentKind: initialRow.agentKind,
            agentSessionId: initialRow.agentSessionId,
            attentionRevision: 1,
            outcome: "ended",
            timestampMs: Date.now(),
          },
        }),
      ).toBe("applied");
    });
    const idleRow = page.getByRole("button", { name: /OMP: alpha first #1;/ }).element();
    expect(idleRow.textContent).toContain("Idle");
    expect(idleRow.textContent).toContain("Done (turn ended)");
    expect(useTerminalNotificationsStore.getState().notifications).toHaveLength(0);
    expect(useTerminalNotificationsStore.getState().toasts).toHaveLength(0);
    expect(vi.mocked(notifyTerminalAgent)).not.toHaveBeenCalled();
    expect(vi.mocked(playTerminalNotificationSound)).not.toHaveBeenCalled();
    expect(notificationPolicy.agents.omp.enabled).toBe(false);
  });

  it("targets the selected registered profile in Settings despite ambient A and retains disconnected B", async () => {
    await mountAgents();
    await selectProject("beta");
    expect(getActiveProfileId()).toBe(agentFixtureRefs.alpha.profileId);
    const href = `/agent-store?tab=settings&profileId=${encodeURIComponent(agentFixtureRefs.beta.profileId)}`;
    expect(page.getByRole("link", { name: "Agent Settings" }).element()
      .getAttribute("href")).toBe(href);
    await act(async () =>
      __setConnectionSnapshotForTests(agentFixtureRefs.beta.profileId, {
        status: "disconnected",
      }),
    );
    expect(page.getByRole("link", { name: "Agent Settings" }).element()
      .getAttribute("href")).toBe(href);
    await userEvent.click(page.getByRole("link", { name: "Agent Settings" }));
    await expect.element(page.getByTestId("fixture-route")).toHaveTextContent(href);
    expect(getActiveProfileId()).toBe(agentFixtureRefs.alpha.profileId);
    await act(async () =>
      saveProfiles(getProfiles().filter((profile) =>
        profile.id !== agentFixtureRefs.beta.profileId,
      )),
    );
    expect(page.getByRole("link", { name: "Agent Settings" }).element()
      .getAttribute("href")).toBe("/agent-store?tab=settings");
    expect(
      document.querySelector('button[aria-label^="Codex, Claude: 2 agents;"]'),
    ).toBeNull();
    expect(
      document.querySelector('button[aria-label^="Codex: beta agent #2;"]'),
    ).toBeNull();
    expect(
      document.querySelector('button[aria-label^="Claude: beta Claude #3;"]'),
    ).toBeNull();
  });

  it("reactively updates registered profile labels without replacing focused rows", async () => {
    await mountAgents();
    const row = page.getByRole("button", { name: /OMP: alpha first #1;/ }).element();
    await act(async () => row.focus());
    await act(async () =>
      saveProfiles(getProfiles().map((profile) =>
        profile.id === agentFixtureRefs.alpha.profileId
          ? { ...profile, name: "Renamed server A" }
          : profile,
      )),
    );
    expect(row.getAttribute("aria-label")).toContain("Renamed server A");
    expect(document.activeElement).toBe(row);
    await expect
      .element(page.getByRole("tab", { name: /alpha.*Renamed server A/ }))
      .toBeVisible();
  });

  it.each([320, 375, 390])(
    "keeps compact sheet and add actions clickable beside the default floating Panels geometry at %ipx",
    async (width) => {
      await page.viewport(width, 844);
      container.style.width = `${width}px`;
      compactState.value = true;
      await mountAgents();
      const opener = page.getByRole("button", { name: "Projects + Agents" });
      const add = page.getByRole("button", { name: "New terminal in selected project" });
      const toolbar = opener.element().parentElement!;
      const toolbarRect = toolbar.getBoundingClientRect();
      // Geometry-only regression for the separately owned shell's default
      // leading floating control; real-shell qualification remains app E2E.
      const panels = document.createElement("button");
      panels.textContent = "Panels";
      panels.style.cssText =
        `position:fixed;left:12px;top:${toolbarRect.top}px;width:148px;height:44px;z-index:40`;
      document.body.append(panels);
      try {
        const openerRect = opener.element().getBoundingClientRect();
        const addRect = add.element().getBoundingClientRect();
        expect(openerRect.top).toBeGreaterThanOrEqual(addRect.bottom);
        for (const target of [opener.element(), add.element()]) {
          const rect = target.getBoundingClientRect();
          expect(rect.height).toBeGreaterThanOrEqual(44);
          expect(rect.width).toBeGreaterThanOrEqual(44);
          expect(target.contains(document.elementFromPoint(
            rect.left + rect.width / 2,
            rect.top + rect.height / 2,
          ))).toBe(true);
        }
        await userEvent.click(add);
        await expect.element(page.getByTestId("fixture-new-terminal-project"))
          .toHaveTextContent("alpha");
        await userEvent.click(opener);
        await expect.element(page.getByRole("dialog", { name: "Projects + Agents" }))
          .toBeVisible();
        await userEvent.keyboard("{Escape}");
        await waitForProjectsSheetDismissal(opener.element());
      } finally {
        panels.remove();
      }
    },
  );

  it("traps compact keyboard focus, sizes every local target, and restores the opener after Escape, Close and project Arrow selection", async () => {
    await page.viewport(375, 700);
    container.style.width = "375px";
    compactState.value = true;
    await mountAgents();
    const opener = page.getByRole("button", { name: "Projects + Agents" });
    for (const target of [
      opener.element(),
      page.getByRole("button", { name: "New terminal in selected project" }).element(),
    ]) {
      expect(target.getBoundingClientRect().height).toBeGreaterThanOrEqual(44);
      expect(target.getBoundingClientRect().width).toBeGreaterThanOrEqual(44);
    }
    await act(async () => opener.element().focus());
    await userEvent.keyboard("{Enter}");
    const dialog = page.getByRole("dialog", { name: "Projects + Agents" });
    await expect.element(dialog).toBeVisible();
    await expect.element(dialog.getByRole("heading", { name: "projects", exact: true }))
      .toBeVisible();
    await expect.element(dialog.getByRole("heading", { name: "agents", exact: true }))
      .toBeVisible();
    for (const target of dialog.element().querySelectorAll<HTMLElement>("button, a[href]")) {
      expect(target.getBoundingClientRect().height).toBeGreaterThanOrEqual(44);
      expect(target.getBoundingClientRect().width).toBeGreaterThanOrEqual(44);
    }
    const focusable = Array.from(
      dialog.element().querySelectorAll<HTMLElement>("button, a[href], [tabindex]"),
    ).filter((target) => target.tabIndex >= 0 && target.getClientRects().length > 0);
    await act(async () => focusable.at(-1)!.focus());
    await userEvent.keyboard("{Tab}");
    expect(dialog.element().contains(document.activeElement)).toBe(true);
    await act(async () => focusable[0]!.focus());
    await userEvent.keyboard("{Shift>}{Tab}{/Shift}");
    expect(dialog.element().contains(document.activeElement)).toBe(true);
    await userEvent.keyboard("{Escape}");
    await waitForProjectsSheetDismissal(opener.element());
    await userEvent.click(opener);
    await userEvent.click(dialog.getByRole("button", { name: "Close", exact: true }));
    await waitForProjectsSheetDismissal(opener.element());
    await userEvent.click(opener);
    await act(async () => dialog.getByRole("tab", { name: /alpha/ }).element().focus());
    await userEvent.keyboard("{ArrowDown}");
    await waitForProjectsSheetDismissal(opener.element());
    await expect.element(page.getByTestId("fixture-active-session"))
      .toHaveTextContent(terminalKey(agentFixtureRefs.claude));
  });

  it("activates compact agents with Enter and Space, dismisses and restores opener without another terminal mount", async () => {
    await page.viewport(375, 700);
    container.style.width = "375px";
    compactState.value = true;
    await mountAgents();
    const opener = page.getByRole("button", { name: "Projects + Agents" });
    const dialog = page.getByRole("dialog", { name: "Projects + Agents" });
    await userEvent.click(opener);
    const alphaHost = document.querySelector('[data-testid="terminal-pane-output-host"]');
    await act(async () =>
      dialog.getByRole("button", { name: /OMP: alpha first #1;/ }).element().focus(),
    );
    await userEvent.keyboard("{Enter}");
    await waitForProjectsSheetDismissal(opener.element());
    expect(document.querySelector('[data-testid="terminal-pane-output-host"]')).toBe(alphaHost);
    await userEvent.click(opener);
    await act(async () =>
      dialog.getByRole("button", { name: /Codex, Claude: 2 agents;/ }).element().focus(),
    );
    await userEvent.keyboard(" ");
    await waitForProjectsSheetDismissal(opener.element());
    await expect.element(page.getByTestId("fixture-active-session"))
      .toHaveTextContent(terminalKey(agentFixtureRefs.beta));
    expect(document.querySelectorAll('[data-testid="terminal-pane-output-host"]')).toHaveLength(1);
    await userEvent.click(page.getByRole("button", { name: "New terminal in selected project" }));
    await expect.element(page.getByTestId("fixture-new-terminal-project")).toHaveTextContent("beta");
  });

  it("selects a feature worktree target then returns to root, preserving running session tabs, active splits, and distinct project context", async () => {
    await page.viewport(1280, 700);
    container.style.width = "1280px";

    const alphaCombobox = page.getByRole("combobox", {
      name: "Worktree for alpha: root",
    });
    await expect.element(alphaCombobox).toBeVisible();

    await expect
      .element(page.getByTestId("fixture-active-session"))
      .toHaveTextContent("alpha-1");

    await userEvent.click(alphaCombobox);

    await expect
      .element(page.getByRole("option", { name: /Project root/ }))
      .toBeVisible();
    await expect
      .element(page.getByRole("option", { name: /feature\/alpha-ui/ }))
      .toBeVisible();
    await expect
      .element(page.getByRole("option", { name: /Detached HEAD/ }))
      .toBeVisible();
    await expect
      .element(page.getByRole("option", { name: /feature\/locked/ }))
      .toBeVisible();

    await userEvent.click(
      page.getByRole("option", { name: /feature\/alpha-ui/ }),
    );

    await expect
      .element(
        page.getByRole("combobox", {
          name: "Worktree for alpha: feature/alpha-ui (alpha-feat)",
        }),
      )
      .toBeVisible();

    expect(
      useProjectTargetStore.getState().activeTargetByProject["alpha"],
    ).toBe("/workspace/alpha-feat");

    await expect
      .element(
        page.getByRole("combobox", { name: "Worktree for beta: root" }),
      )
      .toBeVisible();
    expect(
      useProjectTargetStore.getState().activeTargetByProject["beta"],
    ).toBeUndefined();

    await expect
      .element(page.getByTestId("fixture-active-session"))
      .toHaveTextContent("alpha-1");
    await expect
      .element(page.getByText("alpha first", { exact: true }))
      .toBeVisible();
    await expect
      .element(page.getByText("alpha second", { exact: true }))
      .toBeVisible();

    const updatedCombobox = page.getByRole("combobox", {
      name: "Worktree for alpha: feature/alpha-ui (alpha-feat)",
    });
    await userEvent.click(updatedCombobox);
    await userEvent.click(
      page.getByRole("option", { name: /Project root/ }),
    );

    await expect
      .element(
        page.getByRole("combobox", { name: "Worktree for alpha: root" }),
      )
      .toBeVisible();
    expect(
      useProjectTargetStore.getState().activeTargetByProject["alpha"],
    ).toBeUndefined();

    await expect
      .element(page.getByTestId("fixture-active-session"))
      .toHaveTextContent("alpha-1");
  });

  it("renders and operates worktree selector when terminal commit status is disabled", async () => {
    await page.viewport(1280, 700);
    container.style.width = "1280px";
    terminalCommitStatusState.enabled = false;
    await act(async () => {
      root.unmount();
      root = createRoot(container);
      root.render(<TraditionalProjectsFixture />);
    });
    await settleTraditionalFixtureQueries();

    expect(document.querySelector('nav [role="status"]')).toBeNull();

    const alphaCombobox = page.getByRole("combobox", {
      name: "Worktree for alpha: root",
    });
    await expect.element(alphaCombobox).toBeVisible();

    await userEvent.click(alphaCombobox);
    await userEvent.click(
      page.getByRole("option", { name: /feature\/alpha-ui/ }),
    );

    await expect
      .element(
        page.getByRole("combobox", {
          name: "Worktree for alpha: feature/alpha-ui (alpha-feat)",
        }),
      )
      .toBeVisible();
    expect(
      useProjectTargetStore.getState().activeTargetByProject["alpha"],
    ).toBe("/workspace/alpha-feat");
  });

  it("navigates worktree selector via keyboard, restores focus on Escape, and does not dismiss compact Projects Dialog", async () => {
    await page.viewport(375, 700);
    container.style.width = "375px";
    compactState.value = true;
    await act(async () => {
      root.unmount();
      root = createRoot(container);
      root.render(<TraditionalProjectsFixture />);
    });
    await settleTraditionalFixtureQueries();

    const opener = page.getByRole("button", { name: "Projects + Agents" });
    await userEvent.click(opener);

    const dialog = page.getByRole("dialog", { name: "Projects + Agents" });
    await expect.element(dialog).toBeVisible();

    const alphaCombobox = dialog.getByRole("combobox", {
      name: "Worktree for alpha: root",
    });
    await expect.element(alphaCombobox).toBeVisible();

    await act(async () => alphaCombobox.element().focus());
    expect(document.activeElement).toBe(alphaCombobox.element());

    await userEvent.keyboard("{Enter}");
    await expect.element(page.getByRole("listbox")).toBeVisible();

    await userEvent.keyboard("{Escape}");
    await expect.element(page.getByRole("listbox")).not.toBeInTheDocument();
    await expect.element(dialog).toBeVisible();
    expect(document.activeElement).toBe(alphaCombobox.element());

    await userEvent.keyboard("{Enter}");
    await expect.element(page.getByRole("listbox")).toBeVisible();

    const featureOption = page.getByRole("option", { name: /feature\/alpha-ui/ });
    await userEvent.click(featureOption);
    await expect.element(page.getByRole("listbox")).not.toBeInTheDocument();
    await expect.element(dialog).toBeVisible();

    await expect
      .element(
        dialog.getByRole("combobox", {
          name: "Worktree for alpha: feature/alpha-ui (alpha-feat)",
        }),
      )
      .toBeVisible();

    await userEvent.click(dialog.getByRole("button", { name: "Close", exact: true }));
    await waitForProjectsSheetDismissal(opener.element());
  });

  it("disables unavailable, bare, and prunable worktrees, displays detached and locked states, and distinguishes same-basename paths", async () => {
    customWorktrees = {
      alpha: [
          {
            path: "/workspace/alpha",
            repositoryPath: "/workspace/alpha/.git",
            branch: "alpha/main",
            commitHash: "hash-main",
            isMain: true,
            isLocked: false,
            isDetached: false,
            isBare: false,
            isPrunable: false,
            isAvailable: true,
          },
          {
            path: "/workspace/alpha-detached",
            repositoryPath: "/workspace/alpha/.git",
            branch: null,
            commitHash: "hash-detached",
            isMain: false,
            isLocked: false,
            isDetached: true,
            isBare: false,
            isPrunable: false,
            isAvailable: true,
          },
          {
            path: "/workspace/alpha-locked",
            repositoryPath: "/workspace/alpha/.git",
            branch: "feature/locked",
            commitHash: "hash-locked",
            isMain: false,
            isLocked: true,
            isDetached: false,
            isBare: false,
            isPrunable: false,
            isAvailable: true,
          },
          {
            path: "/workspace/dir-one/feature",
            repositoryPath: "/workspace/alpha/.git",
            branch: "feature/one",
            commitHash: "hash-shared",
            isMain: false,
            isLocked: false,
            isDetached: false,
            isBare: false,
            isPrunable: false,
            isAvailable: true,
          },
          {
            path: "/workspace/dir-two/feature",
            repositoryPath: "/workspace/alpha/.git",
            branch: "feature/two",
            commitHash: "hash-shared",
            isMain: false,
            isLocked: false,
            isDetached: false,
            isBare: false,
            isPrunable: false,
            isAvailable: true,
          },
          {
            path: "/workspace/alpha-bare",
            repositoryPath: "/workspace/alpha/.git",
            branch: "feature/bare",
            commitHash: "hash-bare",
            isMain: false,
            isLocked: false,
            isDetached: false,
            isBare: true,
            isPrunable: false,
            isAvailable: true,
          },
          {
            path: "/workspace/alpha-prunable",
            repositoryPath: "/workspace/alpha/.git",
            branch: "feature/prunable",
            commitHash: "hash-prunable",
            isMain: false,
            isLocked: false,
            isDetached: false,
            isBare: false,
            isPrunable: true,
            isAvailable: false,
          },
      ],
    };

    await page.viewport(1280, 700);
    container.style.width = "1280px";
    await act(async () => {
      root.unmount();
      root = createRoot(container);
      root.render(<TraditionalProjectsFixture />);
    });
    await settleTraditionalFixtureQueries();

    const alphaCombobox = page.getByRole("combobox", {
      name: "Worktree for alpha: root",
    });
    await userEvent.click(alphaCombobox);

    const bareOption = page.getByRole("option", { name: /feature\/bare/ });
    await expect.element(bareOption).toBeDisabled();
    const prunableOption = page.getByRole("option", { name: /feature\/prunable/ });
    await expect.element(prunableOption).toBeDisabled();

    await expect
      .element(page.getByRole("option", { name: /dir-one\/feature/ }))
      .toBeVisible();
    await expect
      .element(page.getByRole("option", { name: /dir-two\/feature/ }))
      .toBeVisible();

    await userEvent.click(
      page.getByRole("option", { name: /Detached HEAD/ }),
    );
    await expect
      .element(
        page.getByRole("combobox", {
          name: "Worktree for alpha: Detached HEAD (alpha-detached)",
        }),
      )
      .toBeVisible();

    await userEvent.click(
      page.getByRole("combobox", {
        name: "Worktree for alpha: Detached HEAD (alpha-detached)",
      }),
    );
    await userEvent.click(
      page.getByRole("option", { name: /feature\/locked/ }),
    );
    await expect
      .element(
        page.getByRole("combobox", {
          name: "Worktree for alpha: feature/locked (alpha-locked)",
        }),
      )
      .toBeVisible();
  });

  it("preserves selection across refetch and discovery transport error", async () => {
    await page.viewport(1280, 700);
    container.style.width = "1280px";

    const alphaCombobox = page.getByRole("combobox", {
      name: "Worktree for alpha: root",
    });
    await userEvent.click(alphaCombobox);
    await userEvent.click(
      page.getByRole("option", { name: /feature\/alpha-ui/ }),
    );

    await expect
      .element(
        page.getByRole("combobox", {
          name: "Worktree for alpha: feature/alpha-ui (alpha-feat)",
        }),
      )
      .toBeVisible();

    worktreeDiscoveryError = new Error("Transient connection error");

    const updatedCombobox = page.getByRole("combobox", {
      name: "Worktree for alpha: feature/alpha-ui (alpha-feat)",
    });
    await userEvent.click(updatedCombobox);
    await expect.element(page.getByRole("listbox")).toBeVisible();
    await userEvent.keyboard("{Escape}");
    await expect.element(page.getByRole("listbox")).not.toBeInTheDocument();

    expect(
      useProjectTargetStore.getState().activeTargetByProject["alpha"],
    ).toBe("/workspace/alpha-feat");
    await expect
      .element(
        page.getByRole("combobox", {
          name: "Worktree for alpha: feature/alpha-ui (alpha-feat)",
        }),
      )
      .toBeVisible();

    worktreeDiscoveryError = null;
  });

  it("keeps target selection strictly scoped by profile for same-name projects", async () => {
    await page.viewport(1280, 700);
    container.style.width = "1280px";
    await mountAgents();

    const alphaCombobox = page.getByRole("combobox", {
      name: "Worktree for alpha: root",
    });
    await expect.element(alphaCombobox).toBeVisible();

    await userEvent.click(alphaCombobox);
    await userEvent.click(
      page.getByRole("option", { name: /feature\/alpha-ui/ }),
    );

    const profileKey = projectKey({
      profileId: agentFixtureRefs.alpha.profileId,
      project: "alpha",
    });
    expect(
      useProjectTargetStore.getState().activeTargetByProject[profileKey],
    ).toBe("/workspace/alpha-feat");

    const betaProfileKey = projectKey({
      profileId: agentFixtureRefs.beta.profileId,
      project: "beta",
    });
    expect(
      useProjectTargetStore.getState().activeTargetByProject[betaProfileKey],
    ).toBeUndefined();

    expect(
      useProjectTargetStore.getState().activeTargetByProject["alpha"],
    ).toBeUndefined();
  });
});
