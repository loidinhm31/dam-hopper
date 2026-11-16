// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi, type Mock } from "vitest";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { connectProfile, disconnectProfile, getConnectionSnapshot, getMediaClientIdForProfile, resetConnections } from "@/api/connections.js";
import { clearAuthToken, getActiveProfileId, getAuthToken, getProfiles, saveProfiles, setActiveProfile, setAuthToken, subscribeToProfileChanges } from "@/api/server-config.js";
import { DevicesPage } from "@/components/pages/DevicesPage.js";
import { ServerSettingsDialog } from "./ServerSettingsDialog.js";

// Only external HTTP/WebSocket seams are fake: profile storage, the page,
// dialog, connection subscriber and 4401 handling are production.
class FakeWebSocket {
  static OPEN = 1;
  static CLOSED = 3;
  static sockets: FakeWebSocket[] = [];
  readyState = 1;
  onopen: (() => void) | null = null;
  onmessage: ((event: { data: string }) => void) | null = null;
  onclose: ((event: { code: number; reason: string }) => void) | null = null;
  onerror: (() => void) | null = null;
  constructor(public url: string) {
    FakeWebSocket.sockets.push(this);
    void Promise.resolve().then(() => this.onopen?.());
  }
  close(code = 1000, reason = "") {
    this.readyState = FakeWebSocket.CLOSED;
    this.onclose?.({ code, reason });
  }
  send() {}
}
const actGlobal: { IS_REACT_ACT_ENVIRONMENT?: boolean } = globalThis;
actGlobal.IS_REACT_ACT_ENVIRONMENT = true;
const selected = { id: "selected", name: "Selected", url: "https://selected.test", authType: "basic" as const,
  username: "alice", autoConnect: true, createdAt: 1 };
const ambient = { ...selected, id: "ambient", name: "Ambient", url: "https://ambient.test", username: "bob" };
const row = (id: string, userAgent: string, current = true) => ({ id, userAgent, current,
  issuedAt: "2026-10-22T00:00:00Z", expiresAt: "2026-11-22T00:00:00Z", mfaVerifiedAt: "2026-10-22T00:00:00Z" });
const json = (body: unknown) => new Response(JSON.stringify(body));
let root: Root;
let container: HTMLDivElement;
let acknowledgement: PromiseWithResolvers<Response>;
let mediaAcknowledgement: PromiseWithResolvers<Response> | null;
let mfaAcknowledgement: PromiseWithResolvers<Response> | null;
let loginAcknowledgement: PromiseWithResolvers<Response> | null;
let setupAcknowledgement: PromiseWithResolvers<Response> | null;
let stepUpAcknowledgement: PromiseWithResolvers<Response> | null;
let mfaEnrollment: boolean;
let mfaStatusRequired: boolean;
let mfaLogin: boolean;
let fetchMock: Mock<(url: string | URL | Request, init?: RequestInit) => Promise<Response>>;
let queryClient: QueryClient;

function button(label: string, scope: ParentNode = container) {
  const found = [...scope.querySelectorAll<HTMLButtonElement>("button")].find((item) => item.textContent === label);
  if (!found) throw new Error(`Missing button ${label}`);
  return found;
}
async function click(label: string, scope?: ParentNode) { await act(async () => button(label, scope).click()); }
function setInput(selector: string, value: string) {
  const input = container.querySelector<HTMLInputElement>(`[data-test-host="settings"] ${selector}`)!;
  Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(input, value);
  input.dispatchEvent(new Event("input", { bubbles: true }));
}
async function render(
  profileId: string | null = selected.id,
  showDialog = false,
  dialogProfile: typeof selected | null = selected,
  onSaved?: (profile: { id: string }) => void,
) {
  await act(async () => root.render(
    <QueryClientProvider client={queryClient}>
      <div data-test-host="page">{profileId !== null && <DevicesPage noLayout profileId={profileId} />}</div>
      <div data-test-host="settings">{showDialog && <ServerSettingsDialog open profile={dialogProfile} onClose={() => {}} onSaved={onSaved} />}</div>
    </QueryClientProvider>,
  ));
}
async function testLogin() {
  await act(async () => setInput('input[type="password"]', "password"));
  await click("Test connection", container.querySelector('[data-test-host="settings"]')!);
}
async function verifyDraft() {
  await act(async () => setInput("#mfa-code-input", "123456"));
  await click("Verify & Continue", container.querySelector('[data-test-host="settings"]')!);
  expect(container.querySelector('[data-test-host="settings"]')!.textContent).toContain("Reachable");
}
async function revokeSelf() {
  const section = container.querySelector('[data-test-host="page"] section[aria-label="Login devices"]')!;
  expect(section.textContent).toContain("Selected client");
  expect(section.textContent).not.toContain("Ambient client");
  await click("Revoke access", section);
  const confirmation = [...document.querySelectorAll('[role="dialog"]')].find((dialog) =>
    dialog.getAttribute("aria-labelledby")?.split(/\s+/).map((id) => document.getElementById(id)?.textContent).join(" ") === "End this login?");
  expect(confirmation).toBeDefined();
  await click("Revoke access", confirmation!);
  expect(fetchMock).toHaveBeenCalledWith(`${selected.url}/api/auth/sessions/self-a`, expect.objectContaining({
    method: "DELETE", credentials: "omit", headers: expect.objectContaining({ Authorization: "Bearer token-a" }),
  }));
}
async function acknowledge() {
  await act(async () => acknowledgement.resolve(new Response(null, { status: 204 })));
}
function expectAmbientIntact() {
  expect(getAuthToken(ambient.id)).toBe("ambient-token");
  expect(getConnectionSnapshot(ambient.id)?.status).toBe("connected");
  expect(container.querySelector('[role="alert"]')).toBeNull();
}

