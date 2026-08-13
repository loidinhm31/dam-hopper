// @vitest-environment jsdom

import * as React from "react";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";

const issueImageTicket = vi.hoisted(() => vi.fn());
const profileListeners = vi.hoisted(() => new Set<() => void>());

vi.mock("@/api/image-tickets.js", () => ({ issueImageTicket }));
vi.mock("@/api/server-config.js", () => ({
  getProfileChangeVersion: () => 0,
  subscribeToProfileChanges: (listener: () => void) => {
    profileListeners.add(listener);
    return () => profileListeners.delete(listener);
  },
}));

import { ImagePreview } from "./ImagePreview.js";

(
  globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;

let root: Root | null = null;

afterEach(() => {
  act(() => root?.unmount());
  root = null;
  document.body.innerHTML = "";
  profileListeners.clear();
  issueImageTicket.mockReset();
});

async function mount(path = "images/preview.webp") {
  const container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
  await act(async () => {
    root?.render(
      <ImagePreview
        project="demo"
        path={path}
        fileName={path.split("/").pop() ?? path}
        mime="image/webp"
      />,
    );
  });
}

async function render(path: string) {
  await act(async () => {
    root?.render(
      <ImagePreview
        project="demo"
        path={path}
        fileName={path.split("/").pop() ?? path}
        mime="image/png"
      />,
    );
  });
}

describe("ImagePreview", () => {
  it("attaches one opaque ticket directly to an accessible native image", async () => {
    const revoke = vi.fn().mockResolvedValue(undefined);
    issueImageTicket.mockResolvedValue({
      purpose: "preview",
      url: "https://api.test/api/fs/image/stream/preview-token",
      expiresAt: 1,
      revoke,
    });

    await mount();

    const image = document.querySelector("img");
    expect(image).toHaveProperty(
      "src",
      "https://api.test/api/fs/image/stream/preview-token",
    );
    expect(image?.alt).toBe("Image preview: preview.webp");
    expect(image?.getAttribute("crossorigin")).toBe("use-credentials");
    expect(document.body.textContent).not.toContain("Download");
    expect(issueImageTicket).toHaveBeenCalledWith(
      "demo",
      "images/preview.webp",
      expect.any(AbortSignal),
    );

    act(() => root?.unmount());
    expect(revoke).toHaveBeenCalledOnce();
    root = null;
  });

  it("revokes a delayed stale ticket instead of replacing the active source", async () => {
    let resolveFirst: ((value: unknown) => void) | undefined;
    const first = new Promise((resolve) => {
      resolveFirst = resolve;
    });
    const staleRevoke = vi.fn();
    const activeRevoke = vi.fn();
    issueImageTicket
      .mockImplementationOnce(() => first)
      .mockResolvedValueOnce({
        purpose: "preview",
        url: "https://api.test/api/fs/image/stream/active-token",
        expiresAt: 1,
        revoke: activeRevoke,
      });

    await mount("images/first.webp");
    await render("images/active.webp");
    await act(async () => {
      resolveFirst?.({
        purpose: "preview",
        url: "https://api.test/api/fs/image/stream/stale-token",
        expiresAt: 1,
        revoke: staleRevoke,
      });
      await Promise.resolve();
    });

    expect(staleRevoke).toHaveBeenCalledOnce();
    expect(document.querySelector("img")?.getAttribute("src")).toContain(
      "active-token",
    );
    expect(activeRevoke).not.toHaveBeenCalled();
  });

  it("shows a generic retryable error without exposing the capability URL", async () => {
    issueImageTicket.mockResolvedValue({
      purpose: "preview",
      url: "https://api.test/api/fs/image/stream/private-token",
      expiresAt: 1,
      revoke: vi.fn(),
    });
    await mount();
    const image = document.querySelector("img") as HTMLImageElement;
    await act(async () => image.dispatchEvent(new Event("error")));

    expect(document.body.textContent).toContain("Image preview unavailable");
    expect(document.body.textContent).not.toContain("private-token");
    const retry = [...document.querySelectorAll("button")].find((button) =>
      button.textContent?.includes("Retry"),
    );
    await act(async () => retry?.click());
    expect(issueImageTicket).toHaveBeenCalledTimes(2);
  });

  it.each([
    [
      "MEDIA_SESSION_UNSUPPORTED",
      "Browser media access is unavailable",
      "Allow site data",
    ],
    ["INSECURE_MEDIA_SERVER", "Secure connection required", "must use HTTPS"],
  ])(
    "renders safe, actionable %s guidance and retries",
    async (code, title, guidance) => {
      issueImageTicket.mockRejectedValueOnce(
        Object.assign(new Error(), { code }),
      );
      await mount();

      expect(document.body.textContent).toContain(title);
      expect(document.body.textContent).toContain(guidance);
      expect(document.body.textContent).not.toContain(code);

      issueImageTicket.mockResolvedValueOnce({
        purpose: "preview",
        url: "https://api.test/api/fs/image/stream/retry-token",
        expiresAt: 1,
        revoke: vi.fn(),
      });
      const retry = [...document.querySelectorAll("button")].find((button) =>
        button.textContent?.includes("Retry"),
      );
      await act(async () => retry?.click());
      expect(issueImageTicket).toHaveBeenCalledTimes(2);
      expect(document.querySelector("img")?.getAttribute("src")).toContain(
        "retry-token",
      );
    },
  );

  it("restarts against a changed profile and cleans the previous ticket", async () => {
    const firstRevoke = vi.fn();
    issueImageTicket.mockResolvedValue({
      purpose: "preview",
      url: "https://api.test/api/fs/image/stream/first-token",
      expiresAt: 1,
      revoke: firstRevoke,
    });
    await mount();

    await act(async () => {
      profileListeners.forEach((listener) => listener());
      await Promise.resolve();
    });

    expect(firstRevoke).toHaveBeenCalledOnce();
    expect(issueImageTicket).toHaveBeenCalledTimes(2);
  });
});
