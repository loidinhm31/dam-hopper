// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { AgentSettings } from "./AgentSettings.js";
import type {
  AgentPathsVerification,
  ExtensionStatusReport,
} from "@/api/agent-status-types.js";

const mockVerification: AgentPathsVerification = {
  effectiveHome: "/home/testuser",
  ompInstallDir: "/home/testuser/.omp/agent",
  ompNotificationDir: "/home/testuser/.omp/agent",
  ompStatus: "current",
  ompCanEnable: true,
  ompReason: undefined,
  codexConfigDir: "/home/testuser/.codex",
  codexNotificationDir: "/home/testuser/.codex",
  codexConfigExists: true,
  codexCanEnable: true,
  codexReason: undefined,
};

const mockOmpReport: ExtensionStatusReport = {
  status: "current",
  targetPath: "/home/testuser/.omp/agent/extensions/dam-hopper-agent-status.ts",
  version: "1.0.0",
  bundledVersion: "1.0.0",
  contentHash: "hash123",
  bundledHash: "hash123",
};

let currentVerification = { ...mockVerification };
let currentOmpReport = { ...mockOmpReport };

const mutateInstall = vi.fn().mockResolvedValue(mockOmpReport);
const mutateUninstall = vi
  .fn()
  .mockResolvedValue({ ...mockOmpReport, status: "absent" });
const saveAgentNotificationPolicy = vi.fn();
const saveAgentSettingsPaths = vi.fn();

vi.mock("@/api/queries.js", () => ({
  useAgentPathsVerification: () => ({
    data: currentVerification,
    isLoading: false,
    refetch: vi.fn(),
  }),
  useOmpExtensionStatus: () => ({
    data: currentOmpReport,
    isLoading: false,
    refetch: vi.fn(),
  }),
  useInstallOmpExtension: () => ({
    mutateAsync: mutateInstall,
    isPending: false,
  }),
  useUninstallOmpExtension: () => ({
    mutateAsync: mutateUninstall,
    isPending: false,
  }),
}));

vi.mock("@/stores/settings.js", () => ({
  useSettingsStore: () => ({
    terminalAgentNotifications: {
      version: 2,
      agents: {
        omp: {
          enabled: true,
          toast: true,
          browser: false,
          sound: false,
          volume: 100,
          pattern: "default",
        },
        codex: {
          enabled: false,
          toast: true,
          browser: false,
          sound: false,
          volume: 100,
          pattern: "default",
        },
        claude: {
          enabled: false,
          toast: true,
          browser: false,
          sound: false,
          volume: 100,
          pattern: "default",
        },
      },
    },
    saveAgentNotificationPolicy,
    agentSettingsPaths: {
      ompAgentDir: "~/.omp/agent",
      codexDir: "~/.codex",
    },
    saveAgentSettingsPaths,
  }),
}));

vi.mock("@/lib/browser-notification-service.js", () => ({
  getBrowserNotificationPermissionState: () => "granted",
  requestBrowserNotificationPermission: vi.fn().mockResolvedValue("granted"),
}));

describe("AgentSettings", () => {
  let container: HTMLDivElement | null = null;
  let root: Root | null = null;

  beforeEach(() => {
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
    currentVerification = { ...mockVerification };
    currentOmpReport = { ...mockOmpReport };
    vi.clearAllMocks();
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

  it("renders OMP and Codex sections with verified status", async () => {
    await act(async () => {
      root?.render(<AgentSettings />);
    });

    expect(container?.textContent).toContain(
      "Oh My Pi (OMP) Integration & Notifications",
    );
    expect(container?.textContent).toContain(
      "Codex Configuration & Notifications",
    );
    expect(container?.textContent).toContain("Installed (v1.0.0)");
    expect(container?.textContent).toContain("Config Verified");
  });

  it("disables OMP notification toggle when path verification fails", async () => {
    currentVerification = {
      ...mockVerification,
      ompCanEnable: false,
      ompReason:
        "Configured install path does not match notification runtime path",
    };

    await act(async () => {
      root?.render(<AgentSettings />);
    });

    expect(container?.textContent).toContain(
      "Notifications Unavailable for OMP",
    );
    expect(container?.textContent).toContain(
      "Configured install path does not match notification runtime path",
    );

    const ompSwitch = container?.querySelector(
      'button[aria-label="Enable OMP notifications"]',
    );
    expect(ompSwitch?.hasAttribute("disabled")).toBe(true);
  });

  it("disables Codex notification toggle when codex config is missing", async () => {
    currentVerification = {
      ...mockVerification,
      codexConfigExists: false,
      codexCanEnable: false,
      codexReason: "Codex config file not found",
    };

    await act(async () => {
      root?.render(<AgentSettings />);
    });

    expect(container?.textContent).toContain(
      "Notifications Unavailable for Codex",
    );
    expect(container?.textContent).toContain("Codex config file not found");

    const codexSwitch = container?.querySelector(
      'button[aria-label="Enable Codex notifications"]',
    );
    expect(codexSwitch?.hasAttribute("disabled")).toBe(true);
  });

  it("saves OMP path when clicking Save Path", async () => {
    await act(async () => {
      root?.render(<AgentSettings />);
    });

    const ompInput = container?.querySelector<HTMLInputElement>(
      "#omp-agent-dir-input",
    );
    expect(ompInput).toBeDefined();

    act(() => {
      if (ompInput) {
        ompInput.value = "/custom/omp/path";
        ompInput.dispatchEvent(new Event("input", { bubbles: true }));
      }
    });

    const saveButtons = container?.querySelectorAll("button");
    const saveOmpBtn = Array.from(saveButtons ?? []).find(
      (btn) => btn.textContent === "Save Path",
    );

    await act(async () => {
      saveOmpBtn?.click();
    });

    expect(saveAgentSettingsPaths).toHaveBeenCalledWith({
      ompAgentDir: "~/.omp/agent",
    });
  });

  it("calls uninstall extension when clicking Remove Extension", async () => {
    await act(async () => {
      root?.render(<AgentSettings />);
    });

    const removeBtn = Array.from(
      container?.querySelectorAll("button") ?? [],
    ).find((btn) => btn.textContent === "Remove Extension");
    expect(removeBtn).toBeDefined();

    await act(async () => {
      removeBtn?.click();
    });

    expect(mutateUninstall).toHaveBeenCalled();
  });
});
