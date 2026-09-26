// @vitest-environment jsdom

import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { PluginManagementSection } from "./PluginManagementSection.js";
import type { ApiClient } from "@/api/client.js";
import type {
  AdminInstallationDto,
  AdminInstallationListResult,
  StageReviewDto,
} from "@/api/plugin-types.js";

vi.mock("@/hooks/use-aggregated-projects.js", () => ({
  useAggregatedProjects: () => ({
    groups: [],
    allProjects: [
      {
        profileId: "test-profile",
        profileName: "Test Profile",
        serverUrl: "http://localhost:4801",
        project: { name: "test-proj", path: "/path/to/test-proj" },
        ref: { profileId: "test-profile", project: "test-proj" },
      },
    ],
    isLoading: false,
  }),
}));

describe("PluginManagementSection", () => {
  let container: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);

    globalThis.fetch = vi.fn().mockImplementation(async (url: string | URL | Request) => {
      const urlStr = String(url);
      if (urlStr.includes("/api/auth/status")) {
        return {
          ok: true,
          status: 200,
          json: async () => ({
            authenticated: true,
            user: "admin-user",
            role: "admin",
            workbenchProtocol: 2,
          }),
        };
      }
      return { ok: false, status: 404, json: async () => ({}) };
    }) as unknown as typeof fetch;
  });

  afterEach(() => {
    act(() => {
      root.unmount();
    });
    container.remove();
    vi.restoreAllMocks();
  });

  function createMockClient(overrides: Partial<ApiClient["plugins"]> = {}): ApiClient {
    const defaultPlugins: ApiClient["plugins"] = {
      list: vi.fn(),
      getEpoch: vi.fn(),
      readUiAsset: vi.fn(),
      openContext: vi.fn(),
      closeContext: vi.fn(),
      invoke: vi.fn(),
      cancel: vi.fn(),
      onRevoked: vi.fn(() => () => {}),
      adminList: vi.fn().mockResolvedValue({
        installations: [],
        securityRevision: 1,
      } as AdminInstallationListResult),
      adminGet: vi.fn(),
      adminStage: vi.fn(),
      adminApprove: vi.fn(),
      adminRollback: vi.fn(),
      adminEnable: vi.fn(),
      adminDisable: vi.fn(),
      adminRemove: vi.fn(),
      adminReplaceGrants: vi.fn(),
      adminReplaceBindings: vi.fn(),
      adminReplaceOwnerHistorySource: vi.fn(),
      onLifecycleRevision: vi.fn(() => () => {}),
      ...overrides,
    };

    return {
      owner: { profileId: "test-profile", generation: 1 },
      transport: {} as unknown as ApiClient["transport"],
      workspace: {} as unknown as ApiClient["workspace"],
      git: {} as unknown as ApiClient["git"],
      fs: {} as unknown as ApiClient["fs"],
      terminal: {} as unknown as ApiClient["terminal"],
      tunnel: {} as unknown as ApiClient["tunnel"],
      portForward: {} as unknown as ApiClient["portForward"],
      system: {} as unknown as ApiClient["system"],
      hostActions: {} as unknown as ApiClient["hostActions"],
      diagnostics: {} as unknown as ApiClient["diagnostics"],
      browserDebug: {} as unknown as ApiClient["browserDebug"],
      settings: {} as unknown as ApiClient["settings"],
      workflow: {} as unknown as ApiClient["workflow"],
      plugins: defaultPlugins,
    };
  }

  it("renders unauthorized message when adminList fails with 401/403", async () => {
    const mockClient = createMockClient({
      adminList: vi.fn().mockRejectedValue(new Error("401 Unauthorized: Actor is not admin")),
    });

    await act(async () => {
      root.render(<PluginManagementSection client={mockClient} />);
    });

    expect(container.querySelector('[data-testid="plugin-admin-unauthorized"]')).toBeTruthy();
    expect(container.textContent).toContain("Administrator Access Required");
  });

  it("renders user account and role badge", async () => {
    const mockClient = createMockClient();

    await act(async () => {
      root.render(<PluginManagementSection client={mockClient} />);
    });

    expect(container.querySelector('[data-testid="auth-user-name"]')?.textContent).toBe("admin-user");
    expect(container.querySelector('[data-testid="auth-role-badge"]')?.textContent).toContain("admin");
  });

  it("renders non-admin warning and hides staging controls when role is user", async () => {
    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({
        authenticated: true,
        user: "standard-user",
        role: "user",
        workbenchProtocol: 2,
      }),
    } as unknown as Response);

    const mockClient = createMockClient();

    await act(async () => {
      root.render(<PluginManagementSection client={mockClient} />);
    });

    expect(container.querySelector('[data-testid="plugin-admin-role-warning"]')).toBeTruthy();
    expect(container.textContent).toContain("Non-Administrator Account");
    // Stage upload form is hidden for non-admin
    expect(container.querySelector('[data-testid="stage-file-input"]')).toBeNull();
  });

  it("renders empty state when no plugins are installed", async () => {
    const mockClient = createMockClient({
      adminList: vi.fn().mockResolvedValue({
        installations: [],
        securityRevision: 1,
      }),
    });

    await act(async () => {
      root.render(<PluginManagementSection client={mockClient} />);
    });

    expect(container.querySelector('[data-testid="no-plugins-message"]')).toBeTruthy();
    expect(container.textContent).toContain("No plugins installed");
  });

  it("renders installed plugins with version, digest, action buttons, and diagnostic chip", async () => {
    const testInst: AdminInstallationDto = {
      installationId: "inst-1",
      pluginId: "evcrate-advisor",
      activePackageDigest: "a".repeat(64),
      activeVersion: "1.0.0",
      activationGeneration: 1,
      enabled: true,
      bindings: { "test-proj": "approved-source" },
      grants: [],
      hasUi: true,
      workerStatus: "ready",
      previousPackage: {
        packageDigest: "b".repeat(64),
        version: "0.9.0",
        bindings: {},
        publishedAt: "2026-09-22T00:00:00Z",
      },
      canRollback: true,
      securityRevision: 1,
      createdAt: "2026-09-22T00:00:00Z",
      updatedAt: "2026-09-22T00:00:00Z",
    };

    const mockClient = createMockClient({
      adminList: vi.fn().mockResolvedValue({
        installations: [testInst],
        securityRevision: 1,
      }),
    });

    await act(async () => {
      root.render(<PluginManagementSection client={mockClient} />);
    });

    expect(container.querySelector('[data-testid="plugin-item-inst-1"]')).toBeTruthy();
    expect(container.textContent).toContain("evcrate-advisor");
    expect(container.textContent).toContain("v1.0.0");
    expect(container.textContent).toContain("Enabled");
    expect(container.textContent).toContain("gen 1");
    expect(container.textContent).toContain("worker: ready");
    expect(container.querySelector('[data-testid="diagnostic-chip-inst-1"]')?.textContent).toContain("0 Grants");
    expect(container.querySelector('[data-testid="manage-access-inst-1"]')).toBeTruthy();
    expect(container.querySelector('[data-testid="rollback-inst-1"]')).toBeTruthy();
    expect(container.querySelector('[data-testid="remove-inst-1"]')).toBeTruthy();
    expect(container.querySelector('[data-testid="toggle-enable-inst-1"]')).toBeTruthy();
  });

  it("calls adminDisable when Disable button is clicked for enabled plugin", async () => {
    const testInst: AdminInstallationDto = {
      installationId: "inst-1",
      pluginId: "evcrate-advisor",
      activePackageDigest: "a".repeat(64),
      activeVersion: "1.0.0",
      activationGeneration: 1,
      enabled: true,
      bindings: {},
      grants: [],
      hasUi: false,
      workerStatus: "ready",
      canRollback: false,
      securityRevision: 1,
      createdAt: "2026-09-22T00:00:00Z",
      updatedAt: "2026-09-22T00:00:00Z",
    };

    const adminDisable = vi.fn().mockResolvedValue({
      ...testInst,
      enabled: false,
    });

    const mockClient = createMockClient({
      adminList: vi.fn().mockResolvedValue({
        installations: [testInst],
        securityRevision: 1,
      }),
      adminDisable,
    });

    await act(async () => {
      root.render(<PluginManagementSection client={mockClient} />);
    });

    const disableBtn = container.querySelector<HTMLButtonElement>('[data-testid="toggle-enable-inst-1"]');
    expect(disableBtn).toBeTruthy();

    await act(async () => {
      disableBtn?.click();
    });

    expect(adminDisable).toHaveBeenCalledWith("inst-1", {
      expectedSecurityRevision: 1,
    });
  });

  it("handles staging package upload and displays immutable review card with access setup", async () => {
    const mockReview: StageReviewDto = {
      stageId: "stage-123",
      transactionId: "tx-456",
      pluginId: "test-plugin",
      version: "2.0.0",
      publisher: "test-org",
      hostVersionRange: ">=0.4.0",
      contracts: { runnerProtocol: "1.0.0" },
      capabilities: ["advisor.scan"],
      entrypoints: {
        backend: { entry: "backend/worker.cjs" },
        ui: { entry: "ui/index.html", mode: "isolated-srcdoc" },
      },
      totalEntries: 10,
      uncompressedBytes: 20480,
      archiveSha256: "c".repeat(64),
      securityRevision: 1,
      stageExpiresAt: "2026-09-22T01:00:00Z",
    };

    const adminStage = vi.fn().mockResolvedValue(mockReview);
    const mockClient = createMockClient({ adminStage });

    await act(async () => {
      root.render(<PluginManagementSection client={mockClient} />);
    });

    const fileInput = container.querySelector<HTMLInputElement>('[data-testid="stage-file-input"]');
    const shaInput = container.querySelector<HTMLInputElement>('[data-testid="expected-sha256-input"]');
    const uploadBtn = container.querySelector<HTMLButtonElement>('[data-testid="stage-upload-btn"]');

    expect(fileInput).toBeTruthy();
    expect(shaInput).toBeTruthy();
    expect(uploadBtn).toBeTruthy();

    const file = new File(["dummy content"], "plugin.tar.gz", { type: "application/gzip" });

    await act(async () => {
      Object.defineProperty(fileInput, "files", {
        value: [file],
        configurable: true,
      });
      fileInput?.dispatchEvent(new Event("change", { bubbles: true }));

      const nativeSetter = Object.getOwnPropertyDescriptor(
        window.HTMLInputElement.prototype,
        "value",
      )?.set;
      nativeSetter?.call(shaInput, "c".repeat(64));
      shaInput?.dispatchEvent(new Event("input", { bubbles: true }));
      shaInput?.dispatchEvent(new Event("change", { bubbles: true }));
    });

    const form = container.querySelector<HTMLFormElement>("form");
    await act(async () => {
      form?.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }));
    });

    // Verify review card displayed with access setup fields
    expect(container.querySelector('[data-testid="stage-review-card"]')).toBeTruthy();
    expect(container.textContent).toContain("test-plugin");
    expect(container.textContent).toContain("v2.0.0");
    expect(container.querySelector('[data-testid="stage-project-select"]')).toBeTruthy();
    expect(container.querySelector('[data-testid="stage-actor-input"]')).toBeTruthy();
    expect(container.querySelector('[data-testid="approve-stage-btn"]')).toBeTruthy();
    expect(container.querySelector('[data-testid="discard-stage-btn"]')).toBeTruthy();
  });

  it("calls adminApprove with initialBindings and initialGrants when Approve & Activate is clicked", async () => {
    const mockReview: StageReviewDto = {
      stageId: "stage-123",
      transactionId: "tx-456",
      pluginId: "test-plugin",
      version: "2.0.0",
      publisher: "test-org",
      hostVersionRange: ">=0.4.0",
      contracts: { runnerProtocol: "1.0.0" },
      capabilities: ["advisor.scan"],
      entrypoints: {
        backend: { entry: "backend/worker.cjs" },
      },
      totalEntries: 5,
      uncompressedBytes: 1024,
      archiveSha256: "d".repeat(64),
      securityRevision: 1,
      stageExpiresAt: "2026-09-22T01:00:00Z",
    };

    const adminApprove = vi.fn().mockResolvedValue({
      installationId: "inst-new",
      pluginId: "test-plugin",
      activePackageDigest: "d".repeat(64),
      activeVersion: "2.0.0",
      activationGeneration: 1,
      enabled: true,
      bindings: { "test-proj": "/path/to/test-proj" },
      grants: [
        {
          actorSubject: "admin-user",
          installationId: "inst-new",
          configuredProjectTarget: "test-proj",
          allowedOperations: ["advisor.scan"],
          allowCurrentAccountPolicy: false,
        },
      ],
      hasUi: false,
      workerStatus: "ready",
      canRollback: false,
      securityRevision: 1,
      createdAt: "2026-09-22T00:00:00Z",
      updatedAt: "2026-09-22T00:00:00Z",
    });

    const mockClient = createMockClient({
      adminStage: vi.fn().mockResolvedValue(mockReview),
      adminApprove,
    });

    await act(async () => {
      root.render(<PluginManagementSection client={mockClient} />);
    });

    // Stage the file first
    const file = new File(["dummy content"], "plugin.tar.gz", { type: "application/gzip" });
    const fileInput = container.querySelector<HTMLInputElement>('[data-testid="stage-file-input"]');
    const shaInput = container.querySelector<HTMLInputElement>('[data-testid="expected-sha256-input"]');

    await act(async () => {
      Object.defineProperty(fileInput, "files", {
        value: [file],
        configurable: true,
      });
      fileInput?.dispatchEvent(new Event("change", { bubbles: true }));

      const nativeSetter = Object.getOwnPropertyDescriptor(
        window.HTMLInputElement.prototype,
        "value",
      )?.set;
      nativeSetter?.call(shaInput, "d".repeat(64));
      shaInput?.dispatchEvent(new Event("input", { bubbles: true }));
      shaInput?.dispatchEvent(new Event("change", { bubbles: true }));
    });

    const form = container.querySelector<HTMLFormElement>("form");
    await act(async () => {
      form?.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }));
    });

    const projectSelect = container.querySelector<HTMLSelectElement>('[data-testid="stage-project-select"]');
    const actorInput = container.querySelector<HTMLInputElement>('[data-testid="stage-actor-input"]');
    const opsInput = container.querySelector<HTMLInputElement>('[data-testid="stage-ops-input"]');
    const approveBtn = container.querySelector<HTMLButtonElement>('[data-testid="approve-stage-btn"]');
    expect(approveBtn).toBeTruthy();

    await act(async () => {
      if (projectSelect) {
        projectSelect.value = "test-proj";
        projectSelect.dispatchEvent(new Event("change", { bubbles: true }));
      }
      if (actorInput) {
        const nativeSetter = Object.getOwnPropertyDescriptor(
          window.HTMLInputElement.prototype,
          "value",
        )?.set;
        nativeSetter?.call(actorInput, "admin-user");
        actorInput.dispatchEvent(new Event("input", { bubbles: true }));
        actorInput.dispatchEvent(new Event("change", { bubbles: true }));
      }
      if (opsInput) {
        const nativeSetter = Object.getOwnPropertyDescriptor(
          window.HTMLInputElement.prototype,
          "value",
        )?.set;
        nativeSetter?.call(opsInput, "advisor.scan");
        opsInput.dispatchEvent(new Event("input", { bubbles: true }));
        opsInput.dispatchEvent(new Event("change", { bubbles: true }));
      }
      approveBtn?.click();
    });

    expect(adminApprove).toHaveBeenCalledWith("stage-123", {
      expectedSha256: "d".repeat(64),
      expectedSecurityRevision: 1,
      initialBindings: { "test-proj": "/path/to/test-proj" },
      initialGrants: [
        {
          actorSubject: "admin-user",
          configuredProjectTarget: "test-proj",
          allowedOperations: ["advisor.scan"],
          allowCurrentAccountPolicy: false,
        },
      ],
      ownerHistorySource: undefined,
    });
  });

  it("opens PluginAccessModal on Manage Access and saves updated access settings", async () => {
    const testInst: AdminInstallationDto = {
      installationId: "inst-1",
      pluginId: "evcrate-advisor",
      activePackageDigest: "a".repeat(64),
      activeVersion: "1.0.0",
      activationGeneration: 1,
      enabled: true,
      bindings: { "test-proj": "/path/to/test-proj" },
      grants: [],
      hasUi: true,
      workerStatus: "ready",
      canRollback: false,
      securityRevision: 1,
      createdAt: "2026-09-22T00:00:00Z",
      updatedAt: "2026-09-22T00:00:00Z",
    };

    const adminReplaceGrants = vi.fn().mockResolvedValue({
      ...testInst,
      securityRevision: 2,
    });
    const adminReplaceBindings = vi.fn().mockResolvedValue({
      ...testInst,
      securityRevision: 2,
    });
    const adminReplaceOwnerHistorySource = vi.fn().mockResolvedValue({
      ...testInst,
      securityRevision: 3,
    });

    const mockClient = createMockClient({
      adminList: vi.fn().mockResolvedValue({
        installations: [testInst],
        securityRevision: 1,
      }),
      adminReplaceGrants,
      adminReplaceBindings,
      adminReplaceOwnerHistorySource,
    });

    await act(async () => {
      root.render(<PluginManagementSection client={mockClient} />);
    });

    const manageBtn = container.querySelector<HTMLButtonElement>('[data-testid="manage-access-inst-1"]');
    expect(manageBtn).toBeTruthy();

    await act(async () => {
      manageBtn?.click();
    });

    // Modal is open
    expect(document.querySelector('[data-testid="plugin-access-modal"]')).toBeTruthy();

    // Add a grant
    const actorInput = document.querySelector<HTMLInputElement>('[data-testid="grant-actor-input"]');
    const addGrantBtn = document.querySelector<HTMLButtonElement>('[data-testid="add-grant-btn"]');
    expect(actorInput).toBeTruthy();
    expect(addGrantBtn).toBeTruthy();

    await act(async () => {
      const nativeSetter = Object.getOwnPropertyDescriptor(
        window.HTMLInputElement.prototype,
        "value",
      )?.set;
      nativeSetter?.call(actorInput, "developer-alice");
      actorInput?.dispatchEvent(new Event("input", { bubbles: true }));
      actorInput?.dispatchEvent(new Event("change", { bubbles: true }));
      addGrantBtn?.click();
    });

    // Save access settings
    const saveBtn = document.querySelector<HTMLButtonElement>('[data-testid="save-access-btn"]');
    expect(saveBtn).toBeTruthy();

    await act(async () => {
      saveBtn?.click();
    });

    expect(adminReplaceBindings).toHaveBeenCalled();
    expect(adminReplaceGrants).toHaveBeenCalled();
    expect(adminReplaceOwnerHistorySource).toHaveBeenCalled();
  });

  it("handles rollback confirmation dialog and calls adminRollback", async () => {
    const testInst: AdminInstallationDto = {
      installationId: "inst-1",
      pluginId: "evcrate-advisor",
      activePackageDigest: "a".repeat(64),
      activeVersion: "1.1.0",
      activationGeneration: 2,
      enabled: true,
      bindings: {},
      grants: [],
      hasUi: false,
      workerStatus: "ready",
      previousPackage: {
        packageDigest: "b".repeat(64),
        version: "1.0.0",
        bindings: {},
        publishedAt: "2026-09-22T00:00:00Z",
      },
      canRollback: true,
      securityRevision: 1,
      createdAt: "2026-09-22T00:00:00Z",
      updatedAt: "2026-09-22T00:00:00Z",
    };

    const adminRollback = vi.fn().mockResolvedValue({
      ...testInst,
      activeVersion: "1.0.0",
    });

    const mockClient = createMockClient({
      adminList: vi.fn().mockResolvedValue({
        installations: [testInst],
        securityRevision: 1,
      }),
      adminRollback,
    });

    await act(async () => {
      root.render(<PluginManagementSection client={mockClient} />);
    });

    const rollbackBtn = container.querySelector<HTMLButtonElement>('[data-testid="rollback-inst-1"]');
    expect(rollbackBtn).toBeTruthy();

    await act(async () => {
      rollbackBtn?.click();
    });

    expect(document.body.textContent).toContain("Confirm Rollback");

    const confirmBtn = Array.from(document.body.querySelectorAll("button")).find(
      (b) => b.textContent?.includes("Rollback Plugin"),
    );
    expect(confirmBtn).toBeTruthy();

    await act(async () => {
      confirmBtn?.click();
    });

    expect(adminRollback).toHaveBeenCalledWith("inst-1", {
      expectedSecurityRevision: 1,
    });
  });

  it("handles remove confirmation dialog and calls adminRemove", async () => {
    const testInst: AdminInstallationDto = {
      installationId: "inst-1",
      pluginId: "evcrate-advisor",
      activePackageDigest: "a".repeat(64),
      activeVersion: "1.0.0",
      activationGeneration: 1,
      enabled: true,
      bindings: {},
      grants: [],
      hasUi: false,
      workerStatus: "ready",
      canRollback: false,
      securityRevision: 1,
      createdAt: "2026-09-22T00:00:00Z",
      updatedAt: "2026-09-22T00:00:00Z",
    };

    const adminRemove = vi.fn().mockResolvedValue({
      installationId: "inst-1",
      removed: true,
      cleanedPackages: [],
    });

    const mockClient = createMockClient({
      adminList: vi.fn().mockResolvedValue({
        installations: [testInst],
        securityRevision: 1,
      }),
      adminRemove,
    });

    await act(async () => {
      root.render(<PluginManagementSection client={mockClient} />);
    });

    const removeBtn = container.querySelector<HTMLButtonElement>('[data-testid="remove-inst-1"]');
    expect(removeBtn).toBeTruthy();

    await act(async () => {
      removeBtn?.click();
    });

    expect(document.body.textContent).toContain("Permanently remove installation");

    const confirmBtn = Array.from(document.body.querySelectorAll("button")).find(
      (b) => b.textContent?.includes("Remove Installation"),
    );
    expect(confirmBtn).toBeTruthy();

    await act(async () => {
      confirmBtn?.click();
    });

    expect(adminRemove).toHaveBeenCalledWith("inst-1", 1);
  });
});
