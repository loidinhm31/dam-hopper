import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import {
  ActiveTerminalRuntimeDisplay,
  RuntimeActiveSessionTitle,
} from "./ActiveTerminalRuntimeDisplay.js";
import type { MountedSession } from "./MultiTerminalDisplay.js";
import type { TabEntry } from "./TerminalTabBar.js";

let mockCompactWorkspace = false;

vi.mock("@/api/queries.js", () => ({
  useGlobalConfig: () => ({ data: undefined }),
}));

vi.mock("@/hooks/use-compact-workspace.js", () => ({
  useCompactWorkspace: () => mockCompactWorkspace,
}));

vi.mock("@/hooks/use-ports.js", () => ({
  usePorts: () => ({
    ports: [],
    createTunnel: vi.fn(),
    stopTunnel: vi.fn(),
  }),
}));

vi.mock("@/hooks/use-resize-handle.js", () => ({
  useResizeHandle: () => ({
    width: 288,
    handleProps: { onMouseDown: vi.fn() },
    isDragging: false,
  }),
}));

vi.mock("@/hooks/use-runtime-tree-ordering.js", () => ({
  useRuntimeTreeOrdering: () => ({
    moveGroup: vi.fn(),
    moveItem: vi.fn(),
  }),
}));

vi.mock("@/components/organisms/TerminalRuntimeOutput.js", () => ({
  TerminalRuntimeOutput: () => <div data-testid="runtime-output" />,
}));

const mountedSessions: MountedSession[] = [
  {
    sessionId: "session-1",
    project: "demo",
    command: "bash",
    cwd: "/workspace",
  },
];

const openTabs: TabEntry[] = [
  {
    sessionId: "session-1",
    label: "bash",
  },
];

function renderDisplay() {
  return renderToStaticMarkup(
    <ActiveTerminalRuntimeDisplay
      activeSessionId="session-1"
      mountedSessions={mountedSessions}
      openTabs={openTabs}
      currentProjectName="demo"
      onNewFreeTerminal={() => {}}
      onNewProjectTerminal={() => {}}
      onSelectTab={() => {}}
      onCloseSession={() => {}}
    />,
  );
}

describe("ActiveTerminalRuntimeDisplay", () => {
  it("uses the mobile runtime trigger instead of the desktop resize handle on compact viewports", () => {
    mockCompactWorkspace = true;

    const markup = renderDisplay();

    expect(markup).toContain("Runtime");
    expect(markup).toContain("Full-width terminal");
    expect(markup).not.toContain("cursor-col-resize");
  });

  it("keeps the resizable desktop navigator on wide viewports", () => {
    mockCompactWorkspace = false;

    const markup = renderDisplay();

    expect(markup).toContain("cursor-col-resize");
    expect(markup).not.toContain("Full-width terminal");
  });

  it("opens diagnostics for the compact runtime title session", () => {
    const onOpenDiagnosticsMenu = vi.fn();
    const title = RuntimeActiveSessionTitle({
      activeSessionId: "session-1",
      activeSessionLabel: "demo: bash",
      onOpenDiagnosticsMenu,
    });
    const preventDefault = vi.fn();
    const stopPropagation = vi.fn();

    (title.props.onContextMenu as (event: {
      clientX: number;
      clientY: number;
      preventDefault: () => void;
      stopPropagation: () => void;
    }) => void)({ clientX: 10, clientY: 20, preventDefault, stopPropagation });

    expect(onOpenDiagnosticsMenu).toHaveBeenCalledWith("session-1", 10, 20);
    expect(preventDefault).toHaveBeenCalledOnce();
    expect(stopPropagation).toHaveBeenCalledOnce();
  });
});
