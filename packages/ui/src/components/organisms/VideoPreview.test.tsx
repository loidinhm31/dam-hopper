// @vitest-environment jsdom

import * as React from "react";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const issueVideoTicket = vi.hoisted(() => vi.fn());
const startVideoDownload = vi.hoisted(() => vi.fn());

vi.mock("@/api/video-tickets.js", () => ({ issueVideoTicket }));
vi.mock("@/lib/start-video-download.js", () => ({ startVideoDownload }));
vi.mock("@/api/server-config.js", () => ({
  getProfileChangeVersion: () => 0,
  subscribeToProfileChanges: () => () => {},
}));

import { VideoPreview } from "./VideoPreview.js";

(
  globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;

let root: Root | null = null;

beforeEach(() => {
  vi.spyOn(HTMLMediaElement.prototype, "pause").mockImplementation(
    () => undefined,
  );
  vi.spyOn(HTMLMediaElement.prototype, "load").mockImplementation(
    () => undefined,
  );
});

afterEach(() => {
  act(() => root?.unmount());
  root = null;
  document.body.innerHTML = "";
  vi.restoreAllMocks();
  issueVideoTicket.mockReset();
  startVideoDownload.mockReset();
});

async function mount() {
  const container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
  await act(async () => {
    root?.render(
      <VideoPreview
        project="demo"
        path="clips/demo.webm"
        fileName="demo.webm"
        mime="video/webm"
      />,
    );
  });
}

async function render(path: string) {
  await act(async () => {
    root?.render(
      <VideoPreview
        project="demo"
        path={path}
        fileName={path.split("/").pop() ?? path}
        mime="video/webm"
      />,
    );
  });
}

describe("VideoPreview", () => {
  it("attaches a playback ticket directly to one native, non-autoplay player", async () => {
    const revoke = vi.fn().mockResolvedValue(undefined);
    issueVideoTicket.mockResolvedValue({
      purpose: "playback",
      url: "https://api.test/api/fs/video/stream/playback-token",
      expiresAt: 1,
      revoke,
    });

    await mount();

    const player = document.querySelector("video");
    expect(player).toHaveProperty(
      "src",
      "https://api.test/api/fs/video/stream/playback-token",
    );
    expect(player?.getAttribute("preload")).toBe("metadata");
    expect(player?.hasAttribute("controls")).toBe(true);
    expect(player?.hasAttribute("autoplay")).toBe(false);
    expect(player?.hasAttribute("playsinline")).toBe(true);
    expect(issueVideoTicket).toHaveBeenCalledWith(
      "demo",
      "clips/demo.webm",
      "playback",
      expect.any(AbortSignal),
    );

    act(() => root?.unmount());
    expect(revoke).toHaveBeenCalledOnce();
    root = null;
  });

  it("starts a separate direct download without replacing playback", async () => {
    issueVideoTicket.mockResolvedValue({
      purpose: "playback",
      url: "https://api.test/api/fs/video/stream/playback-token",
      expiresAt: 1,
      revoke: vi.fn(),
    });
    startVideoDownload.mockResolvedValue(undefined);
    await mount();

    const button = [...document.querySelectorAll("button")].find((candidate) =>
      candidate.textContent?.includes("Download"),
    );
    await act(async () => button?.click());

    expect(startVideoDownload).toHaveBeenCalledWith("demo", "clips/demo.webm");
    expect(document.querySelector("video")?.getAttribute("src")).toContain(
      "playback-token",
    );
  });

  it("revokes a delayed stale playback ticket instead of replacing the active source", async () => {
    let resolveFirst: ((value: unknown) => void) | undefined;
    const first = new Promise((resolve) => {
      resolveFirst = resolve;
    });
    const staleRevoke = vi.fn();
    const activeRevoke = vi.fn();
    issueVideoTicket
      .mockImplementationOnce(() => first)
      .mockResolvedValueOnce({
        purpose: "playback",
        url: "https://api.test/api/fs/video/stream/active-token",
        expiresAt: 1,
        revoke: activeRevoke,
      });

    await mount();
    await render("clips/active.webm");
    await act(async () => {
      resolveFirst?.({
        purpose: "playback",
        url: "https://api.test/api/fs/video/stream/stale-token",
        expiresAt: 1,
        revoke: staleRevoke,
      });
      await Promise.resolve();
    });

    expect(staleRevoke).toHaveBeenCalledOnce();
    expect(document.querySelector("video")?.getAttribute("src")).toContain(
      "active-token",
    );
    expect(activeRevoke).not.toHaveBeenCalled();
  });

  it("maps codec errors to a retryable fallback without exposing the source", async () => {
    issueVideoTicket.mockResolvedValue({
      purpose: "playback",
      url: "https://api.test/api/fs/video/stream/playback-token",
      expiresAt: 1,
      revoke: vi.fn(),
    });
    await mount();
    const player = document.querySelector("video") as HTMLVideoElement;
    Object.defineProperty(player, "currentSrc", {
      configurable: true,
      value: "https://api.test/api/fs/video/stream/playback-token",
    });
    Object.defineProperty(player, "error", {
      configurable: true,
      value: { code: 3 },
    });
    await act(async () => player.dispatchEvent(new Event("error")));

    expect(document.body.textContent).toContain("cannot decode");
    expect(document.body.textContent).not.toContain("playback-token");
    const retry = [...document.querySelectorAll("button")].find((button) =>
      button.textContent?.includes("Retry"),
    );
    await act(async () => retry?.click());
    expect(issueVideoTicket).toHaveBeenCalledTimes(2);
  });

  it("debounces repeated download clicks while playback remains mounted", async () => {
    issueVideoTicket.mockResolvedValue({
      purpose: "playback",
      url: "https://api.test/api/fs/video/stream/playback-token",
      expiresAt: 1,
      revoke: vi.fn(),
    });
    let resolveDownload: (() => void) | undefined;
    startVideoDownload.mockImplementation(
      () => new Promise<void>((resolve) => (resolveDownload = resolve)),
    );
    await mount();
    const download = [...document.querySelectorAll("button")].find((button) =>
      button.textContent?.includes("Download"),
    );
    await act(async () => {
      download?.click();
      download?.click();
    });

    expect(startVideoDownload).toHaveBeenCalledOnce();
    expect(document.querySelector("video")?.getAttribute("src")).toContain(
      "playback-token",
    );
    await act(async () => resolveDownload?.());
  });
});
