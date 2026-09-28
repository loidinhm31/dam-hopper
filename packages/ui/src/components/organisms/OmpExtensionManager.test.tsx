// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { OmpExtensionManager } from "./OmpExtensionManager.js";
import type { ExtensionStatusReport } from "@/api/agent-status-types.js";

const mockUseOmpExtensionStatus = vi.fn();
const mockInstallMutateAsync = vi.fn();
const mockUninstallMutateAsync = vi.fn();

vi.mock("@/api/queries.js", () => ({
  useOmpExtensionStatus: () => mockUseOmpExtensionStatus(),
  useInstallOmpExtension: () => ({
    mutateAsync: mockInstallMutateAsync,
    isPending: false,
  }),
  useUninstallOmpExtension: () => ({
    mutateAsync: mockUninstallMutateAsync,
    isPending: false,
  }),
}));

describe("OmpExtensionManager", () => {
  let container: HTMLDivElement | null = null;
  let root: Root | null = null;

  beforeEach(() => {
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
    mockInstallMutateAsync.mockReset();
    mockUninstallMutateAsync.mockReset();
  });

  afterEach(() => {
    if (root) {
      act(() => {
        root?.unmount();
      });
    }
    container?.remove();
    container = null;
    root = null;
  });

  it("renders absent status with Install Extension button", () => {
    const report: ExtensionStatusReport = {
      status: "absent",
      targetPath: "/home/user/.omp/agent/extensions/dam-hopper-agent-status.ts",
      version: null,
      bundledVersion: "1.0.0",
      contentHash: null,
      bundledHash: "hash123",
    };
    mockUseOmpExtensionStatus.mockReturnValue({
      data: report,
      isLoading: false,
      isError: false,
      refetch: vi.fn(),
    });

    act(() => {
      root?.render(<OmpExtensionManager />);
    });

    expect(container?.textContent).toContain("Oh My Pi (OMP) Lifecycle Extension");
    expect(container?.textContent).toContain("Not Installed");
    expect(container?.textContent).toContain("Install Extension");
    expect(container?.textContent).toContain("Hardened Single-Extension Boundary");
    expect(container?.textContent).toContain("/home/user/.omp/agent/extensions/dam-hopper-agent-status.ts");
  });

  it("renders current status with Remove Extension button", () => {
    const report: ExtensionStatusReport = {
      status: "current",
      targetPath: "/home/user/.omp/agent/extensions/dam-hopper-agent-status.ts",
      version: "1.0.0",
      bundledVersion: "1.0.0",
      contentHash: "hash123",
      bundledHash: "hash123",
    };
    mockUseOmpExtensionStatus.mockReturnValue({
      data: report,
      isLoading: false,
      isError: false,
      refetch: vi.fn(),
    });

    act(() => {
      root?.render(<OmpExtensionManager />);
    });

    expect(container?.textContent).toContain("Installed (v1.0.0)");
    expect(container?.textContent).toContain("Remove Extension");
  });

  it("triggers install mutation when Install button is clicked", async () => {
    const report: ExtensionStatusReport = {
      status: "absent",
      targetPath: "/home/user/.omp/agent/extensions/dam-hopper-agent-status.ts",
      version: null,
      bundledVersion: "1.0.0",
      contentHash: null,
      bundledHash: "hash123",
    };
    mockUseOmpExtensionStatus.mockReturnValue({
      data: report,
      isLoading: false,
      isError: false,
      refetch: vi.fn(),
    });
    mockInstallMutateAsync.mockResolvedValueOnce({
      ...report,
      status: "current",
      version: "1.0.0",
    });

    act(() => {
      root?.render(<OmpExtensionManager />);
    });

    const installBtn = Array.from(container?.querySelectorAll("button") ?? []).find(
      (b) => b.textContent?.includes("Install Extension"),
    );
    expect(installBtn).toBeDefined();

    await act(async () => {
      installBtn?.click();
    });

    expect(mockInstallMutateAsync).toHaveBeenCalledTimes(1);
    expect(container?.textContent).toContain("Extension installed successfully");
  });

  it("triggers uninstall mutation when Remove button is clicked", async () => {
    const report: ExtensionStatusReport = {
      status: "current",
      targetPath: "/home/user/.omp/agent/extensions/dam-hopper-agent-status.ts",
      version: "1.0.0",
      bundledVersion: "1.0.0",
      contentHash: "hash123",
      bundledHash: "hash123",
    };
    mockUseOmpExtensionStatus.mockReturnValue({
      data: report,
      isLoading: false,
      isError: false,
      refetch: vi.fn(),
    });
    mockUninstallMutateAsync.mockResolvedValueOnce({
      ...report,
      status: "absent",
      version: null,
    });

    act(() => {
      root?.render(<OmpExtensionManager />);
    });

    const removeBtn = Array.from(container?.querySelectorAll("button") ?? []).find(
      (b) => b.textContent?.includes("Remove Extension"),
    );
    expect(removeBtn).toBeDefined();

    await act(async () => {
      removeBtn?.click();
    });

    expect(mockUninstallMutateAsync).toHaveBeenCalledTimes(1);
    expect(container?.textContent).toContain("Extension uninstalled successfully");
  });
});
