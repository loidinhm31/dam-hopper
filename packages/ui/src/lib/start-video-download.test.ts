// @vitest-environment jsdom

import { afterEach, describe, expect, it, vi } from "vitest";

const issueVideoTicket = vi.hoisted(() => vi.fn());
vi.mock("@/api/video-tickets.js", () => ({ issueVideoTicket }));

import { startVideoDownload } from "./start-video-download.js";

afterEach(() => {
  issueVideoTicket.mockReset();
  document.body.innerHTML = "";
});

describe("startVideoDownload", () => {
  it("issues a separate download ticket and removes its temporary anchor", async () => {
    issueVideoTicket.mockResolvedValue({
      purpose: "download",
      url: "https://api.test/api/fs/video/stream/download-token",
      expiresAt: 1,
    });
    const click = vi
      .spyOn(HTMLAnchorElement.prototype, "click")
      .mockImplementation(() => undefined);

    await startVideoDownload("project", "clip.webm");

    expect(issueVideoTicket).toHaveBeenCalledWith(
      "project",
      "clip.webm",
      "download",
    );
    expect(click).toHaveBeenCalledOnce();
    expect(document.querySelector("a")).toBeNull();
    click.mockRestore();
  });

  it("removes the capability anchor when browser activation throws", async () => {
    issueVideoTicket.mockResolvedValue({
      purpose: "download",
      url: "https://api.test/api/fs/video/stream/download-token",
      expiresAt: 1,
    });
    const click = vi
      .spyOn(HTMLAnchorElement.prototype, "click")
      .mockImplementation(() => {
        throw new Error("activation failed");
      });

    await expect(startVideoDownload("project", "clip.webm")).rejects.toThrow(
      "activation failed",
    );
    expect(document.querySelector("a")).toBeNull();
    click.mockRestore();
  });
});
