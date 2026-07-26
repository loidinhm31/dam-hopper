import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { GitStatus } from "@/api/client.js";
import { SettingsProjectStatusSection } from "@/components/organisms/SettingsProjectStatusSection.js";
import "@/index.css";

const status: GitStatus = {
  projectName: "dam-hopper",
  branch: "main",
  isClean: true,
  ahead: 0,
  behind: 0,
  staged: 0,
  modified: 0,
  untracked: 0,
  hasStash: false,
  lastCommit: {
    hash: "a1b2c3d4e5f6",
    message: "Show latest project commit",
    date: "Mon, 26 Jul 2026 12:30:00 +0000",
  },
};

describe("Settings project status in Chromium", () => {
  let container: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    container = document.createElement("div");
    document.body.append(container);
    root = createRoot(container);
  });

  afterEach(async () => {
    await act(async () => root.unmount());
    container.remove();
  });

  it("keeps status idle until an accessible manual refresh is clicked", async () => {
    const onRefresh = vi.fn();
    await act(async () =>
      root.render(
        <SettingsProjectStatusSection
          activeProject="dam-hopper"
          isLoading={false}
          onRefresh={onRefresh}
        />,
      ),
    );

    const refresh = container.querySelector<HTMLButtonElement>(
      '[aria-label="Refresh latest commit"]',
    );
    expect(container.textContent).toContain("Refresh to check this project's latest commit.");
    expect(refresh).not.toBeNull();
    refresh?.focus();
    expect(document.activeElement).toBe(refresh);
    await act(async () => refresh?.click());
    expect(onRefresh).toHaveBeenCalledOnce();
  });

  it("shows the selected project's commit and recoverable server status", async () => {
    await act(async () =>
      root.render(
        <SettingsProjectStatusSection
          activeProject="dam-hopper"
          status={status}
          isLoading={false}
          onRefresh={vi.fn()}
        />,
      ),
    );
    expect(container.textContent).toContain("Show latest project commit");
    expect(container.textContent).toContain("a1b2c3d");

    await act(async () =>
      root.render(
        <SettingsProjectStatusSection
          activeProject="dam-hopper"
          status={{ ...status, statusError: "Git unavailable" }}
          isLoading={false}
          onRefresh={vi.fn()}
        />,
      ),
    );
    expect(container.querySelector('[role="alert"]')?.textContent).toContain(
      "Git status is unavailable",
    );
  });
});
