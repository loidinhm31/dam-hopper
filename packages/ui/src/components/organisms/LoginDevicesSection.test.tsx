// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  clearAuthToken, deleteProfile, getAuthToken, saveProfiles, setActiveProfile,
  setAuthToken, updateProfile,
} from "@/api/server-config.js";
import { LoginDevicesSection } from "./LoginDevicesSection.js";
import type { ConnectionSnapshot } from "@/api/connections.js";

const runtime = vi.hoisted(() => ({ snapshots: new Map<string, ConnectionSnapshot>(), listeners: new Set<() => void>(), disconnect: vi.fn() }));
vi.mock("@/api/connections.js", () => ({
  getConnectionSnapshot: (id: string) => runtime.snapshots.get(id) ?? null,
  subscribeConnections: (listener: () => void) => { runtime.listeners.add(listener); return () => runtime.listeners.delete(listener); },
  disconnectProfile: (id: string) => runtime.disconnect(id),
}));
const actGlobal: { IS_REACT_ACT_ENVIRONMENT?: boolean } = globalThis;
actGlobal.IS_REACT_ACT_ENVIRONMENT = true;
const a = { id: "a", name: "A", url: "https://selected.test", authType: "basic" as const, createdAt: 1, autoConnect: false };
const b = { ...a, id: "b", name: "B", url: "https://ambient.test" };
const row = (id: string, current = false, userAgent: string | null = null) => ({ id, current, userAgent,
  issuedAt: "2026-10-22T00:00:00Z", expiresAt: "2026-11-22T00:00:00Z", mfaVerifiedAt: "2026-10-22T00:00:00Z" });
const page = (sessions = [row("other")], nextCursor: string | null = null) => new Response(JSON.stringify({ sessions, nextCursor }));
function deferred<T>() {
  return Promise.withResolvers<T>();
}
function button(text: string, scope: ParentNode = document) {
  const found = [...scope.querySelectorAll("button")].find((item) => item.textContent === text);
  if (!found) throw new Error(`Missing button: ${text}`);
  return found;
}
async function click(text: string, scope?: ParentNode) { await act(async () => button(text, scope).click()); }

let root: Root;
let container: HTMLDivElement;
beforeEach(() => {
  localStorage.clear(); sessionStorage.clear();
  runtime.snapshots.clear(); runtime.disconnect.mockReset();
  saveProfiles([a, b]); setActiveProfile("b"); setAuthToken("token-a", "a"); setAuthToken("token-b", "b");
  container = document.createElement("div"); document.body.append(container); root = createRoot(container);
});
afterEach(async () => {
  await act(async () => root.unmount()); container.remove();
  localStorage.clear(); sessionStorage.clear(); vi.unstubAllGlobals(); vi.restoreAllMocks();
});
async function render(profileId: string | null | undefined = "a") {
  await act(async () => root.render(<LoginDevicesSection key={profileId ?? "legacy"} profileId={profileId} />));
}
async function approve() {
  await click("Revoke access", document.querySelector('[role="dialog"]')!);
}

