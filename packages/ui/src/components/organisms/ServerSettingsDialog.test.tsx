// @vitest-environment jsdom

import { createElement } from "react";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  getAuthToken,
  saveProfiles,
  setActiveProfile,
  setAuthToken,
} from "@/api/server-config.js";
import { ServerSettingsDialog } from "./ServerSettingsDialog.js";



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

  it("revokes a stale profile session before clearing its remaining token via explicit keep-data choice", async () => {
    const staleProfile = {
      id: "profile-stale",
      name: "Deleted Server",
      url: "https://deleted.test",
      authType: "basic" as const,
      username: "user",
      createdAt: 1,
    };
    setAuthToken("stale-token", staleProfile.id);
    const fetchMock = vi.fn(async (url: string | URL | Request) => {
      if (String(url).endsWith("/api/browser/capabilities")) {
        return new Response("{}", { status: 401 });
      }
      return new Response(
        JSON.stringify({
          authenticated: false,
          browserResetState: "retained",
          browserCredentialsRetained: true,
          resetRequired: true,
        }),
        { status: 200 },
      );
    });
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
    // Clicking Logout opens confirmation dialog without firing logout yet
    expect(fetchMock.mock.calls.map(([url]) => url)).not.toContain(
      "https://deleted.test/api/auth/logout",
    );
    expect(document.activeElement).toBe(
      document.querySelector('[data-testid="logout-cancel-btn"]'),
    );

    const keepButton = document.querySelector<HTMLButtonElement>(
      '[data-testid="logout-keep-btn"]',
    );
    await act(async () => {
      keepButton!.click();
      await Promise.resolve();
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(
      fetchMock.mock.calls
        .map(([url]) => String(url))
        .filter((url) => !url.endsWith("/api/browser/capabilities")),
    ).toEqual([
      "https://deleted.test/api/fs/media-session",
      "https://deleted.test/api/auth/logout",
    ]);
    expect(getAuthToken(staleProfile.id)).toBeNull();
    await act(async () => {
      document
        .querySelector<HTMLButtonElement>('[data-testid="logout-outcome-done-btn"]')
        ?.click();
    });
    expect(onClose).toHaveBeenCalledOnce();
  });

  it("revokes media before sending HTTP logout without leaking Bearer over non-loopback HTTP", async () => {
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
    await act(async () => {
      document
        .querySelector<HTMLButtonElement>('[data-testid="logout-keep-btn"]')
        ?.click();
      await Promise.resolve();
      await Promise.resolve();
      await Promise.resolve();
    });

    const mediaCall = fetchMock.mock.calls.find(
      ([url]) => String(url) === "http://insecure.test/api/fs/media-session",
    );
    expect(mediaCall).toBeDefined();
    const mediaInit = (mediaCall as unknown[])[1] as RequestInit;
    expect(mediaInit.method).toBe("DELETE");
    expect(mediaInit.credentials).toBe("include");
    expect(new Headers(mediaInit.headers).get("Authorization")).toBeNull();
    const logoutCall = fetchMock.mock.calls.find(
      ([url]) => String(url) === "http://insecure.test/api/auth/logout",
    );
    expect(logoutCall).toBeDefined();
    const logoutInit = (logoutCall as unknown[])[1] as RequestInit;
    expect(new Headers(logoutInit.headers).get("Authorization")).toBeNull();
    expect(getAuthToken(staleProfile.id)).toBeNull();
    expect(
      document.querySelector('[data-testid="logout-outcome-panel"]')?.textContent,
    ).toContain("HTTP 401");
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
    const fetchMock = vi.fn(async (url: string | URL | Request) => {
      const u = String(url);
      if (u.endsWith("/api/browser/capabilities")) {
        return new Response(
          JSON.stringify({
            available: true,
            managedProfilePresent: true,
            profileEpoch: "1",
          }),
          { status: 200 },
        );
      }
      if (u.endsWith("/api/fs/media-session")) {
        return new Response(null, { status: 500 });
      }
      if (u.endsWith("/api/auth/logout")) {
        return new Response(
          JSON.stringify({
            authenticated: false,
            browserResetState: "retained",
            browserCredentialsRetained: true,
            resetRequired: true,
            profileEpoch: "1",
          }),
          { status: 200 },
        );
      }
      return new Response(JSON.stringify({ sessions: [], nextCursor: null }), {
        status: 200,
      });
    });
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
    await act(async () => {
      document
        .querySelector<HTMLButtonElement>('[data-testid="logout-keep-btn"]')
        ?.click();
      await Promise.resolve();
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(
      fetchMock.mock.calls
        .map(([url]) => String(url))
        .filter(
          (url) =>
            !url.endsWith("/api/auth/sessions") &&
            !url.endsWith("/api/browser/capabilities"),
        ),
    ).toEqual([
      "https://old.test/api/fs/media-session",
      "https://old.test/api/auth/logout",
    ]);
    expect(getAuthToken(profile.id)).toBeNull();
    await act(async () => {
      document
        .querySelector<HTMLButtonElement>('[data-testid="logout-outcome-done-btn"]')
        ?.click();
    });
    expect(onClose).toHaveBeenCalledOnce();
  });

  it("supports confirmed clear-data and reauthenticate flow on cleanupPending/stale epoch", async () => {
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
    const fetchMock = vi.fn(async (url: string | URL | Request) => {
      const u = String(url);
      if (u.endsWith("/api/browser/capabilities")) {
        return new Response(
          JSON.stringify({
            available: true,
            managedProfilePresent: true,
            profileEpoch: "2",
          }),
          { status: 200 },
        );
      }
      if (u.endsWith("/api/fs/media-session")) {
        return new Response(null, { status: 204 });
      }
      if (u.endsWith("/api/auth/logout")) {
        return new Response(
          JSON.stringify({
            authenticated: false,
            browserResetState: "cleanupPending",
            browserCredentialsRetained: true,
            resetRequired: true,
            profileEpoch: "3",
            operationId: "op-bg-1",
            reason: "continuing in background",
          }),
          { status: 200 },
        );
      }
      return new Response(JSON.stringify({ sessions: [], nextCursor: null }), {
        status: 200,
      });
    });
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
    await act(async () => {
      document
        .querySelector<HTMLButtonElement>('[data-testid="logout-clear-btn"]')
        ?.click();
      await Promise.resolve();
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(
      fetchMock.mock.calls
        .map(([url]) => String(url))
        .filter(
          (url) =>
            !url.endsWith("/api/auth/sessions") &&
            !url.endsWith("/api/browser/capabilities"),
        ),
    ).toEqual([
      "https://old.test/api/fs/media-session",
      "https://old.test/api/auth/logout",
    ]);
    expect(
      fetchMock.mock.calls.find(([url]) =>
        String(url).endsWith("/api/fs/media-session"),
      )?.[1],
    ).toEqual(
      expect.objectContaining({
        method: "DELETE",
        headers: expect.objectContaining({ Authorization: "Bearer old-token" }),
        credentials: "include",
      }),
    );
    expect(getAuthToken(profile.id)).toBeNull();
    expect(
      document.querySelector('[data-testid="logout-outcome-panel"]')?.textContent,
    ).toContain("op-bg-1");
    // Clicking Reauthenticate keeps settings dialog open for re-login
    await act(async () => {
      document
        .querySelector<HTMLButtonElement>('[data-testid="logout-outcome-reauth-btn"]')
        ?.click();
    });
    expect(onClose).not.toHaveBeenCalled();
    expect(document.querySelector('[data-testid="account-logout-dialog"]')).toBeNull();
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
    const fetchMock = vi.fn<(url: string | URL | Request) => Promise<Response>>(async () => new Response(JSON.stringify({ sessions: [], nextCursor: null })));
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

  it("supports standalone Reset Browser data now preserving login, Cancel-first focus, and pending status polling (W7)", async () => {
    const profile = {
      id: "prof-reset-only",
      name: "Browser Host Server",
      url: "https://reset-only.test",
      authType: "basic" as const,
      username: "admin",
      createdAt: 1,
      autoConnect: true,
    };
    saveProfiles([profile]);
    setActiveProfile(profile.id);
    setAuthToken("admin-live-token", profile.id);

    let statusCallCount = 0;
    const fetchMock = vi.fn(async (url: string | URL | Request, init?: RequestInit) => {
      const u = String(url);
      if (u.endsWith("/api/browser/capabilities")) {
        return new Response(
          JSON.stringify({
            available: true,
            managedProfilePresent: true,
            profileEpoch: "4",
          }),
          { status: 200 },
        );
      }
      if (u.endsWith("/api/browser/profile/reset") && init?.method === "POST") {
        const parsed = JSON.parse(String(init.body ?? "{}")) as Record<string, unknown>;
        expect(parsed.confirmed).toBe(true);
        expect(parsed.expectedProfileEpoch).toBe("4");
        return new Response(
          JSON.stringify({
            operationId: String(parsed.operationId),
            status: "cleanupPending",
            profileEpoch: "5",
            reason: "waiting for background delete",
          }),
          { status: 202 },
        );
      }
      if (u.includes("/api/browser/profile/reset/")) {
        statusCallCount += 1;
        return new Response(
          JSON.stringify({
            operationId: "op-done",
            status: "completed",
            profileEpoch: "5",
          }),
          { status: 200 },
        );
      }
      return new Response(JSON.stringify({ sessions: [], nextCursor: null }), {
        status: 200,
      });
    });
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
      await Promise.resolve();
    });

    const openResetBtn = document.querySelector<HTMLButtonElement>(
      '[data-testid="browser-reset-open-btn"]',
    );
    expect(openResetBtn).not.toBeNull();
    await act(async () => {
      openResetBtn?.click();
      await Promise.resolve();
      await Promise.resolve();
    });

    const cancelResetBtn = document.querySelector<HTMLButtonElement>(
      '[data-testid="browser-reset-cancel-btn"]',
    );
    const confirmResetBtn = document.querySelector<HTMLButtonElement>(
      '[data-testid="browser-reset-confirm-btn"]',
    );
    expect(cancelResetBtn).not.toBeNull();
    expect(confirmResetBtn?.disabled).toBe(false);

    // Confirm reset -> returns cleanupPending while keeping login token intact
    await act(async () => {
      confirmResetBtn?.click();
      await Promise.resolve();
      await Promise.resolve();
    });
    expect(getAuthToken(profile.id)).toBe("admin-live-token");
    expect(
      document.querySelector('[data-testid="browser-reset-status-panel"]')?.textContent,
    ).toContain("cleanup pending");

    // Poll Check status -> transitions to completed
    await act(async () => {
      document
        .querySelector<HTMLButtonElement>('[data-testid="browser-reset-status-btn"]')
        ?.click();
      await Promise.resolve();
      await Promise.resolve();
    });
    expect(statusCallCount).toBe(1);
    expect(
      document.querySelector('[data-testid="browser-reset-status-panel"]')?.textContent,
    ).toContain("Shared Browser data cleared (profile epoch 5)");
    expect(getAuthToken(profile.id)).toBe("admin-live-token");
  });

  it("never clears replacement token when in-flight logout settles late (W6)", async () => {
    const profile = {
      id: "prof-race",
      name: "Race Server",
      url: "https://race.test",
      authType: "basic" as const,
      username: "admin",
      createdAt: 1,
      autoConnect: true,
    };
    saveProfiles([profile]);
    setActiveProfile(profile.id);
    setAuthToken("token-v1", profile.id);

    let resolveLogout!: (resp: Response) => void;
    const fetchMock = vi.fn((url: string | URL | Request) => {
      const u = String(url);
      if (u.endsWith("/api/browser/capabilities")) {
        return Promise.resolve(
          new Response(
            JSON.stringify({
              available: true,
              managedProfilePresent: false,
              profileEpoch: "1",
            }),
            { status: 200 },
          ),
        );
      }
      if (u.endsWith("/api/auth/logout")) {
        return new Promise<Response>((res) => {
          resolveLogout = res;
        });
      }
      if (u.endsWith("/api/fs/media-session")) {
        return Promise.resolve(new Response(null, { status: 204 }));
      }
      return Promise.resolve(
        new Response(JSON.stringify({ sessions: [], nextCursor: null }), { status: 200 }),
      );
    });
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

    const logoutBtn = [...document.querySelectorAll("button")].find(
      (b) => b.textContent === "Logout",
    );
    await act(async () => {
      logoutBtn?.click();
      await Promise.resolve();
      await Promise.resolve();
    });
    await act(async () => {
      document
        .querySelector<HTMLButtonElement>('[data-testid="logout-keep-btn"]')
        ?.click();
      await Promise.resolve();
    });

    // Simulate replacement login taking over while logout request is in flight
    setAuthToken("token-v2", profile.id);
    await act(async () => {
      resolveLogout(
        new Response(
          JSON.stringify({
            ok: true,
            sessionRevoked: true,
            browserResetState: "retained",
            browserCredentialsRetained: true,
            resetRequired: true,
          }),
          { status: 200 },
        ),
      );
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(getAuthToken(profile.id)).toBe("token-v2");
  });

  it("adopts server operationId on 409 cleanupPending conflict and resumes with same operationId (R5)", async () => {
    const profile = {
      id: "prof-r5",
      name: "R5 Server",
      url: "https://r5.test",
      authType: "basic" as const,
      username: "admin",
      createdAt: 1,
      autoConnect: true,
    };
    saveProfiles([profile]);
    setActiveProfile(profile.id);
    setAuthToken("admin-token-r5", profile.id);

    const statusOpIds: string[] = [];
    const fetchMock = vi.fn(async (url: string | URL | Request, init?: RequestInit) => {
      const u = String(url);
      if (u.endsWith("/api/browser/capabilities")) {
        return new Response(
          JSON.stringify({
            available: false,
            managedProfilePresent: true,
            profileEpoch: "4",
            unavailableReason: "cleanup pending",
          }),
          { status: 200 },
        );
      }
      if (u.endsWith("/api/browser/profile/reset") && init?.method === "POST") {
        return new Response(
          JSON.stringify({
            error: "cleanup already pending",
            kind: "cleanupPending",
            operationId: "server-op-existing-77",
          }),
          { status: 409 },
        );
      }
      if (u.includes("/api/browser/profile/reset/") && (!init?.method || init.method === "GET")) {
        const parsed = new URL(u);
        statusOpIds.push(parsed.pathname.split("/").pop() ?? "");
        return new Response(
          JSON.stringify({
            status: "completed",
            profileEpoch: "5",
            operationId: "server-op-existing-77",
          }),
          { status: 200 },
        );
      }
      return new Response(JSON.stringify({ sessions: [], nextCursor: null }), { status: 200 });
    });
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

    await act(async () => {
      document
        .querySelector<HTMLButtonElement>('[data-testid="browser-reset-open-btn"]')
        ?.click();
      await Promise.resolve();
      await Promise.resolve();
    });
    await act(async () => {
      document
        .querySelector<HTMLButtonElement>('[data-testid="browser-reset-confirm-btn"]')
        ?.click();
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(
      document.querySelector('[data-testid="browser-reset-status-panel"]')?.textContent,
    ).toContain("server-op-existing-77");
    expect(
      document.querySelector('[data-testid="browser-reset-open-btn"]')?.textContent,
    ).toContain("Resume cleanup");

    await act(async () => {
      document
        .querySelector<HTMLButtonElement>('[data-testid="browser-reset-status-btn"]')
        ?.click();
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(statusOpIds).toEqual(["server-op-existing-77"]);
    expect(
      document.querySelector('[data-testid="browser-reset-status-panel"]')?.textContent,
    ).toContain("Shared Browser data cleared (profile epoch 5)");
  });

  it("ignores late preflight/reset settlements after dialog closes or switches profile (R4)", async () => {
    const profileA = {
      id: "prof-a",
      name: "Profile A",
      url: "https://a.test",
      authType: "basic" as const,
      username: "admin",
      createdAt: 1,
      autoConnect: true,
    };
    const profileB = {
      id: "prof-b",
      name: "Profile B",
      url: "https://b.test",
      authType: "basic" as const,
      username: "admin",
      createdAt: 2,
      autoConnect: true,
    };
    saveProfiles([profileA, profileB]);
    setActiveProfile(profileA.id);
    setAuthToken("tok-a", profileA.id);
    setAuthToken("tok-b", profileB.id);

    let resolveCap!: (resp: Response) => void;
    const fetchMock = vi.fn((url: string | URL | Request) => {
      const u = String(url);
      if (u.startsWith("https://a.test/api/browser/capabilities")) {
        return new Promise<Response>((res) => {
          resolveCap = res;
        });
      }
      return Promise.resolve(
        new Response(JSON.stringify({ sessions: [], nextCursor: null }), { status: 200 }),
      );
    });
    vi.stubGlobal("fetch", fetchMock);

    const container = document.createElement("div");
    document.body.append(container);
    root = createRoot(container);
    await act(async () => {
      root?.render(
        createElement(ServerSettingsDialog, {
          open: true,
          profile: profileA,
          onClose: vi.fn(),
        }),
      );
    });

    await act(async () => {
      document
        .querySelector<HTMLButtonElement>('[data-testid="browser-reset-open-btn"]')
        ?.click();
      await Promise.resolve();
    });

    // Switch dialog to profile B while profile A's preflight is in flight
    await act(async () => {
      root?.render(
        createElement(ServerSettingsDialog, {
          open: true,
          profile: profileB,
          onClose: vi.fn(),
        }),
      );
      resolveCap(
        new Response(
          JSON.stringify({
            available: true,
            managedProfilePresent: true,
            profileEpoch: "99",
          }),
          { status: 200 },
        ),
      );
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(
      document.querySelector('[data-testid="browser-reset-confirm-dialog"]'),
    ).toBeNull();
    expect(
      document.querySelector('[data-testid="browser-reset-status-panel"]'),
    ).toBeNull();
  });
});
