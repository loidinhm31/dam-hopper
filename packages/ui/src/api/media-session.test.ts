// @vitest-environment jsdom

import { afterEach, describe, expect, it, vi } from "vitest";

import {
  assertMediaSessionAuthorizationMode,
  assertMediaTransport,
  MediaSessionError,
  mediaTicketUrl,
  probeMediaTicket,
  revokeCurrentMediaSession,
} from "./media-session.js";

afterEach(() => vi.unstubAllGlobals());

describe("media session contract", () => {
  it("accepts HTTP and HTTPS web origins but rejects other schemes", () => {
    expect(() => assertMediaTransport("http://localhost:4800")).not.toThrow();
    expect(() => assertMediaTransport("https://api.test")).not.toThrow();
    expect(() => assertMediaTransport("ftp://api.test")).toThrow(
      expect.objectContaining<Partial<MediaSessionError>>({
        code: "MEDIA_SESSION_UNSUPPORTED",
      }),
    );
  });

  it("rejects absent and unknown authorization modes", () => {
    for (const mode of [undefined, "capability-v1", "session-cookie-v2"]) {
      expect(() => assertMediaSessionAuthorizationMode(mode)).toThrow(
        expect.objectContaining<Partial<MediaSessionError>>({
          code: "MEDIA_SESSION_UNSUPPORTED",
        }),
      );
    }
  });

  it("only resolves an opaque, same-origin stream path", () => {
    expect(
      mediaTicketUrl("/api/fs/video/stream/opaque", "https://api.test"),
    ).toBe("https://api.test/api/fs/video/stream/opaque");
    expect(() =>
      mediaTicketUrl(
        "https://other.test/api/fs/video/stream/opaque",
        "https://api.test",
      ),
    ).toThrow("MEDIA_SESSION_UNSUPPORTED");
    expect(() =>
      mediaTicketUrl("/api/fs/video/stream/opaque?secret", "https://api.test"),
    ).toThrow("MEDIA_SESSION_UNSUPPORTED");
  });

  it("uses a credentialed HEAD request and never reads a response body", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValue(new Response(null, { status: 204 }));
    vi.stubGlobal("fetch", fetchMock);

    await probeMediaTicket(
      "https://api.test/api/fs/video/stream/opaque",
      new AbortController().signal,
    );

    expect(fetchMock).toHaveBeenCalledWith(
      "https://api.test/api/fs/video/stream/opaque",
      expect.objectContaining({ method: "HEAD", credentials: "include" }),
    );
  });

  it("revokes current media session with cookies before credentials are cleared", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValue(new Response(null, { status: 204 }));
    vi.stubGlobal("fetch", fetchMock);

    await revokeCurrentMediaSession("https://api.test", "secret-token");

    expect(fetchMock).toHaveBeenCalledWith(
      "https://api.test/api/fs/media-session",
      expect.objectContaining({
        method: "DELETE",
        credentials: "include",
        headers: { Authorization: "Bearer secret-token" },
      }),
    );
  });

  it("revokes a media session over HTTP with bearer and cookies", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValue(new Response(null, { status: 204 }));
    vi.stubGlobal("fetch", fetchMock);

    await revokeCurrentMediaSession("http://api.test", "secret-token");

    expect(fetchMock).toHaveBeenCalledWith(
      "http://api.test/api/fs/media-session",
      expect.objectContaining({
        method: "DELETE",
        credentials: "include",
        headers: { Authorization: "Bearer secret-token" },
      }),
    );
  });

  it("maps HEAD status and network failures to one redacted compatibility error", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(new Response("private", { status: 404 })),
    );
    await expect(
      probeMediaTicket(
        "https://api.test/api/fs/video/stream/opaque",
        new AbortController().signal,
      ),
    ).rejects.toMatchObject<Partial<MediaSessionError>>({
      code: "MEDIA_SESSION_UNSUPPORTED",
    });

    vi.stubGlobal(
      "fetch",
      vi.fn().mockRejectedValue(new Error("private ticket")),
    );
    const error = await probeMediaTicket(
      "https://api.test/api/fs/video/stream/opaque",
      new AbortController().signal,
    ).catch((reason: unknown) => reason as Error);
    expect(error).toMatchObject<Partial<MediaSessionError>>({
      code: "MEDIA_SESSION_UNSUPPORTED",
    });
    expect(error.message).not.toContain("private");
  });

  it("preserves a stable target error returned by the media probe", async () => {
    vi.stubGlobal(
      "fetch",
      vi
        .fn()
        .mockResolvedValue(
          new Response(
            JSON.stringify({ code: "WORKSPACE_TARGET_UNAVAILABLE" }),
            { status: 404, headers: { "content-type": "application/json" } },
          ),
        ),
    );

    await expect(
      probeMediaTicket(
        "https://api.test/api/fs/video/stream/opaque",
        new AbortController().signal,
      ),
    ).rejects.toMatchObject<Partial<MediaSessionError>>({
      code: "WORKSPACE_TARGET_UNAVAILABLE",
    });
  });
});
