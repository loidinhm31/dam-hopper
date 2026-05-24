import type { ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

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
    <div data-show-feedback={String(showFeedback)} />
  ),
}));

vi.mock("@/components/atoms/ConnectionDot.js", () => ({
  ConnectionDot: () => <span>connection</span>,
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

import { TopNav } from "./TopNav.js";

describe("TopNav", () => {
  it("suppresses branch feedback in the compact branch control", () => {
    const markup = renderToStaticMarkup(
      <TopNav collapsed={false} onToggle={() => {}} />,
    );

    expect(markup).toContain('data-show-feedback="false"');
  });
});
