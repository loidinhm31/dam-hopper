// @vitest-environment jsdom

import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const revokeCurrentMediaSession = vi.hoisted(() => vi.fn());
const resetHostAlerts = vi.hoisted(() => vi.fn());

vi.mock("@/api/media-session.js", () => ({ revokeCurrentMediaSession }));
vi.mock("@/hooks/use-host-resource-alert-presentation.js", () => ({
  useHostResourceAlertPresentationStore: {
    getState: () => ({ reset: resetHostAlerts }),
  },
}));

import {
  clearActiveProfile,
  clearAuthToken,
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
});

afterEach(() => {
  vi.unstubAllGlobals();
  act(() => root?.unmount());
  root = null;
  document.body.innerHTML = "";
  clearActiveProfile();
  clearAuthToken("profile-a");
  clearAuthToken("profile-b");
});

describe("ServerProfilesDialog", () => {
  it("revokes a profile media session before deleting its token", async () => {
    const profileA = {
      id: "profile-a",
      name: "Active server",
      url: "https://active.test",
      authType: "basic" as const,
      createdAt: 1,
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
    vi.stubGlobal(
      "confirm",
      vi.fn(() => true),
    );

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
      'button[title="Delete"]',
    );
    await act(async () => {
      deleteButtons[1]?.click();
      await Promise.resolve();
    });

    expect(revokeCurrentMediaSession).toHaveBeenCalledWith(
      "https://deleted.test",
      "deleted-token",
    );
    expect(getProfiles().map((profile) => profile.id)).toEqual(["profile-a"]);
  });

  it("revokes the old profile media session before switching profiles", async () => {
    const profileA = {
      id: "profile-a",
      name: "Old server",
      url: "https://old.test",
      authType: "basic" as const,
      createdAt: 1,
    };
    const profileB = {
      ...profileA,
      id: "profile-b",
      name: "New server",
      url: "https://new.test",
    };
    saveProfiles([profileA, profileB]);
    setActiveProfile(profileA.id);
    setAuthToken("old-token", profileA.id);
    const onSwitchProfile = vi.fn();

    const container = document.createElement("div");
    document.body.append(container);
    root = createRoot(container);
    await act(async () => {
      root?.render(
        <ServerProfilesDialog
          open
          onClose={() => undefined}
          onEditProfile={() => undefined}
          onSwitchProfile={onSwitchProfile}
        />,
      );
    });

    const switchButton = document.querySelector<HTMLButtonElement>(
      'button[title="Switch to this server"]',
    );
    expect(switchButton).not.toBeNull();
    await act(async () => {
      switchButton?.click();
      await Promise.resolve();
    });

    expect(revokeCurrentMediaSession).toHaveBeenCalledWith(
      "https://old.test",
      "old-token",
    );
    expect(onSwitchProfile).toHaveBeenCalledWith(profileB);
  });
});
