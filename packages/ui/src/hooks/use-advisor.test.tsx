// @vitest-environment jsdom
import { act, type ReactNode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { QueryClient, QueryClientProvider, type UseMutationResult } from "@tanstack/react-query";
import {
  advisorQueryKeys,
  useAdvisorAuth,
  useAdvisorStatus,
  useAdvisorVisibility,
  useAdvisorToggle,
  type AdvisorAuthStatus,
  type AdvisorVisibilityResult,
  type AdvisorToggleResult,
} from "./use-advisor.js";

type GlobalWithAct = typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean };
const actGlobal: GlobalWithAct = globalThis;
actGlobal.IS_REACT_ACT_ENVIRONMENT = true;

const mockCheckAuthStatus = vi.fn();
vi.mock("@/api/auth-client.js", () => ({
  checkAuthStatus: (...args: unknown[]) => mockCheckAuthStatus(...args),
}));

const mockGetAuthToken = vi.fn().mockReturnValue("test-token");
const mockGetServerUrl = vi.fn().mockReturnValue("http://127.0.0.1:4801");
const mockGetProfiles = vi.fn().mockReturnValue([
  { id: "prof-1", name: "Host 1", url: "http://127.0.0.1:4801" },
]);
vi.mock("@/api/server-config.js", () => ({
  getAuthToken: (id?: string) => mockGetAuthToken(id),
  getServerUrl: () => mockGetServerUrl(),
  getProfiles: () => mockGetProfiles(),
}));

const mockConnectionSnapshot = vi.fn();
const mockIsCurrentConnection = vi.fn();
const mockGetApi = vi.fn();
vi.mock("@/api/connections.js", () => ({
  useConnectionSnapshot: (id: string) => mockConnectionSnapshot(id),
  getConnectionSnapshot: (id: string) => mockConnectionSnapshot(id),
  isCurrentConnection: (owner: unknown) => mockIsCurrentConnection(owner),
  getApi: (owner: unknown) => mockGetApi(owner),
}));

let root: Root | null = null;
let container: HTMLDivElement | null = null;
let queryClient: QueryClient;

beforeEach(() => {
  queryClient = new QueryClient({
    defaultOptions: {
      queries: { retry: false, gcTime: 0 },
      mutations: { retry: false },
    },
  });
  vi.clearAllMocks();
  mockIsCurrentConnection.mockReturnValue(true);
  mockConnectionSnapshot.mockReturnValue({
    owner: { profileId: "prof-1", generation: 1 },
    status: "connected",
    serverUrl: "http://127.0.0.1:4801",
    error: null,
  });
  mockCheckAuthStatus.mockResolvedValue({
    authenticated: true,
    user: "admin-user",
    role: "admin",
  });
});

afterEach(() => {
  if (root) {
    act(() => {
      root?.unmount();
    });
    root = null;
  }
  container?.remove();
  container = null;
  queryClient.clear();
});

function createWrapper() {
  return function Wrapper({ children }: { children: ReactNode }) {
    return (
      <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
    );
  };
}

describe("advisorQueryKeys", () => {
  it("generates deterministic query keys scoped by profile and generation", () => {
    expect(advisorQueryKeys.all).toEqual(["advisor"]);
    expect(advisorQueryKeys.profile("prof-1", 2)).toEqual(["advisor", "prof-1", 2]);
    expect(advisorQueryKeys.status("prof-1", 2)).toEqual([
      "advisor",
      "prof-1",
      2,
      "status",
    ]);
    expect(advisorQueryKeys.auth("prof-1")).toEqual([
      "advisor",
      "prof-1",
      "auth-status",
    ]);
  });
});

describe("useAdvisorAuth", () => {
  it("returns isAdmin: true when authenticated as admin", async () => {
    mockCheckAuthStatus.mockResolvedValueOnce({
      authenticated: true,
      user: "super-admin",
      role: "admin",
    });

    let hookResult: AdvisorAuthStatus | null = null;
    function TestComponent() {
      hookResult = useAdvisorAuth("prof-1");
      return null;
    }

    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);

    const Wrapper = createWrapper();
    await act(async () => {
      root?.render(
        <Wrapper>
          <TestComponent />
        </Wrapper>,
      );
    });

    await vi.waitFor(() => {
      expect(hookResult?.isAdmin).toBe(true);
      expect(hookResult?.isAuthenticated).toBe(true);
      expect(hookResult?.user).toBe("super-admin");
    });
  });

  it("returns isAdmin: false when authenticated as standard user", async () => {
    mockCheckAuthStatus.mockResolvedValueOnce({
      authenticated: true,
      user: "regular-user",
      role: "user",
    });

    let hookResult: AdvisorAuthStatus | null = null;
    function TestComponent() {
      hookResult = useAdvisorAuth("prof-1");
      return null;
    }

    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);

    const Wrapper = createWrapper();
    await act(async () => {
      root?.render(
        <Wrapper>
          <TestComponent />
        </Wrapper>,
      );
    });

    await vi.waitFor(() => {
      expect(hookResult?.isAdmin).toBe(false);
      expect(hookResult?.isAuthenticated).toBe(true);
    });
  });

  it("fails closed without querying when target profile is disconnected", async () => {
    mockConnectionSnapshot.mockReturnValueOnce({
      owner: { profileId: "prof-1", generation: 1 },
      status: "disconnected",
      serverUrl: "http://127.0.0.1:4801",
      error: null,
    });

    let hookResult: AdvisorAuthStatus | null = null;
    function TestComponent() {
      hookResult = useAdvisorAuth("prof-1");
      return null;
    }

    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);

    const Wrapper = createWrapper();
    await act(async () => {
      root?.render(
        <Wrapper>
          <TestComponent />
        </Wrapper>,
      );
    });

    expect(hookResult?.isAdmin).toBe(false);
    expect(hookResult?.isAuthenticated).toBe(false);
    expect(mockCheckAuthStatus).not.toHaveBeenCalled();
  });
});

