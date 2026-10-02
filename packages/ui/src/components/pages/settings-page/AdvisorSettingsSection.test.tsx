// @vitest-environment jsdom
import { act, type ReactNode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { AdvisorSettingsSection } from "./AdvisorSettingsSection.js";
import type * as UseAdvisorModule from "@/hooks/use-advisor.js";
import type { AdvisorStatusDto } from "@/api/client.js";

type GlobalWithAct = typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean };
const actGlobal: GlobalWithAct = globalThis;
actGlobal.IS_REACT_ACT_ENVIRONMENT = true;

const mockAuth = {
  isAdmin: true,
  isAuthenticated: true,
  role: "admin" as const,
  user: "admin-user",
  isLoading: false,
  error: null,
};
vi.mock("@/hooks/use-advisor.js", async (importOriginal) => {
  const actual = await importOriginal<typeof UseAdvisorModule>();
  return {
    ...actual,
    useAdvisorAuth: () => mockAuth,
    useAdvisorStatus: () => mockStatusHook(),
    useAdvisorToggle: () => mockToggleHook(),
  };
});

let mockStatusData: AdvisorStatusDto | undefined = {
  enabled: false,
  available: true,
  path: "/home/user/.evcrate/advisor-history",
  sourceError: null,
};
let mockStatusLoading = false;
let mockStatusError: Error | null = null;
const mockRefetch = vi.fn().mockResolvedValue(undefined);

function mockStatusHook() {
  return {
    data: mockStatusData,
    isLoading: mockStatusLoading,
    error: mockStatusError,
    refetch: mockRefetch,
    isFetching: false,
  };
}

const mockMutateAsync = vi.fn().mockResolvedValue({ enabled: true });
function mockToggleHook() {
  return {
    mutateAsync: mockMutateAsync,
    isPending: false,
    error: null,
  };
}

let mockSnapshot = {
  owner: { profileId: "prof-1", generation: 1 },
  status: "connected",
  serverUrl: "http://127.0.0.1:4801",
  error: null,
};
vi.mock("@/api/connections.js", () => ({
  useConnectionSnapshot: () => mockSnapshot,
  getConnectionSnapshot: () => mockSnapshot,
  isCurrentConnection: () => true,
}));

vi.mock("@/api/server-config.js", () => ({
  getProfiles: () => [{ id: "prof-1", name: "Host 1", url: "http://127.0.0.1:4801" }],
}));

let root: Root | null = null;
let container: HTMLDivElement | null = null;
let queryClient: QueryClient;

beforeEach(() => {
  queryClient = new QueryClient({
    defaultOptions: {
      queries: { retry: false, gcTime: 0 },
    },
  });
  vi.clearAllMocks();
  mockAuth.isAdmin = true;
  mockAuth.isLoading = false;
  mockSnapshot = {
    owner: { profileId: "prof-1", generation: 1 },
    status: "connected",
    serverUrl: "http://127.0.0.1:4801",
    error: null,
  };
  mockStatusData = {
    enabled: false,
    available: true,
    path: "/home/user/.evcrate/advisor-history",
    sourceError: null,
  };
  mockStatusLoading = false;
  mockStatusError = null;
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

function renderSection(profileId = "prof-1") {
  return act(async () => {
    root?.render(
      <QueryClientProvider client={queryClient}>
        <AdvisorSettingsSection profileId={profileId} />
      </QueryClientProvider>,
    );
  });
}

describe("AdvisorSettingsSection", () => {
  beforeEach(() => {
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
  });

  it("renders disconnected warning when target server is disconnected", async () => {
    mockSnapshot = {
      owner: { profileId: "prof-1", generation: 1 },
      status: "disconnected",
      serverUrl: "http://127.0.0.1:4801",
      error: null,
    };

    await renderSection();

    const warning = container?.querySelector(
      '[data-testid="advisor-disconnected-warning"]',
    );
    expect(warning).not.toBeNull();
    expect(warning?.textContent).toContain("Target server is disconnected");
  });

  it("renders admin warning notice when user lacks admin role", async () => {
    mockAuth.isAdmin = false;
    mockAuth.role = "user" as const;

    await renderSection();

    const adminWarning = container?.querySelector(
      '[data-testid="advisor-admin-role-warning"]',
    );
    expect(adminWarning).not.toBeNull();
    expect(adminWarning?.textContent).toContain("Administrator access required");
    expect(container?.querySelector('[data-testid="advisor-toggle-switch"]')).toBeNull();
  });

  it("renders enabled state and path when admin and connected", async () => {
    mockStatusData = {
      enabled: true,
      available: true,
      path: "/home/test/.evcrate/advisor-history",
      sourceError: null,
    };

    await renderSection();

    const badge = container?.querySelector('[data-testid="advisor-state-badge"]');
    expect(badge?.textContent).toBe("Enabled");

    const toggle = container?.querySelector<HTMLButtonElement>(
      '[data-testid="advisor-toggle-switch"]',
    );
    expect(toggle).not.toBeNull();
    expect(toggle?.getAttribute("aria-checked")).toBe("true");

    const pathEl = container?.querySelector('[data-testid="advisor-detected-path"]');
    expect(pathEl?.textContent).toContain("/home/test/.evcrate/advisor-history");

    const availableBadge = container?.querySelector(
      '[data-testid="advisor-available-badge"]',
    );
    expect(availableBadge).not.toBeNull();
  });

  it("renders unavailable notice with symlink security note when history dir missing or symlinked", async () => {
    mockStatusData = {
      enabled: true,
      available: false,
      path: "/home/test/.evcrate/advisor-history",
      sourceError: "Symlink rejected: history root must be a real directory",
    };

    await renderSection();

    // Toggle still reflects persisted enabled state
    const badge = container?.querySelector('[data-testid="advisor-state-badge"]');
    expect(badge?.textContent).toBe("Enabled");

    const unavailableBadge = container?.querySelector(
      '[data-testid="advisor-unavailable-badge"]',
    );
    expect(unavailableBadge).not.toBeNull();

    const errorNotice = container?.querySelector(
      '[data-testid="advisor-source-error-notice"]',
    );
    expect(errorNotice).not.toBeNull();
    expect(errorNotice?.textContent).toContain("Symlink rejected");
    expect(errorNotice?.textContent).toContain("Symbolic links to directories are rejected for security");
  });

  it("calls updateSettings toggle mutation on toggle click", async () => {
    mockStatusData = {
      enabled: false,
      available: true,
      path: "/home/test/.evcrate/advisor-history",
      sourceError: null,
    };

    await renderSection();

    const toggle = container?.querySelector<HTMLButtonElement>(
      '[data-testid="advisor-toggle-switch"]',
    );
    expect(toggle).not.toBeNull();

    await act(async () => {
      toggle?.click();
    });

    expect(mockMutateAsync).toHaveBeenCalledWith(true);
  });

  it("displays status error banner and does NOT masquerade as disabled", async () => {
    mockStatusError = new Error("Connection refused: 503 Service Unavailable");
    mockStatusData = undefined;

    await renderSection();

    const statusErrorEl = container?.querySelector(
      '[data-testid="advisor-status-error"]',
    );
    expect(statusErrorEl).not.toBeNull();
    expect(statusErrorEl?.textContent).toContain(
      "Connection refused: 503 Service Unavailable",
    );
    const badge = container?.querySelector('[data-testid="advisor-state-badge"]');
    expect(badge?.textContent).toBe("Error");
    const toggle = container?.querySelector<HTMLButtonElement>(
      '[data-testid="advisor-toggle-switch"]',
    );
    expect(toggle?.disabled).toBe(true);
  });
});