beforeEach(async () => {
  localStorage.clear(); sessionStorage.clear(); resetConnections();
  FakeWebSocket.sockets = []; vi.stubGlobal("WebSocket", FakeWebSocket);
  saveProfiles([selected, ambient]); setActiveProfile(ambient.id);
  setAuthToken("token-a", selected.id); setAuthToken("ambient-token", ambient.id);
  acknowledgement = Promise.withResolvers<Response>();
  mediaAcknowledgement = null;
  mfaAcknowledgement = null;
  loginAcknowledgement = null;
  setupAcknowledgement = null;
  stepUpAcknowledgement = null;
  mfaEnrollment = false;
  mfaStatusRequired = false;
  queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } }); mfaLogin = false;
  fetchMock = vi.fn(async (url: string | URL | Request, init?: RequestInit) => {
    const address = String(url);
    if (address.endsWith("/api/auth/status")) return mfaStatusRequired
      ? { ok: false, status: 401, json: async () => ({
          authenticated: false, code: "MFA_REQUIRED", authProtocol: 2, workbenchProtocol: 2,
        }) }
      : json({ authenticated: true, workbenchProtocol: 2, authProtocol: 2 });
    if (address.endsWith("/api/auth/login")) return loginAcknowledgement?.promise ?? json(mfaLogin
      ? { state: mfaEnrollment ? "enrollmentRequired" : "mfaRequired", challengeToken: "new-mfa-challenge", challengeExpiresAt: "2026-10-22T01:00:00Z", authProtocol: 2 }
      : { token: "token-a", user: "alice" });
    if (address.endsWith("/api/auth/mfa/verify")) return mfaAcknowledgement?.promise ?? json({ state: "authenticated", token: "new-mfa-token", user: "alice",
      role: "user", expiresAt: "2026-11-22T00:00:00Z", mfaDueAt: "2026-11-01T00:00:00Z", authProtocol: 2 });
    if (address.endsWith("/api/auth/mfa/setup")) return setupAcknowledgement?.promise ?? json({
      secret: "secret", otpauthUri: "otpauth://totp/test", issuer: "DamHopper",
      accountName: "alice", algorithm: "SHA1", digits: 6, period: 30,
    });
    if (address.endsWith("/api/auth/mfa/challenge")) return stepUpAcknowledgement?.promise ?? json({
      challengeToken: "step-up-challenge", challengeExpiresAt: "2026-10-22T01:00:00Z", authProtocol: 2,
    });
    if (address.endsWith("/api/fs/media-session")) return mediaAcknowledgement?.promise ?? new Response(null, { status: 204 });
    const token = new Headers(init?.headers).get("Authorization");
    if (address === `${selected.url}/api/auth/sessions` && token === "Bearer token-a") {
      return json({ sessions: [row("self-a", "Selected client")], nextCursor: null });
    }
    if (address === `${selected.url}/api/auth/sessions` && token === "Bearer replacement-b") {
      return json({ sessions: [row("self-b", "Replacement client")], nextCursor: null });
    }
    if (address === `${ambient.url}/api/auth/sessions` && token === "Bearer ambient-token") {
      return json({ sessions: [row("ambient-self", "Ambient client")], nextCursor: null });
    }
    if (address === `${selected.url}/api/auth/sessions` && token === "Bearer new-mfa-token") {
      return json({ sessions: [row("new-self", "New selected login")], nextCursor: null });
    }
    if (address === `${selected.url}/api/auth/sessions/self-a` && init?.method === "DELETE" && token === "Bearer token-a") {
      return acknowledgement.promise;
    }
    return new Response(null, { status: 404 });
  });
  vi.stubGlobal("fetch", fetchMock);
  await connectProfile(selected.id); await connectProfile(ambient.id);
  container = document.createElement("div"); document.body.append(container); root = createRoot(container);
});
afterEach(async () => {
  await act(async () => root.unmount()); container.remove(); resetConnections();
  localStorage.clear(); sessionStorage.clear(); vi.restoreAllMocks(); vi.unstubAllGlobals();
});

