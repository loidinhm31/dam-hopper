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
    await act(async () => {
      deleteButtons[1]?.click();
      await Promise.resolve();
    });

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
    expect(mockRemoveProfileConnection).toHaveBeenCalledWith("profile-b");
    expect(getProfiles().map((profile) => profile.id)).toEqual(["profile-a"]);
  });

  it("revokes media session, clears credentials and disconnects on explicit Logout", async () => {
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

    const logoutButton = document.querySelector<HTMLButtonElement>(
      'button[title="Logout and clear credentials"]',
    );
    expect(logoutButton).not.toBeNull();
    await act(async () => {
      logoutButton?.click();
      await Promise.resolve();
    });

    expect(revokeCurrentMediaSession).toHaveBeenCalledWith(
      "https://logout.test",
      "logout-token",
      expect.anything(),
    );
    expect(getAuthToken(profileA.id)).toBeNull();
    expect(mockDisconnectProfile).toHaveBeenCalledWith("profile-a");
    // Profile is NOT deleted from list
    expect(getProfiles()).toHaveLength(1);
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
});
