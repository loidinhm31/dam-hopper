// @vitest-environment jsdom

import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { SettingsPage } from "./SettingsPage.js";
import { useWorkbenchSelectionsStore } from "@/stores/workbench-selections.js";
import type * as ServerConfigModule from "@/api/server-config.js";
import type { ConnectionRef } from "@/api/ownership.js";
import type { DamHopperConfig } from "@/api/client.js";

const mockExportMutate = vi.fn();
const mockImportMutate = vi.fn();
const mockConfigQuery = vi.fn((_owner?: ConnectionRef) => ({
  data: {
    workspace: { name: "test-workspace", root: "." },
    projects: [],
    server: { sessionChangesEnabled: false },
  } as DamHopperConfig | undefined,
  isLoading: false,
  error: null,
}));
const mockUpdateConfigMutate = vi.fn();
const mockUpdateConfigMutation = vi.fn((owner?: ConnectionRef) => ({
  mutateAsync: (...args: [DamHopperConfig]) =>
    mockUpdateConfigMutate(owner, ...args),
  isPending: false,
  error: null,
}));
const mockProfiles = [
  {
    id: "profile-1",
    name: "Production Server",
    url: "https://prod.example.com",
    authType: "basic" as const,
    createdAt: 1000,
    autoConnect: true,
  },
  {
    id: "profile-2",
    name: "Staging Server",
    url: "https://staging.example.com",
    authType: "none" as const,
    createdAt: 2000,
    autoConnect: true,
  },
];

