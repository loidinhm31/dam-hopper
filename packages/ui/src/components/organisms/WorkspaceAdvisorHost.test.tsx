// @vitest-environment jsdom
import { act, useRef, useEffect, type ReactNode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";
import { WorkspaceAdvisorHost } from "./WorkspaceAdvisorHost.js";
import { AdvisorPanelSlot } from "./AdvisorPanelSlot.js";
import {
  WorkspaceAdvisorPlacementProvider,
} from "@/contexts/WorkspaceAdvisorContext.js";

type GlobalWithAct = typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean };
const actGlobal: GlobalWithAct = globalThis;
actGlobal.IS_REACT_ACT_ENVIRONMENT = true;

vi.mock("@/components/PluginHost.js", () => ({
  PluginHost: ({
    visible = true,
  }: {
    visible?: boolean;
    installationId: string;
    project?: unknown;
    projectTarget?: unknown;
    connection?: unknown;
    onUiIntent?: unknown;
    titleOverride?: string;
    className?: string;
  }) => (
    <div data-testid="mock-plugin-host" data-visible={String(visible)}>
      Mock Plugin Host
    </div>
  ),
}));

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

function MeasuredSlotWrapper({
  top = 50,
  left = 200,
  width = 260,
  height = 600,
  visible = true,
}: {
  top?: number;
  left?: number;
  width?: number;
  height?: number;
  visible?: boolean;
}) {
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const slotEl = ref.current?.querySelector<HTMLDivElement>(
      '[data-testid="advisor-panel-slot-ide"]',
    );
    if (slotEl) {
      slotEl.getBoundingClientRect = () =>
        ({
          top,
          left,
          width,
          height,
          right: left + width,
          bottom: top + height,
          x: left,
          y: top,
          toJSON: () => {},
        }) as DOMRect;
    }
  }, [top, left, width, height]);

  return (
    <div ref={ref}>
      <AdvisorPanelSlot mode="ide" visible={visible} />
    </div>
  );
}

describe("WorkspaceAdvisorHost", () => {
  it("renders inert and hidden offscreen when no slot is registered", async () => {
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);

    await act(async () => {
      root?.render(
        <WorkspaceAdvisorPlacementProvider>
          <WorkspaceAdvisorHost project={null} />
        </WorkspaceAdvisorPlacementProvider>,
      );
    });

    const host = container.querySelector<HTMLDivElement>(
      '[data-testid="workspace-advisor-host"]',
    );
    expect(host).not.toBeNull();
    expect(host?.getAttribute("data-advisor-visible")).toBe("false");
    expect(host?.getAttribute("aria-hidden")).toBe("true");
    expect(host?.hasAttribute("inert")).toBe(true);
    expect(host?.style.visibility).toBe("hidden");
    expect(host?.style.top).toBe("-10000px");
  });

  it("becomes visible and matches geometry when slot is mounted and measured", async () => {
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);

    await act(async () => {
      root?.render(
        <WorkspaceAdvisorPlacementProvider>
          <MeasuredSlotWrapper
            top={50}
            left={200}
            width={260}
            height={600}
            visible={true}
          />
          <WorkspaceAdvisorHost project={null} />
        </WorkspaceAdvisorPlacementProvider>,
      );
    });

    const host = container.querySelector<HTMLDivElement>(
      '[data-testid="workspace-advisor-host"]',
    );
    expect(host).not.toBeNull();
    expect(host?.getAttribute("data-advisor-visible")).toBe("true");
    expect(host?.getAttribute("aria-hidden")).toBe("false");
    expect(host?.hasAttribute("inert")).toBe(false);
    expect(host?.style.visibility).toBe("visible");
    expect(host?.style.top).toBe("50px");
    expect(host?.style.left).toBe("200px");
    expect(host?.style.width).toBe("260px");
    expect(host?.style.height).toBe("600px");
  });

  it("calls onClose when Escape key is pressed inside host container", async () => {
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);

    const onClose = vi.fn();
    await act(async () => {
      root?.render(
        <WorkspaceAdvisorPlacementProvider onClose={onClose}>
          <MeasuredSlotWrapper visible={true} />
          <WorkspaceAdvisorHost project={null} />
        </WorkspaceAdvisorPlacementProvider>,
      );
    });

    const host = container.querySelector<HTMLDivElement>(
      '[data-testid="workspace-advisor-host"]',
    );
    expect(host).not.toBeNull();
    host?.dispatchEvent(
      new KeyboardEvent("keydown", { key: "Escape", bubbles: true }),
    );
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("updates geometry when workspace:layout-change event is dispatched", async () => {
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);

    let currentLeft = 200;
    function DynamicSlotWrapper() {
      const ref = useRef<HTMLDivElement>(null);
      useEffect(() => {
        const slotEl = ref.current?.querySelector<HTMLDivElement>(
          '[data-testid="advisor-panel-slot-ide"]',
        );
        if (slotEl) {
          slotEl.getBoundingClientRect = () =>
            ({
              top: 50,
              left: currentLeft,
              width: 260,
              height: 600,
              right: currentLeft + 260,
              bottom: 650,
              x: currentLeft,
              y: 50,
              toJSON: () => {},
            }) as DOMRect;
        }
      });
      return (
        <div ref={ref}>
          <AdvisorPanelSlot mode="ide" visible={true} />
        </div>
      );
    }

    await act(async () => {
      root?.render(
        <WorkspaceAdvisorPlacementProvider>
          <DynamicSlotWrapper />
          <WorkspaceAdvisorHost project={null} />
        </WorkspaceAdvisorPlacementProvider>,
      );
    });

    const host = container.querySelector<HTMLDivElement>(
      '[data-testid="workspace-advisor-host"]',
    );
    expect(host?.style.left).toBe("200px");

    currentLeft = 350;
    await act(async () => {
      window.dispatchEvent(new CustomEvent("workspace:layout-change"));
      const { promise, resolve } = Promise.withResolvers<void>();
      requestAnimationFrame(() => resolve());
      await promise;
    });

    expect(host?.style.left).toBe("350px");
  });

  it("restores focus to launcherRef when hidden after being visible and focused", async () => {
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);

    const launcherButton = document.createElement("button");
    document.body.appendChild(launcherButton);
    const launcherRef = { current: launcherButton };

    function ControlledSlot({ visible }: { visible: boolean }) {
      return (
        <WorkspaceAdvisorPlacementProvider launcherRef={launcherRef}>
          <MeasuredSlotWrapper visible={visible} />
          <WorkspaceAdvisorHost project={null} />
        </WorkspaceAdvisorPlacementProvider>
      );
    }

    await act(async () => {
      root?.render(<ControlledSlot visible={true} />);
    });

    const host = container.querySelector<HTMLDivElement>(
      '[data-testid="workspace-advisor-host"]',
    );
    expect(host?.getAttribute("data-advisor-visible")).toBe("true");

    // Simulate focus inside host (such as inside iframe/plugin host)
    const inner = host?.querySelector<HTMLElement>(
      '[data-testid="mock-plugin-host"]',
    );
    expect(inner).not.toBeNull();
    inner!.tabIndex = -1;
    inner!.focus();
    expect(document.activeElement).toBe(inner);

    // Transition to hidden
    await act(async () => {
      root?.render(<ControlledSlot visible={false} />);
    });

    expect(document.activeElement).toBe(launcherButton);
    launcherButton.remove();
  });
});
