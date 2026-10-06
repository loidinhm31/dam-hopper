// @vitest-environment jsdom
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { ConnectionRef } from "@/api/ownership.js";
import type { ProjectTargetRef } from "@/api/client.js";
import { WorkflowContextDeck } from "./WorkflowContextDeck.js";

declare global {
  var IS_REACT_ACT_ENVIRONMENT: boolean | undefined;
}
globalThis.IS_REACT_ACT_ENVIRONMENT = true;

describe("WorkflowPlansIntegration — Deck & Sheet mode switch and draft preservation", () => {
  let root: Root | null = null;
  let container: HTMLDivElement | null = null;
  let qc: QueryClient;

  const mockOwner: ConnectionRef = {
    profileId: "test-profile-1",
    generation: 1,
  };

  const mockTarget: ProjectTargetRef = {
    project: "hopper-core",
    worktreePath: null,
  };

  beforeEach(() => {
    qc = new QueryClient({
      defaultOptions: { queries: { retry: false } },
    });
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
  });

  afterEach(() => {
    if (root) {
      act(() => root?.unmount());
      root = null;
    }
    if (container && document.body.contains(container)) {
      document.body.removeChild(container);
      container = null;
    }
    qc.clear();
  });

  it("renders File plans and Manual tracking tabs in Deck header", () => {
    act(() => {
      root?.render(
        createElement(
          QueryClientProvider,
          { client: qc },
          createElement(WorkflowContextDeck, {
            isOpen: true,
            onClose: vi.fn(),
            owner: mockOwner,
            target: mockTarget,
            projects: [],
            plans: [],
            standaloneTasks: [],
            sessions: [],
            onSelectTarget: vi.fn(),
            onSelectItem: vi.fn(),
          }),
        ),
      );
    });

    const fileTab = container?.querySelector('button[role="tab"][aria-selected="false"]');
    const manualTab = container?.querySelector('button[role="tab"][aria-selected="true"]');

    expect(container?.textContent).toContain("File plans");
    expect(container?.textContent).toContain("Manual tracking");
    expect(fileTab).not.toBeNull();
    expect(manualTab).not.toBeNull();
  });

  it("preserves mounted manual quick-capture draft when switching to File plans and back", async () => {
    act(() => {
      root?.render(
        createElement(
          QueryClientProvider,
          { client: qc },
          createElement(WorkflowContextDeck, {
            isOpen: true,
            onClose: vi.fn(),
            owner: mockOwner,
            target: mockTarget,
            projects: [],
            plans: [],
            standaloneTasks: [],
            sessions: [],
            isQuickCaptureOpen: true,
            onCreateItem: vi.fn(),
            onSelectTarget: vi.fn(),
            onSelectItem: vi.fn(),
          }),
        ),
      );
    });

    // In manual mode with isQuickCaptureOpen, the title input is rendered
    const input = container?.querySelector("#wf-cap-title") as HTMLInputElement | null;
    expect(input).not.toBeNull();

    // Type a draft into the quick capture input
    if (input) {
      act(() => {
        const nativeSetter = Object.getOwnPropertyDescriptor(
          window.HTMLInputElement.prototype,
          "value",
        )?.set;
        nativeSetter?.call(input, "Draft for a new feature plan");
        input.dispatchEvent(new Event("input", { bubbles: true }));
        input.dispatchEvent(new Event("change", { bubbles: true }));
      });
    }

    expect(input?.value).toBe("Draft for a new feature plan");

    // Click "File plans" tab to switch mode
    const fileTab = Array.from(container?.querySelectorAll('button[role="tab"]') ?? []).find(
      (b) => b.textContent?.includes("File plans"),
    );
    expect(fileTab).not.toBeNull();

    act(() => {
      fileTab?.click();
    });

    // Verify file plans tab is active and manual region is hidden (not unmounted!)
    expect(fileTab?.getAttribute("aria-selected")).toBe("true");
    const manualContainer = container?.querySelector(".hidden");
    expect(manualContainer).not.toBeNull();

    // Input must still exist in the DOM with the typed draft preserved!
    const preservedInput = container?.querySelector("#wf-cap-title") as HTMLInputElement | null;
    expect(preservedInput).not.toBeNull();
    expect(preservedInput?.value).toBe("Draft for a new feature plan");

    // Click back to "Manual tracking" tab
    const manualTab = Array.from(container?.querySelectorAll('button[role="tab"]') ?? []).find(
      (b) => b.textContent?.includes("Manual tracking"),
    );
    act(() => {
      manualTab?.click();
    });

    // Input is visible again with intact draft
    expect(manualTab?.getAttribute("aria-selected")).toBe("true");
    expect(input?.value).toBe("Draft for a new feature plan");
  });

  it("keeps File plans reachable when manual workflow is unavailable", () => {
    act(() => {
      root?.render(
        createElement(
          QueryClientProvider,
          { client: qc },
          createElement(WorkflowContextDeck, {
            isOpen: true,
            onClose: vi.fn(),
            target: mockTarget,
            projects: [],
            plans: [],
            standaloneTasks: [],
            sessions: [],
            isManualUnavailable: true,
            onSelectTarget: vi.fn(),
            onSelectItem: vi.fn(),
          }),
        ),
      );
    });

    // Since isManualUnavailable is true, default mode initializes to "files"
    const fileTab = Array.from(container?.querySelectorAll('button[role="tab"]') ?? []).find(
      (b) => b.textContent?.includes("File plans"),
    );
    expect(fileTab?.getAttribute("aria-selected")).toBe("true");

    // Switch to manual tracking to see panel-local unavailable notice
    const manualTab = Array.from(container?.querySelectorAll('button[role="tab"]') ?? []).find(
      (b) => b.textContent?.includes("Manual tracking"),
    );
    act(() => {
      manualTab?.click();
    });

    expect(container?.textContent).toContain(
      "Manual workflow tracking is unavailable for this profile.",
    );
  });

  it("prompts for configured project when target is default without real project", () => {
    act(() => {
      root?.render(
        createElement(
          QueryClientProvider,
          { client: qc },
          createElement(WorkflowContextDeck, {
            isOpen: true,
            onClose: vi.fn(),
            target: { project: "default" },
            plansMode: "files",
            projects: [],
            plans: [],
            standaloneTasks: [],
            sessions: [],
            onSelectTarget: vi.fn(),
            onSelectItem: vi.fn(),
          }),
        ),
      );
    });

    expect(container?.textContent).toContain("No configured project selected");
    expect(container?.textContent).toContain("Select a configured project or worktree");
  });
});
