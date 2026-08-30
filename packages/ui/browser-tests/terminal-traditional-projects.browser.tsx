import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { page, userEvent } from "vitest/browser";
import type { GitStatus, Worktree } from "@/api/client.js";
import {
  initTransport,
  resetTransport,
  type Transport,
} from "@/api/transport.js";
import {
  TraditionalProjectsFixture,
  dragSecondTraditionalTerminalToRight,
} from "./terminal-traditional-projects.browser-fixture.js";
import { traditionalTerminalLayoutStorageKey } from "@/lib/traditional-terminal-projects.js";
import "@/index.css";

const LONG_COMMIT_MESSAGE =
  "Preserve complete Traditional project commit context while resizing the terminal navigator";

const compactState = vi.hoisted(() => ({ value: false }));
const terminalCommitStatusState = vi.hoisted(() => ({ enabled: true }));

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
function worktreesFor(projectName: string): Worktree[] {
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

vi.mock("@/stores/settings.js", () => ({
  useSettingsStore: (
    selector: (state: {
      mobileCustomKeyboardEnabled: boolean;
      terminalCommitStatusEnabled: boolean;
    }) => unknown,
  ) =>
    selector({
      mobileCustomKeyboardEnabled: false,
      terminalCommitStatusEnabled: terminalCommitStatusState.enabled,
    }),
}));

vi.mock("@/contexts/AndroidChromeInputPolicyContext.js", () => ({
  useAndroidChromeInputPolicy: () => ({
    isAndroidChromeNativeInputSuppressed: false,
  }),
}));

vi.mock("@/lib/terminal-host-attachment.js", () => ({
  attachTerminalsToHost: vi.fn(),
}));

vi.mock("@/lib/terminal-fit-scheduler.js", () => ({
  cancelScheduledTerminalFit: vi.fn(),
  fitAllTerminals: vi.fn(),
  scheduleTerminalFit: vi.fn(),
}));

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

  beforeEach(async () => {
    compactState.value = false;
    terminalCommitStatusState.enabled = true;
    invoke.mockClear();
    initTransport(projectStatusTransport);
    localStorage.removeItem(
      traditionalTerminalLayoutStorageKey("project:alpha"),
    );
    localStorage.removeItem(
      traditionalTerminalLayoutStorageKey("project:beta"),
    );
    localStorage.removeItem("dam-hopper:traditional-projects-navigator-width");
    container = document.createElement("div");
    container.style.height = "640px";
    container.style.width = "1280px";
    document.body.append(container);
    root = createRoot(container);
    await act(async () => root.render(<TraditionalProjectsFixture />));
  });

  afterEach(async () => {
    await act(async () => root.unmount());
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
      'nav[aria-label="Terminal projects"]',
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
      'nav[aria-label="Terminal projects"]',
    );
    const reloadedResizeHandle = document.querySelector<HTMLElement>(
      '[data-testid="traditional-projects-resize-handle"]',
    );
    expect(reloadedNavigator?.style.width).toBe("520px");
    expect(reloadedResizeHandle?.getAttribute("aria-valuenow")).toBe("520");
    const projectTabs = document.querySelectorAll<HTMLElement>(
      'nav[aria-label="Terminal projects"] [role="tab"]',
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
    expect(alphaProjectTab?.textContent).toContain("Running terminals");
    expect(projectIndicator(alphaProjectTab)?.getAttribute("title")).toBe(
      "Running terminals",
    );
    expect(projectIndicator(alphaProjectTab)?.className).toContain(
      "bg-[var(--color-success)]",
    );
    expect(betaProjectTab?.textContent).toContain("No running terminals");
    expect(projectIndicator(betaProjectTab)?.getAttribute("title")).toBe(
      "No running terminals",
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
    expect(document.body.textContent).not.toContain("agents");
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
    expect(alphaProjectTab?.textContent).toContain("Running terminals");
    const alphaIndicator = () =>
      alphaProjectTab?.querySelector<HTMLElement>('span[aria-hidden="true"]');
    expect(alphaIndicator()?.getAttribute("title")).toBe("Running terminals");
    expect(alphaIndicator()?.className).toContain("bg-[var(--color-success)]");

    await userEvent.click(page.getByTestId("remove-alpha-session"));

    await vi.waitFor(() => {
      expect(alphaProjectTab?.textContent).toContain("No running terminals");
      expect(alphaIndicator()?.getAttribute("title")).toBe(
        "No running terminals",
      );
      expect(alphaIndicator()?.className).toContain(
        "bg-[var(--color-warning)]",
      );
    });
    await expect
      .element(page.getByText("alpha first", { exact: true }))
      .toBeVisible();
  });

  it("uses the compact Projects sheet and handles project tab lifecycle", async () => {
    await page.viewport(375, 700);
    compactState.value = true;
    await act(async () => root.render(<TraditionalProjectsFixture />));

    await expect
      .element(page.getByRole("button", { name: "Projects" }))
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
    await userEvent.click(page.getByRole("button", { name: "Projects" }));
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
      ).toContain("Running terminals"),
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
    ).toContain("Running terminals");
    expect(
      document.querySelector('[data-testid="fixture-active-session"]')
        ?.textContent,
    ).toBe("alpha-1");
  });
});