describe("login devices page with real connection retirement", () => {
  it.each(["none", "before-ack", "after-ack"])("4401 before DELETE ACK cannot revive A or overwrite replacement B (%s)", async (timing) => {
    const replacement = timing !== "none";
    await render();
    await revokeSelf();
    const oldSocket = FakeWebSocket.sockets[0];
    const initialGeneration = getConnectionSnapshot(selected.id)!.owner.generation;
    await act(async () => oldSocket.close(4401, "Revoked"));
    expect(getAuthToken(selected.id)).toBeNull();
    expect(getConnectionSnapshot(selected.id)?.status).toBe("login-required");
    expect(getConnectionSnapshot(selected.id)?.authCode).toBe("AUTH_REQUIRED");
    expect(getConnectionSnapshot(selected.id)?.owner.generation).toBe(initialGeneration + 1);
    expect(FakeWebSocket.sockets).toHaveLength(2);
    if (timing === "before-ack") {
      await act(async () => { setAuthToken("replacement-b", selected.id); });
      expect(getConnectionSnapshot(selected.id)?.status).toBe("connected");
      expect(container.textContent).toContain("Replacement client");
    }
    let socketsBeforeAck = FakeWebSocket.sockets.length;
    let generationBeforeAck = getConnectionSnapshot(selected.id)?.owner.generation;
    await acknowledge();
    if (timing === "after-ack") {
      await act(async () => { setAuthToken("replacement-b", selected.id); });
      expect(container.textContent).toContain("Replacement client");
      socketsBeforeAck = FakeWebSocket.sockets.length;
      generationBeforeAck = getConnectionSnapshot(selected.id)?.owner.generation;
    }
    expect(getAuthToken(selected.id)).toBe(replacement ? "replacement-b" : null);
    expect(FakeWebSocket.sockets).toHaveLength(socketsBeforeAck);
    expect(getConnectionSnapshot(selected.id)?.owner.generation).toBe(generationBeforeAck);
    expect(getConnectionSnapshot(selected.id)?.status).toBe(replacement ? "connected" : "login-required");
    expectAmbientIntact();
  });

  it.each([204, 503])("A ACK after replacement B also retires cannot reconnect or report stale errors (%s)", async (status) => {
    await render(); await revokeSelf();
    await act(async () => FakeWebSocket.sockets[0].close(4401, "A revoked"));
    await act(async () => { setAuthToken("replacement-b", selected.id); });
    expect(container.textContent).toContain("Replacement client");
    await act(async () => FakeWebSocket.sockets.at(-1)!.close(4401, "B expired"));
    const generation = getConnectionSnapshot(selected.id)?.owner.generation;
    const sockets = FakeWebSocket.sockets.length;
    await act(async () => acknowledgement.resolve(new Response(null, { status })));
    expect(getAuthToken(selected.id)).toBeNull();
    expect(getConnectionSnapshot(selected.id)?.status).toBe("login-required");
    expect(getConnectionSnapshot(selected.id)?.owner.generation).toBe(generation);
    expect(FakeWebSocket.sockets).toHaveLength(sockets); expectAmbientIntact();
  });

  it("DELETE-first cleanup uses the real synchronous profile subscriber without double retirement", async () => {
    await render(); await revokeSelf();
    const generation = getConnectionSnapshot(selected.id)!.owner.generation;
    await acknowledge();
    expect(getAuthToken(selected.id)).toBeNull();
    expect(getConnectionSnapshot(selected.id)?.status).toBe("login-required");
    expect(getConnectionSnapshot(selected.id)?.owner.generation).toBe(generation + 1);
    expect(FakeWebSocket.sockets).toHaveLength(2);
    expect(getAuthToken(selected.id)).toBeNull(); expectAmbientIntact();
  });

  it.each(["challenge", "verified"])("preserves a new unsaved MFA %s through ACK and saves its new token", async (stage) => {
    await render(selected.id, true); await revokeSelf(); mfaLogin = true; await testLogin();
    expect(container.querySelector('[data-test-host="settings"] #mfa-code-input')).not.toBeNull();
    if (stage === "verified") await verifyDraft();
    await acknowledge();
    if (stage === "challenge") {
      expect(container.querySelector('[data-test-host="settings"] #mfa-code-input')).not.toBeNull();
      await verifyDraft();
    }
    expect(getAuthToken(selected.id)).toBeNull();
    const dialog = container.querySelector('[data-test-host="settings"]')!;
    expect(button("Save profile", dialog).disabled).toBe(false);
    await click("Save profile", dialog);
    expect(getAuthToken(selected.id)).toBe("new-mfa-token");
    expect(getConnectionSnapshot(selected.id)?.status).toBe("connected"); expectAmbientIntact();
  });

  it("a dialog validated with the revoked credential cannot restore it after page ACK", async () => {
    await render(selected.id, true); await testLogin(); await revokeSelf();
    await acknowledge();
    const generation = getConnectionSnapshot(selected.id)?.owner.generation;
    const sockets = FakeWebSocket.sockets.length;
    const dialog = container.querySelector('[data-test-host="settings"]')!;
    await click("Save profile", dialog);
    expect(getAuthToken(selected.id)).toBeNull();
    expect(getConnectionSnapshot(selected.id)?.status).toBe("login-required");
    expect(getConnectionSnapshot(selected.id)?.owner.generation).toBe(generation);
    expect(FakeWebSocket.sockets).toHaveLength(sockets); expectAmbientIntact();
  });

  it("an MFA draft cannot overwrite a replacement login stored after page ACK", async () => {
    await render(selected.id, true); await revokeSelf(); mfaLogin = true; await testLogin(); await verifyDraft();
    await acknowledge();
    await act(async () => { setAuthToken("replacement-b", selected.id); });
    const generation = getConnectionSnapshot(selected.id)?.owner.generation;
    const sockets = FakeWebSocket.sockets.length;
    const dialog = container.querySelector('[data-test-host="settings"]')!;
    await click("Save profile", dialog);
    expect(getAuthToken(selected.id)).toBe("replacement-b");
    expect(getConnectionSnapshot(selected.id)?.owner.generation).toBe(generation);
    expect(FakeWebSocket.sockets).toHaveLength(sockets); expectAmbientIntact();
  });
  it.each(["before submission", "during verification"])(
    "does not overwrite an external replacement login %s MFA verification",
    async (stage) => {
      await render(selected.id, true);
      await revokeSelf();
      mfaLogin = true;
      await testLogin();
      if (stage === "during verification") {
        mfaAcknowledgement = Promise.withResolvers<Response>();
        await act(async () => setInput("#mfa-code-input", "123456"));
        button("Verify & Continue", container.querySelector('[data-test-host="settings"]')!).click();
        await act(async () => Promise.resolve());
      }
      await act(async () => { setAuthToken("replacement-b", selected.id); });
      if (stage === "during verification") {
        await act(async () => mfaAcknowledgement!.resolve(json({
          state: "authenticated", token: "new-mfa-token", user: "alice",
          role: "user", expiresAt: "2026-11-22T00:00:00Z",
          mfaDueAt: "2026-11-01T00:00:00Z", authProtocol: 2,
        })));
      } else {
        await act(async () => setInput("#mfa-code-input", "123456"));
        await click("Verify & Continue", container.querySelector('[data-test-host="settings"]')!);
      }
      expect(getAuthToken(selected.id)).toBe("replacement-b");
      expect(button("Save profile", container.querySelector('[data-test-host="settings"]')!).disabled).toBe(true);
      expect(container.querySelector('[data-test-host="settings"]')!.textContent).not.toContain("Reachable");
      expectAmbientIntact();
    },
  );
  it("rejects an old MFA attempt after replacement B is installed and retired", async () => {
    await render(selected.id, true);
    await revokeSelf();
    mfaLogin = true;
    const attemptBaselineGeneration = getConnectionSnapshot(selected.id)!.owner.generation;
    await testLogin();
    await acknowledge();
    await act(async () => {
      setAuthToken("replacement-b", selected.id);
      await connectProfile(selected.id);
    });
    expect(getConnectionSnapshot(selected.id)?.status).toBe("connected");
    await act(async () => { clearAuthToken(selected.id); });
    expect(getAuthToken(selected.id)).toBeNull();
    expect(getConnectionSnapshot(selected.id)?.status).toBe("login-required");
    expect(getConnectionSnapshot(selected.id)!.owner.generation).toBeGreaterThan(attemptBaselineGeneration + 1);
    await act(async () => setInput("#mfa-code-input", "123456"));
    await click("Verify & Continue", container.querySelector('[data-test-host="settings"]')!);
    const dialog = container.querySelector('[data-test-host="settings"]')!;
    expect(dialog.textContent).toContain("The login changed during verification");
    expect(getAuthToken(selected.id)).toBeNull();
    expect(button("Save profile", dialog).disabled).toBe(true);
  });
  it("rejects replacement credentials retired while the runtime is disconnected", async () => {
    await render(selected.id, true);
    await act(async () => disconnectProfile(selected.id));
    const attemptGeneration = getConnectionSnapshot(selected.id)!.owner.generation;
    mfaLogin = true;
    await testLogin();
    await act(async () => {
      setAuthToken("replacement-b", selected.id);
      clearAuthToken(selected.id);
      await connectProfile(selected.id);
    });
    expect(getConnectionSnapshot(selected.id)?.status).toBe("login-required");
    expect(getConnectionSnapshot(selected.id)!.owner.generation).toBe(attemptGeneration + 1);
    await act(async () => setInput("#mfa-code-input", "123456"));
    await click("Verify & Continue", container.querySelector('[data-test-host="settings"]')!);
    const dialog = container.querySelector('[data-test-host="settings"]')!;
    expect(dialog.textContent).toContain("The login changed during verification");
    expect(getAuthToken(selected.id)).toBeNull();
  });
  it("rejects queued cross-tab credential replacement events during MFA", async () => {
    await render(selected.id, true);
    mfaLogin = true;
    mfaAcknowledgement = Promise.withResolvers<Response>();
    await testLogin();
    await act(async () => setInput("#mfa-code-input", "123456"));
    const dialog = container.querySelector('[data-test-host="settings"]')!;
    button("Verify & Continue", dialog).click();
    await act(async () => Promise.resolve());

    await act(async () => FakeWebSocket.sockets[0]!.close(4401, "Revoked"));
    const key = `damhopper_profile_auth_v2_${selected.id}`;
    localStorage.removeItem(key);
    const replacement = JSON.stringify({
      version: 2,
      serverUrl: selected.url,
      authType: "basic",
      token: "replacement-b",
    });
    await act(async () => {
      window.dispatchEvent(new StorageEvent("storage", {
        key,
        oldValue: null,
        newValue: replacement,
      }));
      window.dispatchEvent(new StorageEvent("storage", {
        key,
        oldValue: replacement,
        newValue: null,
      }));
    });
    await act(async () => mfaAcknowledgement!.resolve(json({
      state: "authenticated", token: "late-mfa-token", user: "alice",
      role: "user", expiresAt: "2026-11-22T00:00:00Z",
      mfaDueAt: "2026-11-01T00:00:00Z", authProtocol: 2,
    })));
    expect(dialog.textContent).toContain("The login changed during verification");
    expect(getAuthToken(selected.id)).toBeNull();
    expect(button("Save profile", dialog).disabled).toBe(true);
  });
  it.each(["challenge", "verified"])(
    "accepts fresh MFA after observed revocation without a runtime (%s)",
    async (stage) => {
      resetConnections();
      await act(async () => connectProfile(ambient.id));
      await render(null, true, selected);
      expect(getConnectionSnapshot(selected.id)).toBeNull();
      mfaLogin = true;
      await testLogin();
      if (stage === "verified") await verifyDraft();
      await act(async () => clearAuthToken(selected.id));
      if (stage === "challenge") await verifyDraft();
      const dialog = container.querySelector('[data-test-host="settings"]')!;
      expect(button("Save profile", dialog).disabled).toBe(false);
      await click("Save profile", dialog);
      expect(dialog.textContent).toContain("Saved!");
      expect(getAuthToken(selected.id)).toBe("new-mfa-token");
      expect(getConnectionSnapshot(selected.id)?.status).toBe("connected");
      expectAmbientIntact();
    },
  );




  it("saves a Basic-to-None transition across the subscriber reconnect", async () => {
    await render(selected.id, true);
    const dialog = container.querySelector('[data-test-host="settings"]')!;
    const mediaClientIdBefore = getMediaClientIdForProfile(selected.id);
    const generationBefore = getConnectionSnapshot(selected.id)!.owner.generation;
    await act(async () => {
      dialog.querySelector<HTMLInputElement>('input[name="authType"][value="none"]')!.click();
    });

    await click("Test connection", dialog);
    expect(button("Save profile", dialog).disabled).toBe(false);
    await click("Save profile", dialog);
    const mediaCleanup = fetchMock.mock.calls.find(
      ([url, init]) =>
        String(url) === `${selected.url}/api/fs/media-session` &&
        init?.method === "DELETE",
    );
    expect(JSON.parse(String(mediaCleanup?.[1]?.body)).mediaClientId).toBe(mediaClientIdBefore);
    expect(dialog.textContent).toContain("Saved!");
    expect(getProfiles().find((candidate) => candidate.id === selected.id)?.authType).toBe("none");
    expect(getConnectionSnapshot(selected.id)!.owner.generation).toBeGreaterThan(generationBefore);
    expectAmbientIntact();
  });
  it("restores the prior profile and token after a partial token-clear failure", async () => {
    await render(selected.id, true);
    const dialog = container.querySelector('[data-test-host="settings"]')!;
    await act(async () => {
      setInput('input[data-auth-input="true"]', "https://replacement.test");
      setInput('input[type="password"]', "password");
    });
    await testLogin();
    const originalRemoveItem = Storage.prototype.removeItem;
    vi.spyOn(Storage.prototype, "removeItem").mockImplementation(
      function (this: Storage, key: string) {
        if (this === sessionStorage && key === "damhopper_auth_token_selected") {
          throw new Error("session storage unavailable");
        }
        originalRemoveItem.call(this, key);
      },
    );
    await click("Save profile", dialog);
    expect(dialog.textContent).toContain("Unable to clear the previous login token");
    expect(dialog.textContent).not.toContain("Saved!");
    expect(getProfiles().find((candidate) => candidate.id === selected.id)?.authType).toBe("basic");
    expect(getAuthToken(selected.id)).toBe("token-a");
    expectAmbientIntact();
  });
  it("does not restore token A after replacement B is retired during rollback", async () => {
    await render(selected.id, true);
    const dialog = container.querySelector('[data-test-host="settings"]')!;
    await act(async () => {
      setInput('input[data-auth-input="true"]', "https://replacement.test");
      setInput('input[type="password"]', "password");
    });
    await testLogin();
    let injected = false;
    const unsubscribe = subscribeToProfileChanges((event) => {
      if (
        !injected &&
        event.type === "dataChanged" &&
        getProfiles().find((candidate) => candidate.id === selected.id)?.url ===
          selected.url
      ) {
        injected = true;
        setAuthToken("replacement-b", selected.id);
        clearAuthToken(selected.id);
      }
    });
    const tokenWrites: string[] = [];
    const originalSetItem = Storage.prototype.setItem;
    vi.spyOn(Storage.prototype, "setItem").mockImplementation(
      function (this: Storage, key: string, value: string) {
        if (
          this === localStorage &&
          key === `damhopper_profile_auth_v2_${selected.id}`
        ) {
          tokenWrites.push(JSON.parse(value).token);
        }
        originalSetItem.call(this, key, value);
      },
    );
    const originalRemoveItem = Storage.prototype.removeItem;
    vi.spyOn(Storage.prototype, "removeItem").mockImplementation(
      function (this: Storage, key: string) {
        if (this === sessionStorage && key === "damhopper_auth_token_selected") {
          throw new Error("session storage unavailable");
        }
        originalRemoveItem.call(this, key);
      },
    );
    await click("Save profile", dialog);
    unsubscribe();
    expect(injected).toBe(true);
    expect(dialog.textContent).toContain("its prior login was not restored");
    expect(dialog.textContent).not.toContain("Saved!");
    expect(getProfiles().find((candidate) => candidate.id === selected.id)?.url).toBe(selected.url);
    expect(getAuthToken(selected.id)).toBeNull();
    expect(tokenWrites).not.toContain("token-a");
    expectAmbientIntact();
  });


  it("connects a saved profile when auto-connect is enabled without a runtime", async () => {
    const offlineProfile = { ...selected, autoConnect: false };
    resetConnections();
    await act(async () => {
      saveProfiles([offlineProfile, ambient]);
      await connectProfile(ambient.id);
    });
    const onSaved = vi.fn();
    await render(selected.id, true, offlineProfile, onSaved);
    expect(getConnectionSnapshot(selected.id)).toBeNull();
    const dialog = container.querySelector('[data-test-host="settings"]')!;
    await act(async () => {
      dialog.querySelector<HTMLInputElement>('input[type="checkbox"]')!.click();
    });
    await testLogin();
    await click("Save profile", dialog);
    expect(dialog.textContent).toContain("Saved!");
    expect(onSaved).toHaveBeenCalledWith(
      expect.objectContaining({ id: selected.id, autoConnect: true }),
    );
    expect(getConnectionSnapshot(selected.id)?.status).toBe("connected");
    expectAmbientIntact();
  });
  it("reports successful cleanup when new-profile activation fails", async () => {
    const onSaved = vi.fn();
    await render(null, true, null, onSaved);
    const dialog = container.querySelector('[data-test-host="settings"]')!;
    await act(async () => {
      setInput('input[data-auth-input="true"]', "https://new-profile.test");
      setInput('input[placeholder="Username"]', "new-user");
      setInput('input[type="password"]', "new-password");
    });
    await click("Test connection", dialog);
    let createdProfileId: string | null = null;
    const unsubscribe = subscribeToProfileChanges((event) => {
      const created = getProfiles().find(
        (candidate) => candidate.url === "https://new-profile.test",
      );
      if (event.type === "profileListChanged" && created) {
        createdProfileId = created.id;
        void connectProfile(created.id);
      }
    });
    const originalSetItem = Storage.prototype.setItem;
    vi.spyOn(Storage.prototype, "setItem").mockImplementation(
      function (this: Storage, key: string, value: string) {
        if (
          this === localStorage &&
          key === "damhopper_active_profile_id" &&
          value !== ambient.id
        ) {
          throw new Error("active profile storage unavailable");
        }
        originalSetItem.call(this, key, value);
      },
    );
    await click("Save profile", dialog);
    unsubscribe();
    expect(dialog.textContent).toContain("Unable to activate the new server profile");
    expect(getProfiles().some((candidate) => candidate.url === "https://new-profile.test")).toBe(false);
    expect(getAuthToken(ambient.id)).toBe("ambient-token");
    expect(getActiveProfileId()).toBe(ambient.id);
    expect(onSaved).not.toHaveBeenCalled();
    expect(createdProfileId).not.toBeNull();
    expect(
      getConnectionSnapshot(createdProfileId!)?.status,
    ).toBe("disconnected");
  });


  it.each(["login", "MFA"])("clears busy state when the profile changes during %s", async (stage) => {
    await render(selected.id, true);
    const dialog = container.querySelector('[data-test-host="settings"]')!;
    if (stage === "MFA") {
      mfaLogin = true;
      await testLogin();
      mfaAcknowledgement = Promise.withResolvers<Response>();
      await act(async () => setInput("#mfa-code-input", "123456"));
      button("Verify & Continue", dialog).click();
      await act(async () => Promise.resolve());
    } else {
      loginAcknowledgement = Promise.withResolvers<Response>();
      await testLogin();
    }
    await act(async () => saveProfiles([{ ...selected, name: "Renamed elsewhere" }, ambient]));
    const result = stage === "MFA"
      ? { state: "authenticated", token: "late-mfa-token", user: "alice", role: "user", authProtocol: 2 }
      : { token: "late-token", user: "alice" };
    await act(async () => {
      (stage === "MFA" ? mfaAcknowledgement : loginAcknowledgement)!.resolve(json(result));
    });
    expect(dialog.textContent).toContain("The target profile changed during authentication");
    expect(button("Test connection", dialog).disabled).toBe(false);
    expect(button("Save profile", dialog).disabled).toBe(true);
    expect(getAuthToken(selected.id)).toBe("token-a");
  });
  it("clears enrollment busy state after persisted target replacement", async () => {
    await render(selected.id, true);
    mfaLogin = true;
    mfaEnrollment = true;
    setupAcknowledgement = Promise.withResolvers<Response>();
    await testLogin();
    await act(async () => saveProfiles([{ ...selected, name: "Renamed elsewhere" }, ambient]));
    await act(async () => setupAcknowledgement!.resolve(json({
      secret: "secret", otpauthUri: "otpauth://totp/test", issuer: "DamHopper",
      accountName: "alice", algorithm: "SHA1", digits: 6, period: 30,
    })));
    const dialog = container.querySelector('[data-test-host="settings"]')!;
    expect(dialog.textContent).toContain("The target profile changed during authentication");
    expect(button("Test connection", dialog).disabled).toBe(false);
  });

  it("clears automatic step-up busy state after persisted target replacement", async () => {
    stepUpAcknowledgement = Promise.withResolvers<Response>();
    mfaStatusRequired = true;
    await act(async () => {
      disconnectProfile(selected.id);
      await connectProfile(selected.id);
    });
    expect(getConnectionSnapshot(selected.id)?.status).toBe("mfa-required");
    await render(selected.id, true);
    await act(async () => saveProfiles([{ ...selected, name: "Renamed elsewhere" }, ambient]));
    await act(async () => stepUpAcknowledgement!.resolve(json({
      challengeToken: "late-step-up", challengeExpiresAt: "2026-10-22T01:00:00Z", authProtocol: 2,
    })));
    const dialog = container.querySelector('[data-test-host="settings"]')!;
    expect(dialog.textContent).toContain("The target profile changed during authentication");
    expect(button("Test connection", dialog).disabled).toBe(false);
  });
  it.each(["enrollment", "step-up"])(
    "URL edits clear pending MFA busy state (%s)",
    async (kind) => {
      if (kind === "enrollment") {
        mfaLogin = true;
        mfaEnrollment = true;
        setupAcknowledgement = Promise.withResolvers<Response>();
      } else {
        mfaStatusRequired = true;
        stepUpAcknowledgement = Promise.withResolvers<Response>();
        await act(async () => {
          disconnectProfile(selected.id);
          await connectProfile(selected.id);
        });
      }
      await render(selected.id, true);
      if (kind === "enrollment") await testLogin();
      const dialog = container.querySelector('[data-test-host="settings"]')!;
      await act(async () =>
        setInput('input[data-auth-input="true"]', "https://edited.test"),
      );
      expect(button("Test connection", dialog).disabled).toBe(false);
      const pending = kind === "enrollment"
        ? setupAcknowledgement!
        : stepUpAcknowledgement!;
      await act(async () => pending.resolve(json(
        kind === "enrollment"
          ? {
              secret: "secret", otpauthUri: "otpauth://totp/test",
              issuer: "DamHopper", accountName: "alice",
              algorithm: "SHA1", digits: 6, period: 30,
            }
          : {
              challengeToken: "late-step-up",
              challengeExpiresAt: "2026-10-22T01:00:00Z",
              authProtocol: 2,
            },
      )));
      expect(button("Test connection", dialog).disabled).toBe(false);
    },
  );


  it("creates a new profile without borrowing an authenticated ambient profile token", async () => {
    await render(null, true, null);
    const dialog = container.querySelector('[data-test-host="settings"]')!;
    await act(async () => {
      setInput('input[data-auth-input="true"]', "https://new-profile.test");
      setInput('input[placeholder="Username"]', "new-user");
      setInput('input[type="password"]', "new-password");
    });
    await click("Test connection", dialog);
    expect(button("Save profile", dialog).disabled).toBe(false);
    await click("Save profile", dialog);
    const created = getProfiles().find((candidate) => candidate.url === "https://new-profile.test");
    expect(created).toBeDefined();
    expect(getAuthToken(created!.id)).toBe("token-a");
    expect(getConnectionSnapshot(created!.id)?.status).toBe("connected");
    expect(dialog.textContent).toContain("Saved!");
    expect(getAuthToken(ambient.id)).toBe("ambient-token");
  });
  it("clears test busy state when the target profile changes during login", async () => {
    await render(selected.id, true);
    loginAcknowledgement = Promise.withResolvers<Response>();
    const dialog = container.querySelector('[data-test-host="settings"]')!;
    await testLogin();
    await act(async () => saveProfiles([{ ...selected, name: "Renamed elsewhere" }, ambient]));
    await act(async () => loginAcknowledgement!.resolve(json({ token: "late-token", user: "alice" })));
    expect(dialog.textContent).toContain("The target profile changed during authentication");
    expect(button("Test connection", dialog).disabled).toBe(false);
    expect(button("Save profile", dialog).disabled).toBe(true);
    expect(getAuthToken(selected.id)).toBe("token-a");
  });


  it.each([false, true])("page ACK fences a dialog Save awaiting media cleanup (replacement %s)", async (replacement) => {
    await render(selected.id, true); await revokeSelf(); mfaLogin = true; await testLogin(); await verifyDraft();
    mediaAcknowledgement = Promise.withResolvers<Response>();
    const mediaCalls = fetchMock.mock.calls.filter(([url]) => String(url).endsWith("/api/fs/media-session")).length;
    const dialog = container.querySelector('[data-test-host="settings"]')!;
    await click("Save profile", dialog);
    expect(fetchMock.mock.calls.filter(([url]) => String(url).endsWith("/api/fs/media-session"))).toHaveLength(mediaCalls + 1);
    expect(getAuthToken(selected.id)).toBe("token-a");
    await acknowledge();
    if (replacement) await act(async () => { setAuthToken("replacement-b", selected.id); });
    const generation = getConnectionSnapshot(selected.id)?.owner.generation;
    const sockets = FakeWebSocket.sockets.length;
    await act(async () => mediaAcknowledgement!.resolve(new Response(null, { status: 204 })));
    expect(getAuthToken(selected.id)).toBe(replacement ? "replacement-b" : null);
    expect(getConnectionSnapshot(selected.id)?.owner.generation).toBe(generation);
    expect(FakeWebSocket.sockets).toHaveLength(sockets);
    expect(dialog.textContent).not.toContain("Saved!"); expectAmbientIntact();
  });
  it("rejects a URL-changing Save after queued cross-tab credential replacement", async () => {
    const offlineProfile = { ...selected, autoConnect: false };
    await act(async () => {
      disconnectProfile(selected.id);
      saveProfiles([offlineProfile, ambient]);
    });
    await render(selected.id, true, offlineProfile);
    await act(async () =>
      setInput('input[data-auth-input="true"]', "https://replacement.test"),
    );
    mfaLogin = true;
    await testLogin();
    await verifyDraft();
    mediaAcknowledgement = Promise.withResolvers<Response>();
    const dialog = container.querySelector('[data-test-host="settings"]')!;
    await click("Save profile", dialog);
    expect(fetchMock.mock.calls.some(([url]) =>
      String(url) === `${selected.url}/api/fs/media-session`,
    )).toBe(true);

    const key = `damhopper_profile_auth_v2_${selected.id}`;
    localStorage.removeItem(key);
    const replacement = JSON.stringify({
      version: 2,
      serverUrl: "https://replacement.test",
      authType: "basic",
      token: "replacement-b",
    });
    await act(async () => {
      window.dispatchEvent(new StorageEvent("storage", {
        key, oldValue: null, newValue: replacement,
      }));
      window.dispatchEvent(new StorageEvent("storage", {
        key, oldValue: replacement, newValue: null,
      }));
    });
    await act(async () =>
      mediaAcknowledgement!.resolve(new Response(null, { status: 204 })),
    );
    expect(getAuthToken(selected.id)).toBeNull();
    expect(dialog.textContent).not.toContain("Saved!");
    expect(getAuthToken(ambient.id)).toBe("ambient-token");
  });


  it("a late ACK cannot clear or overwrite a replacement owner", async () => {
    await render(); await revokeSelf();
    await act(async () => FakeWebSocket.sockets[0].close(4401, "Revoked"));
    await act(async () => { setAuthToken("replacement-b", selected.id); });
    const generation = getConnectionSnapshot(selected.id)?.owner.generation;
    const sockets = FakeWebSocket.sockets.length;
    expect(container.textContent).toContain("Replacement client");
    await acknowledge();
    expect(getAuthToken(selected.id)).toBe("replacement-b");
    expect(getConnectionSnapshot(selected.id)?.owner.generation).toBe(generation);
    expect(FakeWebSocket.sockets).toHaveLength(sockets); expectAmbientIntact();
  });

  it.each(["switch", "remount", "switch-back"])("a deferred retired A ACK cannot change a newer page owner (%s)", async (change) => {
    await render(); await revokeSelf();
    await act(async () => FakeWebSocket.sockets[0].close(4401, "Revoked"));
    if (change === "remount") await render(null);
    else await render(ambient.id);
    await act(async () => { setAuthToken("replacement-b", selected.id); });
    if (change !== "switch") await render(selected.id);
    expect(container.textContent).toContain(change === "switch" ? "Ambient client" : "Replacement client");
    const generation = getConnectionSnapshot(selected.id)?.owner.generation;
    const ambientGeneration = getConnectionSnapshot(ambient.id)?.owner.generation;
    const sockets = FakeWebSocket.sockets.length;
    await acknowledge();
    expect(getAuthToken(selected.id)).toBe("replacement-b");
    expect(getConnectionSnapshot(selected.id)?.status).toBe("connected");
    expect(getConnectionSnapshot(selected.id)?.owner.generation).toBe(generation);
    expect(getConnectionSnapshot(ambient.id)?.owner.generation).toBe(ambientGeneration);
    expect(FakeWebSocket.sockets).toHaveLength(sockets);
    expectAmbientIntact();
  });

  it("local cleanup failure offers retry and recovers on real 4401 without another DELETE", async () => {
    await render(); await revokeSelf();
    const original = Storage.prototype.removeItem;
    const removal = vi.spyOn(Storage.prototype, "removeItem").mockImplementation(function (this: Storage, key: string) {
      if (key === "damhopper_profile_auth_v2_selected") throw new Error("Storage unavailable");
      original.call(this, key);
    });
    await acknowledge();
    expect(container.textContent).toContain("unable to clear its saved login token");
    expect(button("Retry local cleanup").disabled).toBe(false);
    await click("Retry local cleanup");
    expect(container.textContent).toContain("unable to clear its saved login token");
    expect(getConnectionSnapshot(selected.id)?.status).toBe("connected");
    expect(FakeWebSocket.sockets).toHaveLength(2);
    // Storage failure does not simulate server enforcement. Exercise the real
    // 4401 handler once storage recovers; it must still terminate this runtime.
    removal.mockRestore();
    await act(async () => FakeWebSocket.sockets[0].close(4401, "Revoked session"));
    expect(getConnectionSnapshot(selected.id)?.status).toBe("login-required");
    expect(getAuthToken(selected.id)).toBeNull();
    expect(FakeWebSocket.sockets).toHaveLength(2);
    expect(fetchMock.mock.calls.filter(([url, init]) =>
      String(url).endsWith("/api/auth/sessions/self-a") && init?.method === "DELETE")).toHaveLength(1);
    expect(getAuthToken(ambient.id)).toBe("ambient-token");
  });

  it.each([false, true])("deferred ACK retires only its exact owner (replacement %s)", async (replacement) => {
    await render(); await revokeSelf();
    const initialGeneration = getConnectionSnapshot(selected.id)!.owner.generation;
    expect(getAuthToken(selected.id)).toBe("token-a");
    expect(FakeWebSocket.sockets).toHaveLength(2);
    if (replacement) {
      await act(async () => { setAuthToken("replacement-b", selected.id); });
      expect(container.textContent).toContain("Replacement client");
    }
    const generation = getConnectionSnapshot(selected.id)!.owner.generation;
    const sockets = FakeWebSocket.sockets.length;
    await acknowledge();
    expect(getAuthToken(selected.id)).toBe(replacement ? "replacement-b" : null);
    expect(getConnectionSnapshot(selected.id)?.status).toBe(replacement ? "connected" : "login-required");
    expect(getConnectionSnapshot(selected.id)?.owner.generation).toBe(replacement ? generation : initialGeneration + 1);
    expect(FakeWebSocket.sockets).toHaveLength(sockets);
    expectAmbientIntact();
  });
});
