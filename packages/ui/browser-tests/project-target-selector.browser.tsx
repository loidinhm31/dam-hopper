import { act, useState } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { page, userEvent } from "vitest/browser";
import type { Worktree } from "@/api/client.js";
import { ProjectTargetSelector } from "@/components/organisms/ProjectTargetSelector.js";
import { createProjectTargetSnapshot } from "@/stores/project-target.js";
import "@/index.css";

const PROJECT = "project-1";
const PROJECT_ROOT = "/workspace/project-1";
const FEATURE_PATH = "/workspace/project-1-feature";

const worktrees: Worktree[] = [
  {
    path: PROJECT_ROOT,
    repositoryPath: "/workspace/project-1/.git",
    branch: "main",
    commitHash: "main-commit",
    isMain: true,
    isLocked: false,
    isDetached: false,
    isBare: false,
    isPrunable: false,
    isAvailable: true,
  },
  {
    path: FEATURE_PATH,
    repositoryPath: "/workspace/project-1/.git",
    branch: "feature/switching",
    commitHash: "feature-commit",
    isMain: false,
    isLocked: false,
    isDetached: false,
    isBare: false,
    isPrunable: false,
    isAvailable: true,
  },
  {
    path: "/workspace/project-1-stale",
    repositoryPath: "/workspace/project-1/.git",
    branch: "feature/stale",
    commitHash: "stale-commit",
    isMain: false,
    isLocked: false,
    isDetached: false,
    isBare: false,
    isPrunable: true,
    isAvailable: false,
  },
];

function TargetHarness() {
  const [selectedPath, setSelectedPath] = useState<string | null>(null);
  const selectedWorktree = worktrees.find(
    (worktree) => worktree.path === selectedPath,
  );
  const target = createProjectTargetSnapshot(
    PROJECT,
    selectedPath,
    selectedWorktree,
  );

  return (
    <>
      <p data-testid="project-identity">Project: {PROJECT}</p>
      <output data-testid="selected-target">{target.label}</output>
      <ProjectTargetSelector
        projectRoot={PROJECT_ROOT}
        target={target}
        worktrees={worktrees}
        isLoading={false}
        isFetching={false}
        isFetched
        isError={false}
        fallbackNotice={null}
        removePendingPath={null}
        onSelect={setSelectedPath}
        onRefresh={() => undefined}
        onRemove={() => undefined}
      />
    </>
  );
}

describe("project target selector in Chromium", () => {
  let container: HTMLDivElement;
  let root: Root;

  beforeEach(async () => {
    container = document.createElement("div");
    document.body.append(container);
    root = createRoot(container);
    await act(async () => root.render(<TargetHarness />));
  });

  afterEach(async () => {
    await act(async () => root.unmount());
    container.remove();
    document.body.innerHTML = "";
  });

  it("switches targets with the native radio keyboard pattern", async () => {
    const rootRadio = page.getByRole("radio", { name: /Project root/ });
    const featureRadio = page.getByRole("radio", {
      name: /feature\/switching/,
    });

    await expect.element(rootRadio).toBeVisible();
    await userEvent.click(rootRadio);
    await userEvent.keyboard("{ArrowDown}");

    await expect
      .poll(() => (featureRadio.element() as HTMLInputElement).checked)
      .toBe(true);
    await expect
      .element(page.getByTestId("selected-target"))
      .toHaveTextContent("feature/switching");
    await expect
      .element(page.getByTestId("project-identity"))
      .toHaveTextContent("Project: project-1");
  });

  it("keeps unavailable worktrees visible but disabled", async () => {
    const staleRadio = page.getByRole("radio", { name: /feature\/stale/ });

    await expect
      .poll(() => (staleRadio.element() as HTMLInputElement).disabled)
      .toBe(true);
    await expect
      .element(page.getByText("Prunable — unavailable"))
      .toBeVisible();
    expect(document.body.textContent).not.toContain("No registered worktrees");
  });
});
