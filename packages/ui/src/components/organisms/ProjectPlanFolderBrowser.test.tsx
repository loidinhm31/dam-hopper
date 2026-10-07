import { describe, it, expect, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { ProjectPlanFolderBrowser } from "./ProjectPlanFolderBrowser.js";
import type { PlanFoldersResponse } from "@/api/project-plans-types.js";

describe("ProjectPlanFolderBrowser", () => {
  const dummyFoldersData: PlanFoldersResponse = {
    target: {
      project: "dam-hopper",
      worktreePath: null,
      targetKey: "dam-hopper",
    },
    path: "plans",
    kind: "collection",
    folderState: "present",
    folders: [
      { name: "261001-feature-a", path: "plans/261001-feature-a" },
      { name: "261002-feature-b", path: "plans/261002-feature-b" },
    ],
    listing: {
      complete: true,
      entriesVisited: 2,
      limitsReached: [],
    },
    watchPaths: ["plans"],
    diagnostics: [],
  };

  it("renders folder rows with name and navigation buttons", () => {
    const html = renderToStaticMarkup(
      <ProjectPlanFolderBrowser
        currentPath="plans"
        foldersData={dummyFoldersData}
        isLoading={false}
        error={null}
        onNavigatePath={vi.fn()}
        onRefresh={vi.fn()}
      />,
    );

    expect(html).toContain("261001-feature-a");
    expect(html).toContain("261002-feature-b");
    expect(html).toContain('role="list"');
  });

  it("renders breadcrumbs correctly for nested browsing path", () => {
    const html = renderToStaticMarkup(
      <ProjectPlanFolderBrowser
        currentPath="plans/archive/2026"
        foldersData={dummyFoldersData}
        isLoading={false}
        error={null}
        onNavigatePath={vi.fn()}
        onRefresh={vi.fn()}
      />,
    );

    expect(html).toContain("plans");
    expect(html).toContain("archive");
    expect(html).toContain("2026");
  });

  it("renders loading state when isLoading is true and no data", () => {
    const html = renderToStaticMarkup(
      <ProjectPlanFolderBrowser
        currentPath="plans"
        isLoading={true}
        error={null}
        onNavigatePath={vi.fn()}
        onRefresh={vi.fn()}
      />,
    );

    expect(html).toContain("Loading plans folder...");
  });

  it("renders error state when error is provided", () => {
    const html = renderToStaticMarkup(
      <ProjectPlanFolderBrowser
        currentPath="plans"
        isLoading={false}
        error={new Error("EACCES permission denied")}
        onNavigatePath={vi.fn()}
        onRefresh={vi.fn()}
      />,
    );

    expect(html).toContain("Failed to read folder");
    expect(html).toContain("EACCES permission denied");
  });

  it("renders missing folder notice when folderState is missing", () => {
    const missingData: PlanFoldersResponse = {
      ...dummyFoldersData,
      folderState: "missing",
      folders: [],
    };
    const html = renderToStaticMarkup(
      <ProjectPlanFolderBrowser
        currentPath="plans"
        foldersData={missingData}
        isLoading={false}
        error={null}
        onNavigatePath={vi.fn()}
        onRefresh={vi.fn()}
      />,
    );

    expect(html).toContain("No plans folder found");
  });

  it("renders truncation banner when listing is incomplete", () => {
    const truncatedData: PlanFoldersResponse = {
      ...dummyFoldersData,
      listing: {
        complete: false,
        entriesVisited: 5000,
        limitsReached: ["entries"],
      },
    };
    const html = renderToStaticMarkup(
      <ProjectPlanFolderBrowser
        currentPath="plans"
        foldersData={truncatedData}
        isLoading={false}
        error={null}
        onNavigatePath={vi.fn()}
        onRefresh={vi.fn()}
      />,
    );

    expect(html).toContain("Listing truncated");
    expect(html).toContain("5000 entries visited");
  });
});
