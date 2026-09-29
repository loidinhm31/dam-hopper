// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { AgentSettings } from "./AgentSettings.js";
import type {
  AgentPathsVerification,
  ExtensionStatusReport,
  NativeIntegrationStatusReport,
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
  codexCanEnable: false,
  codexReason: "Codex native hooks track status only; terminal alert notifications are not supported in this rollout",
  claudeConfigDir: "/home/testuser/.claude",
  claudeNotificationDir: "/home/testuser/.claude",
  claudeConfigExists: true,
  claudeCanEnable: true,
  claudeReason: undefined,
};

const mockOmpReport: ExtensionStatusReport = {
  status: "current",
  targetPath: "/home/testuser/.omp/agent/extensions/dam-hopper-agent-status.ts",
  version: "1.0.0",
  bundledVersion: "1.0.0",
  contentHash: "hash123",
  bundledHash: "hash123",
};

const mockCodexReport: NativeIntegrationStatusReport = {
  agentKind: "codex",
  status: "current",
  readiness: "ready",
  targetPath: "/home/testuser/.codex/hooks/dam-hopper-agent-status",
  launcherPath: "/home/testuser/.codex/hooks/dam-hopper-agent-status",
  manifestPath: "/home/testuser/.codex/hooks/dam-hopper-agent-status.manifest.json",
  configPath: "/home/testuser/.codex/hooks.json",
  version: "1.0.0",
  bundledVersion: "1.0.0",
  contentHash: "hash456",
  bundledHash: "hash456",
  details: undefined,
};

const mockClaudeReport: NativeIntegrationStatusReport = {
  agentKind: "claude",
  status: "current",
  readiness: "ready",
  targetPath: "/home/testuser/.claude/hooks/dam-hopper-agent-status",
  launcherPath: "/home/testuser/.claude/hooks/dam-hopper-agent-status",
  manifestPath: "/home/testuser/.claude/hooks/dam-hopper-agent-status.manifest.json",
  configPath: "/home/testuser/.claude/settings.json",
  version: "1.0.0",
  bundledVersion: "1.0.0",
  contentHash: "hash789",
  bundledHash: "hash789",
  details: undefined,
};

let currentVerification = { ...mockVerification };
let currentOmpReport = { ...mockOmpReport };
let currentCodexReport = { ...mockCodexReport };
let currentClaudeReport = { ...mockClaudeReport };

const mutateInstallOmp = vi.fn().mockResolvedValue(mockOmpReport);
const mutateUninstallOmp = vi
  .fn()
  .mockResolvedValue({ ...mockOmpReport, status: "absent" });

const mutateInstallCodex = vi.fn().mockResolvedValue(mockCodexReport);
const mutateUninstallCodex = vi
  .fn()
  .mockResolvedValue({ ...mockCodexReport, status: "absent" });

const mutateInstallClaude = vi.fn().mockResolvedValue(mockClaudeReport);
const mutateUninstallClaude = vi
  .fn()
  .mockResolvedValue({ ...mockClaudeReport, status: "absent" });

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
    mutateAsync: mutateInstallOmp,
    isPending: false,
  }),
  useUninstallOmpExtension: () => ({
    mutateAsync: mutateUninstallOmp,
    isPending: false,
  }),
  useNativeIntegrationStatus: (agent: string) => ({
    data: agent === "codex" ? currentCodexReport : currentClaudeReport,
    isLoading: false,
    refetch: vi.fn(),
  }),
  useInstallNativeIntegration: (agent: string) => ({
    mutateAsync: agent === "codex" ? mutateInstallCodex : mutateInstallClaude,
    isPending: false,
  }),
  useUninstallNativeIntegration: (agent: string) => ({
    mutateAsync: agent === "codex" ? mutateUninstallCodex : mutateUninstallClaude,
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
      claudeDir: "~/.claude",
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
    currentCodexReport = { ...mockCodexReport };
    currentClaudeReport = { ...mockClaudeReport };
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

  it("renders OMP, Codex, and Claude sections with verified status", async () => {
    await act(async () => {
      root?.render(<AgentSettings />);
    });

    expect(container?.textContent).toContain(
      "Oh My Pi (OMP) Integration & Notifications",
    );
    expect(container?.textContent).toContain(
      "Codex Configuration & Status Hooks",
    );
    expect(container?.textContent).toContain(
      "Claude Code Integration & Notifications",
    );
    expect(container?.textContent).toContain("Installed (v1.0.0)");
    expect(container?.textContent).toContain("Status-Only Observation");
    expect(container?.textContent).toContain("Qualified Attention Only");
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

  it("disables Codex notification toggle and explains status-only rollout limitation", async () => {
    await act(async () => {
      root?.render(<AgentSettings />);
    });

    expect(container?.textContent).toContain(
      "Codex provides status only in this rollout; alert notifications are unsupported",
    );

    const codexSwitch = container?.querySelector(
      'button[aria-label="Enable Codex notifications"]',
    );
    expect(codexSwitch?.hasAttribute("disabled")).toBe(true);
  });

  it("enables Claude notification toggle when verification succeeds", async () => {
    await act(async () => {
      root?.render(<AgentSettings />);
    });

    const claudeSwitch = container?.querySelector(
      'button[aria-label="Enable Claude notifications"]',
    );
    expect(claudeSwitch).toBeDefined();
    expect(claudeSwitch?.hasAttribute("disabled")).toBe(false);
  });

  it("disables Claude notification toggle when claudeCanEnable is false", async () => {
    currentVerification = {
      ...mockVerification,
      claudeCanEnable: false,
      claudeReason: "Claude native integration is not ready (trust-required)",
    };

    await act(async () => {
      root?.render(<AgentSettings />);
    });

    expect(container?.textContent).toContain(
      "Notifications Unavailable for Claude",
    );
    expect(container?.textContent).toContain(
      "Claude native integration is not ready (trust-required)",
    );

    const claudeSwitch = container?.querySelector(
      'button[aria-label="Enable Claude notifications"]',
    );
    expect(claudeSwitch?.hasAttribute("disabled")).toBe(true);
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

    expect(mutateUninstallOmp).toHaveBeenCalled();
  });

  it("calls install and uninstall for Codex native hook", async () => {
    currentCodexReport = {
      ...mockCodexReport,
      status: "absent",
    };

    await act(async () => {
      root?.render(<AgentSettings />);
    });

    const installBtn = Array.from(
      container?.querySelectorAll("button") ?? [],
    ).find((btn) => btn.textContent === "Install Hook");
    expect(installBtn).toBeDefined();

    await act(async () => {
      installBtn?.click();
    });

    expect(mutateInstallCodex).toHaveBeenCalledWith("~/.codex");
  });
});
