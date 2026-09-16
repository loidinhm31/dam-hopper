// @vitest-environment jsdom

import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { SettingsPage } from "./SettingsPage.js";

const mockExportMutate = vi.fn();
const mockImportMutate = vi.fn();

vi.mock("@/api/queries.js", () => ({
  useConfig: () => ({
    data: {
      workspace: { name: "test-workspace", root: "." },
      projects: [],
      server: {},
    },
    isLoading: false,
    error: null,
  }),
  useUpdateConfig: () => ({
    mutateAsync: vi.fn(),
    isPending: false,
    error: null,
  }),
  useClearCache: () => ({
    mutateAsync: vi.fn(),
    isPending: false,
  }),
  useResetWorkspace: () => ({
    mutateAsync: vi.fn(),
    isPending: false,
  }),
  useExportSettings: () => ({
    mutateAsync: mockExportMutate,
    isPending: false,
  }),
  useImportSettings: () => ({
    mutateAsync: mockImportMutate,
    isPending: false,
  }),
}));

vi.mock("@/components/templates/AppLayout.js", () => ({
  AppLayout: ({ children }: { children: React.ReactNode }) => (
    <div data-testid="app-layout">{children}</div>
  ),
}));

vi.mock("@/components/organisms/SettingsAppearanceSection.js", () => ({
  SettingsAppearanceSection: () => <div>AppearanceSection</div>,
}));
vi.mock("@/components/organisms/SettingsKeyboardShortcutsSection.js", () => ({
  SettingsKeyboardShortcutsSection: () => <div>KeyboardSection</div>,
}));
vi.mock("@/components/organisms/SettingsUsageInsightsSection.js", () => ({
  SettingsUsageInsightsSection: () => <div>UsageSection</div>,
}));
vi.mock("@/components/organisms/DiagnosticsExportButton.js", () => ({
  DiagnosticsExportButton: () => <div>DiagnosticsButton</div>,
}));
vi.mock("@/components/organisms/SettingsIdleSuspendTimingSection.js", () => ({
  SettingsIdleSuspendTimingSection: () => <div>IdleSuspendSection</div>,
}));
vi.mock("@/components/pages/settings-page/SettingsMaintenancePanel.js", () => ({
  SettingsMaintenancePanel: () => <div>MaintenancePanel</div>,
}));
vi.mock("@/components/pages/settings-page/SettingsConfigPanels.js", () => ({
  SettingsGlobalConfigPanel: () => <div>GlobalConfigPanel</div>,
  SettingsWorkspaceConfigPanel: () => <div>WorkspaceConfigPanel</div>,
}));

describe("SettingsPage Import / Export integration", () => {
  let container: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    mockExportMutate.mockReset();
    mockImportMutate.mockReset();
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
  });

  afterEach(() => {
    act(() => {
      root.unmount();
    });
    container.remove();
    vi.restoreAllMocks();
  });

  it("handles export by fetching TOML and triggering browser download", async () => {
    mockExportMutate.mockResolvedValue("[workspace]\nname = 'test'\n");

    const createObjectURLMock = vi.fn().mockReturnValue("blob:mock-url");
    const revokeObjectURLMock = vi.fn();
    window.URL.createObjectURL = createObjectURLMock;
    window.URL.revokeObjectURL = revokeObjectURLMock;

    act(() => {
      root.render(<SettingsPage />);
    });

    const exportBtn = Array.from(container.querySelectorAll("button")).find(
      (btn) => btn.textContent?.trim() === "Export",
    );

    await act(async () => {
      exportBtn?.click();
    });

    expect(mockExportMutate).toHaveBeenCalledTimes(1);
    expect(createObjectURLMock).toHaveBeenCalledTimes(1);
    expect(container.textContent).toContain("Downloaded dam-hopper.toml");
  });

  it("handles import confirmation and successful upload", async () => {
    mockImportMutate.mockResolvedValue({
      imported: true,
      fileName: "dam-hopper.toml",
      backupFileName: "dam-hopper.toml.bak.123",
      workspaceName: "test-workspace",
    });

    vi.spyOn(window, "confirm").mockReturnValue(true);

    act(() => {
      root.render(<SettingsPage />);
    });

    const fileInput = container.querySelector<HTMLInputElement>("input[type='file']");
    expect(fileInput).toBeTruthy();

    const testFile = new File(["[workspace]\nname = 'imported'\n"], "dam-hopper.toml", {
      type: "application/toml",
    });
    testFile.text = async () => "[workspace]\nname = 'imported'\n";

    await act(async () => {
      Object.defineProperty(fileInput, "files", {
        value: [testFile],
        writable: true,
      });
      fileInput?.dispatchEvent(new Event("change", { bubbles: true }));
    });

    expect(window.confirm).toHaveBeenCalledWith(expect.stringContaining("test-workspace"));
    expect(mockImportMutate).toHaveBeenCalledWith("[workspace]\nname = 'imported'\n");
    expect(container.textContent).toContain("Settings imported. Backup saved to dam-hopper.toml.bak.123");
  });

  it("handles import cancellation when confirm dialog is dismissed", async () => {
    vi.spyOn(window, "confirm").mockReturnValue(false);

    act(() => {
      root.render(<SettingsPage />);
    });

    const fileInput = container.querySelector<HTMLInputElement>("input[type='file']");
    const testFile = new File(["[workspace]\nname = 'imported'\n"], "dam-hopper.toml", {
      type: "application/toml",
    });

    await act(async () => {
      Object.defineProperty(fileInput, "files", {
        value: [testFile],
        writable: true,
      });
      fileInput?.dispatchEvent(new Event("change", { bubbles: true }));
    });

    expect(window.confirm).toHaveBeenCalled();
    expect(mockImportMutate).not.toHaveBeenCalled();
    expect(container.textContent).toContain("Import cancelled.");
  });

  it("rejects files exceeding 1 MiB size limit", async () => {
    act(() => {
      root.render(<SettingsPage />);
    });

    const fileInput = container.querySelector<HTMLInputElement>("input[type='file']");
    const bigFile = new File(["dummy"], "huge.toml", { type: "application/toml" });
    Object.defineProperty(bigFile, "size", { value: 1024 * 1024 + 1 });

    await act(async () => {
      Object.defineProperty(fileInput, "files", {
        value: [bigFile],
        writable: true,
      });
      fileInput?.dispatchEvent(new Event("change", { bubbles: true }));
    });

    expect(mockImportMutate).not.toHaveBeenCalled();
    expect(container.textContent).toContain("File size exceeds 1 MiB limit.");
  });
});
