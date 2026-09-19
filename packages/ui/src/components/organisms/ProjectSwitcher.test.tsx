import { describe, expect, it, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { ProjectSwitcher } from "./ProjectSwitcher.js";
import type { ProjectWithStatus } from "@/api/client.js";
import type { ProjectRef } from "@/api/ownership.js";
import * as useAggregatedProjectsModule from "@/hooks/use-aggregated-projects.js";

let mockSelectedProject: ProjectRef | null = null;
const mockSetSelectedProject = vi.fn();

vi.mock("@/stores/workspace.js", () => ({
  useWorkspaceStore: () => ({
    selectedProject: mockSelectedProject,
    setSelectedProject: mockSetSelectedProject,
  }),
}));

vi.mock("@/hooks/use-aggregated-projects.js", () => ({
  useAggregatedProjects: vi.fn(),
}));

const mockProjectItem: ProjectWithStatus = {
  name: "my-app",
  path: "/tmp/my-app",
  type: "system",
};

describe("ProjectSwitcher", () => {
  it("renders with placeholder when no project is selected", () => {
    mockSelectedProject = null;
    vi.spyOn(useAggregatedProjectsModule, "useAggregatedProjects").mockReturnValue({
      groups: [],
      allProjects: [],
      isLoading: false,
    });

    const markup = renderToStaticMarkup(<ProjectSwitcher />);
    expect(markup).toContain("Select project");
  });

  it("renders with placeholder when selectedProject is not in available projects", () => {
    mockSelectedProject = { profileId: "remote-1", project: "missing-repo" };
    vi.spyOn(useAggregatedProjectsModule, "useAggregatedProjects").mockReturnValue({
      groups: [],
      allProjects: [],
      isLoading: false,
    });

    const markup = renderToStaticMarkup(<ProjectSwitcher />);
    expect(markup).toContain("Select project");
  });

  it("renders selected project label when project is available", () => {
    mockSelectedProject = { profileId: "remote-1", project: "my-app" };
    vi.spyOn(useAggregatedProjectsModule, "useAggregatedProjects").mockReturnValue({
      groups: [
        {
          profile: {
            id: "remote-1",
            name: "Server 1",
            url: "http://localhost:14801",
            authType: "none",
            autoConnect: true,
            createdAt: 0,
          },
          serverUrl: "http://localhost:14801",
          status: "connected",
          projects: [mockProjectItem],
        },
      ],
      allProjects: [
        {
          profileId: "remote-1",
          profileName: "Server 1",
          serverUrl: "http://localhost:14801",
          project: mockProjectItem,
          ref: { profileId: "remote-1", project: "my-app" },
        },
      ],
      isLoading: false,
    });

    const markup = renderToStaticMarkup(<ProjectSwitcher />);
    expect(markup).toContain("my-app");
  });
});
