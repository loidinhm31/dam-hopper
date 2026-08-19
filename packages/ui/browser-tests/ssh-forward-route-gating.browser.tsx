import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { SshForwardHostProvider } from "@/contexts/SshForwardHostContext.js";
import { DamHopperApp } from "@/embed/dam-hopper-app.js";
import type {
  SshForwardHost,
  SshForwardSnapshot,
} from "@/lib/ssh-forward-host.js";
import "@/index.css";

(
  globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;

const mocks = vi.hoisted(() => ({
  fetchCalls: [] as string[],
  invoke: vi.fn(),
  webSocket: vi.fn(),
}));

vi.mock("@/api/transport.js", () => ({
  getTransport: () => ({ invoke: mocks.invoke, onEvent: () => () => {} }),
}));
vi.mock("@/api/transport-utils.js", () => ({ reinitializeTransport: vi.fn() }));
vi.mock("@/api/queries.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/api/queries.js")>();
  return {
    ...actual,
    useWorkspaceStatus: () => ({
      data: { ready: true },
      isLoading: false,
      isError: false,
      error: null,
    }),
  };
});
vi.mock("@/hooks/use-server-profile.js", () => ({
  useServerProfile: () => ({
    id: "server-1",
    name: "Local",
    url: "http://127.0.0.1:4800",
    authType: "none",
    createdAt: 1,
  }),
}));
vi.mock("@/hooks/use-sse.js", () => ({
  useIpc: () => ({ status: "connected" }),
  initTransportListeners: vi.fn(),
  resetTransportListeners: vi.fn(),
}));
vi.mock("@/hooks/use-browser-shortcut-guard.js", () => ({
  useBrowserShortcutGuard: () => {},
}));
vi.mock("@/hooks/use-browser-context-menu-suppression.js", () => ({
  useBrowserContextMenuSuppression: () => {},
}));
vi.mock("@/stores/settings.js", () => ({
  useSettingsStore: {
    getState: () => ({ systemFontSize: 14, hydrate: vi.fn() }),
    subscribe: () => () => {},
  },
}));
vi.mock("@/stores/workspace.js", () => ({
  useWorkspaceStore: (selector: (state: { activeProject: null }) => unknown) =>
    selector({ activeProject: null }),
}));
vi.mock("@/components/organisms/TopNav.js", () => ({
  TopNav: () => <nav data-testid="top-nav" />,
}));
vi.mock("@/components/organisms/TerminalNotificationToastViewport.js", () => ({
  TerminalNotificationToastViewport: () => null,
}));
vi.mock("@/components/organisms/AndroidChromeKeyboardNotice.js", () => ({
  AndroidChromeKeyboardNotice: () => null,
}));
vi.mock("@/components/molecules/PassphrasePrompt.js", () => ({
  PassphrasePrompt: () => null,
}));

let container: HTMLDivElement;
let root: Root;
let queryClient: QueryClient;
const desktopSnapshot = {
  context: {
    desktopInstanceId: "11111111-1111-4111-8111-111111111111",
    managerSessionId: "22222222-2222-2222-8222-222222222222",
    clientEpoch: "1",
  },
  scopeId: "server-1",
  activationToken: "1",
  scopeGeneration: "1",
  profilesRevision: "1",
  trustRevision: "1",
  profiles: [],
  runtimes: [],
  hostKeyChallenges: [],
} as unknown as SshForwardSnapshot;
const desktopHostMock = {
  openClient: vi.fn(async () => ({
    context: desktopSnapshot.context,
    activationTokenFloor: "0",
    activeScopeId: desktopSnapshot.scopeId,
    scopeGeneration: desktopSnapshot.scopeGeneration,
  })),
  activateScope: vi.fn(async () => ({
    context: desktopSnapshot.context,
    activationToken: desktopSnapshot.activationToken,
    scopeId: desktopSnapshot.scopeId,
    scopeGeneration: desktopSnapshot.scopeGeneration,
    snapshot: desktopSnapshot,
  })),
  snapshot: vi.fn(async () => desktopSnapshot),
  subscribe: vi.fn(() => () => {}),
};
const desktopHost = desktopHostMock as unknown as SshForwardHost;

beforeEach(() => {
  localStorage.clear();
  localStorage.setItem(
    "damhopper_server_profiles",
    JSON.stringify([
      {
        id: "server-1",
        name: "Local",
        url: "http://127.0.0.1:4800",
        authType: "none",
        createdAt: 1,
      },
    ]),
  );
  localStorage.setItem("damhopper_active_profile_id", "server-1");
  mocks.fetchCalls.length = 0;
  mocks.invoke.mockReset();
  mocks.webSocket.mockReset();
  desktopHostMock.snapshot.mockClear();
  desktopHostMock.subscribe.mockClear();
  vi.stubGlobal("WebSocket", mocks.webSocket);
  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      mocks.fetchCalls.push(url);
      if (url.endsWith("/api/auth/login"))
        return new Response(JSON.stringify({ token: "browser-test-token" }), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        });
      if (url.endsWith("/api/auth/status"))
        return new Response(JSON.stringify({ authenticated: true }), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        });
      return new Response("", { status: 204 });
    }),
  );
  window.history.pushState({}, "", "/ssh-forwarding");
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
  queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
});

afterEach(async () => {
  await act(async () => root.unmount());
  queryClient.clear();
  container.remove();
  vi.unstubAllGlobals();
  localStorage.clear();
});

async function render(
  kind: "web" | "nativeDesktop" | "nativeMobile",
  host: SshForwardHost | null = null,
) {
  await act(async () =>
    root.render(
      <QueryClientProvider client={queryClient}>
        <SshForwardHostProvider host={host} environment={{ kind }}>
          <DamHopperApp />
        </SshForwardHostProvider>
      </QueryClientProvider>,
    ),
  );
  if (kind === "nativeDesktop") {
    await vi.waitFor(
      () => {
        expect(container.textContent).toContain("SSH Forwarding");
        expect(desktopHostMock.snapshot).toHaveBeenCalled();
      },
      { timeout: 10_000 },
    );
  } else {
    await vi.waitFor(() =>
      expect(container.textContent).not.toContain("Loading…"),
    );
  }
}

describe("SSH forwarding production route gating in Chromium", () => {
  it("does not match the direct route or issue forwarding calls in browser", async () => {
    await render("web");
    expect(container.textContent).not.toContain("SSH FORWARDS");
    expect(container.textContent).not.toContain("SSH Forwarding");
    expect(mocks.invoke).not.toHaveBeenCalled();
    expect(mocks.webSocket).not.toHaveBeenCalled();
    expect(
      mocks.fetchCalls.some(
        (url) => url.includes("/api/ssh") || url.includes("/api/ports"),
      ),
    ).toBe(false);
  });

  it("does not match the direct route or issue forwarding calls on mobile", async () => {
    await render("nativeMobile");
    expect(container.textContent).not.toContain("SSH FORWARDS");
    expect(container.textContent).not.toContain("SSH Forwarding");
    expect(mocks.invoke).not.toHaveBeenCalled();
    expect(mocks.webSocket).not.toHaveBeenCalled();
    expect(
      mocks.fetchCalls.some(
        (url) => url.includes("/api/ssh") || url.includes("/api/ports"),
      ),
    ).toBe(false);
  });

  it("matches the direct route only for a native desktop host", async () => {
    await render("nativeDesktop", desktopHost);
    expect(desktopHostMock.snapshot).toHaveBeenCalled();
    expect(desktopHostMock.subscribe).toHaveBeenCalled();
  });
});
