// @vitest-environment jsdom

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const config = vi.hoisted(() => ({
  profile: { id: "profile-a", url: "https://api.test/" },
  getActiveProfile: vi.fn(() => ({
    id: config.profile.id,
    url: config.profile.url,
  })),
  getAuthToken: vi.fn((profileId?: string) =>
    profileId === "profile-b" ? "new-token" : "secret-token",
  ),
  getServerUrl: vi.fn(() => "https://fallback.test"),
  normalizeServerUrl: vi.fn((url: string) => url.replace(/\/$/, "")),
}));

vi.mock("./server-config.js", () => config);

import { issueVideoTicket, VideoTicketError } from "./video-tickets.js";

beforeEach(() => {
  config.profile = { id: "profile-a", url: "https://api.test/" };
  config.getActiveProfile.mockImplementation(() => config.profile);
  config.getAuthToken.mockImplementation((profileId?: string) =>
    profileId === "profile-b" ? "new-token" : "secret-token",
  );
});

afterEach(() => vi.unstubAllGlobals());

function issued(purpose: "playback" | "download") {
  return {
    ticket: "opaque_token",
    streamPath: "/api/fs/video/stream/opaque_token",
    expiresAt: 1_800_000_000_000,
    purpose,
    authorizationMode: "session-cookie-v1",
  };
}

describe("issueVideoTicket", () => {
  it("snapshots profile auth and exposes only an absolute stream URL", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValue(
        new Response(JSON.stringify(issued("playback")), { status: 201 }),
      );
    vi.stubGlobal("fetch", fetchMock);

    const ticket = await issueVideoTicket(
      "project",
      "clips/demo.webm",
      "playback",
    );

    expect(ticket).toMatchObject({
      purpose: "playback",
      url: "https://api.test/api/fs/video/stream/opaque_token",
      expiresAt: 1_800_000_000_000,
    });
    expect(fetchMock).toHaveBeenCalledWith(
      "https://api.test/api/fs/video/tickets",
      expect.objectContaining({
        method: "POST",
        credentials: "include",
        headers: expect.objectContaining({
          Authorization: "Bearer secret-token",
        }),
      }),
    );
    if (ticket.purpose === "playback") await ticket.revoke();
    expect(fetchMock).toHaveBeenLastCalledWith(
      "https://api.test/api/fs/video/tickets",
      expect.objectContaining({ method: "DELETE", keepalive: true }),
    );
  });

  it("fails closed before issuing media to an insecure server", async () => {
    config.profile = { id: "profile-a", url: "http://api.test" };
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);

    await expect(
      issueVideoTicket("project", "clips/demo.webm", "playback"),
    ).rejects.toMatchObject<Partial<VideoTicketError>>({
      code: "INSECURE_MEDIA_SERVER",
    });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("rejects old servers and probes an issued ticket with credentials", async () => {
    const fetchMock = vi.fn().mockResolvedValueOnce(
      new Response(
        JSON.stringify({ ...issued("playback"), authorizationMode: undefined }),
        {
          status: 201,
        },
      ),
    );
    vi.stubGlobal("fetch", fetchMock);

    await expect(
      issueVideoTicket("project", "clips/demo.webm", "playback"),
    ).rejects.toMatchObject<Partial<VideoTicketError>>({
      code: "MEDIA_SESSION_UNSUPPORTED",
    });
    expect(fetchMock).toHaveBeenCalledOnce();

    fetchMock
      .mockReset()
      .mockResolvedValueOnce(
        new Response(JSON.stringify(issued("playback")), { status: 201 }),
      )
      .mockResolvedValueOnce(new Response(null, { status: 204 }));
    await issueVideoTicket("project", "clips/demo.webm", "playback");
    expect(fetchMock).toHaveBeenLastCalledWith(
      "https://api.test/api/fs/video/stream/opaque_token",
      expect.objectContaining({ method: "HEAD", credentials: "include" }),
    );
  });

  it("rejects purpose and stream-path manipulation without leaking server content", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        new Response(
          JSON.stringify({
            ...issued("download"),
            streamPath: "https://other.test/steal",
          }),
          { status: 201 },
        ),
      ),
    );

    await expect(
      issueVideoTicket("project", "clips/demo.webm", "download"),
    ).rejects.toMatchObject<Partial<VideoTicketError>>({
      code: "INVALID_RESPONSE",
    });
  });

  it("returns a fixed status code for failed issue requests", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(new Response("private", { status: 429 })),
    );

    await expect(
      issueVideoTicket("project", "clips/demo.webm", "download"),
    ).rejects.toMatchObject<Partial<VideoTicketError>>({ code: "HTTP_429" });
  });

  it("omits authorization when the issuing profile has no token", async () => {
    config.getAuthToken.mockReturnValueOnce(null);
    const fetchMock = vi
      .fn()
      .mockResolvedValue(
        new Response(JSON.stringify(issued("download")), { status: 201 }),
      );
    vi.stubGlobal("fetch", fetchMock);

    await issueVideoTicket("project", "clips/demo.webm", "download");

    const options = fetchMock.mock.calls[0]?.[1] as RequestInit;
    expect(options.headers).not.toHaveProperty("Authorization");
    expect(options.body).toBe(
      JSON.stringify({
        project: "project",
        path: "clips/demo.webm",
        purpose: "download",
      }),
    );
  });

  it("turns a caller cancellation into a fixed error code", async () => {
    const controller = new AbortController();
    controller.abort();
    vi.stubGlobal(
      "fetch",
      vi.fn().mockRejectedValue(new DOMException("aborted", "AbortError")),
    );

    await expect(
      issueVideoTicket(
        "project",
        "clips/demo.webm",
        "playback",
        controller.signal,
      ),
    ).rejects.toMatchObject<Partial<VideoTicketError>>({ code: "ABORTED" });
  });

  it("rejects malformed capability paths without exposing a response body", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        new Response(
          JSON.stringify({
            ...issued("playback"),
            streamPath: "/api/fs/video/stream/opaque_token?filename=secret",
          }),
          { status: 201 },
        ),
      ),
    );

    await expect(
      issueVideoTicket("project", "clips/demo.webm", "playback"),
    ).rejects.toMatchObject<Partial<VideoTicketError>>({
      code: "INVALID_RESPONSE",
    });
  });

  it("uses the original profile URL and authorization when revoking playback", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(
        new Response(JSON.stringify(issued("playback")), { status: 201 }),
      )
      .mockResolvedValueOnce(new Response(null, { status: 204 }));
    vi.stubGlobal("fetch", fetchMock);

    const ticket = await issueVideoTicket(
      "project",
      "clips/demo.webm",
      "playback",
    );
    config.profile = { id: "profile-b", url: "https://new-api.test/" };
    if (ticket.purpose === "playback") await ticket.revoke();

    expect(fetchMock).toHaveBeenLastCalledWith(
      "https://api.test/api/fs/video/tickets",
      expect.objectContaining({
        headers: expect.objectContaining({
          Authorization: "Bearer secret-token",
        }),
      }),
    );
  });

  it("never includes server response canaries in its fixed errors", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        new Response("private ticket-canary clips/demo.webm", {
          status: 500,
        }),
      ),
    );

    const error = await issueVideoTicket(
      "project",
      "clips/demo.webm",
      "playback",
    ).catch((reason: unknown) => reason as Error);
    expect(error.message).not.toContain("private");
    expect(error.message).not.toContain("ticket-canary");
    expect(error.message).not.toContain("clips/demo.webm");
  });
});
