import { act, useState, type ReactNode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { page } from "vitest/browser";
import {
  WorkspaceAdvisorPlacementProvider,
} from "@/contexts/WorkspaceAdvisorContext.js";
import { WorkspaceAdvisorHost } from "@/components/organisms/WorkspaceAdvisorHost.js";
import { AdvisorPanelSlot } from "@/components/organisms/AdvisorPanelSlot.js";
import { IdeShell } from "@/components/templates/IdeShell.js";
import { TerminalWorkspaceShell } from "@/components/templates/TerminalWorkspaceShell.js";
import { MobileWorkspaceShell } from "@/components/templates/MobileWorkspaceShell.js";
import type { WorkspaceMode } from "@/lib/workspace-mode.js";
import type { ToolWindowDef } from "@/types/ide.js";
import type { MobileWorkspaceSurface } from "@/components/templates/MobileWorkspaceShell.js";
import { Sparkles, Terminal as TerminalIcon } from "lucide-react";
import "@/index.css";

vi.mock("@/components/organisms/TopNav.js", () => ({
  TopNav: () => <header data-testid="mock-top-nav" />,
}));

vi.mock("@/hooks/use-sidebar-collapse.js", () => ({
  useSidebarCollapse: () => ({ collapsed: false, toggle: vi.fn() }),
}));

vi.mock("react-router-dom", () => ({
  useSearchParams: () => [new URLSearchParams(), vi.fn()],
  Link: ({
    children,
    to,
    ...props
  }: { children?: ReactNode; to: string } & React.AnchorHTMLAttributes<HTMLAnchorElement>) => (
    <a href={to} {...props}>
      {children}
    </a>
  ),
}));

// Provide a stable mocked AdvisorPanel to isolate native DOM panel placement in browser testing
vi.mock("@/advisor/AdvisorPanel.js", () => ({
  AdvisorPanel: ({
    className,
  }: {
    connection?: unknown;
    projectTarget?: unknown;
    className?: string;
  }) => {
    return (
      <div className={className} data-testid="native-advisor-panel">
        <span data-testid="native-advisor-title">EVCrate Advisor</span>
      </div>
    );
  },
}));

type GlobalWithAct = typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean };
const actGlobal: GlobalWithAct = globalThis;
actGlobal.IS_REACT_ACT_ENVIRONMENT = true;

let root: Root | null = null;
let container: HTMLDivElement | null = null;

beforeEach(() => {
  container = document.createElement("div");
  container.style.width = "100vw";
  container.style.height = "100vh";
  document.body.appendChild(container);
  root = createRoot(container);
});

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

function CrossModeHarness({
  initialMode = "ide",
  initialAdvisorOpen = true,
}: {
  initialMode?: WorkspaceMode | "compact";
  initialAdvisorOpen?: boolean;
}) {
  const [mode, setMode] = useState<WorkspaceMode | "compact">(initialMode);
  const [advisorOpen, setAdvisorOpen] = useState(initialAdvisorOpen);
  const [terminalPanelRequest, setTerminalPanelRequest] = useState<{
    nonce: number;
    targetId: "advisor" | "git";
  } | null>(
    initialMode === "terminal" && initialAdvisorOpen
      ? { nonce: 1, targetId: "advisor" }
      : null,
  );
  const [compactSurface, setCompactSurface] = useState<string>(
    initialAdvisorOpen ? "advisor" : "terminal",
  );

  const rightTools: ToolWindowDef[] = [
    {
      id: "advisor",
      label: "Advisor",
      icon: Sparkles,
      defaultActive: advisorOpen,
      content: advisorOpen ? <AdvisorPanelSlot mode="ide" /> : null,
    },
  ];

  const compactSurfaces: MobileWorkspaceSurface[] = [
    {
      id: "terminal",
      label: "Terminal",
      icon: TerminalIcon,
      content: <div>Terminal Surface</div>,
    },
    {
      id: "advisor",
      label: "Advisor",
      icon: Sparkles,
      content: <AdvisorPanelSlot mode="compact" />,
    },
  ];

  return (
    <WorkspaceAdvisorPlacementProvider
      onClose={() => setAdvisorOpen(false)}
      onUiIntent={(intent) => {
        if (intent === "dismiss") {
          setAdvisorOpen(false);
        }
      }}
    >
      <div data-testid="test-controls" className="fixed top-0 left-0 z-50 flex gap-2 bg-black/80 p-2 text-xs text-white">
        <button
          type="button"
          data-testid="switch-to-ide"
          onClick={() => {
            setMode("ide");
            setAdvisorOpen(true);
          }}
        >
          IDE Mode
        </button>
        <button
          type="button"
          data-testid="switch-to-terminal"
          onClick={() => {
            setMode("terminal");
            setTerminalPanelRequest({ nonce: Date.now(), targetId: "advisor" });
            setAdvisorOpen(true);
          }}
        >
          Terminal Mode
        </button>
        <button
          type="button"
          data-testid="switch-to-compact"
          onClick={() => {
            setMode("compact");
            setCompactSurface("advisor");
            setAdvisorOpen(true);
          }}
        >
          Compact Mode
        </button>
        <button
          type="button"
          data-testid="toggle-advisor"
          onClick={() => setAdvisorOpen((prev) => !prev)}
        >
          Toggle Advisor
        </button>
      </div>

      <WorkspaceAdvisorHost project={null} />

      {mode === "compact" ? (
        <MobileWorkspaceShell
          surfaces={compactSurfaces}
          activeSurfaceId={compactSurface}
          onSurfaceChange={setCompactSurface}
          workspaceMode="ide"
          onWorkspaceModeChange={() => {}}
        />
      ) : mode === "terminal" ? (
        <TerminalWorkspaceShell
          terminalContent={<div className="h-full">Terminal Content</div>}
          fleetContent={<div>Fleet</div>}
          gitContent={<div>Git</div>}
          projectContent={<div>Project</div>}
          activatePanelRequest={terminalPanelRequest}
          workspaceMode="terminal"
          onWorkspaceModeChange={() => {}}
        />
      ) : (
        <IdeShell
          leftTools={[]}
          rightTools={rightTools}
          workspaceMode="ide"
          onWorkspaceModeChange={() => {}}
          editor={<div className="h-full">Editor Content</div>}
        />
      )}
    </WorkspaceAdvisorPlacementProvider>
  );
}

