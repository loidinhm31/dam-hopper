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

describe("PluginManagementSection", () => {
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

  it("renders installed plugins with version, digest, and action buttons", async () => {
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

  it("handles staging package upload and displays immutable review card", async () => {
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
    expect(adminStage).toHaveBeenCalledTimes(1);

    // Verify review card displayed
    expect(container.querySelector('[data-testid="stage-review-card"]')).toBeTruthy();
    expect(container.textContent).toContain("test-plugin");
    expect(container.textContent).toContain("v2.0.0");
    expect(container.textContent).toContain("Publisher: test-org");
    expect(container.textContent).toContain("Verified Integrity");
    expect(container.querySelector('[data-testid="approve-stage-btn"]')).toBeTruthy();
    expect(container.querySelector('[data-testid="discard-stage-btn"]')).toBeTruthy();
  });

  it("calls adminApprove when Approve & Activate is clicked on review card", async () => {
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
      bindings: {},
      grants: [],
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
    const uploadBtn = container.querySelector<HTMLButtonElement>('[data-testid="stage-upload-btn"]');

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

    const approveBtn = container.querySelector<HTMLButtonElement>('[data-testid="approve-stage-btn"]');
    expect(approveBtn).toBeTruthy();

    await act(async () => {
      approveBtn?.click();
    });

    expect(adminApprove).toHaveBeenCalledWith("stage-123", {
      expectedSha256: "d".repeat(64),
      expectedSecurityRevision: 1,
    });
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
      activePackageDigest: "b".repeat(64),
      activationGeneration: 3,
      canRollback: false,
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

    // Open rollback dialog
    await act(async () => {
      rollbackBtn?.click();
    });

    expect(document.body.textContent).toContain("Rollback plugin package?");

    // Confirm rollback
    const confirmBtn = Array.from(document.body.querySelectorAll("button")).find(
      (b) => b.textContent?.includes("Confirm Rollback"),
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

    // Open remove dialog
    await act(async () => {
      removeBtn?.click();
    });

    expect(document.body.textContent).toContain("Remove plugin installation?");

    // Confirm remove
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