describe("useAdvisorVisibility", () => {
  it("returns isVisible: true only when connected + admin + enabled", async () => {
    mockCheckAuthStatus.mockResolvedValue({
      authenticated: true,
      role: "admin",
      user: "admin-user",
    });
    const mockStatusFn = vi.fn().mockResolvedValue({
      enabled: true,
      available: true,
      path: "/home/user/.evcrate/advisor-history",
      sourceError: null,
    });
    mockGetApi.mockReturnValue({
      advisor: { status: mockStatusFn },
    });

    let hookResult: AdvisorVisibilityResult | null = null;
    function TestComponent() {
      hookResult = useAdvisorVisibility({ profileId: "prof-1", generation: 1 });
      return null;
    }

    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);

    const Wrapper = createWrapper();
    await act(async () => {
      root?.render(
        <Wrapper>
          <TestComponent />
        </Wrapper>,
      );
    });

    await vi.waitFor(() => {
      expect(hookResult?.isConnected).toBe(true);
      expect(hookResult?.isAdmin).toBe(true);
      expect(hookResult?.isEnabled).toBe(true);
      expect(hookResult?.isVisible).toBe(true);
    });
  });

  it("returns isVisible: false when disabled even if admin and connected", async () => {
    mockCheckAuthStatus.mockResolvedValue({
      authenticated: true,
      role: "admin",
    });
    const mockStatusFn = vi.fn().mockResolvedValue({
      enabled: false,
      available: true,
      path: "/home/user/.evcrate/advisor-history",
      sourceError: null,
    });
    mockGetApi.mockReturnValue({
      advisor: { status: mockStatusFn },
    });

    let hookResult: AdvisorVisibilityResult | null = null;
    function TestComponent() {
      hookResult = useAdvisorVisibility({ profileId: "prof-1", generation: 1 });
      return null;
    }

    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);

    const Wrapper = createWrapper();
    await act(async () => {
      root?.render(
        <Wrapper>
          <TestComponent />
        </Wrapper>,
      );
    });

    await vi.waitFor(() => {
      expect(hookResult?.isConnected).toBe(true);
      expect(hookResult?.isAdmin).toBe(true);
      expect(hookResult?.isEnabled).toBe(false);
      expect(hookResult?.isVisible).toBe(false);
    });
  });

  it("returns isVisible: false when user is not admin", async () => {
    mockCheckAuthStatus.mockResolvedValue({
      authenticated: true,
      role: "user",
    });

    let hookResult: AdvisorVisibilityResult | null = null;
    function TestComponent() {
      hookResult = useAdvisorVisibility({ profileId: "prof-1", generation: 1 });
      return null;
    }

    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);

    const Wrapper = createWrapper();
    await act(async () => {
      root?.render(
        <Wrapper>
          <TestComponent />
        </Wrapper>,
      );
    });

    await vi.waitFor(() => {
      expect(hookResult?.isAdmin).toBe(false);
      expect(hookResult?.isVisible).toBe(false);
    });
  });
});

describe("useAdvisorToggle", () => {
  it("captures owner and intended value and calls updateSettings", async () => {
    const mockUpdateSettings = vi.fn().mockResolvedValue({ enabled: true });
    mockGetApi.mockReturnValue({
      advisor: { updateSettings: mockUpdateSettings },
    });

    let toggleFn: UseMutationResult<AdvisorToggleResult, Error, boolean> | null = null;
    function TestComponent() {
      toggleFn = useAdvisorToggle({ profileId: "prof-1", generation: 1 });
      return null;
    }

    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);

    const Wrapper = createWrapper();
    await act(async () => {
      root?.render(
        <Wrapper>
          <TestComponent />
        </Wrapper>,
      );
    });

    await act(async () => {
      await toggleFn?.mutateAsync(true);
    });

    expect(mockUpdateSettings).toHaveBeenCalledWith({ enabled: true });
  });
});
