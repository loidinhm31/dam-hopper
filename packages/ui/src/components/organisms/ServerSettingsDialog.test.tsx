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

  it("mounts safely when closed and unmounts without throwing TDZ ReferenceError", async () => {
    const container = document.createElement("div");
    document.body.append(container);
    root = createRoot(container);

    // Initial render with open: false (matches application startup state)
    expect(() => {
      act(() => {
        root?.render(
          createElement(ServerSettingsDialog, {
            open: false,
            profile: null,
            onClose: vi.fn(),
          }),
        );
      });
    }).not.toThrow();
    expect(container.innerHTML).toBe("");

    // Open and close cycle
    await act(async () => {
      root?.render(
        createElement(ServerSettingsDialog, {
          open: true,
          profile: null,
          onClose: vi.fn(),
        }),
      );
    });
    expect(container.innerHTML).not.toBe("");

    expect(() => {
      act(() => {
        root?.render(
          createElement(ServerSettingsDialog, {
            open: false,
            profile: null,
            onClose: vi.fn(),
          }),
        );
      });
    }).not.toThrow();
    expect(container.innerHTML).toBe("");
  });

  it("blocks profile name text field while exempting auth fields on Android Chrome", () => {
    mockPolicy.enabled = true;
    const markup = renderToStaticMarkup(
      createElement(ServerSettingsDialog, {
        open: true,
        profile: null,
        onClose: vi.fn(),
      }),
    );

    expect(markup).toContain('placeholder="My Server" disabled=""');
    expect(markup).toContain('placeholder="Username" data-auth-input="true"');
    expect(markup).toContain('placeholder="Password" data-auth-input="true"');
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
      'input[placeholder="http://127.0.0.1:4801"]',
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
        headers: expect.objectContaining({
          Authorization: "Bearer http-token",
        }),
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

    expect(fetchMock.mock.calls.map(([url]) => url).filter((url) => !String(url).endsWith("/api/auth/sessions"))).toEqual([
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

    expect(fetchMock.mock.calls.map(([url]) => url).filter((url) => !String(url).endsWith("/api/auth/sessions"))).toEqual([
      "https://old.test/api/fs/media-session",
      "https://old.test/api/auth/logout",
    ]);
    expect(fetchMock.mock.calls.find(([url]) => String(url).endsWith("/api/fs/media-session"))?.[1]).toEqual(
      expect.objectContaining({
        method: "DELETE",
        headers: expect.objectContaining({ Authorization: "Bearer old-token" }),
        credentials: "include",
      }),
    );
    expect(getAuthToken(profile.id)).toBeNull();
    expect(onClose).toHaveBeenCalledOnce();
  });

  it("uses the selected saved login despite unsaved edits and ambient selection changes", async () => {
    const selected = { id: "saved-a", name: "Saved A", url: "https://saved.test", authType: "basic" as const, username: "alice", createdAt: 1, autoConnect: false };
    const other = { ...selected, id: "saved-b", url: "https://ambient.test" };
    saveProfiles([selected, other]); setActiveProfile(other.id);
    setAuthToken("saved-credential", selected.id); setAuthToken("ambient-credential", other.id);
    const session = { id: "selected-session", userAgent: "Selected saved client", current: false,
      issuedAt: "2026-10-22T00:00:00Z", expiresAt: "2026-11-22T00:00:00Z", mfaVerifiedAt: "2026-10-22T00:00:00Z" };
    const fetchMock = vi.fn(async (url: string | URL | Request, init?: RequestInit) => {
      if (String(url).endsWith("/api/auth/login")) {
        return new Response(JSON.stringify({ token: "unsaved-draft-token", user: "alice" }));
      }
      const owned = String(url).startsWith(`${selected.url}/`) &&
        new Headers(init?.headers).get("Authorization") === "Bearer saved-credential";
      if (init?.method === "DELETE") return new Response(null, { status: owned ? 204 : 404 });
      return new Response(JSON.stringify({ sessions: [owned ? session : { ...session, userAgent: "Wrong ambient or draft client" }], nextCursor: null }));
    });
    vi.stubGlobal("fetch", fetchMock);
    const container = document.createElement("div"); document.body.append(container); root = createRoot(container);
    await act(async () => root?.render(createElement(ServerSettingsDialog, { open: true, profile: selected, onClose: vi.fn() })));
    await act(async () => {
      setInputValue(document.querySelector<HTMLInputElement>('input[placeholder="http://127.0.0.1:4801"]')!, "https://unsaved.test");
      setInputValue(document.querySelector<HTMLInputElement>('input[type="password"]')!, "draft-password");
    });
    await act(async () => [...document.querySelectorAll("button")].find((item) => item.textContent === "Test connection")!.click());
    expect(document.body.textContent).toContain("Reachable");
    const section = document.querySelector('section[aria-label="Login devices"]')!;
    await act(async () => [...section.querySelectorAll("button")].find((item) => item.textContent === "Refresh")!.click());
    expect(section.textContent).toContain("Selected saved client");
    expect(section.textContent).not.toContain("Wrong ambient or draft client");
    await act(async () => section.querySelector<HTMLButtonElement>("li button")!.click());
    const confirmation = [...document.querySelectorAll('[role="dialog"]')].find((dialog) =>
      dialog.getAttribute("aria-labelledby")?.split(/\s+/).map((id) => document.getElementById(id)?.textContent).join(" ") === "Revoke this login?");
    expect(confirmation).toBeDefined();
    await act(async () => [...confirmation!.querySelectorAll<HTMLButtonElement>("button")].find((item) => item.textContent === "Revoke access")!.click());
    expect(section.querySelector("li")).toBeNull();
    const deviceCalls = fetchMock.mock.calls.filter(([url]) => String(url).includes("/api/auth/sessions"));
    expect(deviceCalls).toHaveLength(3);
    expect(deviceCalls.map(([url]) => String(url))).toEqual([
      `${selected.url}/api/auth/sessions`, `${selected.url}/api/auth/sessions`,
      `${selected.url}/api/auth/sessions/selected-session`,
    ]);
    for (const [, init] of deviceCalls) {
      expect(init).toMatchObject({ credentials: "omit", headers: { Authorization: "Bearer saved-credential" } });
    }
    expect(getAuthToken(selected.id)).toBe("saved-credential");
    expect(getAuthToken(other.id)).toBe("ambient-credential");
  });

  it("captures legacy saved selection once, and gives a new profile no device authority", async () => {
    const selected = { id: "legacy-a", name: "Legacy A", url: "https://saved.test", authType: "basic" as const, createdAt: 1, autoConnect: false };
    const other = { ...selected, id: "legacy-b", url: "https://other.test" };
    saveProfiles([selected, other]); setActiveProfile(selected.id); setAuthToken("saved-credential", selected.id);
    const fetchMock = vi.fn(async (_url: string | URL | Request) => new Response(JSON.stringify({ sessions: [], nextCursor: null })));
    vi.stubGlobal("fetch", fetchMock);
    const container = document.createElement("div"); document.body.append(container); root = createRoot(container);
    await act(async () => root?.render(createElement(ServerSettingsDialog, { open: true, onClose: vi.fn() })));
    await act(async () => setActiveProfile(other.id));
    const section = document.querySelector('section[aria-label="Login devices"]')!;
    await act(async () => [...section.querySelectorAll("button")].find((item) => item.textContent === "Refresh")!.click());
    expect(fetchMock.mock.calls.every(([url]) => String(url) === "https://saved.test/api/auth/sessions")).toBe(true);
    await act(async () => root?.render(createElement(ServerSettingsDialog, { open: true, profile: null, onClose: vi.fn() })));
    expect(document.querySelector('section[aria-label="Login devices"]')?.textContent).toContain("Save and select");
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });
});
