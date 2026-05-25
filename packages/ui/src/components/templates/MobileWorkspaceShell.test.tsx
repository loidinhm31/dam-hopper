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
  it("renders the active companion surface and all tab buttons", () => {
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

    expect(markup).toContain("Terminal companion");
    expect(markup).toContain("Files panel");
    expect(markup).toContain("Terminal panel");
    expect(markup).toContain("Explorer");
    expect(markup).toContain("Terminal");
    expect(markup).toContain('aria-pressed="true"');
    expect(markup).toContain('hidden=""');
    expect(markup).toContain('inert=""');
  });
});
