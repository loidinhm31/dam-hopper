// @vitest-environment jsdom

import { afterEach, describe, expect, it, vi } from "vitest";

const config = vi.hoisted(() => ({
  getActiveProfile: vi.fn(() => ({
    id: "profile-a",
    url: "https://api.test/",
  })),
  getAuthToken: vi.fn(() => "secret-token"),
  getServerUrl: vi.fn(() => "https://fallback.test"),
  normalizeServerUrl: vi.fn((url: string) => url.replace(/\/$/, "")),
}));

vi.mock("./server-config.js", () => config);

import { issueVideoTicket, VideoTicketError } from "./video-tickets.js";

afterEach(() => vi.unstubAllGlobals());

function issued(purpose: "playback" | "download") {
  return {
    ticket: "opaque_token",
    streamPath: "/api/fs/video/stream/opaque_token",
    expiresAt: 1_800_000_000_000,
    purpose,
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

  it("rejects purpose and stream-path manipulation without leaking server content", async () => {
    vi.stubGlobal(
      "fetch",
      vi
        .fn()
        .mockResolvedValue(
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
});
