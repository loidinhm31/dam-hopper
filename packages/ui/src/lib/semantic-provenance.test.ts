import { beforeEach, describe, expect, it, vi } from "vitest";
import { QueryClient } from "@tanstack/react-query";
import { captureSemanticProvenance } from "./semantic-model-uri.js";

const live = vi.hoisted(() => ({
  snapshot: { status: "connected", serverUrl: "http://fixture", owner: { profileId: "profile-a", generation: 2 } },
  profiles: [{ id: "profile-a", url: "http://fixture", authType: "basic" }],
  token: "abc" as string | null,
  clients: [] as QueryClient[],
}));
vi.mock("@/api/connections.js", () => ({
  getConnectionSnapshot: () => live.snapshot,
  getRegisteredQueryClients: () => live.clients,
}));
vi.mock("@/api/server-config.js", () => ({
  getProfiles: () => live.profiles,
  getAuthToken: () => live.token,
  normalizeServerUrl: (url: string) => url,
}));
const target = { profileId: "profile-a", project: "project-a" };
const currentKey = ["profile", "profile-a", 2, "projects"];
let cache: QueryClient;

beforeEach(() => {
  cache = new QueryClient();
  live.clients = [cache];
  live.snapshot = { status: "connected", serverUrl: "http://fixture", owner: { profileId: "profile-a", generation: 2 } };
  live.profiles = [{ id: "profile-a", url: "http://fixture", authType: "basic" }];
  live.token = "abc";
});

describe("semantic provenance authority", () => {
  it("captures only current-owner project root and non-secret credential fingerprint", () => {
    cache.setQueryData(["profile", "profile-a", 1, "projects"], [{ name: "project-a", path: "/old" }]);
    cache.setQueryData(["projects"], [{ name: "project-a", path: "/ambient" }]);
    cache.setQueryData(currentKey, [{ name: "project-a", path: "/current" }]);
    expect(captureSemanticProvenance(target)).toEqual({
      serverUrl: "http://fixture", configuredRoot: "/current",
      actor: "credential:ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad",
    });
  });

  it("rejects old-generation, ambient-only, or invalidated project metadata", async () => {
    cache.setQueryData(["profile", "profile-a", 1, "projects"], [{ name: "project-a", path: "/old" }]);
    cache.setQueryData(["projects"], [{ name: "project-a", path: "/ambient" }]);
    expect(captureSemanticProvenance(target)).toBeNull();
    cache.setQueryData(currentKey, [{ name: "project-a", path: "/current" }]);
    await cache.invalidateQueries({ queryKey: currentKey });
    expect(captureSemanticProvenance(target)).toBeNull();
  });

  it("rejects unavailable owners, mismatched endpoint profiles, and missing credentials", () => {
    cache.setQueryData(currentKey, [{ name: "project-a", path: "/current" }]);
    live.snapshot.status = "disconnected";
    expect(captureSemanticProvenance(target)).toBeNull();
    live.snapshot.status = "connected";
    live.profiles[0].url = "http://replacement";
    expect(captureSemanticProvenance(target)).toBeNull();
    live.profiles[0].url = "http://fixture";
    live.token = null;
    expect(captureSemanticProvenance(target)).toBeNull();
  });

  it("preserves matching reconnect provenance but distinguishes root and credential replacement", () => {
    cache.setQueryData(currentKey, [{ name: "project-a", path: "/current" }]);
    const captured = captureSemanticProvenance(target);
    expect(captureSemanticProvenance(target)).toEqual(captured);
    live.token = "replacement-credential";
    expect(captureSemanticProvenance(target)?.actor).not.toBe(captured?.actor);
    cache.setQueryData(currentKey, [{ name: "project-a", path: "/replacement-root" }]);
    expect(captureSemanticProvenance(target)?.configuredRoot).toBe("/replacement-root");
  });
});