describe("saved-profile login devices", () => {
  it("loads pages, retries a failed page, deduplicates and uses the later current marker", async () => {
    const initial = deferred<Response>();
    const fetch = vi.fn().mockReturnValueOnce(initial.promise)
      .mockResolvedValueOnce(new Response(null, { status: 503 }))
      .mockResolvedValueOnce(page([row("other"), row("current", true, "<script>not markup</script>")]))
      .mockResolvedValueOnce(page([]));
    vi.stubGlobal("fetch", fetch);
    await render(); expect(container.textContent).toContain("Loading login devices");
    await act(async () => initial.resolve(page([row("other")], "next")));
    expect(container.textContent).toContain("Unknown browser/client");
    await click("Load more"); expect(container.textContent).toContain("Login devices request failed");
    await click("Retry");
    expect(container.querySelectorAll("li")).toHaveLength(2);
    expect(container.textContent).toContain("This session");
    expect(container.textContent).toContain("<script>not markup</script>"); expect(container.querySelector("script")).toBeNull();
    await click("Refresh"); expect(container.textContent).toContain("No active logins found");
  });

  it("requires confirmation, retains pending/failed rows and preserves both profile logins on other revoke", async () => {
    const acknowledgement = deferred<Response>();
    const fetch = vi.fn().mockResolvedValueOnce(page())
      .mockResolvedValueOnce(new Response(null, { status: 503 })).mockReturnValueOnce(acknowledgement.promise);
    vi.stubGlobal("fetch", fetch); await render();
    await click("Revoke access"); await click("Cancel", document.querySelector('[role="dialog"]')!);
    expect(fetch).toHaveBeenCalledTimes(1);
    await click("Revoke access"); await approve();
    expect(container.querySelectorAll("li")).toHaveLength(1); expect(container.textContent).toContain("Try revoking");
    await click("Revoke access"); await approve();
    expect(container.querySelectorAll("li")).toHaveLength(1); expect(button("Revoking…").disabled).toBe(true);
    await act(async () => acknowledgement.resolve(new Response(null, { status: 204 })));
    expect(container.querySelectorAll("li")).toHaveLength(0);
    expect(getAuthToken("a")).toBe("token-a"); expect(getAuthToken("b")).toBe("token-b");
    expect(runtime.disconnect).not.toHaveBeenCalled();
  });

  it("lists and revokes the selected saved account, not the ambient account", async () => {
    const fetch = vi.fn(async (url: string | URL | Request, init?: RequestInit) => {
      const selected = String(url).startsWith(`${a.url}/`) &&
        new Headers(init?.headers).get("Authorization") === "Bearer token-a";
      if (init?.method === "DELETE") return new Response(null, { status: selected ? 204 : 404 });
      return page([selected ? row("selected-login", false, "Selected account client") : row("wrong-login", false, "Wrong account client")]);
    });
    vi.stubGlobal("fetch", fetch); await render();
    expect(container.textContent).toContain("Selected account client");
    expect(container.textContent).not.toContain("Wrong account client");
    await click("Revoke access"); await approve();
    expect(container.querySelector('[data-session-id="selected-login"]')).toBeNull();
    expect(fetch).toHaveBeenNthCalledWith(1, `${a.url}/api/auth/sessions`, expect.objectContaining({
      credentials: "omit", cache: "no-store", headers: expect.objectContaining({ Authorization: "Bearer token-a" }),
    }));
    expect(fetch).toHaveBeenNthCalledWith(2, `${a.url}/api/auth/sessions/selected-login`, expect.objectContaining({
      method: "DELETE", credentials: "omit", headers: expect.objectContaining({ Authorization: "Bearer token-a" }),
    }));
    expect(getAuthToken("a")).toBe("token-a"); expect(getAuthToken("b")).toBe("token-b");
    expect(runtime.disconnect).not.toHaveBeenCalled();
  });

  it("warns and clears only the captured current login, never ambient username or another same-server profile", async () => {
    saveProfiles([a, { ...b, url: a.url }]);
    setAuthToken("token-b", "b");
    sessionStorage.setItem("damhopper_auth_username", "other-user");
    vi.stubGlobal("fetch", vi.fn().mockResolvedValueOnce(page([row("self", true)]))
      .mockResolvedValueOnce(new Response(null, { status: 204 })));
    await render(); await click("Revoke access");
    expect(document.querySelector('[role="dialog"]')?.textContent).toContain("This ends this login");
    await approve();
    expect(getAuthToken("a")).toBeNull(); expect(getAuthToken("b")).toBe("token-b");
    expect(sessionStorage.getItem("damhopper_auth_username")).toBe("other-user");
    expect(container.textContent).toContain("Log in and save");
  });

  it.each(["profile", "url", "credential", "delete", "generation", "close"])(
    "discards deferred list success/error after %s changes", async (change) => {
      const old = deferred<Response>();
      const fetch = vi.fn().mockReturnValueOnce(old.promise).mockResolvedValue(page([row("replacement")]));
      vi.stubGlobal("fetch", fetch); await render();
      await act(async () => {
        if (change === "profile") root.render(<LoginDevicesSection key="b" profileId="b" />);
        if (change === "url") updateProfile("a", { url: "https://replacement.test" });
        if (change === "credential") setAuthToken("new-login", "a");
        if (change === "delete") deleteProfile("a");
        if (change === "generation") {
          runtime.snapshots.set("a", { owner: { profileId: "a", generation: 2 }, status: "connected", serverUrl: a.url, intent: true, error: null });
          for (const listener of runtime.listeners) listener();
        }
        if (change === "close") root.render(null);
      });
      await act(async () => old.resolve(page([row("stale")]))) ;
      expect(container.querySelector('[data-session-id="stale"]')).toBeNull();
      expect((fetch.mock.calls[0][1] as RequestInit).signal?.aborted).toBe(true);
      if (change === "close") { await render(); expect(container.querySelector('[data-session-id="replacement"]')).not.toBeNull(); }
    });

  it("refresh supersedes an earlier page even if its fetch ignores cancellation", async () => {
    const old = deferred<Response>();
    vi.stubGlobal("fetch", vi.fn().mockReturnValueOnce(old.promise).mockResolvedValueOnce(page([row("fresh")])));
    await render(); await click("Refresh");
    await act(async () => old.resolve(new Response(null, { status: 503 })));
    expect(container.querySelector('[data-session-id="fresh"]')).not.toBeNull();
    expect(container.querySelector('[role="alert"]')).toBeNull();
  });

  it.each([false, true])("handles WS-before-DELETE without clearing replacement login (%s)", async (replacement) => {
    runtime.snapshots.set("a", { owner: { profileId: "a", generation: 4 }, status: "connected", serverUrl: a.url, intent: true, error: null });
    const acknowledgement = deferred<Response>();
    const fetch = vi.fn().mockResolvedValueOnce(page([row("self", true)]))
      .mockReturnValueOnce(acknowledgement.promise).mockResolvedValue(page([row("replacement")]));
    vi.stubGlobal("fetch", fetch); await render(); await click("Revoke access"); await approve();
    await act(async () => {
      runtime.snapshots.set("a", { owner: { profileId: "a", generation: 5 }, status: "login-required", authCode: "AUTH_REQUIRED", serverUrl: a.url, intent: true, error: null });
      clearAuthToken("a"); for (const listener of runtime.listeners) listener();
    });
    expect((fetch.mock.calls[1][1] as RequestInit).signal?.aborted).toBe(false);
    if (replacement) await act(async () => setAuthToken("replacement-token", "a"));
    await act(async () => acknowledgement.resolve(new Response(null, { status: 204 })));
    expect(getAuthToken("a")).toBe(replacement ? "replacement-token" : null);
    expect(getAuthToken("b")).toBe("token-b"); expect(runtime.disconnect).not.toHaveBeenCalled();
    expect(container.querySelector('[role="alert"]')).toBeNull();
  });

  it("reports unsupported no-auth and retries initial errors, with no authority for new profiles", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValueOnce(new Response(null, { status: 500 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ code: "DEVICE_SESSIONS_UNAVAILABLE" }), { status: 409 })));
    await render(); await click("Retry"); expect(container.textContent).toContain("without authentication");
    await render(null); expect(container.textContent).toContain("Save and select");
  });

  it.each(["profile", "url", "credential", "delete", "generation", "close"])(
    "fences an acknowledged or failed self DELETE after %s supersedes it", async (change) => {
      for (const status of [204, 503]) {
        const acknowledgement = deferred<Response>();
        vi.stubGlobal("fetch", vi.fn().mockResolvedValueOnce(page([row("self", true)]))
          .mockReturnValueOnce(acknowledgement.promise).mockResolvedValue(page([row("new-owner")])));
        await render(); await click("Revoke access"); await approve();
        await act(async () => {
          if (change === "profile") root.render(<LoginDevicesSection key="b" profileId="b" />);
          if (change === "url") updateProfile("a", { url: "https://new.test" });
          if (change === "credential") setAuthToken("replacement-token", "a");
          if (change === "delete") deleteProfile("a");
          if (change === "generation") {
            runtime.snapshots.set("a", { owner: { profileId: "a", generation: 8 }, status: "connected", serverUrl: a.url, intent: true, error: null });
            for (const listener of runtime.listeners) listener();
          }
          if (change === "close") root.render(null);
        });
        await act(async () => acknowledgement.resolve(new Response(null, { status })));
        expect(runtime.disconnect).not.toHaveBeenCalled();
        expect(container.querySelector('[role="alert"]')).toBeNull();
        if (change === "credential") expect(getAuthToken("a")).toBe("replacement-token");
        if (change === "close") {
          expect(getAuthToken("a")).toBe("token-a");
          await render(); expect(container.querySelector('[data-session-id="new-owner"]')).not.toBeNull();
        }
        await act(async () => root.render(null));
        runtime.snapshots.clear(); saveProfiles([a, b]); setAuthToken("token-a", "a");
      }
    });

  it("keeps local credential-removal failures actionable even when disconnect retires its generation", async () => {
    runtime.snapshots.set("a", { owner: { profileId: "a", generation: 1 }, status: "connected", serverUrl: a.url, intent: true, error: null });
    runtime.disconnect.mockImplementation((id: string) => {
      const previous = runtime.snapshots.get(id)!;
      runtime.snapshots.set(id, { ...previous, owner: { profileId: id, generation: previous.owner.generation + 1 }, status: "disconnected" });
      for (const listener of runtime.listeners) listener();
    });
    const fetch = vi.fn().mockResolvedValueOnce(page([row("self", true)]))
      .mockResolvedValueOnce(new Response(null, { status: 204 }))
      .mockResolvedValue(new Response(null, { status: 401 }));
    vi.stubGlobal("fetch", fetch);
    await render();
    const original = Storage.prototype.removeItem;
    const removal = vi.spyOn(Storage.prototype, "removeItem").mockImplementation(function (this: Storage, key: string) {
      if (key === "damhopper_profile_auth_v2_a") throw new Error("Storage unavailable");
      original.call(this, key);
    });
    await click("Revoke access"); await approve();
    expect(container.textContent).toContain("unable to clear its saved login token");
    expect(getAuthToken("a")).toBe("token-a"); expect(runtime.disconnect).not.toHaveBeenCalled();
    removal.mockRestore();
    await click("Retry local cleanup");
    expect(fetch).toHaveBeenCalledTimes(2);
    expect(getAuthToken("a")).toBeNull(); expect(runtime.disconnect).toHaveBeenCalledWith("a");
    expect(getAuthToken("b")).toBe("token-b");
  });
});
