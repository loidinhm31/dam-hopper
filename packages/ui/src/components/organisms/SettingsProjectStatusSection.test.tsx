import { renderToStaticMarkup } from "react-dom/server";
import type { ComponentProps } from "react";
import { describe, expect, it, vi } from "vitest";
import type { GitStatus } from "@/api/client.js";
import { SettingsProjectStatusSection } from "./SettingsProjectStatusSection.js";

const status: GitStatus = {
  projectName: "dam-hopper",
  branch: "feature/project-status",
  isClean: true,
  ahead: 0,
  behind: 0,
  staged: 0,
  modified: 0,
  untracked: 0,
  hasStash: false,
  lastCommit: {
    hash: "1234567890abcdef",
    message: "Add a compact project status card",
    date: "Mon, 26 Jul 2026 12:30:00 +0000",
  },
};

function render(
  props: Partial<ComponentProps<typeof SettingsProjectStatusSection>> = {},
) {
  return renderToStaticMarkup(
    <SettingsProjectStatusSection
      activeProject="dam-hopper"
      isLoading={false}
      onRefresh={vi.fn()}
      {...props}
    />,
  );
}

describe("SettingsProjectStatusSection", () => {
  it("keeps the manual refresh state idle until a result exists", () => {
    const markup = render();

    expect(markup).toContain(
      "Refresh to check this project&#x27;s latest commit.",
    );
    expect(markup).toContain('aria-label="Refresh latest commit"');
  });

  it("renders the latest commit details with a short hash", () => {
    const markup = render({ status });

    expect(markup).toContain("Add a compact project status card");
    expect(markup).toContain("feature/project-status");
    expect(markup).toContain("1234567");
    expect(markup).toContain('title="1234567890abcdef"');
    expect(markup).toContain('title="Mon, 26 Jul 2026 12:30:00 +0000"');
    expect(markup).toContain('dateTime="2026-07-26T12:30:00.000Z"');
  });

  it("reports unavailable project and Git status states", () => {
    expect(render({ activeProject: null })).toContain(
      "No active project selected.",
    );
    expect(render({ status: null })).toContain(
      "This project is not a Git repository.",
    );
    expect(render({ status: { ...status, pathExists: false } })).toContain(
      "This project path is no longer available.",
    );
    expect(render({ error: new Error("offline") })).toContain(
      "Could not read project status.",
    );
  });

  it("handles repositories without a commit and malformed commit dates", () => {
    expect(
      render({
        status: { ...status, lastCommit: { hash: "", message: "", date: "" } },
      }),
    ).toContain("This Git repository has no commits yet.");
    expect(
      render({
        status: {
          ...status,
          lastCommit: { ...status.lastCommit, date: "not-a-date" },
        },
      }),
    ).toContain("Commit date unavailable");
  });
});
