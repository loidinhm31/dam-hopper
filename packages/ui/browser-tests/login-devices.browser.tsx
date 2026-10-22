import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { page, userEvent } from "vitest/browser";
import { saveProfiles, setActiveProfile, setAuthToken } from "@/api/server-config.js";
import { ServerSettingsDialog } from "@/components/organisms/ServerSettingsDialog.js";
import "@/index.css";

const actGlobal: { IS_REACT_ACT_ENVIRONMENT?: boolean } = globalThis;
actGlobal.IS_REACT_ACT_ENVIRONMENT = true;
let container: HTMLDivElement;
let root: Root;
const profile = { id: "browser-device", name: "Device server", url: "https://device.test", authType: "basic" as const, autoConnect: false, createdAt: 1 };
beforeEach(() => {
  localStorage.clear(); saveProfiles([profile]); setActiveProfile(profile.id); setAuthToken("browser-fixture-token", profile.id);
  container = document.createElement("div"); document.body.append(container); root = createRoot(container);
});
afterEach(async () => {
  await act(async () => root.unmount()); container.remove(); localStorage.clear();
  vi.unstubAllGlobals(); vi.restoreAllMocks();
});

it.each([667, 420])("wraps untrusted hints, bounds scrolling and keeps confirmation keyboard actions visible at 320x%i", async (height) => {
  await page.viewport(320, height);
  const hint = `<script>plain text</script>${"UnbrokenClientHint".repeat(30)}`;
  const row = { id: "other", userAgent: hint, current: false, issuedAt: "2026-10-22T00:00:00Z", expiresAt: "2026-11-22T00:00:00Z", mfaVerifiedAt: "2026-10-22T00:00:00Z" };
  const rows = [row, ...Array.from({ length: 11 }, (_, index) => ({
    ...row, id: `other-${index}`, userAgent: `Additional client ${index}`,
  }))];
  const fetch = vi.fn().mockResolvedValueOnce(new Response(JSON.stringify({ sessions: rows, nextCursor: null })))
    .mockResolvedValueOnce(new Response(null, { status: 204 }));
  vi.stubGlobal("fetch", fetch);
  await act(async () => root.render(<ServerSettingsDialog open profile={profile} onClose={vi.fn()} />));
  const section = container.querySelector<HTMLElement>('section[aria-label="Login devices"]')!;
  const list = section.querySelector<HTMLElement>("ul")!;
  await vi.waitFor(() => expect(list.querySelector("li")).not.toBeNull());
  const hintElement = list.querySelector<HTMLElement>("li p")!;
  expect(hintElement.textContent).toBe(hint); expect(list.querySelector("script")).toBeNull();
  expect(hintElement.scrollWidth).toBeLessThanOrEqual(hintElement.clientWidth);
  expect(list.clientHeight).toBeLessThanOrEqual(256);
  expect(list.scrollHeight).toBeGreaterThan(list.clientHeight);
  list.scrollTop = list.scrollHeight;
  expect(list.scrollTop).toBeGreaterThan(0);
  expect(list.querySelectorAll("li")).toHaveLength(12);
  expect(document.documentElement.scrollWidth).toBeLessThanOrEqual(window.innerWidth);
  const revoke = list.querySelector<HTMLButtonElement>("button")!;
  revoke.scrollIntoView({ block: "center" });
  await userEvent.click(revoke);
  const dialog = document.querySelector<HTMLElement>('[role="dialog"]')!;
  await vi.waitFor(() => expect(dialog.contains(document.activeElement)).toBe(true));
  const actions = [...dialog.querySelectorAll<HTMLButtonElement>("button")].filter((item) => item.textContent === "Cancel" || item.textContent === "Revoke access");
  for (const action of actions) {
    const rect = action.getBoundingClientRect();
    expect(rect.top).toBeGreaterThanOrEqual(0); expect(rect.bottom).toBeLessThanOrEqual(height);
    expect(rect.left).toBeGreaterThanOrEqual(0); expect(rect.right).toBeLessThanOrEqual(320);
  }
  await userEvent.keyboard("{Escape}");
  await vi.waitFor(() => expect(document.querySelector('[role="dialog"]')).toBeNull());
  expect(fetch).toHaveBeenCalledTimes(1);
  await userEvent.click(revoke);
  const confirm = [...document.querySelectorAll<HTMLButtonElement>('[role="dialog"] button')].find((item) => item.textContent === "Revoke access")!;
  await userEvent.click(confirm);
  await vi.waitFor(() => expect(list.querySelector('[data-session-id="other"]')).toBeNull());
  expect(list.querySelectorAll("li")).toHaveLength(11);
  expect(fetch).toHaveBeenLastCalledWith(`${profile.url}/api/auth/sessions/other`, expect.objectContaining({
    method: "DELETE", credentials: "omit", headers: expect.objectContaining({ Authorization: "Bearer browser-fixture-token" }),
  }));
});
