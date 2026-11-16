// @vitest-environment jsdom

import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const revokeCurrentMediaSession = vi.hoisted(() => vi.fn());
const resetHostAlerts = vi.hoisted(() => vi.fn());
const mockConnectProfile = vi.hoisted(() => vi.fn());
const mockDisconnectProfile = vi.hoisted(() => vi.fn());
const mockRemoveProfileConnection = vi.hoisted(() => vi.fn());

vi.mock("@/api/media-session.js", () => ({ revokeCurrentMediaSession }));
vi.mock("@/hooks/use-host-resource-alert-presentation.js", () => ({
  useHostResourceAlertPresentationStore: {
    getState: () => ({ reset: resetHostAlerts }),
  },
}));
vi.mock("@/api/connections.js", () => ({
  connectProfile: mockConnectProfile,
  disconnectProfile: mockDisconnectProfile,
  removeProfileConnection: mockRemoveProfileConnection,
  getMediaClientIdForProfile: vi.fn(() => "test-media-client-id"),
  subscribeConnections: vi.fn(() => () => {}),
  getConnectionSnapshot: vi.fn((profileId: string) => {
    if (profileId === "profile-live") {
      return {
        owner: { profileId, generation: 1 },
        status: "connected",
        intent: true,
        serverUrl: "https://live.test",
        error: null,
      };
    }
    if (profileId === "profile-mfa") {
      return {
        owner: { profileId, generation: 1 },
        status: "mfa-required",
        intent: true,
        serverUrl: "https://mfa.test",
        error: "MFA verification required",
      };
    }
    return {
      owner: { profileId, generation: 1 },
      status: "disconnected",
      intent: false,
      serverUrl: "https://disconnected.test",
      error: null,
    };
  }),
}));

import {
  clearActiveProfile,
  clearAuthToken,
  getAuthToken,
  getProfiles,
  saveProfiles,
  setActiveProfile,
  setAuthToken,
} from "@/api/server-config.js";
import { ServerProfilesDialog } from "./ServerProfilesDialog.js";

let root: Root | null = null;

beforeEach(() => {
  localStorage.clear();
  sessionStorage.clear();
  revokeCurrentMediaSession.mockReset().mockResolvedValue(undefined);
  resetHostAlerts.mockReset();
  mockConnectProfile.mockReset();
  mockDisconnectProfile.mockReset();
  mockRemoveProfileConnection.mockReset();
});

afterEach(() => {
  vi.unstubAllGlobals();
  act(() => root?.unmount());
  root = null;
  document.body.innerHTML = "";
  clearActiveProfile();
  clearAuthToken("profile-a");
  clearAuthToken("profile-b");
  clearAuthToken("profile-live");
});

