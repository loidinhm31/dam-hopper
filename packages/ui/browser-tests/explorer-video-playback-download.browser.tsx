import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { page, userEvent } from "vitest/browser";
import { VideoPreview } from "@/components/organisms/VideoPreview.js";
import "@/index.css";

const serverConfig = vi.hoisted(() => ({
  profileVersion: 0,
  getActiveProfile: () => ({ id: "browser", url: window.location.origin }),
  getAuthToken: () => "synthetic-auth",
}));

vi.mock("@/api/server-config.js", () => ({
  getActiveProfile: serverConfig.getActiveProfile,
  getAuthToken: serverConfig.getAuthToken,
  getServerUrl: () => window.location.origin,
  normalizeServerUrl: (url: string) => url.replace(/\/$/, ""),
  getProfileChangeVersion: () => serverConfig.profileVersion,
  subscribeToProfileChanges: () => () => {},
}));

describe("Explorer video playback in Chromium", () => {
  let container: HTMLDivElement;
  let root: Root;
  let mounted = false;
  let fetchMock: ReturnType<typeof vi.fn>;
  let browserFetch: typeof fetch;
  let deferStale = false;
  let resolveStale: (() => void) | undefined;

  async function render(path = "clips/one-second-vp8.webm") {
    await act(async () => {
      root.render(
        <VideoPreview
          project="demo"
          path={path}
          fileName={path.split("/").pop() ?? path}
          mime="video/webm"
        />,
      );
    });
    mounted = true;
  }

  function postBodies() {
    return fetchMock.mock.calls
      .map(([, init]) => init as RequestInit | undefined)
      .filter((init) => init?.method === "POST")
      .map((init) => JSON.parse(String(init?.body)) as Record<string, string>);
  }

  function streamFetchCount() {
    return fetchMock.mock.calls.filter(([input]) =>
      String(input).includes("/api/fs/video/stream/"),
    ).length;
  }

  beforeEach(async () => {
    browserFetch = window.fetch.bind(window);
    fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      if (init?.method === "POST" && deferStale) {
        const body = JSON.parse(String(init.body)) as { path?: string };
        if (body.path === "clips/stale.webm") {
          const response = await browserFetch(input, {
            ...init,
            signal: undefined,
          });
          return new Promise<Response>((resolve) => {
            resolveStale = () => resolve(response);
          });
        }
      }
      return browserFetch(input, init);
    });
    vi.stubGlobal("fetch", fetchMock);
    deferStale = false;
    resolveStale = undefined;
    container = document.createElement("div");
    container.style.width = "100vw";
    container.style.height = "100vh";
    document.body.append(container);
    root = createRoot(container);
    await render();
  });

  afterEach(async () => {
    if (mounted) await act(async () => root.unmount());
    mounted = false;
    container.remove();
    document.body.replaceChildren();
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it("plays fixture metadata through a purpose-bound playback ticket without autoplay", async () => {
    const player = document.querySelector("video") as HTMLVideoElement;
    await expect(
      page.getByRole("heading", { name: "one-second-vp8.webm" }),
    ).toBeVisible();
    await expect(
      page.getByLabelText("Video preview: one-second-vp8.webm"),
    ).toBeVisible();
    expect(player.controls).toBe(true);
    expect(player.autoplay).toBe(false);
    expect(player.playsInline).toBe(true);
    expect(player.crossOrigin).toBe("use-credentials");
    await expect.poll(() => player.readyState).toBeGreaterThanOrEqual(1);
    await expect.element(page.getByText("Ready to play")).toBeVisible();
    expect(postBodies()).toContainEqual(
      expect.objectContaining({
        path: "clips/one-second-vp8.webm",
        purpose: "playback",
      }),
    );
    const ticketRequest = fetchMock.mock.calls.find(
      ([, init]) => init?.method === "POST",
    );
    expect(String(ticketRequest?.[0]).endsWith("/api/fs/video/tickets")).toBe(
      true,
    );
    expect(
      (ticketRequest?.[1] as RequestInit | undefined)?.headers,
    ).toMatchObject({ Authorization: "Bearer synthetic-auth" });
    const probeRequest = fetchMock.mock.calls.find(
      ([input, init]) =>
        init?.method === "HEAD" && String(input).endsWith("/playback_ticket"),
    );
    expect(probeRequest?.[1]).toEqual(
      expect.objectContaining({ method: "HEAD", credentials: "include" }),
    );

    player.focus();
    const playing = new Promise<void>((resolve) =>
      player.addEventListener("playing", () => resolve(), { once: true }),
    );
    await userEvent.keyboard(" ");
    await expect.poll(() => player.paused).toBe(false);
    await playing;
    const seeked = new Promise<void>((resolve) =>
      player.addEventListener("seeked", () => resolve(), { once: true }),
    );
    player.currentTime = 0.5;
    await expect.poll(() => player.currentTime).toBeGreaterThan(0);
    await seeked;
    player.pause();
    expect(player.paused).toBe(true);
    const resumed = new Promise<void>((resolve) =>
      player.addEventListener("playing", () => resolve(), { once: true }),
    );
    await userEvent.keyboard(" ");
    await expect.poll(() => player.paused).toBe(false);
    await resumed;
    expect(document.activeElement).toBe(player);
    expect(getComputedStyle(player).outlineStyle === "none").toBe(false);
  });

  it("starts a native direct download without Blob or object-URL buffering", async () => {
    const player = document.querySelector("video") as HTMLVideoElement;
    await expect.poll(() => player.readyState).toBeGreaterThanOrEqual(1);
    const playbackSource = player.currentSrc;
    const deleteCallsBefore = fetchMock.mock.calls.filter(
      ([, init]) => init?.method === "DELETE",
    ).length;
    const nativeClick = HTMLAnchorElement.prototype.click;
    let activatedHref: string | null = null;
    const click = vi
      .spyOn(HTMLAnchorElement.prototype, "click")
      .mockImplementation(function clickAnchor(this: HTMLAnchorElement) {
        activatedHref = this.href;
        nativeClick.call(this);
      });
    const blob = vi.spyOn(Response.prototype, "blob");
    const objectUrl = vi.spyOn(URL, "createObjectURL");
    const streamFetchesBefore = streamFetchCount();

    await userEvent.click(
      page.getByRole("button", { name: "Download one-second-vp8.webm" }),
    );

    await expect
      .poll(() => postBodies())
      .toContainEqual(expect.objectContaining({ purpose: "download" }));
    await expect
      .poll(() => activatedHref?.endsWith("/download_ticket") ?? false)
      .toBe(true);
    expect(click).toHaveBeenCalledOnce();
    expect(player.currentSrc === playbackSource).toBe(true);
    expect(
      fetchMock.mock.calls.filter(([, init]) => init?.method === "DELETE")
        .length,
    ).toBe(deleteCallsBefore);
    // One credentialed HEAD compatibility probe occurs for the new download
    // ticket; JavaScript still never requests the media body.
    expect(streamFetchCount()).toBe(streamFetchesBefore + 1);
    expect(blob).not.toHaveBeenCalled();
    expect(objectUrl).not.toHaveBeenCalled();
    const attachment = await browserFetch(activatedHref ?? "", {
      method: "HEAD",
    });
    expect(attachment.headers.get("Content-Disposition")).toBe("attachment");
  });

  it("keeps the new player active when a delayed selection resolves stale", async () => {
    deferStale = true;
    await render("clips/stale.webm");
    await render("clips/active.webm");
    await expect(
      page.getByRole("heading", { name: "active.webm" }),
    ).toBeVisible();
    const player = document.querySelector("video") as HTMLVideoElement;
    await expect.poll(() => player.currentSrc).toContain("/active_ticket");
    const activeSource = player.currentSrc;
    await act(async () => resolveStale?.());

    await expect
      .poll(() =>
        fetchMock.mock.calls.some(([, init]) => init?.method === "DELETE"),
      )
      .toBe(true);
    await expect(
      page.getByRole("heading", { name: "active.webm" }),
    ).toBeVisible();
    expect(player.currentSrc === activeSource).toBe(true);
  });

  it("fails closed when the credentialed ticket probe is rejected", async () => {
    await render("clips/unsupported.webm");
    const player = document.querySelector("video") as HTMLVideoElement;
    await expect
      .element(page.getByText("Browser media access is unavailable").first())
      .toBeVisible();
    await expect.poll(() => player.currentSrc).toBe("");
    const retry = page.getByRole("button", { name: "Retry video playback" });
    await expect.element(retry).toBeVisible();
    await userEvent.click(retry);
    await expect
      .poll(
        () =>
          postBodies().filter((body) => body.path === "clips/unsupported.webm")
            .length,
      )
      .toBeGreaterThanOrEqual(2);

    const pause = vi.spyOn(player, "pause");
    const load = vi.spyOn(player, "load");
    await act(async () => root.unmount());
    mounted = false;
    await expect.poll(() => pause.mock.calls.length).toBeGreaterThan(0);
    await expect.poll(() => load.mock.calls.length).toBeGreaterThan(0);
    await expect.poll(() => player.getAttribute("src")).toBeNull();
  });

  it("keeps controls and status within narrow browser viewports", async () => {
    const player = document.querySelector("video") as HTMLVideoElement;
    await expect.poll(() => player.readyState).toBeGreaterThanOrEqual(1);
    await expect.element(page.getByText("Ready to play")).toBeVisible();
    for (const width of [320, 375, 1280]) {
      await page.viewport(width, 700);
      await expect
        .element(
          page.getByRole("button", { name: "Download one-second-vp8.webm" }),
        )
        .toBeVisible();
      expect(container.scrollWidth).toBeLessThanOrEqual(container.clientWidth);
    }
  });
});
