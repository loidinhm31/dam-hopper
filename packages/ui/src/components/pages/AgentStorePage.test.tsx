// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { AgentStorePage } from "./AgentStorePage.js";

vi.mock("@/api/queries.js", () => ({
  useAgentStoreItems: () => ({ data: [], isLoading: false, isError: false }),
  useAgentStoreMatrix: () => ({ data: {}, isError: false }),
  useProjects: () => ({ data: [], isError: false }),
}));

vi.mock("@/components/templates/AppLayout.js", () => ({
  AppLayout: ({ title, children }: { title: string; children: React.ReactNode }) => (
    <div data-testid="app-layout">
      <h1>{title}</h1>
      {children}
    </div>
  ),
}));

vi.mock("@/components/organisms/DiagnosticsExportButton.js", () => ({
  DiagnosticsExportButton: () => <button>Export</button>,
}));

vi.mock("@/components/organisms/StoreInventory.js", () => ({
  StoreInventory: () => <div data-testid="store-inventory" />,
}));

vi.mock("@/components/organisms/DistributionMatrix.js", () => ({
  DistributionMatrix: () => <div data-testid="distribution-matrix" />,
}));

vi.mock("@/components/organisms/HealthStatus.js", () => ({
  HealthStatus: () => <div data-testid="health-status" />,
}));
vi.mock("@/components/organisms/AgentSettings.js", () => ({
  AgentSettings: () => (
    <div data-testid="agent-settings">Agent Settings Panel</div>
  ),
}));


describe("AgentStorePage", () => {
  let container: HTMLDivElement | null = null;
  let root: Root | null = null;

  beforeEach(() => {
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
  });

  afterEach(() => {
    if (root) {
      act(() => {
        root?.unmount();
      });
    }
    container?.remove();
    container = null;
    root = null;
  });

  it("renders without infinite loop or maximum update depth exceeded", () => {
    act(() => {
      root?.render(<AgentStorePage />);
    });
    expect(container?.textContent).toContain("Agent Store");
    expect(container?.textContent).toContain("Agent Settings");
  });

  it("switches to Agent Settings tab and renders AgentSettings", async () => {
    act(() => {
      root?.render(<AgentStorePage />);
    });

    const buttons = container?.querySelectorAll("button");
    const settingsButton = Array.from(buttons ?? []).find(
      (btn) => btn.textContent === "Agent Settings",
    );
    expect(settingsButton).toBeDefined();

    await act(async () => {
      settingsButton?.click();
    });

    expect(container?.querySelector("[data-testid='agent-settings']")).toBeDefined();
  });
});
