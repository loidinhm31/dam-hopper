// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";
import { AdvisorPanelSlot } from "./AdvisorPanelSlot.js";
import {
  WorkspaceAdvisorPlacementProvider,
  useWorkspaceAdvisorPlacement,
} from "@/contexts/WorkspaceAdvisorContext.js";

type GlobalWithAct = typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean };
const actGlobal: GlobalWithAct = globalThis;
actGlobal.IS_REACT_ACT_ENVIRONMENT = true;

let root: Root | null = null;
let container: HTMLDivElement | null = null;

afterEach(() => {
  if (root) {
    act(() => {
      root?.unmount();
    });
    root = null;
  }
  container?.remove();
  container = null;
});

function SlotObserver() {
  const placement = useWorkspaceAdvisorPlacement();
  return (
    <div data-testid="active-slot-mode">
      {placement?.activeSlot?.mode ?? "none"}
    </div>
  );
}

describe("AdvisorPanelSlot", () => {
  it("renders with data attributes and registers with placement context", async () => {
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);

    const onActivate = vi.fn();
    await act(async () => {
      root?.render(
        <WorkspaceAdvisorPlacementProvider>
          <SlotObserver />
          <AdvisorPanelSlot mode="ide" onActivate={onActivate} />
        </WorkspaceAdvisorPlacementProvider>,
      );
    });

    const slot = container.querySelector(
      '[data-testid="advisor-panel-slot-ide"]',
    );
    expect(slot).not.toBeNull();
    expect(slot?.getAttribute("data-advisor-slot-mode")).toBe("ide");

    const observer = container.querySelector(
      '[data-testid="active-slot-mode"]',
    );
    expect(observer?.textContent).toBe("ide");

    slot?.dispatchEvent(new MouseEvent("pointerdown", { bubbles: true }));
    expect(onActivate).toHaveBeenCalledTimes(1);
  });

  it("applies terminal inset padding for floating panel resize grip", async () => {
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);

    await act(async () => {
      root?.render(
        <WorkspaceAdvisorPlacementProvider>
          <AdvisorPanelSlot mode="terminal" />
        </WorkspaceAdvisorPlacementProvider>,
      );
    });

    const slot = container.querySelector(
      '[data-testid="advisor-panel-slot-terminal"]',
    );
    expect(slot?.className).toContain("pb-8");
    expect(slot?.className).toContain("pr-8");
  });

  it("unregisters from context when unmounted", async () => {
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);

    await act(async () => {
      root?.render(
        <WorkspaceAdvisorPlacementProvider>
          <SlotObserver />
          <AdvisorPanelSlot mode="compact" />
        </WorkspaceAdvisorPlacementProvider>,
      );
    });

    const observer = container.querySelector(
      '[data-testid="active-slot-mode"]',
    );
    expect(observer?.textContent).toBe("compact");

    await act(async () => {
      root?.render(
        <WorkspaceAdvisorPlacementProvider>
          <SlotObserver />
        </WorkspaceAdvisorPlacementProvider>,
      );
    });

    expect(observer?.textContent).toBe("none");
  });
});
