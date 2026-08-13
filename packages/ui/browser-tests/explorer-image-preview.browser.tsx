import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { page } from "vitest/browser";
import { ImagePreview } from "@/components/organisms/ImagePreview.js";
import "@/index.css";

const profileState = vi.hoisted(() => ({
  version: 0,
  listeners: new Set<() => void>(),
}));

vi.mock("@/api/media-session.js", async (importOriginal) => {
  const actual =
    await importOriginal<typeof import("@/api/media-session.js")>();
  return {
    ...actual,
    // The shared browser fixture is HTTP and validates native-element behavior;
    // real HTTPS/cookie enforcement remains covered by server contract tests.
    assertMediaTransport: () => undefined,
  };
});

vi.mock("@/api/server-config.js", () => ({
  getActiveProfile: () => ({
    id: `browser-profile-${profileState.version}`,
    url: window.location.origin,
  }),
  getAuthToken: () => "browser-test-token",
  getServerUrl: () => window.location.origin,
  normalizeServerUrl: (url: string) => url.replace(/\/$/, ""),
  getProfileChangeVersion: () => profileState.version,
  subscribeToProfileChanges: (listener: () => void) => {
    profileState.listeners.add(listener);
    return () => profileState.listeners.delete(listener);
  },
}));

(
  globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;

describe("Explorer image preview in Chromium", () => {
  let container: HTMLDivElement;
  let root: Root;
  let mounted = false;
  let fetchSpy: ReturnType<typeof vi.spyOn>;
  let createObjectUrlSpy: ReturnType<typeof vi.spyOn>;
  let responseBlobSpy: ReturnType<typeof vi.spyOn>;

  const postCalls = () =>
    fetchSpy.mock.calls.filter(
      ([, init]) => (init as RequestInit | undefined)?.method === "POST",
    );
  const deleteCalls = () =>
    fetchSpy.mock.calls.filter(
      ([, init]) => (init as RequestInit | undefined)?.method === "DELETE",
    );
  const headCalls = () =>
    fetchSpy.mock.calls.filter(
      ([, init]) => (init as RequestInit | undefined)?.method === "HEAD",
    );
  const expectReady = () =>
    expect
      .poll(() => document.body.textContent ?? "")
      .toContain("Ready to view");
  const renderPreview = async (path: string) => {
    await act(async () => {
      root.render(
        <ImagePreview
          project="demo"
          path={path}
          fileName={path.split("/").pop() ?? path}
          mime="image/png"
        />,
      );
    });
  };

  beforeEach(async () => {
    profileState.version = 0;
    profileState.listeners.clear();
    fetchSpy = vi.spyOn(globalThis, "fetch");
    createObjectUrlSpy = vi.spyOn(URL, "createObjectURL");
    responseBlobSpy = vi.spyOn(Response.prototype, "blob");
    container = document.createElement("div");
    container.style.width = "100vw";
    container.style.height = "100vh";
    document.body.append(container);
    root = createRoot(container);
    await act(async () => {
      root.render(
        <ImagePreview
          project="demo"
          path="images/fixture.png"
          fileName="fixture.png"
          mime="image/png"
        />,
      );
    });
    mounted = true;
  });

  afterEach(async () => {
    if (mounted) await act(async () => root.unmount());
    mounted = false;
    container.remove();
    document.body.replaceChildren();
    vi.restoreAllMocks();
  });

  it("renders a real raster fixture through the opaque native image source", async () => {
    const image = document.querySelector("img") as HTMLImageElement;
    await expect.poll(() => image.naturalWidth).toBe(1);
    await expect.poll(() => image.naturalHeight).toBe(1);
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
    await expect(
      page.getByRole("img", { name: "Image preview: fixture.png" }),
    ).toBeVisible();
    await expectReady();
    expect(image.currentSrc).toContain("/api/fs/image/stream/image_ticket");
    expect(image.crossOrigin).toBe("use-credentials");
    const post = postCalls()[0];
    expect(post?.[0]).toBe(`${window.location.origin}/api/fs/image/tickets`);
    expect(post?.[1]).toEqual(
      expect.objectContaining({
        credentials: "include",
        body: JSON.stringify({ project: "demo", path: "images/fixture.png" }),
        headers: expect.objectContaining({
          Authorization: "Bearer browser-test-token",
        }),
      }),
    );
    const probe = headCalls().find(([input]) =>
      String(input).endsWith("/api/fs/image/stream/image_ticket"),
    );
    expect(probe?.[1]).toEqual(
      expect.objectContaining({ method: "HEAD", credentials: "include" }),
    );
    expect(document.querySelectorAll("img")).toHaveLength(1);
    expect(createObjectUrlSpy).not.toHaveBeenCalled();
    expect(responseBlobSpy).not.toHaveBeenCalled();
  });

  it("stays usable at narrow widths without adding a download action", async () => {
    const image = document.querySelector("img") as HTMLImageElement;
    await expect.poll(() => image.naturalWidth).toBe(1);
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
    await expectReady();
    for (const width of [320, 375, 1280]) {
      await page.viewport(width, 700);
      await expect(
        page.getByRole("img", { name: "Image preview: fixture.png" }),
      ).toBeVisible();
      expect(container.scrollWidth).toBeLessThanOrEqual(container.clientWidth);
    }
    expect(
      [...document.querySelectorAll("button")].some((button) =>
        button.textContent?.includes("Download"),
      ),
    ).toBe(false);
  });

  it("reissues and revokes capabilities after a profile refresh", async () => {
    const image = document.querySelector("img") as HTMLImageElement;
    await expect.poll(() => image.naturalWidth).toBe(1);
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
    await expectReady();

    await act(async () => {
      profileState.version = 1;
      profileState.listeners.forEach((listener) => listener());
      await Promise.resolve();
    });

    await expect.poll(() => postCalls().length).toBe(2);
    await expect.poll(() => deleteCalls().length).toBe(1);
    await expect.poll(() => image.naturalWidth).toBe(1);
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
    await expectReady();
  });

  it("fails closed on a rejected probe and recovers through a fresh ticket", async () => {
    await renderPreview("images/retry.png");
    const image = document.querySelector("img") as HTMLImageElement;
    await expect
      .element(page.getByText("Browser media access is unavailable").first())
      .toBeVisible();
    await expect.poll(() => image.currentSrc).toBe("");
    await expect(
      page.getByRole("button", { name: "Retry image preview" }),
    ).toBeVisible();

    await page.getByRole("button", { name: "Retry image preview" }).click();
    await expect.poll(() => postCalls().length).toBe(3);
    await expect.poll(() => image.naturalWidth).toBe(1);
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
    await expectReady();
    await expect.poll(() => deleteCalls().length).toBeGreaterThanOrEqual(1);
    expect(
      deleteCalls().some(([, init]) =>
        String((init as RequestInit | undefined)?.body).includes(
          "retry_bad_ticket",
        ),
      ),
    ).toBe(true);
  });

  it("detaches a delayed old stream before profile refresh", async () => {
    await renderPreview("images/stale-stream.png");
    const image = document.querySelector("img") as HTMLImageElement;
    await expect
      .poll(() => image.currentSrc)
      .toContain("/api/fs/image/stream/stale_stream_ticket");

    await act(async () => {
      profileState.version = 1;
      profileState.listeners.forEach((listener) => listener());
      await Promise.resolve();
    });

    await expect.poll(() => postCalls().length).toBe(3);
    await expect.poll(() => deleteCalls().length).toBeGreaterThanOrEqual(1);
    await expect.poll(() => image.naturalWidth).toBe(1);
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
    await expectReady();
    expect(
      deleteCalls().some(([, init]) =>
        String((init as RequestInit | undefined)?.body).includes(
          "stale_stream_ticket",
        ),
      ),
    ).toBe(true);
  });

  it("revokes the capability when the native preview unmounts", async () => {
    const image = document.querySelector("img") as HTMLImageElement;
    await expect.poll(() => image.naturalWidth).toBe(1);
    const beforeUnmount = deleteCalls().length;
    await act(async () => root.unmount());
    mounted = false;
    await expect.poll(() => deleteCalls().length).toBe(beforeUnmount + 1);
    expect(
      deleteCalls().some(([, init]) =>
        String((init as RequestInit | undefined)?.body).includes(
          "image_ticket",
        ),
      ),
    ).toBe(true);
  });
});
