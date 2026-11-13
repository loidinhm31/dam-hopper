import { afterEach, beforeEach, describe, expect, it, vi, type MockInstance } from "vitest";
import {
  acquireBrowserControl,
  closeBrowserSession,
  createBrowserSession,
  findInBrowserPage,
  getBrowserCapabilities,
  getBrowserSelectedText,
  getBrowserSession,
  historyBrowser,
  listBrowserSessions,
  mintViewerAttachmentTickets,
  navigateBrowser,
  releaseBrowserControl,
  reloadBrowser,
  renewBrowserControl,
  getBrowserProfileResetStatus,
  getBrowserProfileResetStatusForOrigin,
  preflightBrowserCapabilitiesForOrigin,
  resetBrowserProfile,
  resetBrowserProfileForOrigin,
  respondBrowserDialog,
  setBrowserViewport,
  requestBrowserHostJson,
} from "./browser-host-client.js";
import { BrowserHostClientError } from "./browser-host-types.js";
import { ConnectionOwnerError } from "./ownership.js";
import * as connections from "./connections.js";
import * as serverConfig from "./server-config.js";

describe("browser-host-client", () => {
  const mockOwner = { profileId: "profile-1", generation: 1 };
  let fetchSpy: MockInstance;

  beforeEach(() => {
    vi.spyOn(connections, "isCurrentConnection").mockImplementation(
      (ref) => ref.profileId === "profile-1" && ref.generation === 1,
    );
    vi.spyOn(connections, "getConnectionSnapshot").mockReturnValue({
      owner: mockOwner,
      status: "connected",
      intent: true,
      serverUrl: "http://127.0.0.1:4801",
      error: null,
    });
    vi.spyOn(serverConfig, "getServerUrl").mockReturnValue(
      "http://127.0.0.1:4801",
    );
    vi.spyOn(serverConfig, "getAuthToken").mockReturnValue("test-token-xyz");

    fetchSpy = vi.spyOn(globalThis, "fetch");
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("fails fast if connection is disconnected or stale", async () => {
    vi.spyOn(connections, "isCurrentConnection").mockReturnValue(false);

    await expect(getBrowserCapabilities(mockOwner)).rejects.toThrow(
      ConnectionOwnerError,
    );
  });

  it("fails if connection becomes stale during request", async () => {
    fetchSpy.mockImplementationOnce(async () => {
      // Simulate connection drop / profile change mid-flight
      vi.spyOn(connections, "isCurrentConnection").mockReturnValue(false);
      return new Response(JSON.stringify({ available: true }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      });
    });

    await expect(getBrowserCapabilities(mockOwner)).rejects.toThrow(
      /stale during request/,
    );
  });

  it("fetches capabilities with auth and no-store headers", async () => {
    fetchSpy.mockResolvedValueOnce(
      new Response(
        JSON.stringify({
          available: true,
          protocolVersion: 1,
          profileEpoch: "1",
          managedProfilePresent: false,
          effectiveBounds: {},
        }),
        { status: 200, headers: { "Content-Type": "application/json" } },
      ),
    );

    const caps = await getBrowserCapabilities(mockOwner);
    expect(caps.available).toBe(true);

    expect(fetchSpy).toHaveBeenCalledWith(
      "http://127.0.0.1:4801/api/browser/capabilities",
      expect.objectContaining({
        headers: expect.objectContaining({
          Authorization: "Bearer test-token-xyz",
          "Cache-Control": "no-store",
        }),
      }),
    );
  });

  it("translates error responses to BrowserHostClientError", async () => {
    fetchSpy.mockResolvedValueOnce(
      new Response(
        JSON.stringify({
          kind: "browserBusy",
          error: "Maximum target capacity reached",
        }),
        { status: 429, headers: { "Content-Type": "application/json" } },
      ),
    );

    await expect(
      createBrowserSession(mockOwner, {
        creationKey: "12345678-1234-4234-8234-123456789abc",
        url: "https://example.com",
        viewport: { width: 1280, height: 720, dpr: 1 },
      }),
    ).rejects.toMatchObject({
      name: "BrowserHostClientError",
      kind: "browserBusy",
      status: 429,
      message: "Maximum target capacity reached",
    });
  });

  it("handles session CRUD and navigation endpoints", async () => {
    const mockSession = {
      browserSessionId: "sess-1",
      browserIncarnation: "inc-1",
      profileEpoch: "1",
      navigationRevision: "1",
      viewportEpoch: "1",
      url: "https://example.com",
      title: "Example",
      status: "running",
      geometry: { cssWidth: 800, cssHeight: 600, dpr: 1 },
      inputAvailable: true,
    };

    fetchSpy.mockImplementation(async () =>
      new Response(JSON.stringify(mockSession), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      }),
    );

    const created = await createBrowserSession(mockOwner, {
      creationKey: "key-1",
      url: "https://example.com",
      viewport: { width: 800, height: 600, dpr: 1 },
    });
    expect(created.browserSessionId).toBe("sess-1");

    const session = await getBrowserSession(mockOwner, "sess-1");
    expect(session.url).toBe("https://example.com");

    const navigated = await navigateBrowser(mockOwner, "sess-1", {
      url: "https://example.org",
      navigationRevision: 1,
    });
    expect(navigated.browserSessionId).toBe("sess-1");

    const hist = await historyBrowser(mockOwner, "sess-1", {
      direction: "back",
      navigationRevision: 2,
    });
    expect(hist.browserSessionId).toBe("sess-1");

    const reloaded = await reloadBrowser(mockOwner, "sess-1", {
      navigationRevision: 3,
    });
    expect(reloaded.browserSessionId).toBe("sess-1");

    const viewport = await setBrowserViewport(mockOwner, "sess-1", {
      leaseToken: "lease-1",
      viewportEpoch: 1,
      width: 1024,
      height: 768,
      dpr: 1,
    });
    expect(viewport.browserSessionId).toBe("sess-1");

    fetchSpy.mockResolvedValueOnce(new Response(null, { status: 204 }));
    await expect(
      closeBrowserSession(mockOwner, "sess-1"),
    ).resolves.toBeUndefined();
  });

  it("handles control lease, dialog, find and selected-text", async () => {
    fetchSpy.mockResolvedValueOnce(
      new Response(
        JSON.stringify({ leaseToken: "lease-abc", expiresAtUnixMs: 5000 }),
        { status: 200, headers: { "Content-Type": "application/json" } },
      ),
    );

    const acq = await acquireBrowserControl(mockOwner, "sess-1", {
      viewerId: "viewer-1",
      holderKind: "human",
    });
    expect(acq.leaseToken).toBe("lease-abc");

    fetchSpy.mockResolvedValueOnce(
      new Response(
        JSON.stringify({ leaseToken: "lease-abc", expiresAtUnixMs: 10000 }),
        { status: 200, headers: { "Content-Type": "application/json" } },
      ),
    );
    const renewed = await renewBrowserControl(mockOwner, "sess-1", {
      leaseToken: "lease-abc",
    });
    expect(renewed.expiresAtUnixMs).toBe(10000);

    fetchSpy.mockResolvedValueOnce(new Response(null, { status: 200 }));
    await releaseBrowserControl(mockOwner, "sess-1", { leaseToken: "lease-abc" });

    fetchSpy.mockResolvedValueOnce(new Response(null, { status: 200 }));
    await respondBrowserDialog(mockOwner, "sess-1", {
      leaseToken: "lease-abc",
      dialogId: "d-1",
      accept: true,
    });

    fetchSpy.mockResolvedValueOnce(
      new Response(
        JSON.stringify({
          query: "hello",
          forward: true,
          matchCount: 3,
          activeMatchOrdinal: 1,
        }),
        { status: 200, headers: { "Content-Type": "application/json" } },
      ),
    );
    const findRes = await findInBrowserPage(mockOwner, "sess-1", {
      leaseToken: "lease-abc",
      query: "hello",
      forward: true,
    });
    expect(findRes.matchCount).toBe(3);

    fetchSpy.mockResolvedValueOnce(
      new Response(JSON.stringify({ text: "selected content" }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      }),
    );
    const selected = await getBrowserSelectedText(
      mockOwner,
      "sess-1",
      "lease-abc",
    );
    expect(selected.text).toBe("selected content");
  });

  it("mints atomic viewer attachment tickets with valid subprotocols", async () => {
    fetchSpy
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({ ticket: "media-tok-123", expiresAtUnixMs: 30000 }),
          { status: 200, headers: { "Content-Type": "application/json" } },
        ),
      )
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({ ticket: "control-tok-456", expiresAtUnixMs: 30000 }),
          { status: 200, headers: { "Content-Type": "application/json" } },
        ),
      );

    const creds = await mintViewerAttachmentTickets(
      mockOwner,
      "sess-1",
      "inc-1",
      1,
    );
    expect(creds.owner).toEqual(mockOwner);
    expect(creds.browserSessionId).toBe("sess-1");
    expect(creds.browserIncarnation).toBe("inc-1");
    expect(creds.profileEpoch).toBe(1);
    expect(creds.mediaTicket).toBe("media-tok-123");
    expect(creds.controlTicket).toBe("control-tok-456");
    expect(creds.mediaWsUrl).toBe("ws://127.0.0.1:4801/api/browser/media");
    expect(creds.controlWsUrl).toBe("ws://127.0.0.1:4801/api/browser/control");
    expect(creds.mediaSubprotocols).toEqual([
      "damhopper.browser.media.v1",
      "damhopper.ticket.media-tok-123",
    ]);
    expect(creds.controlSubprotocols).toEqual([
      "damhopper.browser.control.v1",
      "damhopper.ticket.control-tok-456",
    ]);
  });

  it("rejects ticket minting if profile or generation changes before completion", async () => {
    fetchSpy.mockImplementationOnce(async () => {
      // Simulate profile switch / generation bump during ticket minting
      vi.spyOn(connections, "isCurrentConnection").mockReturnValue(false);
      return new Response(
        JSON.stringify({ ticket: "media-tok-123", expiresAtUnixMs: 30000 }),
        { status: 200, headers: { "Content-Type": "application/json" } },
      );
    });

    await expect(
      mintViewerAttachmentTickets(mockOwner, "sess-1", "inc-1", 1),
    ).rejects.toThrow(ConnectionOwnerError);
  });

  it("rejects cleartext non-loopback HTTP origins before fetch or ticket minting (never transmitting Bearer token)", async () => {
    vi.spyOn(connections, "getConnectionSnapshot").mockReturnValue({
      owner: mockOwner,
      status: "connected",
      intent: true,
      serverUrl: "http://192.168.1.50:4801",
      error: null,
    });

    await expect(getBrowserCapabilities(mockOwner)).rejects.toThrowError(
      BrowserHostClientError,
    );
    await expect(
      requestBrowserHostJson(mockOwner, "/api/browser/sessions"),
    ).rejects.toMatchObject({
      kind: "insecureOrigin",
      status: 0,
    });
    await expect(
      mintViewerAttachmentTickets(
        mockOwner,
        "12345678-1234-4234-8234-123456789abc",
        "fedcba98-7654-4321-8901-abcdef012345",
        1,
      ),
    ).rejects.toMatchObject({
      kind: "insecureOrigin",
      status: 0,
    });
  });

  it("permits loopback HTTP and remote HTTPS origins for ticket minting", async () => {
    fetchSpy.mockImplementation(async () =>
      new Response(
        JSON.stringify({
          ticket: "ticket-abc",
          expiresAtUnixMs: Date.now() + 30_000,
        }),
        { status: 200, headers: { "Content-Type": "application/json" } },
      ),
    );

    for (const allowedOrigin of [
      "http://127.0.0.1:4801",
      "http://localhost:4801",
      "http://[::1]:4801",
      "https://damhopper.example.com",
    ]) {
      vi.spyOn(connections, "getConnectionSnapshot").mockReturnValue({
        owner: mockOwner,
        status: "connected",
        intent: true,
        serverUrl: allowedOrigin,
        error: null,
      });

      const creds = await mintViewerAttachmentTickets(
        mockOwner,
        "12345678-1234-4234-8234-123456789abc",
        "fedcba98-7654-4321-8901-abcdef012345",
        1,
      );

      if (allowedOrigin.startsWith("https://")) {
        expect(creds.mediaWsUrl.startsWith("wss://")).toBe(true);
        expect(creds.controlWsUrl.startsWith("wss://")).toBe(true);
      } else {
        expect(creds.mediaWsUrl.startsWith("ws://")).toBe(true);
        expect(creds.controlWsUrl.startsWith("ws://")).toBe(true);
      }
    }
  });

  it("rejects reset and preflight functions on insecure remote origin without constructing fetch or WebSocket", async () => {
    const wsSpy = vi.fn();
    vi.stubGlobal("WebSocket", wsSpy);
    fetchSpy.mockClear();

    const insecureOrigin = "http://192.168.1.50:4801";

    await expect(
      preflightBrowserCapabilitiesForOrigin(insecureOrigin, "test-token"),
    ).rejects.toMatchObject({
      kind: "insecureOrigin",
      status: 0,
    });

    await expect(
      resetBrowserProfileForOrigin(insecureOrigin, "test-token", {
        profileEpoch: 1,
        reason: "insecure-test",
      }),
    ).rejects.toMatchObject({
      kind: "insecureOrigin",
      status: 0,
    });

    await expect(
      getBrowserProfileResetStatusForOrigin(insecureOrigin, "test-token", "op-123"),
    ).rejects.toMatchObject({
      kind: "insecureOrigin",
      status: 0,
    });

    vi.spyOn(connections, "getConnectionSnapshot").mockReturnValue({
      owner: mockOwner,
      status: "connected",
      intent: true,
      serverUrl: insecureOrigin,
      error: null,
    });

    await expect(
      resetBrowserProfile(mockOwner, {
        profileEpoch: 1,
        reason: "insecure-test",
      }),
    ).rejects.toMatchObject({
      kind: "insecureOrigin",
      status: 0,
    });

    await expect(
      getBrowserProfileResetStatus(mockOwner, "op-123"),
    ).rejects.toMatchObject({
      kind: "insecureOrigin",
      status: 0,
    });

    expect(fetchSpy).not.toHaveBeenCalled();
    expect(wsSpy).not.toHaveBeenCalled();
  });

  it("permits reset and preflight functions on loopback HTTP and remote HTTPS origins", async () => {
    for (const allowedOrigin of [
      "http://127.0.0.1:4801",
      "http://localhost:4801",
      "http://[::1]:4801",
      "https://damhopper.example.com",
    ]) {
      fetchSpy.mockReset();
      fetchSpy.mockImplementation(async (url: string) => {
        if (url.includes("/api/browser/capabilities")) {
          return new Response(
            JSON.stringify({
              available: true,
              profileEpoch: 1,
              runningSessions: 1,
              maxConcurrentSessions: 5,
              supportedProtocols: ["bhjf-v1"],
              features: { audio: true, video: true },
            }),
            {
              status: 200,
              headers: {
                "Content-Type": "application/json",
                "x-browser-reset-state": "ready",
                "x-browser-epoch": "1",
              },
            },
          );
        }
        return new Response(
          JSON.stringify({
            operationId: "op-abc",
            profileId: "profile-1",
            status: "completed",
            profileEpoch: 2,
          }),
          { status: 200, headers: { "Content-Type": "application/json" } },
        );
      });

      const preflight = await preflightBrowserCapabilitiesForOrigin(
        allowedOrigin,
        "token-123",
      );
      expect(preflight.kind).toBe("admitted");
      expect(preflight.available).toBe(true);
      expect(preflight.profileEpoch).toBe(1);

      const resetRes = await resetBrowserProfileForOrigin(
        allowedOrigin,
        "token-123",
        { profileEpoch: 1, reason: "unit-test" },
      );
      expect(resetRes.operationId).toBe("op-abc");
      expect(resetRes.status).toBe("completed");

      const statusRes = await getBrowserProfileResetStatusForOrigin(
        allowedOrigin,
        "token-123",
        "op-abc",
      );
      expect(statusRes.operationId).toBe("op-abc");
      expect(statusRes.status).toBe("completed");

      for (const call of fetchSpy.mock.calls) {
        const init = call[1] as RequestInit;
        expect(init.credentials).toBe("include");
        expect((init.headers as Record<string, string>)["Authorization"]).toBe(
          "Bearer token-123",
        );
      }
    }
  });
});
