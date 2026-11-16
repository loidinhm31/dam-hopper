// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type * as BrowserHostClientModule from "@/api/browser-host-client.js";
import { BrowserHostClientError, type DevToolsLeaseResponse } from "@/api/browser-host-types.js";
import type { ConnectionRef } from "@/api/ownership.js";
import { BrowserDevToolsDock, type BrowserDevToolsDockProps } from "./browser-devtools-dock.js";

const { connState, api } = vi.hoisted(() => ({
  connState: { current: true },
  api: {
    createBrowserDevToolsLease: vi.fn(),
    revokeBrowserDevToolsLease: vi.fn(),
  },
}));

vi.mock("@/api/connections.js", () => ({
  isCurrentConnection: (ref: ConnectionRef) =>
    connState.current && ref.profileId === "profile-1" && ref.generation === 1,
  getConnectionSnapshot: () => ({
    owner: { profileId: "profile-1", generation: 1 },
    status: "connected",
    intent: true,
    serverUrl: "https://hub.example.com",
    error: null,
  }),
}));

vi.mock("@/api/browser-host-client.js", async (original) => ({
  ...(await original<typeof BrowserHostClientModule>()),
  ...api,
}));

describe("BrowserDevToolsDock", () => {
  const owner: ConnectionRef = { profileId: "profile-1", generation: 1 };
  let root: Root | null = null;
  let container: HTMLDivElement | null = null;

  beforeEach(() => {
    connState.current = true;
    api.createBrowserDevToolsLease.mockReset();
    api.revokeBrowserDevToolsLease.mockReset().mockResolvedValue(undefined);
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
  });

  afterEach(() => {
    if (root) {
      act(() => {
        root?.unmount();
      });
      root = null;
    }
    if (container && document.body.contains(container)) {
      document.body.removeChild(container);
      container = null;
    }
  });

  async function renderDock(overrides: Partial<BrowserDevToolsDockProps> = {}) {
    const props: BrowserDevToolsDockProps = {
      owner,
      sessionId: "sess-1",
      browserIncarnation: "inc-1",
      profileEpoch: "1",
      dockSide: "bottom",
      onToggleDockSide: vi.fn(),
      onClose: vi.fn(),
      ...overrides,
    };
    await act(async () => {
      root?.render(<BrowserDevToolsDock {...props} />);
    });
    return props;
  }

  it("mints a DevTools lease on mount, renders the devtools_app.html iframe, and revokes on unmount", async () => {
    const lease: DevToolsLeaseResponse = {
      token: "dt-token-1",
      expiresAtUnixMs: Date.now() + 300_000,
      browserSessionId: "sess-1",
      browserIncarnation: "inc-1",
      profileEpoch: "1",
    };
    api.createBrowserDevToolsLease.mockResolvedValueOnce(lease);

    await renderDock();

    expect(api.createBrowserDevToolsLease).toHaveBeenCalledWith(owner, "sess-1", expect.any(AbortSignal));
    const iframe = container?.querySelector<HTMLIFrameElement>('[data-testid="browser-devtools-iframe"]');
    expect(iframe).toBeTruthy();
    expect(iframe?.getAttribute("src")).toContain("/api/browser/devtools/dt-token-1/devtools_app.html");
    expect(iframe?.getAttribute("src")).toContain("panel=console");
    expect(iframe?.getAttribute("src")).toContain("wss=hub.example.com%2Fapi%2Fbrowser%2Fdevtools%2Fdt-token-1%2Fws");

    act(() => {
      root?.unmount();
      root = null;
    });
    expect(api.revokeBrowserDevToolsLease).toHaveBeenCalledWith(owner, "sess-1", "dt-token-1");
  });

  it("revokes old lease and mints fresh lease on reload, and wires dock-side and close controls", async () => {
    api.createBrowserDevToolsLease
      .mockResolvedValueOnce({
        token: "dt-token-1",
        expiresAtUnixMs: Date.now() + 300_000,
        browserSessionId: "sess-1",
        browserIncarnation: "inc-1",
        profileEpoch: "1",
      })
      .mockResolvedValueOnce({
        token: "dt-token-2",
        expiresAtUnixMs: Date.now() + 300_000,
        browserSessionId: "sess-1",
        browserIncarnation: "inc-1",
        profileEpoch: "1",
      });

    const props = await renderDock({ dockSide: "bottom" });
    expect(container?.querySelector('[data-testid="browser-devtools-dock"]')?.getAttribute("data-dock-side")).toBe("bottom");

    act(() => {
      container?.querySelector<HTMLButtonElement>('[data-testid="browser-devtools-dock-side-btn"]')?.click();
    });
    expect(props.onToggleDockSide).toHaveBeenCalledTimes(1);

    await act(async () => {
      container?.querySelector<HTMLButtonElement>('[data-testid="browser-devtools-reload-btn"]')?.click();
    });
    expect(api.revokeBrowserDevToolsLease).toHaveBeenCalledWith(owner, "sess-1", "dt-token-1");
    expect(container?.querySelector<HTMLIFrameElement>('[data-testid="browser-devtools-iframe"]')?.getAttribute("src")).toContain("dt-token-2");

    act(() => {
      container?.querySelector<HTMLButtonElement>('[data-testid="browser-devtools-close-btn"]')?.click();
    });
    expect(props.onClose).toHaveBeenCalledTimes(1);
  });

  it("revokes stale or incarnation-mismatched async lease responses without mounting iframe", async () => {
    const deferred = Promise.withResolvers<DevToolsLeaseResponse>();
    api.createBrowserDevToolsLease.mockReturnValueOnce(deferred.promise);

    await renderDock({ sessionId: "sess-1", browserIncarnation: "inc-1" });
    expect(container?.querySelector('[data-testid="browser-devtools-loading"]')).toBeTruthy();

    // Unmount before mint resolves -> late token must be immediately revoked
    act(() => {
      root?.unmount();
      root = null;
    });
    await act(async () => {
      deferred.resolve({
        token: "late-token",
        expiresAtUnixMs: Date.now() + 300_000,
        browserSessionId: "sess-1",
        browserIncarnation: "inc-1",
        profileEpoch: "1",
      });
    });
    expect(api.revokeBrowserDevToolsLease).toHaveBeenCalledWith(owner, "sess-1", "late-token");
  });

  it("rejects and revokes leases with mismatched browserIncarnation or profileEpoch and drops stale-connection leases", async () => {
    // 1. Mismatched browserIncarnation -> revokes token, shows error + Retry, never mounts iframe
    api.createBrowserDevToolsLease.mockResolvedValueOnce({
      token: "wrong-inc-token",
      expiresAtUnixMs: Date.now() + 300_000,
      browserSessionId: "sess-1",
      browserIncarnation: "inc-other",
      profileEpoch: "1",
    });
    await renderDock({ sessionId: "sess-1", browserIncarnation: "inc-1", profileEpoch: "1" });
    expect(api.revokeBrowserDevToolsLease).toHaveBeenCalledWith(owner, "sess-1", "wrong-inc-token");
    expect(container?.querySelector('[data-testid="browser-devtools-iframe"]')).toBeNull();
    expect(container?.querySelector('[data-testid="browser-devtools-error"]')).toBeTruthy();

    // 2. Mismatched profileEpoch -> revokes token, shows error + Retry
    api.revokeBrowserDevToolsLease.mockClear();
    api.createBrowserDevToolsLease.mockResolvedValueOnce({
      token: "wrong-epoch-token",
      expiresAtUnixMs: Date.now() + 300_000,
      browserSessionId: "sess-1",
      browserIncarnation: "inc-1",
      profileEpoch: "99",
    });
    await act(async () => {
      container?.querySelector<HTMLButtonElement>('[data-testid="browser-devtools-retry-btn"]')?.click();
    });
    expect(api.revokeBrowserDevToolsLease).toHaveBeenCalledWith(owner, "sess-1", "wrong-epoch-token");
    expect(container?.querySelector('[data-testid="browser-devtools-iframe"]')).toBeNull();
    expect(container?.querySelector('[data-testid="browser-devtools-error"]')).toBeTruthy();

    // 3. Stale connection (!isCurrentConnection) on resolve -> never mounts iframe or calls revoke on stale owner
    api.revokeBrowserDevToolsLease.mockClear();
    const deferred = Promise.withResolvers<DevToolsLeaseResponse>();
    api.createBrowserDevToolsLease.mockReturnValueOnce(deferred.promise);
    await act(async () => {
      container?.querySelector<HTMLButtonElement>('[data-testid="browser-devtools-retry-btn"]')?.click();
    });
    connState.current = false;
    await act(async () => {
      deferred.resolve({
        token: "stale-conn-token",
        expiresAtUnixMs: Date.now() + 300_000,
        browserSessionId: "sess-1",
        browserIncarnation: "inc-1",
        profileEpoch: "1",
      });
    });
    expect(container?.querySelector('[data-testid="browser-devtools-iframe"]')).toBeNull();
    expect(api.revokeBrowserDevToolsLease).not.toHaveBeenCalled();
  });

  it("shows error state and retries minting on failure", async () => {
    api.createBrowserDevToolsLease
      .mockRejectedValueOnce(new BrowserHostClientError("DevTools lease capacity reached", "tooManyDevToolsLeases", 429))
      .mockResolvedValueOnce({
        token: "dt-token-retry",
        expiresAtUnixMs: Date.now() + 300_000,
        browserSessionId: "sess-1",
        browserIncarnation: "inc-1",
        profileEpoch: "1",
      });

    await renderDock();
    expect(container?.querySelector('[data-testid="browser-devtools-error"]')?.textContent).toContain(
      "DevTools lease capacity reached",
    );

    await act(async () => {
      container?.querySelector<HTMLButtonElement>('[data-testid="browser-devtools-retry-btn"]')?.click();
    });
    expect(container?.querySelector('[data-testid="browser-devtools-iframe"]')?.getAttribute("src")).toContain("dt-token-retry");
  });
});
