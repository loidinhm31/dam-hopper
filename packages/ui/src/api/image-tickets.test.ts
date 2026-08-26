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

import { ImageTicketError, issueImageTicket } from "./image-tickets.js";

beforeEach(() => {
  config.profile = { id: "profile-a", url: "https://api.test/" };
  config.getActiveProfile.mockImplementation(() => config.profile);
  config.getAuthToken.mockImplementation((profileId?: string) =>
    profileId === "profile-b" ? "new-token" : "secret-token",
  );
});

afterEach(() => vi.unstubAllGlobals());

function issued() {
  return {
    ticket: "opaque_token",
    streamPath: "/api/fs/image/stream/opaque_token",
    expiresAt: 1_800_000_000_000,
    purpose: "preview",
    authorizationMode: "session-cookie-v1",
  };
}

describe("issueImageTicket", () => {
  it("snapshots profile auth and exposes only an absolute image URL", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValue(
        new Response(JSON.stringify(issued()), { status: 201 }),
      );
    vi.stubGlobal("fetch", fetchMock);

    const ticket = await issueImageTicket(
      { project: "project", worktreePath: "/tmp/project-worktree" },
      "images/preview.webp",
    );

    expect(ticket).toMatchObject({
      purpose: "preview",
      url: "https://api.test/api/fs/image/stream/opaque_token",
      expiresAt: 1_800_000_000_000,
    });
    expect(fetchMock).toHaveBeenCalledWith(
      "https://api.test/api/fs/image/tickets",
      expect.objectContaining({
        method: "POST",
        credentials: "include",
        headers: expect.objectContaining({
          Authorization: "Bearer secret-token",
        }),
      }),
    );
    expect(JSON.parse(fetchMock.mock.calls[0][1].body as string)).toEqual({
      project: "project",
      worktreePath: "/tmp/project-worktree",
      path: "images/preview.webp",
    });

    await ticket.revoke();
    expect(fetchMock).toHaveBeenLastCalledWith(
      "https://api.test/api/fs/image/tickets",
      expect.objectContaining({ method: "DELETE", keepalive: true }),
    );
  });

  it("rejects old servers and probes an issued ticket with credentials", async () => {
    const fetchMock = vi.fn().mockResolvedValueOnce(
      new Response(
        JSON.stringify({ ...issued(), authorizationMode: undefined }),
        {
          status: 201,
        },
      ),
    );
    vi.stubGlobal("fetch", fetchMock);

    await expect(
      issueImageTicket("project", "images/preview.webp"),
    ).rejects.toMatchObject<Partial<ImageTicketError>>({
      code: "MEDIA_SESSION_UNSUPPORTED",
    });
    expect(fetchMock).toHaveBeenCalledOnce();

    fetchMock
      .mockReset()
      .mockResolvedValueOnce(
        new Response(JSON.stringify(issued()), { status: 201 }),
      )
      .mockResolvedValueOnce(new Response(null, { status: 204 }));
    await issueImageTicket("project", "images/preview.webp");
    expect(fetchMock).toHaveBeenLastCalledWith(
      "https://api.test/api/fs/image/stream/opaque_token",
      expect.objectContaining({ method: "HEAD", credentials: "include" }),
    );
  });

  it("rejects purpose, token, and stream-path manipulation", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        new Response(
          JSON.stringify({
            ...issued(),
            ticket: "../steal",
            purpose: "download",
            streamPath: "https://other.test/steal",
          }),
          { status: 201 },
        ),
      ),
    );

    await expect(
      issueImageTicket("project", "images/preview.webp"),
    ).rejects.toMatchObject<Partial<ImageTicketError>>({
      code: "INVALID_RESPONSE",
    });
  });

  it("rejects query-bearing capability paths", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        new Response(
          JSON.stringify({
            ...issued(),
            streamPath: "/api/fs/image/stream/opaque_token?path=secret",
          }),
          { status: 201 },
        ),
      ),
    );

    await expect(
      issueImageTicket("project", "images/preview.webp"),
    ).rejects.toMatchObject<Partial<ImageTicketError>>({
      code: "INVALID_RESPONSE",
    });
  });

  it("uses the original profile URL and authorization when revoking", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(
        new Response(JSON.stringify(issued()), { status: 201 }),
      )
      .mockResolvedValueOnce(new Response(null, { status: 204 }));
    vi.stubGlobal("fetch", fetchMock);

    const ticket = await issueImageTicket("project", "images/preview.webp");
    config.profile = { id: "profile-b", url: "https://new-api.test/" };
    await ticket.revoke();

    expect(fetchMock).toHaveBeenLastCalledWith(
      "https://api.test/api/fs/image/tickets",
      expect.objectContaining({
        headers: expect.objectContaining({
          Authorization: "Bearer secret-token",
        }),
        body: JSON.stringify({ ticket: "opaque_token" }),
      }),
    );
  });

  it("honors caller cancellation while parsing the response body", async () => {
    const controller = new AbortController();
    let bodyStarted: (() => void) | undefined;
    let resolveBody: ((value: unknown) => void) | undefined;
    const body = new Promise<unknown>((resolve) => {
      resolveBody = resolve;
    });
    const response = new Response(null, { status: 201 });
    vi.spyOn(response, "json").mockImplementation(async () => {
      bodyStarted?.();
      return body;
    });
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(response));

    const request = issueImageTicket(
      "project",
      "images/preview.webp",
      controller.signal,
    );
    await new Promise<void>((resolve) => {
      bodyStarted = resolve;
    });
    controller.abort();
    resolveBody?.(issued());

    await expect(request).rejects.toMatchObject<Partial<ImageTicketError>>({
      code: "ABORTED",
    });
  });

  it("turns caller cancellation into a fixed error", async () => {
    const controller = new AbortController();
    controller.abort();
    vi.stubGlobal(
      "fetch",
      vi.fn().mockRejectedValue(new DOMException("aborted", "AbortError")),
    );

    await expect(
      issueImageTicket("project", "images/preview.webp", controller.signal),
    ).rejects.toMatchObject<Partial<ImageTicketError>>({ code: "ABORTED" });
  });

  it("never includes server response content in fixed errors", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        new Response("private ticket-canary images/preview.webp", {
          status: 500,
        }),
      ),
    );

    const error = await issueImageTicket(
      "project",
      "images/preview.webp",
    ).catch((reason: unknown) => reason as Error);
    expect(error.message).not.toContain("private");
    expect(error.message).not.toContain("ticket-canary");
    expect(error.message).not.toContain("images/preview.webp");
  });
});
