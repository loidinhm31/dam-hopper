import type { ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import { Files, Terminal } from "lucide-react";
import { MobileWorkspaceShell } from "./MobileWorkspaceShell.js";

vi.mock("@/components/organisms/TopNav.js", () => ({
  TopNav: ({ children }: { children?: ReactNode }) => (
    <div data-testid="top-nav">{children}</div>
  ),
}));

vi.mock("@/hooks/use-sidebar-collapse.js", () => ({
  useSidebarCollapse: () => ({ collapsed: true, toggle: () => {} }),
}));

describe("MobileWorkspaceShell", () => {
  it("renders the active surface with a compact panel trigger", () => {
    const markup = renderToStaticMarkup(
      <MobileWorkspaceShell
        surfaces={[
          {
            id: "explorer",
            label: "Explorer",
            icon: Files,
            content: <div>Files panel</div>,
          },
          {
            id: "terminal",
            label: "Terminal",
            icon: Terminal,
            content: <div>Terminal panel</div>,
          },
        ]}
        activeSurfaceId="terminal"
        onSurfaceChange={() => {}}
        workspaceMode="terminal"
        onWorkspaceModeChange={() => {}}
      />,
    );

    expect(markup).toMatch(
      /<div class="app-screen-height flex flex-col overflow-clip gradient-bg">/,
    );
    expect(markup).not.toContain("Terminal companion");
    expect(markup).toContain("Files panel");
    expect(markup).toContain("Terminal panel");
    expect(markup).toContain("Panels");
    expect(markup).toContain("Switch workspace surface, currently Terminal");
    expect(markup).toContain("Terminal");
    expect(markup).not.toContain('aria-label="Workspace surfaces"');
    expect(markup).toContain('hidden=""');
    expect(markup).toContain('inert=""');
  });

  it("keeps toolbar actions in a compact companion row", () => {
    const markup = renderToStaticMarkup(
      <MobileWorkspaceShell
        surfaces={[
          {
            id: "terminal",
            label: "Terminal",
            icon: Terminal,
            content: <div>Terminal panel</div>,
          },
        ]}
        activeSurfaceId="terminal"
        onSurfaceChange={() => {}}
        workspaceMode="terminal"
        onWorkspaceModeChange={() => {}}
        toolbarActions={<button type="button">Action</button>}
      />,
    );

    expect(markup).toContain("Terminal");
    expect(markup).toContain("Action");
    expect(markup).not.toContain("Terminal companion");
  });

  it("falls back to the first surface when the active id is unavailable", () => {
    const markup = renderToStaticMarkup(
      <MobileWorkspaceShell
        surfaces={[
          {
            id: "explorer",
            label: "Explorer",
            icon: Files,
            content: <div>Files panel</div>,
          },
          {
            id: "terminal",
            label: "Terminal",
            icon: Terminal,
            content: <div>Terminal panel</div>,
          },
        ]}
        activeSurfaceId="missing"
        onSurfaceChange={() => {}}
        workspaceMode="terminal"
        onWorkspaceModeChange={() => {}}
      />,
    );

    expect(markup).toContain("Switch workspace surface, currently Explorer");
    expect(markup).toContain('aria-hidden="false"');
    expect(markup).toContain("Files panel");
  });

  it("renders an empty-state fallback when no surfaces are available", () => {
    const markup = renderToStaticMarkup(
      <MobileWorkspaceShell
        surfaces={[]}
        activeSurfaceId="terminal"
        onSurfaceChange={() => {}}
        workspaceMode="terminal"
        onWorkspaceModeChange={() => {}}
      />,
    );

    expect(markup).toContain("Workspace surfaces unavailable");
  });

  it("keeps safe-area padding on non-terminal workspace modes", () => {
    const markup = renderToStaticMarkup(
      <MobileWorkspaceShell
        surfaces={[]}
        activeSurfaceId="ide"
        onSurfaceChange={() => {}}
        workspaceMode="ide"
        onWorkspaceModeChange={() => {}}
      />,
    );

    expect(markup).toMatch(
      /<div class="app-screen-height flex flex-col overflow-clip gradient-bg safe-area-bottom">/,
    );
  });
});
