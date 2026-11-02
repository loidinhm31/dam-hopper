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

const mockProfiles: never[] = [];
let mockActiveProfile: { id: string; authType?: string; url?: string } | null = null;
let mockAuthToken: string | null = null;
vi.mock("@/api/server-config.js", () => ({
  getServerUrl: () => "http://localhost:4801",
  buildAuthHeaders: () => ({}),
  getActiveProfile: () => mockActiveProfile,
  getProfiles: () => mockProfiles,
  migrateToProfiles: vi.fn(),
  normalizeServerUrl: (url: string) => url,
  getAuthToken: () => mockAuthToken,
  setAuthToken: vi.fn(),
  readServerProfiles: () => ({ status: "available", profiles: [] }),
  subscribeToProfileChanges: vi.fn(() => () => {}),
}));

vi.mock("@/hooks/use-server-profile.js", () => ({
  useServerProfile: () => mockActiveProfile,
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
vi.mock("@/os/OsShell.js", () => ({
  OsShell: () => <div data-testid="os-shell">DamHopper OS Shell</div>,
}));

describe("DamHopperApp Cognito Mode root boundary", () => {
  let root: Root | null = null;
  let container: HTMLDivElement | null = null;
  let queryClient: QueryClient;

  beforeEach(() => {
    mockActiveProfile = null;
    mockAuthToken = null;
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
    window.history.pushState({}, "", "/");
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

  it("renders retirement notice for /ssh-forwarding deep link", async () => {
    window.history.pushState({}, "", "/ssh-forwarding");
    const container = document.createElement("div");
    document.body.appendChild(container);
    const root = createRoot(container);

    await act(async () => {
      root.render(
        <QueryClientProvider client={new QueryClient()}>
          <DamHopperApp />
        </QueryClientProvider>,
      );
    });

    expect(container.textContent).toContain("SSH Port Forwarding Retired");
    expect(container.textContent).toContain(
      "Native desktop SSH port forwarding has been removed",
    );

    await act(async () => root.unmount());
    container.remove();
    window.history.pushState({}, "", "/");
  });
  it("renders unauthenticated notice on /os without token and does not mount OsShell", async () => {
    window.history.pushState({}, "", "/os");
    await act(async () => {
      root?.render(
        <QueryClientProvider client={queryClient}>
          <DamHopperApp />
        </QueryClientProvider>,
      );
    });

    expect(container?.querySelector("[data-testid='os-unauthenticated']")).not.toBeNull();
    expect(container?.textContent).toContain("Authentication Required");
    expect(container?.querySelector("[data-testid='os-shell']")).toBeNull();
  });
  it("renders unauthenticated notice on /os when profile has authType: 'basic' but token is missing", async () => {
    mockActiveProfile = { id: "profile-token-required", authType: "basic" };
    mockAuthToken = null;
    window.history.pushState({}, "", "/os");
    await act(async () => {
      root?.render(
        <QueryClientProvider client={queryClient}>
          <DamHopperApp />
        </QueryClientProvider>,
      );
    });

    expect(container?.querySelector("[data-testid='os-unauthenticated']")).not.toBeNull();
    expect(container?.textContent).toContain("Authentication Required");
    expect(container?.querySelector("[data-testid='os-shell']")).toBeNull();
  });

  it("renders dashboard page on default root /", async () => {
    window.history.pushState({}, "", "/");
    await act(async () => {
      root?.render(
        <QueryClientProvider client={queryClient}>
          <DamHopperApp />
        </QueryClientProvider>,
      );
    });
    expect(container?.querySelector("[data-testid='dashboard-page']")).not.toBeNull();
  });

  it("renders OsShell on /os when profile is authenticated", async () => {
    mockActiveProfile = { id: "profile-1", authType: "basic" };
    mockAuthToken = "token-xyz";
    window.history.pushState({}, "", "/os");

    await act(async () => {
      root?.render(
        <QueryClientProvider client={queryClient}>
          <DamHopperApp />
        </QueryClientProvider>,
      );
    });

    expect(container?.querySelector("[data-testid='os-shell']")).not.toBeNull();
    expect(container?.querySelector("[data-testid='os-unauthenticated']")).toBeNull();
    expect(container?.textContent).toContain("DamHopper OS Shell");
  });

  it("renders OsShell on /os when profile has authType: 'none' without token", async () => {
    mockActiveProfile = { id: "profile-dev", authType: "none" };
    mockAuthToken = null;
    window.history.pushState({}, "", "/os");

    await act(async () => {
      root?.render(
        <QueryClientProvider client={queryClient}>
          <DamHopperApp />
        </QueryClientProvider>,
      );
    });

    expect(container?.querySelector("[data-testid='os-shell']")).not.toBeNull();
    expect(container?.querySelector("[data-testid='os-unauthenticated']")).toBeNull();
  });

  it("does not trigger workspace terminal navigation on Ctrl+Backquote while on /os", async () => {
    mockActiveProfile = { id: "profile-1", authType: "none" };
    window.history.pushState({}, "", "/os");

    await act(async () => {
      root?.render(
        <QueryClientProvider client={queryClient}>
          <DamHopperApp />
        </QueryClientProvider>,
      );
    });

    // Dispatch Ctrl+Backquote
    window.dispatchEvent(
      new KeyboardEvent("keydown", {
        key: "`",
        code: "Backquote",
        ctrlKey: true,
        bubbles: true,
        cancelable: true,
      }),
    );

    // Route remains /os, does not navigate to /workspace
    expect(window.location.pathname).toBe("/os");
    expect(container?.querySelector("[data-testid='os-shell']")).not.toBeNull();
  });

  it("reactively unmounts OsShell when profile authentication is revoked", async () => {
    mockActiveProfile = { id: "profile-1", authType: "basic" };
    mockAuthToken = "valid-token";
    window.history.pushState({}, "", "/os");

    await act(async () => {
      root?.render(
        <QueryClientProvider client={queryClient}>
          <DamHopperApp />
        </QueryClientProvider>,
      );
    });
    expect(container?.querySelector("[data-testid='os-shell']")).not.toBeNull();

    // Revoke token and re-render
    mockAuthToken = null;
    await act(async () => {
      root?.render(
        <QueryClientProvider client={queryClient}>
          <DamHopperApp />
        </QueryClientProvider>,
      );
    });

    expect(container?.querySelector("[data-testid='os-shell']")).toBeNull();
    expect(container?.querySelector("[data-testid='os-unauthenticated']")).not.toBeNull();
  });

  it("navigates to /workspace on Ctrl+Backquote while on default route /", async () => {
    mockActiveProfile = { id: "profile-1", authType: "none" };
    window.history.pushState({}, "", "/");

    await act(async () => {
      root?.render(
        <QueryClientProvider client={queryClient}>
          <DamHopperApp />
        </QueryClientProvider>,
      );
    });

    window.dispatchEvent(
      new KeyboardEvent("keydown", {
        key: "`",
        code: "Backquote",
        ctrlKey: true,
        bubbles: true,
        cancelable: true,
      }),
    );

    expect(window.location.pathname).toBe("/workspace");
  });
});
