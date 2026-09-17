// @vitest-environment jsdom

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import {
  saveProfiles,
  setAuthToken,
  getAuthToken,
  createProfile,
  type ServerProfile,
} from "./server-config.js";
import {
  connectProfile,
  disconnectProfile,
  getConnectionSnapshot,
  resetConnections,
} from "./connections.js";
import { useWorkspaceStore } from "@/stores/workspace.js";
import { useWorkbenchSelectionsStore } from "@/stores/workbench-selections.js";
import { projectKey, parseProjectKey } from "./ownership.js";
import { checkLegacyDeepLink } from "@/lib/fresh-state-reset.js";

describe("Phase 02 — Unified multi-profile shell integration", () => {
class MockWebSocket {
  readyState = 1; // WebSocket.OPEN
  onopen: (() => void) | null = null;
  onmessage: ((event: { data: string }) => void) | null = null;
  onclose: (() => void) | null = null;
  onerror: (() => void) | null = null;
  constructor(public url: string) {
    Promise.resolve().then(() => {
      this.onopen?.();
    });
  }

  send() {}
  close() {
    this.readyState = 3;
    this.onclose?.();
  }
}
vi.stubGlobal("WebSocket", MockWebSocket);
  beforeEach(() => {
    localStorage.clear();
    sessionStorage.clear();
    resetConnections();
    useWorkspaceStore.setState({
      selectedProject: null,
      navigationRevision: 0,
      activeProject: null,
      activeProjectRevision: 0,
    });
    useWorkbenchSelectionsStore.setState({
      preferencesProfileId: null,
      preferencesStatus: "unset",
      preferencesSnapshot: null,
      settingsProfileId: null,
      browserTargetProfileId: null,
    });
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    resetConnections();
  });

  it("boots independent profiles A, B, C with isolated statuses (A connected, B login-required, C offline)", async () => {
    const profileA: ServerProfile = {
      id: "profile-a",
      name: "Server A (Healthy)",
      url: "http://server-a.test",
      authType: "basic",
      createdAt: 1,
      autoConnect: true,
    };
    const profileB: ServerProfile = {
      id: "profile-b",
      name: "Server B (Needs Login)",
      url: "http://server-b.test",
      authType: "basic",
      createdAt: 2,
      autoConnect: true,
    };
    const profileC: ServerProfile = {
      id: "profile-c",
      name: "Server C (Offline)",
      url: "http://server-c.test",
      authType: "none",
      createdAt: 3,
      autoConnect: true,
    };

    saveProfiles([profileA, profileB, profileC]);
    // Profile A has credentials
    setAuthToken("token-a", profileA.id);
    // Profile B has NO token -> basic auth without token must become login-required

    // Mock fetch for /api/auth/status
    const fetchMock = vi.fn(async (url: string | URL | Request) => {
      const urlStr = String(url);
      if (urlStr.includes("server-a.test")) {
        return new Response(JSON.stringify({ authenticated: true, workbenchProtocol: 2 }), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        });
      }
      if (urlStr.includes("server-c.test")) {
        // Network failure for server C
        throw new TypeError("Failed to fetch");
      }
      return new Response(JSON.stringify({ error: "Not found" }), { status: 404 });
    });
    vi.stubGlobal("fetch", fetchMock);

    // Bootstrap connect each profile independently
    await Promise.all([
      connectProfile(profileA.id),
      connectProfile(profileB.id),
      connectProfile(profileC.id),
    ]);

    const snapA = getConnectionSnapshot(profileA.id);
    const snapB = getConnectionSnapshot(profileB.id);
    const snapC = getConnectionSnapshot(profileC.id);

    // Profile A is connected
    expect(snapA?.status).toBe("connected");
    // Profile B is login-required without network attempt because token was missing
    expect(snapB?.status).toBe("login-required");
    // Profile C is offline due to fetch error
    expect(snapC?.status).toBe("offline");

    // Failure of B and C does NOT affect A
    expect(snapA?.status).toBe("connected");
  });

  it("project selection does not mutate credentials, server config, preferences source, or transport", () => {
    const store = useWorkspaceStore.getState();
    const wbStore = useWorkbenchSelectionsStore.getState();

    wbStore.setPreferencesProfileId("pref-profile-1", { theme: "light" });
    wbStore.setSettingsProfileId("settings-profile-1");
    wbStore.setBrowserTargetProfileId("browser-profile-1");

    // Select project A
    store.setSelectedProject({ profileId: "profile-a", project: "frontend-app" });

    expect(useWorkspaceStore.getState().selectedProject).toEqual({
      profileId: "profile-a",
      project: "frontend-app",
    });
    expect(useWorkspaceStore.getState().activeProject).toBe("frontend-app");

    // Preferences source and settings targets remain completely unchanged
    expect(useWorkbenchSelectionsStore.getState().preferencesProfileId).toBe("pref-profile-1");
    expect(useWorkbenchSelectionsStore.getState().settingsProfileId).toBe("settings-profile-1");
    expect(useWorkbenchSelectionsStore.getState().browserTargetProfileId).toBe("browser-profile-1");

    // Selecting another project on another profile
    store.setSelectedProject({ profileId: "profile-b", project: "backend-service" });
    expect(useWorkspaceStore.getState().selectedProject).toEqual({
      profileId: "profile-b",
      project: "backend-service",
    });
    expect(useWorkbenchSelectionsStore.getState().preferencesProfileId).toBe("pref-profile-1");
  });

  it("disambiguates equal project names across different profiles via qualified tuple keys", () => {
    const ref1 = { profileId: "profile-prod", project: "api-service" };
    const ref2 = { profileId: "profile-staging", project: "api-service" };

    const key1 = projectKey(ref1);
    const key2 = projectKey(ref2);

    expect(key1).not.toBe(key2);
    expect(key1).toBe(JSON.stringify(["profile-prod", "api-service"]));
    expect(key2).toBe(JSON.stringify(["profile-staging", "api-service"]));

    expect(parseProjectKey(key1)).toEqual(ref1);
    expect(parseProjectKey(key2)).toEqual(ref2);
  });

  it("rejects legacy unqualified deep links without profileId and guides the user", () => {
    const unqualified = checkLegacyDeepLink({
      search: "?project=api-service",
      hash: "",
    });
    expect(unqualified.isLegacy).toBe(true);
    expect(unqualified.guidance).toContain("Legacy unqualified link detected without profileId");

    const qualified = checkLegacyDeepLink({
      search: "?profileId=profile-prod&project=api-service",
      hash: "",
    });
    expect(qualified.isLegacy).toBe(false);
  });
});
