// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi, type Mock } from "vitest";
import { connectProfile, getConnectionSnapshot, resetConnections } from "@/api/connections.js";
import { getAuthToken, saveProfiles, setActiveProfile, setAuthToken, type ServerProfile } from "@/api/server-config.js";
import { ServerSettingsDialog } from "./ServerSettingsDialog.js";

// Only external HTTP/WebSocket seams are fake: owner capture, profile storage,
// the connection subscriber, 4401 handling and the dialog/section are production.
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
let loginToken: string;
let mfaLogin: boolean;
let fetchMock: Mock<(url: string | URL | Request, init?: RequestInit) => Promise<Response>>;

function button(label: string, scope: ParentNode = container) {
  const found = [...scope.querySelectorAll<HTMLButtonElement>("button")].find((item) => item.textContent === label);
  if (!found) throw new Error(`Missing button ${label}`);
  return found;
}
async function click(label: string, scope?: ParentNode) { await act(async () => button(label, scope).click()); }
function setInput(selector: string, value: string) {
  const input = container.querySelector<HTMLInputElement>(selector)!;
  Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(input, value);
  input.dispatchEvent(new Event("input", { bubbles: true }));
}
async function render(profile: ServerProfile = selected, open = true) {
  await act(async () => root.render(<ServerSettingsDialog open={open} profile={profile} onClose={() => {}} />));
}
async function testLogin() {
  await act(async () => setInput('input[type="password"]', "password"));
  await click("Test connection");
}
async function verifyDraft() {
  await act(async () => setInput("#mfa-code-input", "123456"));
  await click("Verify & Continue");
  expect(container.textContent).toContain("Reachable");
}
async function revokeSelf() {
  const section = container.querySelector('section[aria-label="Login devices"]')!;
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
  acknowledgement = Promise.withResolvers<Response>(); mediaAcknowledgement = null;
  loginToken = "token-a"; mfaLogin = false;
  fetchMock = vi.fn(async (url: string | URL | Request, init?: RequestInit) => {
    const address = String(url);
    if (address.endsWith("/api/auth/status")) return json({ authenticated: true, workbenchProtocol: 2, authProtocol: 2 });
    if (address.endsWith("/api/auth/login")) return json(mfaLogin
      ? { state: "mfaRequired", challengeToken: "new-mfa-challenge", challengeExpiresAt: "2026-10-22T01:00:00Z", authProtocol: 2 }
      : { token: loginToken, user: "alice" });
    if (address.endsWith("/api/auth/mfa/verify")) return json({ state: "authenticated", token: "new-mfa-token", user: "alice",
      role: "user", expiresAt: "2026-11-22T00:00:00Z", mfaDueAt: "2026-11-01T00:00:00Z", authProtocol: 2 });
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
    if (address === `${selected.url}/api/auth/sessions` &&
        (token === "Bearer new-mfa-token" || token === "Bearer new-dialog-token")) {
      return json({ sessions: [row("new-self", "New selected login")], nextCursor: null });
    }
    if (address === `${ambient.url}/api/auth/sessions` && token === "Bearer new-dialog-token") {
      return json({ sessions: [row("new-ambient-self", "New ambient login")], nextCursor: null });
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

describe("login devices with real connection retirement and settings drafts", () => {
  it.each(["none", "before-ack", "after-ack"])("4401 before DELETE ACK cannot revive A or overwrite replacement B (%s)", async (timing) => {
    const replacement = timing !== "none";
    await render(); await testLogin();
    expect(button("Save profile").disabled).toBe(false);
    await revokeSelf();
    const oldSocket = FakeWebSocket.sockets[0];
    await act(async () => oldSocket.close(4401, "Revoked"));
    expect(getAuthToken(selected.id)).toBeNull();
    expect(getConnectionSnapshot(selected.id)?.status).toBe("login-required");
    expect(getConnectionSnapshot(selected.id)?.authCode).toBe("AUTH_REQUIRED");
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
    // Prior defect kept the prevalidated A draft and left this button enabled.
    expect(button("Save profile").disabled).toBe(true);
    await click("Save profile");
    expect(getAuthToken(selected.id)).toBe(replacement ? "replacement-b" : null);
    expect(FakeWebSocket.sockets).toHaveLength(socketsBeforeAck);
    expect(getConnectionSnapshot(selected.id)?.owner.generation).toBe(generationBeforeAck);
    expect(getConnectionSnapshot(selected.id)?.status).toBe(replacement ? "connected" : "login-required");
    expectAmbientIntact();
  });

  it.each([204, 503])("A ACK after replacement B also retires cannot reconnect or report stale errors (%s)", async (status) => {
    await render(); await testLogin(); await revokeSelf();
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
    if (status === 204) expect(button("Save profile").disabled).toBe(true);
  });

  it("DELETE-first cleanup uses the real synchronous profile subscriber without double retirement", async () => {
    await render(); await testLogin(); await revokeSelf();
    const generation = getConnectionSnapshot(selected.id)!.owner.generation;
    await acknowledge();
    expect(getAuthToken(selected.id)).toBeNull();
    expect(getConnectionSnapshot(selected.id)?.status).toBe("login-required");
    expect(getConnectionSnapshot(selected.id)?.owner.generation).toBe(generation + 1);
    expect(button("Save profile").disabled).toBe(true);
    await click("Save profile");
    expect(FakeWebSocket.sockets).toHaveLength(2);
    expect(getAuthToken(selected.id)).toBeNull(); expectAmbientIntact();
  });

  it.each(["challenge", "verified"])("preserves a new unsaved MFA %s through ACK and saves its new token", async (stage) => {
    await render(); await revokeSelf(); mfaLogin = true; await testLogin();
    expect(container.querySelector("#mfa-code-input")).not.toBeNull();
    if (stage === "verified") await verifyDraft();
    await acknowledge();
    if (stage === "challenge") {
      expect(container.querySelector("#mfa-code-input")).not.toBeNull();
      await verifyDraft();
    }
    expect(getAuthToken(selected.id)).toBeNull();
    expect(button("Save profile").disabled).toBe(false);
    await click("Save profile");
    expect(getAuthToken(selected.id)).toBe("new-mfa-token");
    expect(getConnectionSnapshot(selected.id)?.status).toBe("connected"); expectAmbientIntact();
  });

  it("replacement login stored after ACK cannot be cleared or overwritten by an enabled stale MFA draft Save", async () => {
    await render(); await revokeSelf(); mfaLogin = true; await testLogin(); await verifyDraft(); await acknowledge();
    await act(async () => { setAuthToken("replacement-b", selected.id); });
    const generation = getConnectionSnapshot(selected.id)?.owner.generation;
    const sockets = FakeWebSocket.sockets.length;
    expect(container.textContent).toContain("Replacement client");
    expect(button("Save profile").disabled).toBe(false);
    await click("Save profile");
    expect(container.textContent).toContain("This login changed while settings were open");
    expect(getAuthToken(selected.id)).toBe("replacement-b");
    expect(getConnectionSnapshot(selected.id)?.owner.generation).toBe(generation);
    expect(FakeWebSocket.sockets).toHaveLength(sockets); expectAmbientIntact();
  });

  it.each(["switch", "reopen", "switch-back"])("a deferred retired A ACK cannot change a newer dialog incarnation (%s)", async (change) => {
    await render(); await revokeSelf();
    await act(async () => FakeWebSocket.sockets[0].close(4401, "Revoked"));
    if (change === "reopen") await render(selected, false);
    else await render(ambient);
    await act(async () => { setAuthToken("replacement-b", selected.id); });
    if (change !== "switch") await render(selected);
    loginToken = "new-dialog-token"; await testLogin();
    expect(button("Save profile").disabled).toBe(false);
    await acknowledge();
    expect(button("Save profile").disabled).toBe(false);
    await click("Save profile");
    expect(getAuthToken(change === "switch" ? ambient.id : selected.id)).toBe("new-dialog-token");
    expect(getAuthToken(change === "switch" ? selected.id : ambient.id)).toBe(change === "switch" ? "replacement-b" : "ambient-token");
    expect(container.querySelector('[role="alert"]')).toBeNull();
  });

  it("local cleanup failure still invalidates the revoked draft before Save", async () => {
    await render(); await testLogin(); await revokeSelf();
    const original = Storage.prototype.removeItem;
    const removal = vi.spyOn(Storage.prototype, "removeItem").mockImplementation(function (this: Storage, key: string) {
      if (key === "damhopper_profile_auth_v2_selected") throw new Error("Storage unavailable");
      original.call(this, key);
    });
    await acknowledge();
    expect(container.textContent).toContain("unable to clear its saved login token");
    expect(button("Retry local cleanup").disabled).toBe(false);
    expect(button("Save profile").disabled).toBe(true);
    await click("Save profile");
    expect(getConnectionSnapshot(selected.id)?.status).toBe("connected");
    expect(FakeWebSocket.sockets).toHaveLength(2);
    // Storage failure does not simulate server enforcement. Exercise the real
    // 4401 handler once storage recovers; it must still terminate this runtime.
    removal.mockRestore();
    await act(async () => FakeWebSocket.sockets[0].close(4401, "Revoked session"));
    expect(getConnectionSnapshot(selected.id)?.status).toBe("login-required");
    expect(getAuthToken(selected.id)).toBeNull();
    expect(FakeWebSocket.sockets).toHaveLength(2);
    expect(getAuthToken(ambient.id)).toBe("ambient-token");
  });

  it.each([false, true])("revalidates a Save already awaiting media cleanup when self ACK arrives (replacement %s)", async (replacement) => {
    await render(); await revokeSelf(); mfaLogin = true; await testLogin(); await verifyDraft();
    mediaAcknowledgement = Promise.withResolvers<Response>();
    const mediaCallsBeforeSave = fetchMock.mock.calls.filter(([url]) => String(url).endsWith("/api/fs/media-session")).length;
    await click("Save profile");
    expect(fetchMock.mock.calls.filter(([url]) => String(url).endsWith("/api/fs/media-session"))).toHaveLength(mediaCallsBeforeSave + 1);
    expect(getAuthToken(selected.id)).toBe("token-a");
    expect(container.textContent).not.toContain("Saved!");
    await acknowledge();
    if (replacement) await act(async () => { setAuthToken("replacement-b", selected.id); });
    const sockets = FakeWebSocket.sockets.length;
    await act(async () => mediaAcknowledgement!.resolve(new Response(null, { status: 204 })));
    expect(getAuthToken(selected.id)).toBe(replacement ? "replacement-b" : null);
    expect(FakeWebSocket.sockets).toHaveLength(sockets);
    expect(container.textContent).not.toContain("Saved!"); expectAmbientIntact();
  });
});
