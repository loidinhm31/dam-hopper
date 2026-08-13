// @vitest-environment jsdom

import { createElement } from "react";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  getAuthToken,
  saveProfiles,
  setActiveProfile,
  setAuthToken,
} from "@/api/server-config.js";
import { ServerSettingsDialog } from "./ServerSettingsDialog.js";

const mockPolicy = vi.hoisted(() => ({ enabled: false }));

vi.mock("@/contexts/AndroidChromeInputPolicyContext.js", () => ({
  useAndroidChromeInputPolicy: () => ({
    isAndroidChromeNativeInputSuppressed: mockPolicy.enabled,
  }),
}));

let root: Root | null = null;

function setInputValue(input: HTMLInputElement, value: string): void {
  const setter = Object.getOwnPropertyDescriptor(
    HTMLInputElement.prototype,
    "value",
  )?.set;
  setter?.call(input, value);
  input.dispatchEvent(new Event("input", { bubbles: true }));
}

describe("ServerSettingsDialog Android Chrome policy", () => {
  beforeEach(() => {
    mockPolicy.enabled = false;
  });

  afterEach(() => {
    act(() => root?.unmount());
    root = null;
    document.body.innerHTML = "";
    localStorage.clear();
    sessionStorage.clear();
    vi.restoreAllMocks();
    vi.useRealTimers();
  });

  it("blocks server text fields and text-dependent actions", () => {
    mockPolicy.enabled = true;
    const markup = renderToStaticMarkup(
      createElement(ServerSettingsDialog, {
        open: true,
        profile: null,
        onClose: vi.fn(),
      }),
    );

    expect(markup).toContain('placeholder="http://localhost:4800" disabled=""');
    expect(markup).toContain(
      "Unavailable on Android Chrome: text entry is disabled",
    );
    expect(markup).toContain(">Cancel</button>");
  });

  it("clears the old profile token when saving a changed server URL", async () => {
    const profile = {
      id: "profile-a",
      name: "Old Server",
      url: "http://old.test",
      authType: "basic" as const,
      username: "user",
      createdAt: 1,
    };
    saveProfiles([profile]);
    setActiveProfile(profile.id);
    setAuthToken("old-token", profile.id);
    const fetchMock = vi.fn(async () => ({
      ok: true,
      status: 200,
      json: async () => ({ token: "old-token" }),
    }));
    vi.stubGlobal("fetch", fetchMock);

    const container = document.createElement("div");
    document.body.append(container);
    root = createRoot(container);
    await act(async () => {
      root?.render(
        createElement(ServerSettingsDialog, {
          open: true,
          profile,
          onClose: vi.fn(),
        }),
      );
    });

    const urlInput = document.querySelector<HTMLInputElement>(
      'input[placeholder="http://localhost:4800"]',
    );
    const passwordInput = document.querySelector<HTMLInputElement>(
      'input[type="password"]',
    );
    const testButton = [...document.querySelectorAll("button")].find(
      (button) => button.textContent === "Test connection",
    );
    expect(urlInput).not.toBeNull();
    expect(passwordInput).not.toBeNull();
    expect(testButton).not.toBeNull();

    await act(async () => {
      setInputValue(passwordInput!, "password");
      testButton!.click();
      await Promise.resolve();
    });
    expect(document.body.textContent).toContain("Reachable");

    await act(async () => {
      setInputValue(urlInput!, "https://new.test");
      await Promise.resolve();
    });
    const replacementTestButton = [...document.querySelectorAll("button")].find(
      (button) => button.textContent === "Test connection",
    );
    await act(async () => {
      replacementTestButton!.click();
      await Promise.resolve();
    });

    vi.useFakeTimers();
    const saveButton = [...document.querySelectorAll("button")].find(
      (button) => button.textContent === "Save profile",
    );
    expect(saveButton).not.toBeNull();
    await act(async () => saveButton!.click());

    expect(getAuthToken(profile.id)).toBeNull();
    expect(fetchMock.mock.calls.map(([url]) => url)).toContain(
      "http://old.test/api/fs/media-session",
    );
  });

  it("revokes a stale profile session before clearing its remaining token", async () => {
    const staleProfile = {
      id: "profile-stale",
      name: "Deleted Server",
      url: "https://deleted.test",
      authType: "basic" as const,
      username: "user",
      createdAt: 1,
    };
    setAuthToken("stale-token", staleProfile.id);
    const fetchMock = vi.fn(async () => ({ ok: true, status: 200 }));
    vi.stubGlobal("fetch", fetchMock);
    const onClose = vi.fn();

    const container = document.createElement("div");
    document.body.append(container);
    root = createRoot(container);
    await act(async () => {
      root?.render(
        createElement(ServerSettingsDialog, {
          open: true,
          profile: staleProfile,
          onClose,
        }),
      );
    });

    const logoutButton = [...document.querySelectorAll("button")].find(
      (button) => button.textContent === "Logout",
    );
    await act(async () => {
      logoutButton!.click();
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(fetchMock.mock.calls.map(([url]) => url)).toEqual([
      "https://deleted.test/api/fs/media-session",
      "https://deleted.test/api/auth/logout",
    ]);
    expect(getAuthToken(staleProfile.id)).toBeNull();
    expect(onClose).toHaveBeenCalledOnce();
  });

  it("revokes media before sending HTTP logout", async () => {
    const staleProfile = {
      id: "profile-http",
      name: "Insecure Server",
      url: "http://insecure.test",
      authType: "basic" as const,
      username: "user",
      createdAt: 1,
    };
    setAuthToken("http-token", staleProfile.id);
    const fetchMock = vi.fn(async () => ({ ok: false, status: 401 }));
    vi.stubGlobal("fetch", fetchMock);

    const container = document.createElement("div");
    document.body.append(container);
    root = createRoot(container);
    await act(async () => {
      root?.render(
        createElement(ServerSettingsDialog, {
          open: true,
          profile: staleProfile,
          onClose: vi.fn(),
        }),
      );
    });

    const logoutButton = [...document.querySelectorAll("button")].find(
      (button) => button.textContent === "Logout",
    );
    await act(async () => {
      logoutButton!.click();
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(fetchMock).toHaveBeenCalledWith(
      "http://insecure.test/api/fs/media-session",
      expect.objectContaining({
        method: "DELETE",
        credentials: "include",
        headers: { Authorization: "Bearer http-token" },
      }),
    );
    expect(fetchMock).toHaveBeenCalledWith(
      "http://insecure.test/api/auth/logout",
      expect.objectContaining({ headers: {} }),
    );
    expect(getAuthToken(staleProfile.id)).toBeNull();
  });

  it("continues local logout after a failed media-session revoke", async () => {
    const profile = {
      id: "profile-a",
      name: "Old Server",
      url: "https://old.test",
      authType: "basic" as const,
      username: "user",
      createdAt: 1,
    };
    const otherProfile = { ...profile, id: "profile-b", name: "Other Server" };
    saveProfiles([profile, otherProfile]);
    setActiveProfile(otherProfile.id);
    setAuthToken("old-token", profile.id);
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce({ ok: false, status: 500 })
      .mockResolvedValueOnce({ ok: true, status: 200 });
    vi.stubGlobal("fetch", fetchMock);
    const onClose = vi.fn();

    const container = document.createElement("div");
    document.body.append(container);
    root = createRoot(container);
    await act(async () => {
      root?.render(
        createElement(ServerSettingsDialog, {
          open: true,
          profile,
          onClose,
        }),
      );
    });

    const logoutButton = [...document.querySelectorAll("button")].find(
      (button) => button.textContent === "Logout",
    );
    await act(async () => {
      logoutButton!.click();
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(fetchMock.mock.calls.map(([url]) => url)).toEqual([
      "https://old.test/api/fs/media-session",
      "https://old.test/api/auth/logout",
    ]);
    expect(getAuthToken(profile.id)).toBeNull();
    expect(onClose).toHaveBeenCalledOnce();
  });

  it("revokes the media session before logging out", async () => {
    const profile = {
      id: "profile-a",
      name: "Old Server",
      url: "https://old.test",
      authType: "basic" as const,
      username: "user",
      createdAt: 1,
    };
    const otherProfile = { ...profile, id: "profile-b", name: "Other Server" };
    saveProfiles([profile, otherProfile]);
    setActiveProfile(otherProfile.id);
    setAuthToken("old-token", profile.id);
    const fetchMock = vi.fn(async () => ({ ok: true, status: 200 }));
    vi.stubGlobal("fetch", fetchMock);
    const onClose = vi.fn();

    const container = document.createElement("div");
    document.body.append(container);
    root = createRoot(container);
    await act(async () => {
      root?.render(
        createElement(ServerSettingsDialog, {
          open: true,
          profile,
          onClose,
        }),
      );
    });

    const logoutButton = [...document.querySelectorAll("button")].find(
      (button) => button.textContent === "Logout",
    );
    expect(logoutButton).not.toBeNull();
    await act(async () => {
      logoutButton!.click();
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(fetchMock.mock.calls.map(([url]) => url)).toEqual([
      "https://old.test/api/fs/media-session",
      "https://old.test/api/auth/logout",
    ]);
    expect(fetchMock.mock.calls[0]?.[1]).toEqual(
      expect.objectContaining({
        method: "DELETE",
        headers: { Authorization: "Bearer old-token" },
        credentials: "include",
      }),
    );
    expect(getAuthToken(profile.id)).toBeNull();
    expect(onClose).toHaveBeenCalledOnce();
  });
});
