// @vitest-environment jsdom
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useCognitoModeStore } from "@/stores/cognito-mode.js";
import { useSettingsStore } from "@/stores/settings.js";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { DamHopperApp } from "./dam-hopper-app.js";

vi.mock("@/api/connections.js", async (importOriginal) => {
  const actual = await importOriginal<Record<string, unknown>>();
  return {
    ...actual,
    connectProfile: vi.fn(),
    syncActiveProfileConnection: vi.fn(),
    registerConnectionRegistryQueryClient: vi.fn(() => () => {}),
    subscribeConnections: vi.fn(() => () => {}),
    getAllConnectionSnapshots: vi.fn(() => []),
  };
});

vi.mock("@/api/server-config.js", () => ({
  getServerUrl: () => "http://localhost:4801",
  buildAuthHeaders: () => ({}),
  getActiveProfile: () => null,
  migrateToProfiles: vi.fn(),
  normalizeServerUrl: (url: string) => url,
  getAuthToken: () => null,
  setAuthToken: vi.fn(),
  readServerProfiles: () => ({ status: "available", profiles: [] }),
  isSameOriginProfile: () => false,
  subscribeToProfileChanges: vi.fn(() => () => {}),
}));

vi.mock("@/hooks/use-server-profile.js", () => ({
  useServerProfile: () => null,
}));

vi.mock("@/contexts/SshForwardHostContext.js", () => ({
  SshForwardHostProvider: ({ children }: { children: React.ReactNode }) => children,
  SshForwardScopeBridge: () => null,
  useSshForwardHost: () => ({ host: null, environment: { kind: "web" } }),
}));

vi.mock("@/contexts/BrowserDebugHostContext.js", () => ({
  BrowserDebugHostProvider: ({ children }: { children: React.ReactNode }) => children,
  useBrowserDebugHost: () => null,
}));

vi.mock("@/components/pages/DashboardPage.js", () => ({
  DashboardPage: () => <div data-testid="dashboard-page">Dashboard</div>,
}));

vi.mock("@/components/pages/WorkspacePage.js", () => ({
  default: () => <div data-testid="workspace-page">Workspace</div>,
}));

vi.mock("@/components/organisms/TerminalNotificationToastViewport.js", () => ({
  TerminalNotificationToastViewport: () => (
    <div data-testid="toast-viewport">Toast Viewport</div>
  ),
}));

describe("DamHopperApp Cognito Mode root boundary", () => {
  let root: Root | null = null;
  let container: HTMLDivElement | null = null;
  let queryClient: QueryClient;

  beforeEach(() => {
    useCognitoModeStore.getState().reset();
    useSettingsStore.setState({
      cognitoModeShortcut: "Mod+Alt+KeyB",
      cognitoModeStyle: "heavy-blur",
    });
    queryClient = new QueryClient({
      defaultOptions: { queries: { retry: false } },
    });
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
  });

  afterEach(async () => {
    await act(async () => {
      root?.unmount();
      root = null;
    });
    container?.remove();
    container = null;
    useCognitoModeStore.getState().reset();
    document.querySelectorAll("[data-cognito-mode-overlay]").forEach((el) => el.remove());
  });

  it("mounts data-cognito-mode-content boundary and toggles inert when cognito active", async () => {
    await act(async () => {
      root?.render(
        createElement(
          QueryClientProvider,
          { client: queryClient },
          createElement(DamHopperApp),
        ),
      );
    });

    const contentDiv = document.querySelector<HTMLElement>("[data-cognito-mode-content]");
    expect(contentDiv).not.toBeNull();

    // Inactive: content is interactive (not inert)
    expect(contentDiv?.hasAttribute("inert")).toBe(false);
    expect(contentDiv?.getAttribute("aria-hidden")).toBeNull();

    // Toast viewport is OUTSIDE data-cognito-mode-content
    const toastViewport = document.querySelector("[data-testid='toast-viewport']");
    expect(toastViewport).not.toBeNull();
    expect(contentDiv?.contains(toastViewport)).toBe(false);

    // Overlay is not mounted while inactive
    expect(document.querySelector("[data-cognito-mode-overlay]")).toBeNull();

    // Activate cognito mode
    await act(async () => {
      useCognitoModeStore.getState().toggle("Mod+Alt+KeyB");
    });

    // Content boundary is inert and aria-hidden
    expect(contentDiv?.hasAttribute("inert")).toBe(true);
    expect(contentDiv?.getAttribute("aria-hidden")).toBe("true");

    // Overlay is mounted at document.body outside content boundary
    const overlay = document.querySelector("[data-cognito-mode-overlay]");
    expect(overlay).not.toBeNull();
    expect(contentDiv?.contains(overlay)).toBe(false);

    // Toast viewport remains outside content boundary and not inert
    expect(toastViewport?.closest("[data-cognito-mode-content]")).toBeNull();

    // Deactivate cognito mode
    await act(async () => {
      useCognitoModeStore.getState().toggle("Mod+Alt+KeyB");
    });

    // Content boundary is no longer inert
    expect(contentDiv?.hasAttribute("inert")).toBe(false);
    expect(contentDiv?.getAttribute("aria-hidden")).toBeNull();
    expect(document.querySelector("[data-cognito-mode-overlay]")).toBeNull();
  });
});
