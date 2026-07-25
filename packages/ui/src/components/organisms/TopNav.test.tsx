import type { ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

let mockCompactWorkspace = false;

vi.mock("react-router-dom", () => ({
  NavLink: ({
    to,
    children,
    className,
  }: {
    to: string;
    children: ReactNode;
    className?: string | ((args: { isActive: boolean }) => string);
  }) => (
    <a
      href={to}
      className={
        typeof className === "function"
          ? className({ isActive: false })
          : className
      }
    >
      {children}
    </a>
  ),
}));

vi.mock("@tanstack/react-query", () => ({
  useQuery: () => ({ data: [{ name: "demo-project" }] }),
}));

vi.mock("@/hooks/use-sse.js", () => ({
  useIpc: () => ({ status: "connected" }),
}));

vi.mock("@/hooks/use-compact-workspace.js", () => ({
  useCompactWorkspace: () => mockCompactWorkspace,
}));

vi.mock("@/stores/workspace.js", () => ({
  useWorkspaceStore: () => ({ activeProject: "demo-project" }),
}));

vi.mock("@/api/server-config.js", () => ({
  getActiveProfile: () => ({ name: "Local" }),
  getServerUrl: () => "http://127.0.0.1:4800",
  buildAuthHeaders: () => ({}),
}));

vi.mock("@/components/organisms/GitBranchControl.js", () => ({
  GitBranchControl: ({ showFeedback = true }: { showFeedback?: boolean }) => (
    <div data-testid="git-branch-control" data-show-feedback={String(showFeedback)} />
  ),
}));

vi.mock("@/components/atoms/ConnectionDot.js", () => ({
  ConnectionDot: ({ collapsed = false }: { collapsed?: boolean }) => (
    <span data-connection-collapsed={String(collapsed)}>connection</span>
  ),
}));

vi.mock("@/components/atoms/Logo.js", () => ({
  Logo: () => <span>logo</span>,
}));

vi.mock("@/components/organisms/WorkspaceSwitcher.js", () => ({
  WorkspaceSwitcher: () => <span>workspace</span>,
}));

vi.mock("@/components/organisms/ProjectSwitcher.js", () => ({
  ProjectSwitcher: () => <span>project</span>,
}));

vi.mock("@/components/organisms/ServerSettingsDialog.js", () => ({
  ServerSettingsDialog: () => null,
}));

vi.mock("@/components/organisms/ServerProfilesDialog.js", () => ({
  ServerProfilesDialog: () => null,
}));

vi.mock("@/components/organisms/HostResourcePopover.js", () => ({
  HostResourcePopover: () => <button>resources</button>,
}));

vi.mock("@/components/organisms/TerminalNotificationCenter.js", () => ({
  TerminalNotificationCenter: () => (
    <span data-testid="terminal-notification-center">notifications</span>
  ),
}));

import { TopNav } from "./TopNav.js";

describe("TopNav", () => {
  beforeEach(() => {
    mockCompactWorkspace = false;
  });

  it("suppresses branch feedback in the compact branch control", () => {
    const markup = renderToStaticMarkup(
      <TopNav collapsed={false} onToggle={() => {}} />,
    );

    expect(markup).toContain('data-show-feedback="false"');
    expect(markup).toContain("safe-area-top");
    expect(markup).toContain("min-h-12");
    expect(markup).toContain('data-testid="top-nav-desktop-notifications"');
    expect(markup).not.toContain('data-testid="top-nav-compact-notifications"');
    expect(
      markup.match(/data-testid="terminal-notification-center"/g),
    ).toHaveLength(1);
  });

  it("renders the project and branch toolbar in compact workspace mode", () => {
    mockCompactWorkspace = true;

    const markup = renderToStaticMarkup(
      <TopNav collapsed={false} onToggle={() => {}} />,
    );

    expect(markup).toContain("project");
    expect(markup).toContain('data-testid="git-branch-control"');
    expect(markup).toContain('data-connection-collapsed="true"');
  });

  it("renders a wrapped mobile nav grid when compact mode is expanded", () => {
    mockCompactWorkspace = true;

    const markup = renderToStaticMarkup(
      <TopNav collapsed={false} onToggle={() => {}} />,
    );

    expect(markup).toContain("grid-cols-2");
    expect(markup).toContain("sm:hidden");
    expect(markup).not.toContain("col-span-2");
    expect(markup).toContain('data-mobile-menu-open="true"');
    expect(markup).toContain("resources");
    expect(markup).toContain("Manage server connections");
    expect(markup).toContain("Local");
    expect(markup).toContain('data-mobile-visible="true"');
  });

  it("hides compact utility rows until the mobile menu is opened", () => {
    mockCompactWorkspace = true;

    const markup = renderToStaticMarkup(
      <TopNav collapsed={true} onToggle={() => {}} />,
    );

    expect(markup).not.toContain("grid-cols-2");
    expect(markup).toContain('data-mobile-menu-open="false"');
    expect(markup).toContain("hidden sm:flex");
    expect(markup).toContain('data-mobile-visible="false"');
    expect(markup).toContain('data-testid="top-nav-compact-notifications"');
    expect(markup).not.toContain('data-testid="top-nav-desktop-notifications"');
    expect(
      markup.match(/data-testid="terminal-notification-center"/g),
    ).toHaveLength(1);
  });
});