vi.mock("@/api/server-config.js", async (importOriginal) => {
  const actual = await importOriginal<typeof ServerConfigModule>();
  return {
    ...actual,
    readServerProfiles: () => ({
      status: "available",
      profiles: mockProfiles,
    }),
  };
});
vi.mock("@/api/queries.js", () => ({
  useConfig: (owner?: ConnectionRef) => mockConfigQuery(owner),
  useUpdateConfig: (owner?: ConnectionRef) => mockUpdateConfigMutation(owner),
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
  useProjects: () => ({
    data: [],
    isLoading: false,
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
    expect(container.textContent).toContain("Downloaded config.toml");
  });

  it("handles import confirmation and successful upload", async () => {
    mockImportMutate.mockResolvedValue({
      imported: true,
      fileName: "config.toml",
      backupFileName: "config.toml.bak.123",
      workspaceName: "test-workspace",
    });

    act(() => {
      root.render(<SettingsPage />);
    });

    const fileInput =
      container.querySelector<HTMLInputElement>("input[type='file']");
    expect(fileInput).toBeTruthy();

    const testFile = new File(
      ["[workspace]\nname = 'imported'\n"],
      "config.toml",
      {
        type: "application/toml",
      },
    );
    testFile.text = async () => "[workspace]\nname = 'imported'\n";

    await act(async () => {
      Object.defineProperty(fileInput, "files", {
        value: [testFile],
        writable: true,
      });
      fileInput?.dispatchEvent(new Event("change", { bubbles: true }));
    });
    const confirmButton = [
      ...document.querySelectorAll<HTMLButtonElement>('[role="dialog"] button'),
    ].find((btn) => btn.textContent?.includes("Apply configuration"));
    expect(confirmButton).toBeTruthy();
    await act(async () => {
      confirmButton?.click();
    });
    expect(mockImportMutate).toHaveBeenCalledWith(
      "[workspace]\nname = 'imported'\n",
    );
    expect(container.textContent).toContain(
      "Settings imported. Backup saved to config.toml.bak.123",
    );
  });

  it("handles import cancellation when confirm dialog is dismissed", async () => {
    act(() => {
      root.render(<SettingsPage />);
    });

    const fileInput =
      container.querySelector<HTMLInputElement>("input[type='file']");
    const testFile = new File(
      ["[workspace]\nname = 'imported'\n"],
      "config.toml",
      {
        type: "application/toml",
      },
    );

    await act(async () => {
      Object.defineProperty(fileInput, "files", {
        value: [testFile],
        writable: true,
      });
      fileInput?.dispatchEvent(new Event("change", { bubbles: true }));
    });
    const cancelButton = [
      ...document.querySelectorAll<HTMLButtonElement>('[role="dialog"] button'),
    ].find((btn) => btn.textContent?.includes("Cancel"));
    expect(cancelButton).toBeTruthy();
    await act(async () => {
      cancelButton?.click();
    });
    expect(mockImportMutate).not.toHaveBeenCalled();
    expect(container.textContent).toContain("Import cancelled.");
  });

  it("rejects files exceeding 1 MiB size limit", async () => {
    act(() => {
      root.render(<SettingsPage />);
    });

    const fileInput =
      container.querySelector<HTMLInputElement>("input[type='file']");
    const bigFile = new File(["dummy"], "huge.toml", {
      type: "application/toml",
    });
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

  it("renders target selector and updates settingsProfileId on change", async () => {
    useWorkbenchSelectionsStore.getState().setSettingsProfileId(null);

    act(() => {
      root.render(<SettingsPage />);
    });

    const targetSelect = container.querySelector<HTMLSelectElement>(
      "#settings-target-select",
    );
    expect(targetSelect).toBeTruthy();

    await act(async () => {
      if (targetSelect) {
        targetSelect.value = "profile-1";
        targetSelect.dispatchEvent(new Event("change", { bubbles: true }));
      }
    });

    expect(useWorkbenchSelectionsStore.getState().settingsProfileId).toBe(
      "profile-1",
    );
    expect(container.textContent).toContain("Production Server");
    expect(container.textContent).toContain("https://prod.example.com");
  });

  it("binds export filename to the selected target profile", async () => {
    useWorkbenchSelectionsStore.getState().setSettingsProfileId("profile-1");
    mockExportMutate.mockResolvedValue("[workspace]\nname = 'prod'\n");

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
    expect(container.textContent).toContain(
      "Downloaded dam-hopper-production-server-config.toml",
    );
  });

  it("aborts import if settings target profile changes during confirmation", async () => {
    useWorkbenchSelectionsStore.getState().setSettingsProfileId("profile-1");

    act(() => {
      root.render(<SettingsPage />);
    });

    const fileInput =
      container.querySelector<HTMLInputElement>("input[type='file']");
    const testFile = new File(
      ["[workspace]\nname = 'imported'\n"],
      "config.toml",
      { type: "application/toml" },
    );
    testFile.text = async () => "[workspace]\nname = 'imported'\n";

    await act(async () => {
      Object.defineProperty(fileInput, "files", {
        value: [testFile],
        writable: true,
      });
      fileInput?.dispatchEvent(new Event("change", { bubbles: true }));
    });

    useWorkbenchSelectionsStore.getState().setSettingsProfileId("profile-2");

    const confirmButton = [
      ...document.querySelectorAll<HTMLButtonElement>('[role="dialog"] button'),
    ].find((btn) => btn.textContent?.includes("Apply configuration"));
    expect(confirmButton).toBeTruthy();
    await act(async () => {
      confirmButton?.click();
    });
    expect(container.textContent).toContain(
      "Import cancelled: settings target server or connection changed during confirmation.",
    );
  });
});

describe("SettingsPage accordion collapse behavior", () => {
  let container: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
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

  const SECTION_TITLES = [
    "Appearance",
    "Keyboard Shortcuts",
    "Terminal Idle Suspend",
    "Session Changes",
    "Global Settings",
    "Workspace Config",
    "Maintenance",
    "Import / Export Settings",
  ];

  it("renders all sections collapsed by default", () => {
    act(() => {
      root.render(<SettingsPage />);
    });

    const buttons = Array.from(
      container.querySelectorAll<HTMLButtonElement>("button[aria-expanded]"),
    );

    expect(buttons.length).toBe(SECTION_TITLES.length);

    for (const title of SECTION_TITLES) {
      const btn = buttons.find((b) => b.textContent?.includes(title));
      expect(btn, `Section button "${title}" should exist`).toBeTruthy();
      expect(btn?.getAttribute("aria-expanded")).toBe("false");

      const panelId = btn?.getAttribute("aria-controls");
      expect(panelId).toBeTruthy();
      const panel = container.querySelector(`#${panelId}`);
      expect(panel, `Panel for "${title}" should exist`).toBeTruthy();
      expect(panel?.hasAttribute("hidden")).toBe(true);
    }
  });

  it("expands a collapsed section on click and collapses on next click", async () => {
    act(() => {
      root.render(<SettingsPage />);
    });

    const appearanceBtn = Array.from(
      container.querySelectorAll<HTMLButtonElement>("button[aria-expanded]"),
    ).find((b) => b.textContent?.includes("Appearance"));

    expect(appearanceBtn).toBeTruthy();
    expect(appearanceBtn?.getAttribute("aria-expanded")).toBe("false");

    const panelId = appearanceBtn?.getAttribute("aria-controls");
    const panel = container.querySelector(`#${panelId}`);
    expect(panel?.hasAttribute("hidden")).toBe(true);

    // Click to expand
    await act(async () => {
      appearanceBtn?.click();
    });

    expect(appearanceBtn?.getAttribute("aria-expanded")).toBe("true");
    expect(panel?.hasAttribute("hidden")).toBe(false);

    // Click again to collapse
    await act(async () => {
      appearanceBtn?.click();
    });

    expect(appearanceBtn?.getAttribute("aria-expanded")).toBe("false");
    expect(panel?.hasAttribute("hidden")).toBe(true);
  });

  it("toggles multiple sections independently", async () => {
    act(() => {
      root.render(<SettingsPage />);
    });

    const buttons = Array.from(
      container.querySelectorAll<HTMLButtonElement>("button[aria-expanded]"),
    );
    const wsConfigBtn = buttons.find((b) =>
      b.textContent?.includes("Workspace Config"),
    );
    const maintenanceBtn = buttons.find((b) =>
      b.textContent?.includes("Maintenance"),
    );

    expect(wsConfigBtn).toBeTruthy();
    expect(maintenanceBtn).toBeTruthy();

    const wsPanel = container.querySelector(
      `#${wsConfigBtn?.getAttribute("aria-controls")}`,
    );
    const maintPanel = container.querySelector(
      `#${maintenanceBtn?.getAttribute("aria-controls")}`,
    );

    expect(wsPanel?.hasAttribute("hidden")).toBe(true);
    expect(maintPanel?.hasAttribute("hidden")).toBe(true);

    // Expand Workspace Config
    await act(async () => {
      wsConfigBtn?.click();
    });
    expect(wsConfigBtn?.getAttribute("aria-expanded")).toBe("true");
    expect(wsPanel?.hasAttribute("hidden")).toBe(false);
    expect(maintenanceBtn?.getAttribute("aria-expanded")).toBe("false");
    expect(maintPanel?.hasAttribute("hidden")).toBe(true);

    // Expand Maintenance
    await act(async () => {
      maintenanceBtn?.click();
    });
    expect(wsConfigBtn?.getAttribute("aria-expanded")).toBe("true");
    expect(wsPanel?.hasAttribute("hidden")).toBe(false);
    expect(maintenanceBtn?.getAttribute("aria-expanded")).toBe("true");
    expect(maintPanel?.hasAttribute("hidden")).toBe(false);
  });
});

describe("SettingsPage Session Changes toggle integration", () => {
  let container: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    mockUpdateConfigMutate.mockReset();
    mockUpdateConfigMutate.mockResolvedValue({
      workspace: { name: "test-workspace", root: "." },
      projects: [],
      server: { sessionChangesEnabled: true },
    });
    mockConfigQuery.mockReset();
    mockConfigQuery.mockImplementation((owner?: ConnectionRef) => ({
      data: {
        workspace: { name: "test-workspace", root: "." },
        projects: [],
        server: {
          sessionChangesEnabled: owner?.profileId === "profile-1",
        },
      },
      isLoading: false,
      error: null,
    }));
    useWorkbenchSelectionsStore.getState().setSettingsProfileId(null);
    useWorkbenchSelectionsStore.getState().setPreferencesProfileId(null);
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

  async function expandSessionChangesSection() {
    const buttons = Array.from(
      container.querySelectorAll<HTMLButtonElement>("button[aria-expanded]"),
    );
    const sessionChangesBtn = buttons.find((b) =>
      b.textContent?.includes("Session Changes"),
    );
    expect(sessionChangesBtn).toBeTruthy();
    await act(async () => {
      sessionChangesBtn?.click();
    });
  }

  it("reflects server.sessionChangesEnabled and defaults visually OFF until authoritative config is available", async () => {
    mockConfigQuery.mockReturnValueOnce({
      data: undefined,
      isLoading: true,
      error: null,
    });

    act(() => {
      root.render(<SettingsPage />);
    });
    await expandSessionChangesSection();

    let toggle = container.querySelector<HTMLButtonElement>(
      '[role="switch"][aria-label="Toggle Session Changes tracking"]',
    );
    expect(toggle).toBeTruthy();
    expect(toggle?.getAttribute("aria-checked")).toBe("false");
    expect(toggle?.hasAttribute("disabled")).toBe(true);

    mockConfigQuery.mockReturnValueOnce({
      data: {
        workspace: { name: "test-workspace", root: "." },
        projects: [],
        server: { sessionChangesEnabled: true },
      },
      isLoading: false,
      error: null,
    });

    act(() => {
      root.render(<SettingsPage />);
    });
    await expandSessionChangesSection();

    toggle = container.querySelector<HTMLButtonElement>(
      '[role="switch"][aria-label="Toggle Session Changes tracking"]',
    );
    expect(toggle?.getAttribute("aria-checked")).toBe("true");
    expect(toggle?.hasAttribute("disabled")).toBe(false);
  });

  it("disables switch when target owner profile is not ready", async () => {
    useWorkbenchSelectionsStore
      .getState()
      .setSettingsProfileId("unknown-profile-999");

    act(() => {
      root.render(<SettingsPage />);
    });
    await expandSessionChangesSection();

    const toggle = container.querySelector<HTMLButtonElement>(
      '[role="switch"][aria-label="Toggle Session Changes tracking"]',
    );
    expect(toggle).toBeTruthy();
    expect(toggle?.hasAttribute("disabled")).toBe(true);
  });

  it("toggling ON calls updateConfig with sessionChangesEnabled: true and displays restart notice", async () => {
    mockConfigQuery.mockReturnValue({
      data: {
        workspace: { name: "test-workspace", root: "." },
        projects: [],
        server: { sessionChangesEnabled: false, sessionDbPath: "custom.db" },
      },
      isLoading: false,
      error: null,
    });

    act(() => {
      root.render(<SettingsPage />);
    });
    await expandSessionChangesSection();

    const toggle = container.querySelector<HTMLButtonElement>(
      '[role="switch"][aria-label="Toggle Session Changes tracking"]',
    );
    expect(toggle?.getAttribute("aria-checked")).toBe("false");

    await act(async () => {
      toggle?.click();
    });

    expect(mockUpdateConfigMutate).toHaveBeenCalledTimes(1);
    const updatedConfig = mockUpdateConfigMutate.mock.calls[0][1] as DamHopperConfig;
    expect(updatedConfig.server?.sessionChangesEnabled).toBe(true);
    expect(updatedConfig.server?.sessionDbPath).toBe("custom.db");

    const notice = container.querySelector(
      '[data-testid="session-changes-restart-notice"]',
    );
    expect(notice?.textContent).toContain(
      "Restart active OMP sessions to load the Session Changes extension",
    );
  });

  it("toggling OFF clears restart notice", async () => {
    mockConfigQuery.mockReturnValue({
      data: {
        workspace: { name: "test-workspace", root: "." },
        projects: [],
        server: { sessionChangesEnabled: true },
      },
      isLoading: false,
      error: null,
    });

    act(() => {
      root.render(<SettingsPage />);
    });
    await expandSessionChangesSection();

    const toggle = container.querySelector<HTMLButtonElement>(
      '[role="switch"][aria-label="Toggle Session Changes tracking"]',
    );
    expect(toggle?.getAttribute("aria-checked")).toBe("true");

    await act(async () => {
      toggle?.click();
    });

    expect(mockUpdateConfigMutate).toHaveBeenCalledTimes(1);
    const updatedConfig = mockUpdateConfigMutate.mock.calls[0][1] as DamHopperConfig;
    expect(updatedConfig.server?.sessionChangesEnabled).toBe(false);

    const notice = container.querySelector(
      '[data-testid="session-changes-restart-notice"]',
    );
    expect(notice).toBeNull();
  });

  it("surfaces mutation error honestly on failure", async () => {
    mockUpdateConfigMutate.mockRejectedValueOnce(
      new Error(
        "Failed to install managed session changes extension: Permission denied",
      ),
    );

    act(() => {
      root.render(<SettingsPage />);
    });
    await expandSessionChangesSection();

    const toggle = container.querySelector<HTMLButtonElement>(
      '[role="switch"][aria-label="Toggle Session Changes tracking"]',
    );

    await act(async () => {
      toggle?.click();
    });

    const errorAlert = container.querySelector(
      '[data-testid="session-changes-error"]',
    );
    expect(errorAlert?.textContent).toContain(
      "Failed to install managed session changes extension: Permission denied",
    );
  });

  it("fences late response when target profile switches during toggle mutation", async () => {
    const { promise, resolve } = Promise.withResolvers<DamHopperConfig>();
    mockUpdateConfigMutate.mockImplementationOnce(() => promise);

    useWorkbenchSelectionsStore.getState().setSettingsProfileId("profile-2");

    act(() => {
      root.render(<SettingsPage />);
    });
    await expandSessionChangesSection();

    const toggle = container.querySelector<HTMLButtonElement>(
      '[role="switch"][aria-label="Toggle Session Changes tracking"]',
    );
    // profile-2 starts with sessionChangesEnabled: false
    expect(toggle?.getAttribute("aria-checked")).toBe("false");

    act(() => {
      toggle?.click();
    });
    act(() => {
      useWorkbenchSelectionsStore.getState().setSettingsProfileId("profile-1");
    });

    await act(async () => {
      resolve({
        workspace: { name: "test-workspace", root: "." },
        projects: [],
        server: { sessionChangesEnabled: true },
      });
    });

    const notice = container.querySelector(
      '[data-testid="session-changes-restart-notice"]',
    );
    expect(notice).toBeNull();
  });

  it("isolates target profile from workbench preferences source", async () => {
    useWorkbenchSelectionsStore.getState().setSettingsProfileId("profile-1");
    useWorkbenchSelectionsStore.getState().setPreferencesProfileId("profile-2");

    act(() => {
      root.render(<SettingsPage />);
    });
    await expandSessionChangesSection();
    const toggle = container.querySelector<HTMLButtonElement>(
      '[role="switch"][aria-label="Toggle Session Changes tracking"]',
    );

    await act(async () => {
      toggle?.click();
    });

    expect(mockUpdateConfigMutate).toHaveBeenCalledTimes(1);
    const targetOwnerArg = mockUpdateConfigMutate.mock.calls[0][0] as ConnectionRef;
    expect(targetOwnerArg?.profileId).toBe("profile-1");
  });
});
