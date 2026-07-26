import { act, type ReactNode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { GitStatus } from "@/api/client.js";

const mocks = vi.hoisted(() => ({
  activeProject: "project-a" as string | null,
  mutate: vi.fn(),
  mutation: {
    data: undefined as
      | { project: string; status: GitStatus | null }
      | undefined,
    error: null as Error | null,
    variables: undefined as string | undefined,
    isPending: false,
  },
}));

vi.mock("@/api/queries.js", () => ({
  useConfig: () => ({ data: undefined, isLoading: false, error: null }),
  useUpdateConfig: () => ({
    mutateAsync: vi.fn(),
    isPending: false,
    error: null,
  }),
  useClearCache: () => ({ mutateAsync: vi.fn(), isPending: false }),
  useResetWorkspace: () => ({ mutateAsync: vi.fn(), isPending: false }),
  useExportSettings: () => ({ mutateAsync: vi.fn(), isPending: false }),
  useImportSettings: () => ({ mutateAsync: vi.fn(), isPending: false }),
  useManualProjectStatus: () => ({ ...mocks.mutation, mutate: mocks.mutate }),
}));

vi.mock("@/stores/workspace.js", () => ({
  useWorkspaceStore: (
    selector: (state: { activeProject: string | null }) => unknown,
  ) => selector({ activeProject: mocks.activeProject }),
}));

vi.mock("@/components/templates/AppLayout.js", () => ({
  AppLayout: ({ children }: { children: ReactNode }) => <main>{children}</main>,
}));

vi.mock("@/components/pages/settings-page/SettingsSectionAccordion.js", () => ({
  SettingsSectionAccordion: ({ children }: { children: ReactNode }) => (
    <section>{children}</section>
  ),
}));

vi.mock("@/components/organisms/SettingsAppearanceSection.js", () => ({
  SettingsAppearanceSection: () => null,
}));
vi.mock("@/components/organisms/SettingsKeyboardShortcutsSection.js", () => ({
  SettingsKeyboardShortcutsSection: () => null,
}));
vi.mock("@/components/organisms/SettingsUsageInsightsSection.js", () => ({
  SettingsUsageInsightsSection: () => null,
}));
vi.mock("@/components/organisms/DiagnosticsExportButton.js", () => ({
  DiagnosticsExportButton: () => null,
}));
vi.mock("@/components/pages/settings-page/SettingsMaintenancePanel.js", () => ({
  SettingsMaintenancePanel: () => null,
}));
vi.mock(
  "@/components/pages/settings-page/SettingsImportExportPanel.js",
  () => ({
    SettingsImportExportPanel: () => null,
  }),
);
vi.mock("@/components/pages/settings-page/SettingsConfigPanels.js", () => ({
  SettingsGlobalConfigPanel: () => null,
  SettingsWorkspaceConfigPanel: () => null,
}));
vi.mock("@/components/organisms/SettingsProjectStatusSection.js", () => ({
  SettingsProjectStatusSection: ({
    activeProject,
    status,
    isLoading,
    error,
    onRefresh,
  }: {
    activeProject: string | null;
    status: GitStatus | null | undefined;
    isLoading: boolean;
    error: Error | null;
    onRefresh: () => void;
  }) => (
    <button
      type="button"
      aria-label="Refresh latest commit"
      data-project={activeProject ?? ""}
      data-status={status === undefined ? "idle" : "loaded"}
      data-loading={String(isLoading)}
      data-error={String(Boolean(error))}
      onClick={onRefresh}
    >
      Refresh
    </button>
  ),
}));

import { SettingsPage } from "@/components/pages/SettingsPage.js";

describe("Settings project-status integration in Chromium", () => {
  let container: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    mocks.activeProject = "project-a";
    mocks.mutate.mockReset();
    mocks.mutation.data = undefined;
    mocks.mutation.error = null;
    mocks.mutation.variables = undefined;
    mocks.mutation.isPending = false;
    container = document.createElement("div");
    document.body.append(container);
    root = createRoot(container);
  });

  afterEach(async () => {
    await act(async () => root.unmount());
    container.remove();
  });

  function refreshButton() {
    const button = container.querySelector<HTMLButtonElement>(
      '[aria-label="Refresh latest commit"]',
    );
    expect(button).not.toBeNull();
    return button as HTMLButtonElement;
  }

  it("does not request status until Refresh is clicked for the active project", async () => {
    await act(async () => root.render(<SettingsPage />));

    expect(mocks.mutate).not.toHaveBeenCalled();
    await act(async () => refreshButton().click());
    expect(mocks.mutate).toHaveBeenCalledOnce();
    expect(mocks.mutate).toHaveBeenCalledWith("project-a");
  });

  it("masks another project's in-flight data, error, and loading state", async () => {
    mocks.mutation.data = {
      project: "project-a",
      status: {
        projectName: "project-a",
        branch: "main",
        isClean: true,
        ahead: 0,
        behind: 0,
        staged: 0,
        modified: 0,
        untracked: 0,
        hasStash: false,
        lastCommit: { hash: "abc", message: "Old project", date: "" },
      },
    };
    mocks.mutation.error = new Error("old project failed");
    mocks.mutation.variables = "project-a";
    mocks.mutation.isPending = true;
    mocks.activeProject = "project-b";

    await act(async () => root.render(<SettingsPage />));

    const refresh = refreshButton();
    expect(refresh.dataset.project).toBe("project-b");
    expect(refresh.dataset.status).toBe("idle");
    expect(refresh.dataset.loading).toBe("false");
    expect(refresh.dataset.error).toBe("false");
  });
});