describe("ServerProfilesDialog", () => {
  it("revokes a profile media session before deleting its token on remove", async () => {
    const profileA = {
      id: "profile-a",
      name: "Active server",
      url: "https://active.test",
      authType: "basic" as const,
      createdAt: 1,
      autoConnect: true,
    };
    const profileB = {
      ...profileA,
      id: "profile-b",
      name: "Deleted server",
      url: "https://deleted.test",
    };
    saveProfiles([profileA, profileB]);
    setActiveProfile(profileA.id);
    setAuthToken("deleted-token", profileB.id);

    const container = document.createElement("div");
    document.body.append(container);
    root = createRoot(container);
    await act(async () => {
      root?.render(
        <ServerProfilesDialog
          open
          onClose={() => undefined}
          onEditProfile={() => undefined}
        />,
      );
    });

    const deleteButtons = document.querySelectorAll<HTMLButtonElement>(
      'button[title="Remove profile"]',
    );
    expect(deleteButtons).toHaveLength(2);
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    await act(async () => {
      deleteButtons[1]?.click();
      await Promise.resolve();
    });

    const confirmDialog = document.querySelector('[role="dialog"]');
    expect(confirmDialog?.textContent).toMatch(/server Browser credentials are retained/i);

    const confirmButton = [
      ...document.querySelectorAll<HTMLButtonElement>('[role="dialog"] button'),
    ].find((button) => button.textContent?.includes("Remove profile"));
    expect(confirmButton).toBeTruthy();
    await act(async () => {
      confirmButton?.click();
      await Promise.resolve();
    });

    expect(revokeCurrentMediaSession).toHaveBeenCalledWith(
      "https://deleted.test",
      "deleted-token",
      expect.anything(),
    );
    expect(fetchMock).not.toHaveBeenCalled();
    expect(mockRemoveProfileConnection).toHaveBeenCalledWith("profile-b");
    expect(getProfiles().map((profile) => profile.id)).toEqual(["profile-a"]);
  });

  it("requires explicit keep/clear choice, defaults focus to Cancel, and cancels without logout", async () => {
    const profileA = {
      id: "profile-a",
      name: "Server to logout",
      url: "https://logout.test",
      authType: "basic" as const,
      createdAt: 1,
      autoConnect: true,
    };
    saveProfiles([profileA]);
    setAuthToken("logout-token", profileA.id);

    const fetchMock = vi.fn(async (url: string | URL | Request) => {
      if (String(url).endsWith("/api/browser/capabilities")) {
        return new Response(
          JSON.stringify({
            available: true,
            managedProfilePresent: true,
            profileEpoch: "2",
          }),
          { status: 200 },
        );
      }
      if (String(url).endsWith("/api/auth/logout")) {
        return new Response(
          JSON.stringify({
            authenticated: false,
            browserResetState: "retained",
            browserCredentialsRetained: true,
            resetRequired: true,
            profileEpoch: "2",
          }),
          { status: 200 },
        );
      }
      return new Response("{}", { status: 404 });
    });
    vi.stubGlobal("fetch", fetchMock);

    const onLoginMock = vi.fn();
    const container = document.createElement("div");
    document.body.append(container);
    root = createRoot(container);
    await act(async () => {
      root?.render(
        <ServerProfilesDialog
          open
          onClose={() => undefined}
          onEditProfile={() => undefined}
          onLoginProfile={onLoginMock}
        />,
      );
    });

    const logoutButton = document.querySelector<HTMLButtonElement>(
      'button[title="Log out of this server account"]',
    );
    expect(logoutButton).not.toBeNull();
    await act(async () => {
      logoutButton?.click();
      await Promise.resolve();
      await Promise.resolve();
    });

    // Dialog opened, NO logout yet, initial focus on Cancel
    expect(fetchMock.mock.calls.some(([u]) => String(u).endsWith("/api/auth/logout"))).toBe(false);
    expect(getAuthToken(profileA.id)).toBe("logout-token");
    const cancelBtn = document.querySelector<HTMLButtonElement>('[data-testid="logout-cancel-btn"]');
    const keepBtn = document.querySelector<HTMLButtonElement>('[data-testid="logout-keep-btn"]');
    const clearBtn = document.querySelector<HTMLButtonElement>('[data-testid="logout-clear-btn"]');
    expect(cancelBtn).not.toBeNull();
    expect(keepBtn).not.toBeNull();
    expect(clearBtn).not.toBeNull();
    expect(document.activeElement).toBe(cancelBtn);
    expect(keepBtn?.hasAttribute("autofocus")).toBe(false);
    expect(clearBtn?.hasAttribute("autofocus")).toBe(false);

    // Cancel keeps login & profile intact
    await act(async () => {
      cancelBtn?.click();
      await Promise.resolve();
    });
    expect(document.querySelector('[data-testid="account-logout-dialog"]')).toBeNull();
    expect(getAuthToken(profileA.id)).toBe("logout-token");
    expect(revokeCurrentMediaSession).not.toHaveBeenCalled();

    // Re-open and choose explicit Keep Browser data
    await act(async () => {
      logoutButton?.click();
      await Promise.resolve();
      await Promise.resolve();
    });
    const keepBtn2 = document.querySelector<HTMLButtonElement>('[data-testid="logout-keep-btn"]');
    await act(async () => {
      keepBtn2?.click();
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(revokeCurrentMediaSession).toHaveBeenCalledWith(
      "https://logout.test",
      "logout-token",
      expect.anything(),
    );
    const logoutCall = fetchMock.mock.calls.find(([u]) =>
      String(u).endsWith("/api/auth/logout"),
    );
    expect(logoutCall).toBeDefined();
    expect(JSON.parse(String((logoutCall?.[1] as RequestInit).body))).toEqual({
      browserReset: false,
    });
    expect(getAuthToken(profileA.id)).toBeNull();
    expect(mockDisconnectProfile).toHaveBeenCalledWith("profile-a");
    expect(document.querySelector('[data-testid="logout-outcome-panel"]')?.textContent).toContain(
      "retained",
    );
    const reauthBtn = document.querySelector<HTMLButtonElement>(
      '[data-testid="logout-outcome-reauth-btn"]',
    );
    expect(reauthBtn).not.toBeNull();
    await act(async () => {
      reauthBtn?.click();
    });
    expect(onLoginMock).toHaveBeenCalledWith(profileA);
    expect(getProfiles()).toHaveLength(1);
  });

  it("supports confirmed clear shared Browser data and offline keep-data fallback", async () => {
    const profileA = {
      id: "profile-a",
      name: "Admin Server",
      url: "https://admin.test",
      authType: "basic" as const,
      createdAt: 1,
      autoConnect: true,
    };
    saveProfiles([profileA]);
    setAuthToken("admin-token", profileA.id);

    const fetchMock = vi.fn(async (url: string | URL | Request) => {
      if (String(url).endsWith("/api/browser/capabilities")) {
        return new Response(
          JSON.stringify({
            available: true,
            managedProfilePresent: true,
            profileEpoch: "4",
          }),
          { status: 200 },
        );
      }
      if (String(url).endsWith("/api/auth/logout")) {
        return new Response(
          JSON.stringify({
            authenticated: false,
            browserResetState: "cleared",
            browserCredentialsRetained: false,
            resetRequired: false,
            profileEpoch: "5",
          }),
          { status: 200 },
        );
      }
      return new Response("{}", { status: 404 });
    });
    vi.stubGlobal("fetch", fetchMock);

    const container = document.createElement("div");
    document.body.append(container);
    root = createRoot(container);
    await act(async () => {
      root?.render(
        <ServerProfilesDialog
          open
          onClose={() => undefined}
          onEditProfile={() => undefined}
        />,
      );
    });

    await act(async () => {
      document
        .querySelector<HTMLButtonElement>('button[title="Log out of this server account"]')
        ?.click();
      await Promise.resolve();
      await Promise.resolve();
    });

    const clearBtn = document.querySelector<HTMLButtonElement>(
      '[data-testid="logout-clear-btn"]',
    );
    expect(clearBtn?.disabled).toBe(false);
    await act(async () => {
      clearBtn?.click();
      await Promise.resolve();
      await Promise.resolve();
    });

    const logoutCall = fetchMock.mock.calls.find(([u]) =>
      String(u).endsWith("/api/auth/logout"),
    );
    const sent = JSON.parse(String((logoutCall?.[1] as RequestInit).body));
    expect(sent).toMatchObject({
      browserReset: true,
      confirmed: true,
      expectedProfileEpoch: "4",
    });
    expect(typeof sent.operationId).toBe("string");
    expect(document.querySelector('[data-testid="logout-outcome-panel"]')?.textContent).toContain(
      "deleted",
    );

    // Offline server disables Clear and reports remote status unknown (never cleared)
    await act(async () => {
      document
        .querySelector<HTMLButtonElement>('[data-testid="logout-outcome-done-btn"]')
        ?.click();
    });
    setAuthToken("admin-token-2", profileA.id);
    fetchMock.mockRejectedValue(new Error("offline"));
    await act(async () => {
      root?.render(
        <ServerProfilesDialog
          open
          onClose={() => undefined}
          onEditProfile={() => undefined}
        />,
      );
    });
    await act(async () => {
      document
        .querySelector<HTMLButtonElement>('button[title="Log out of this server account"]')
        ?.click();
      await Promise.resolve();
      await Promise.resolve();
    });
    expect(
      document.querySelector<HTMLButtonElement>('[data-testid="logout-clear-btn"]')?.disabled,
    ).toBe(true);
    await act(async () => {
      document
        .querySelector<HTMLButtonElement>('[data-testid="logout-keep-btn"]')
        ?.click();
      await Promise.resolve();
      await Promise.resolve();
    });
    expect(getAuthToken(profileA.id)).toBeNull();
    expect(document.querySelector('[data-testid="logout-outcome-panel"]')?.textContent).toContain(
      "NOT cleared",
    );
  });
  it("disconnects a live profile without clearing token or deleting profile", async () => {
    const profileLive = {
      id: "profile-live",
      name: "Live server",
      url: "https://live.test",
      authType: "basic" as const,
      createdAt: 1,
      autoConnect: true,
    };
    saveProfiles([profileLive]);
    setAuthToken("live-token", profileLive.id);

    const container = document.createElement("div");
    document.body.append(container);
    root = createRoot(container);
    await act(async () => {
      root?.render(
        <ServerProfilesDialog
          open
          onClose={() => undefined}
          onEditProfile={() => undefined}
        />,
      );
    });

    const disconnectBtn = document.querySelector<HTMLButtonElement>(
      'button[title="Disconnect without clearing credentials"]',
    );
    expect(disconnectBtn).not.toBeNull();
    await act(async () => {
      disconnectBtn?.click();
      await Promise.resolve();
    });

    expect(mockDisconnectProfile).toHaveBeenCalledWith("profile-live");
    expect(getAuthToken(profileLive.id)).toBe("live-token");
  });

  it("toggles auto-connect without reloading page", async () => {
    const profile = {
      id: "profile-a",
      name: "Server",
      url: "https://test.local",
      authType: "none" as const,
      createdAt: 1,
      autoConnect: true,
    };
    saveProfiles([profile]);

    const container = document.createElement("div");
    document.body.append(container);
    root = createRoot(container);
    await act(async () => {
      root?.render(
        <ServerProfilesDialog
          open
          onClose={() => undefined}
          onEditProfile={() => undefined}
        />,
      );
    });

    const checkbox = document.querySelector<HTMLInputElement>(
      'input[type="checkbox"]',
    );
    expect(checkbox).not.toBeNull();
    expect(checkbox?.checked).toBe(true);

    await act(async () => {
      checkbox?.click();
      await Promise.resolve();
    });

    expect(getProfiles()[0].autoConnect).toBe(false);
  });

  it("renders MFA required badge and calls onLoginProfile on MFA button click", async () => {
    const profileMfa = {
      id: "profile-mfa",
      name: "MFA Server",
      url: "https://mfa.test",
      authType: "basic" as const,
      username: "alice",
      createdAt: 1,
      autoConnect: true,
    };
    saveProfiles([profileMfa]);
    setAuthToken("restricted-token", profileMfa.id);

    const onLoginMock = vi.fn();
    const container = document.createElement("div");
    document.body.append(container);
    root = createRoot(container);
    await act(async () => {
      root?.render(
        <ServerProfilesDialog
          open
          onClose={() => undefined}
          onEditProfile={() => undefined}
          onLoginProfile={onLoginMock}
        />,
      );
    });

    expect(document.body.textContent).toContain("MFA required");

    const mfaBtn = document.querySelector<HTMLButtonElement>(
      'button[title="Complete MFA verification for this server"]',
    );
    expect(mfaBtn).not.toBeNull();
    await act(async () => {
      mfaBtn?.click();
    });

    expect(onLoginMock).toHaveBeenCalledWith(profileMfa);
  });

  it("offers Log out first inside local profile removal dialog and preserves replacement login on late logout completion (W6, W7, W9)", async () => {
    const profile = {
      id: "profile-live",
      name: "Live Server",
      url: "https://live.test",
      authType: "basic" as const,
      username: "admin",
      createdAt: 1,
      autoConnect: true,
    };
    saveProfiles([profile]);
    setAuthToken("old-token", profile.id);

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
      return Promise.resolve(new Response(null, { status: 204 }));
    });
    vi.stubGlobal("fetch", fetchMock);

    const container = document.createElement("div");
    document.body.append(container);
    root = createRoot(container);
    await act(async () => {
      root?.render(
        <ServerProfilesDialog
          open
          onClose={() => undefined}
          onEditProfile={() => undefined}
        />,
      );
    });

    // 1. Open Remove profile -> click "Log out first..." -> opens AccountLogoutDialog
    const removeBtn = document.querySelector<HTMLButtonElement>(
      'button[title="Remove profile"]',
    );
    await act(async () => {
      removeBtn?.click();
      await Promise.resolve();
    });
    const logoutFirstBtn = document.querySelector<HTMLButtonElement>(
      '[data-testid="remove-profile-logout-first-btn"]',
    );
    expect(logoutFirstBtn).not.toBeNull();
    await act(async () => {
      logoutFirstBtn?.click();
      await Promise.resolve();
      await Promise.resolve();
    });
    expect(document.querySelector('[data-testid="account-logout-dialog"]')).not.toBeNull();

    // 2. Start keep-data logout while old-token is active; simulate replacement login before completion
    await act(async () => {
      document
        .querySelector<HTMLButtonElement>('[data-testid="logout-keep-btn"]')
        ?.click();
      await Promise.resolve();
    });
    setAuthToken("replacement-token", profile.id);
    mockDisconnectProfile.mockClear();

    await act(async () => {
      resolveLogout(
        new Response(
          JSON.stringify({
            ok: true,
            sessionRevoked: false,
            revocationUncertain: true,
            browserResetState: "retained",
            browserCredentialsRetained: true,
            resetRequired: true,
            revocationError: "session store offline",
          }),
          { status: 200 },
        ),
      );
      await Promise.resolve();
      await Promise.resolve();
    });

    // Replacement token & connection must NEVER be cleared or disconnected!
    expect(getAuthToken(profile.id)).toBe("replacement-token");
    expect(mockDisconnectProfile).not.toHaveBeenCalled();
    // Outcome must truthfully render revocation uncertainty (never claim login was revoked)
    const panelText =
      document.querySelector('[data-testid="logout-outcome-panel"]')?.textContent ?? "";
    expect(panelText).toContain("session revocation failed or could not be verified");
    expect(panelText).not.toContain("Your server login was revoked");
  });
});
