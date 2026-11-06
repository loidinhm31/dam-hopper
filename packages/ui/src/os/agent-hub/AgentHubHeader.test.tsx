// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from "vitest";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { AgentHubHeader } from "./AgentHubHeader.js";
import type { TraditionalTerminalProjectGroup } from "@/lib/traditional-terminal-projects.js";
import type { AgentHubSummary } from "../agent-hub.js";

function makeSummary(overrides?: Partial<AgentHubSummary>): AgentHubSummary {
  return {
    total: 10,
    agentsCount: 5,
    backgroundCount: 2,
    needsAttention: 3,
    working: 4,
    idle: 2,
    unavailable: 1,
    unobserved: 0,
    connectedProfiles: 1,
    totalProfiles: 1,
    ...overrides,
  };
}

describe("AgentHubHeader", () => {
  let container: HTMLDivElement | null = null;
  let root: Root | null = null;

  beforeEach(() => {
    (globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
  });

  it("renders toggle button with correct aria attributes and triggers onToggleSidebar", () => {
    const onToggleSidebar = vi.fn();

    act(() => {
      root?.render(
        <AgentHubHeader
          sidebarHidden={false}
          selectedGroup={null}
          summary={makeSummary()}
          onToggleSidebar={onToggleSidebar}
          onOpenRecipes={() => {}}
        />,
      );
    });

    const toggleBtn = container?.querySelector("button[aria-label='Toggle projects sidebar']") as HTMLButtonElement;
    expect(toggleBtn).toBeDefined();
    expect(toggleBtn.getAttribute("aria-expanded")).toBe("true");
    expect(toggleBtn.getAttribute("aria-controls")).toBe("traditional-projects-navigator");

    act(() => {
      toggleBtn.click();
    });
    expect(onToggleSidebar).toHaveBeenCalled();
  });

  it("displays context pill for selected group and fallback for null", () => {
    const group: TraditionalTerminalProjectGroup = {
      id: "p1:proj-a",
      label: "proj-a",
      projectName: "proj-a",
      profileId: "p1",
      profileName: "Localhost",
      terminalTabs: [],
      mountedSessions: [],
    };

    act(() => {
      root?.render(
        <AgentHubHeader
          sidebarHidden={true}
          selectedGroup={group}
          selectedWorktree="feature/new-ui"
          summary={makeSummary()}
          onToggleSidebar={() => {}}
          onOpenRecipes={() => {}}
        />,
      );
    });

    const pill = container?.querySelector("[data-testid='agent-hub-context-pill']");
    expect(pill?.textContent).toBe("Localhost/proj-a · feature/new-ui");

    // Null group
    act(() => {
      root?.render(
        <AgentHubHeader
          sidebarHidden={true}
          selectedGroup={null}
          summary={makeSummary()}
          onToggleSidebar={() => {}}
          onOpenRecipes={() => {}}
        />,
      );
    });
    expect(container?.querySelector("[data-testid='agent-hub-context-pill']")?.textContent).toBe("No project");
  });

  it("renders summary counters and triggers onOpenRecipes", () => {
    const onOpenRecipes = vi.fn();
    const summary = makeSummary({ needsAttention: 7, working: 9 });

    act(() => {
      root?.render(
        <AgentHubHeader
          sidebarHidden={false}
          selectedGroup={null}
          summary={summary}
          onToggleSidebar={() => {}}
          onOpenRecipes={onOpenRecipes}
        />,
      );
    });

    expect(container?.querySelector("[data-testid='agent-hub-attn-counter']")?.textContent).toContain("!7 Attn");
    expect(container?.querySelector("[data-testid='agent-hub-work-counter']")?.textContent).toContain("●9 Work");

    const recipesBtn = container?.querySelector("button[aria-label='Open Recipes']") as HTMLButtonElement;
    expect(recipesBtn).toBeDefined();
    act(() => {
      recipesBtn.click();
    });
    expect(onOpenRecipes).toHaveBeenCalled();
  });
});
