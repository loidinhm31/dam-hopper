// @vitest-environment jsdom

import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { getAuthToken, saveProfiles, setActiveProfile, setAuthToken } from "@/api/server-config.js";
import { DevicesPage } from "./DevicesPage.js";

const a = { id: "page-a", name: "Server One", url: "https://one.test", authType: "basic" as const, createdAt: 1, autoConnect: false };
const b = { ...a, id: "page-b", name: "Server Two", url: "https://two.test" };
const row = { id: "other", userAgent: "Selected client", current: false, issuedAt: "2026-10-22T00:00:00Z", expiresAt: "2026-11-22T00:00:00Z", mfaVerifiedAt: "2026-10-22T00:00:00Z" };

describe("DevicesPage", () => {
  let container: HTMLDivElement;
  let root: Root;
  beforeEach(() => {
    localStorage.clear();
    saveProfiles([a, b]); setActiveProfile(b.id);
    setAuthToken("token-a", a.id); setAuthToken("token-b", b.id);
    container = document.createElement("div"); document.body.append(container); root = createRoot(container);
  });
  afterEach(() => {
    act(() => root.unmount()); container.remove(); localStorage.clear();
    vi.unstubAllGlobals(); vi.restoreAllMocks();
  });

  it("uses the selected owner for refresh and confirmed other-session revocation", async () => {
    let acknowledge!: (response: Response) => void;
    const deletion = new Promise<Response>((resolve) => { acknowledge = resolve; });
    const fetchMock = vi.fn(async (_url: string | URL | Request, init?: RequestInit) =>
      init?.method === "DELETE" ? deletion : new Response(JSON.stringify({ sessions: [row], nextCursor: null })));
    vi.stubGlobal("fetch", fetchMock);
    await act(async () => root.render(<DevicesPage profileId={a.id} />));
    expect(container.querySelector('[data-testid="app-layout"]')?.getAttribute("data-title")).toBe("Devices");
    expect(container.textContent).toContain("Selected client");
    expect(container.querySelector<HTMLSelectElement>("select")?.value).toBe(a.id);
    const button = (text: string, scope: ParentNode = document) =>
      [...scope.querySelectorAll<HTMLButtonElement>("button")].find((item) => item.textContent === text)!;
    await act(async () => button("Refresh", container).click());
    await act(async () => button("Revoke access", container).click());
    await act(async () => button("Cancel", document.querySelector('[role="dialog"]')!).click());
    expect(fetchMock.mock.calls.filter(([, init]) => init?.method === "DELETE")).toHaveLength(0);
    await act(async () => button("Revoke access", container).click());
    await act(async () => { button("Revoke access", document.querySelector('[role="dialog"]')!).click(); });
    expect(container.querySelector('[data-session-id="other"]')).not.toBeNull();
    await act(async () => { acknowledge(new Response(null, { status: 204 })); });
    expect(container.querySelector('[data-session-id="other"]')).toBeNull();
    expect(fetchMock.mock.calls.map(([url]) => String(url))).toEqual([
      `${a.url}/api/auth/sessions`, `${a.url}/api/auth/sessions`, `${a.url}/api/auth/sessions/other`,
    ]);
    for (const [, init] of fetchMock.mock.calls) expect(init).toMatchObject({ credentials: "omit", headers: { Authorization: "Bearer token-a" } });
    expect(getAuthToken(a.id)).toBe("token-a"); expect(getAuthToken(b.id)).toBe("token-b");
  });

  it("warns on self revoke and clears only the selected owner's credential", async () => {
    vi.stubGlobal("fetch", vi.fn(async (_url: string | URL | Request, init?: RequestInit) =>
      init?.method === "DELETE" ? new Response(null, { status: 204 }) : new Response(JSON.stringify({ sessions: [{ ...row, current: true }], nextCursor: null }))));
    await act(async () => root.render(<DevicesPage profileId={a.id} noLayout />));
    expect(container.querySelector('[data-testid="app-layout"]')).toBeNull();
    await act(async () => container.querySelector<HTMLButtonElement>("li button")!.click());
    const dialog = document.querySelector('[role="dialog"]')!;
    expect(dialog.textContent).toContain("You will need to log in again");
    await act(async () => [...dialog.querySelectorAll<HTMLButtonElement>("button")].find((button) => button.textContent === "Revoke access")!.click());
    expect(getAuthToken(a.id)).toBeNull(); expect(getAuthToken(b.id)).toBe("token-b");
  });

  it("supports controlled rerender and profile selection callbacks", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify({ sessions: [], nextCursor: null }))));
    const onProfileChange = vi.fn();
    await act(async () => root.render(<DevicesPage noLayout profileId={a.id} onProfileChange={onProfileChange} />));
    const select = container.querySelector<HTMLSelectElement>("select")!;
    expect(select.value).toBe(a.id);
    await act(async () => root.render(<DevicesPage noLayout profileId={b.id} onProfileChange={onProfileChange} />));
    expect(select.value).toBe(b.id);
    await act(async () => { select.value = a.id; select.dispatchEvent(new Event("change", { bubbles: true })); });
    expect(onProfileChange).toHaveBeenCalledWith(a.id);
    expect(select.value).toBe(a.id);
  });
});