describe("G5 persistent Workspace Advisor placement in Chromium", () => {
  it("preserves identical native panel DOM element across IDE → TERMINAL → compact → IDE switches", async () => {
    await act(async () => {
      root?.render(<CrossModeHarness initialMode="ide" initialAdvisorOpen={true} />);
    });

    const host = container!.querySelector<HTMLDivElement>(
      '[data-testid="workspace-advisor-host"]',
    );
    expect(host).not.toBeNull();

    // 1. Initial IDE mode check
    const panelsInitial = container!.querySelectorAll(
      '[data-testid="native-advisor-panel"]',
    );
    expect(panelsInitial.length).toBe(1);
    const initialPanel = panelsInitial[0]!;
    expect(
      initialPanel.querySelector('[data-testid="native-advisor-title"]')?.textContent,
    ).toBe("EVCrate Advisor");

    // 2. Switch to Terminal mode
    await act(async () => {
      const btn = container!.querySelector<HTMLButtonElement>(
        '[data-testid="switch-to-terminal"]',
      );
      btn?.click();
    });

    // Verify still exactly 1 panel and strictly the exact same DOM node reference
    const panelsInTerminal = container!.querySelectorAll(
      '[data-testid="native-advisor-panel"]',
    );
    expect(panelsInTerminal.length).toBe(1);
    expect(panelsInTerminal[0]).toBe(initialPanel);

    // 3. Switch to Compact mode
    await act(async () => {
      const btn = container!.querySelector<HTMLButtonElement>(
        '[data-testid="switch-to-compact"]',
      );
      btn?.click();
    });

    const panelsInCompact = container!.querySelectorAll(
      '[data-testid="native-advisor-panel"]',
    );
    expect(panelsInCompact.length).toBe(1);
    expect(panelsInCompact[0]).toBe(initialPanel);

    // 4. Switch back to IDE mode
    await act(async () => {
      const btn = container!.querySelector<HTMLButtonElement>(
        '[data-testid="switch-to-ide"]',
      );
      btn?.click();
    });

    const panelsFinal = container!.querySelectorAll(
      '[data-testid="native-advisor-panel"]',
    );
    expect(panelsFinal.length).toBe(1);
    expect(panelsFinal[0]).toBe(initialPanel);
  });

  it("preserves native panel DOM element and sets host inert when hidden, restoring on reopen", async () => {
    await act(async () => {
      root?.render(<CrossModeHarness initialMode="ide" initialAdvisorOpen={true} />);
    });

    const panels = container!.querySelectorAll(
      '[data-testid="native-advisor-panel"]',
    );
    expect(panels.length).toBe(1);
    const initialPanel = panels[0]!;

    const host = container!.querySelector<HTMLDivElement>(
      '[data-testid="workspace-advisor-host"]',
    );
    expect(host).not.toBeNull();

    // Hide advisor
    await act(async () => {
      const toggleBtn = container!.querySelector<HTMLButtonElement>(
        '[data-testid="toggle-advisor"]',
      );
      toggleBtn?.click();
    });

    // Panel must NOT be unmounted or recreated during toggle
    const panelsAfterHide = container!.querySelectorAll(
      '[data-testid="native-advisor-panel"]',
    );
    expect(panelsAfterHide.length).toBe(1);
    expect(panelsAfterHide[0]).toBe(initialPanel);

    // Host must be inert and hidden
    expect(host?.getAttribute("data-advisor-visible")).toBe("false");
    expect(host?.getAttribute("aria-hidden")).toBe("true");
    expect(host?.hasAttribute("inert")).toBe(true);
    expect(host?.style.visibility).toBe("hidden");

    // Reopen advisor
    await act(async () => {
      const toggleBtn = container!.querySelector<HTMLButtonElement>(
        '[data-testid="toggle-advisor"]',
      );
      toggleBtn?.click();
    });

    // Panel must still be identical
    const panelsAfterReopen = container!.querySelectorAll(
      '[data-testid="native-advisor-panel"]',
    );
    expect(panelsAfterReopen.length).toBe(1);
    expect(panelsAfterReopen[0]).toBe(initialPanel);
  });
});
