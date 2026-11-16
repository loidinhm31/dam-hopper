import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { page, userEvent } from "vitest/browser";
import {
  clearActiveProfile,
  clearAuthToken,
  getAuthToken,
  getProfiles,
  saveProfiles,
  setActiveProfile,
  setAuthToken,
} from "@/api/server-config.js";
import { resetConnections } from "@/api/connections.js";
import { ServerProfilesDialog } from "@/components/organisms/ServerProfilesDialog.js";
import { ServerSettingsDialog } from "@/components/organisms/ServerSettingsDialog.js";
import "@/index.css";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

describe("Host Browser Confirmed Account Logout and Local Removal in Chromium", () => {
  let root: Root | null = null;
  let container: HTMLDivElement | null = null;

  beforeEach(() => {
    localStorage.clear();
    sessionStorage.clear();
    resetConnections();
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
  });

  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
    if (root) {
      act(() => root?.unmount());
      root = null;
    }
    container?.remove();
    container = null;
    document.body.innerHTML = "";
    clearActiveProfile();
    clearAuthToken("prof-1");
    clearAuthToken("prof-2");
  });

  it("focuses Cancel by default, never preselects logout actions, cancels on initial Enter and Escape, then supports keep and confirmed clear", async () => {
    const profile1 = {
      id: "prof-1",
      name: "Primary Host",
      url: "https://primary.test",
      authType: "basic" as const,
      username: "admin",
      createdAt: 1,
      autoConnect: true,
    };
    const profile2 = {
      ...profile1,
      id: "prof-2",
      name: "Secondary Host",
      url: "https://secondary.test",
    };
    saveProfiles([profile1, profile2]);
    setActiveProfile(profile2.id);
    setAuthToken("tok-primary", profile1.id);
    setAuthToken("tok-secondary", profile2.id);

    const logoutPayloads: Array<Record<string, unknown>> = [];
    const fetchMock = vi.fn(async (url: string | URL | Request, init?: RequestInit) => {
      const target = String(url);
      if (target.endsWith("/api/browser/capabilities")) {
        return new Response(
          JSON.stringify({
            available: true,
            managedProfilePresent: true,
            profileEpoch: "3",
          }),
          { status: 200 },
        );
      }
      if (target.endsWith("/api/fs/media-session")) {
        return new Response(null, { status: 204 });
      }
      if (target.endsWith("/api/auth/logout")) {
        const parsed = JSON.parse(String(init?.body ?? "{}")) as Record<
          string,
          unknown
        >;
        logoutPayloads.push(parsed);
        if (parsed.browserReset === true && parsed.confirmed === true) {
          return new Response(
            JSON.stringify({
              authenticated: false,
              browserResetState: "cleared",
              browserCredentialsRetained: false,
              resetRequired: false,
              profileEpoch: "4",
              operationId: parsed.operationId,
            }),
            { status: 200 },
          );
        }
        return new Response(
          JSON.stringify({
            authenticated: false,
            browserResetState: "retained",
            browserCredentialsRetained: true,
            resetRequired: true,
            profileEpoch: "3",
          }),
          { status: 200 },
        );
      }
      return new Response(JSON.stringify({ sessions: [], nextCursor: null }), {
        status: 200,
      });
    });
    vi.stubGlobal("fetch", fetchMock);

    await act(async () => {
      root?.render(
        createElement(ServerProfilesDialog, {
          open: true,
          onClose: () => undefined,
          onEditProfile: () => undefined,
        }),
      );
    });

    // 1. Open Logout dialog for profile1 -> focus MUST land on Cancel
    await page.getByTitle("Log out of this server account").first().click();
    await expect.element(page.getByTestId("account-logout-dialog")).toBeVisible();

    const cancelEl = document.querySelector<HTMLButtonElement>(
      '[data-testid="logout-cancel-btn"]',
    )!;
    const keepEl = document.querySelector<HTMLButtonElement>(
      '[data-testid="logout-keep-btn"]',
    )!;
    const clearEl = document.querySelector<HTMLButtonElement>(
      '[data-testid="logout-clear-btn"]',
    )!;
    await vi.waitFor(() => {
      expect(document.activeElement).toBe(cancelEl);
    });
    expect(keepEl.hasAttribute("autofocus")).toBe(false);
    expect(clearEl.hasAttribute("autofocus")).toBe(false);

    // 2. Initial Enter cancels without logout or wipe
    await userEvent.keyboard("{Enter}");
    await vi.waitFor(() => {
      expect(document.querySelector('[data-testid="account-logout-dialog"]')).toBeNull();
    });
    expect(logoutPayloads).toHaveLength(0);
    expect(getAuthToken(profile1.id)).toBe("tok-primary");

    // 3. Reopen and press Escape -> cancels without logout or wipe
    await page.getByTitle("Log out of this server account").first().click();
    await expect.element(page.getByTestId("account-logout-dialog")).toBeVisible();
    await userEvent.keyboard("{Escape}");
    await vi.waitFor(() => {
      expect(document.querySelector('[data-testid="account-logout-dialog"]')).toBeNull();
    });
    expect(logoutPayloads).toHaveLength(0);
    expect(getAuthToken(profile1.id)).toBe("tok-primary");

    // 4. Explicit keep-data calls server logout FIRST, clears local token, reports retained/resetRequired
    await page.getByTitle("Log out of this server account").first().click();
    await expect.element(page.getByTestId("logout-keep-btn")).toBeVisible();
    await page.getByTestId("logout-keep-btn").click();
    await expect.element(page.getByTestId("logout-outcome-panel")).toBeVisible();
    expect(logoutPayloads).toEqual([{ browserReset: false }]);
    expect(getAuthToken(profile1.id)).toBeNull();
    expect(
      document.querySelector('[data-testid="logout-outcome-panel"]')?.textContent,
    ).toContain("retained");
    await page.getByTestId("logout-outcome-done-btn").click();

    // 5. Switch to ServerSettingsDialog on profile1 (re-seeded token) -> explicit confirmed clear
    setAuthToken("tok-primary-2", profile1.id);
    const onSettingsClose = vi.fn();
    await act(async () => {
      root?.render(
        createElement(ServerSettingsDialog, {
          open: true,
          profile: profile1,
          onClose: onSettingsClose,
        }),
      );
    });
    await page.getByRole("button", { name: "Logout" }).click();
    await expect.element(page.getByTestId("logout-clear-btn")).toBeEnabled();
    await page.getByTestId("logout-clear-btn").click();
    await expect.element(page.getByTestId("logout-outcome-panel")).toBeVisible();

    expect(logoutPayloads).toHaveLength(2);
    expect(logoutPayloads[1]).toMatchObject({
      browserReset: true,
      confirmed: true,
      expectedProfileEpoch: "3",
    });
    expect(typeof logoutPayloads[1].operationId).toBe("string");
    expect(getAuthToken(profile1.id)).toBeNull();
    expect(
      document.querySelector('[data-testid="logout-outcome-panel"]')?.textContent,
    ).toContain("deleted");
    await page.getByTestId("logout-outcome-done-btn").click();
    expect(onSettingsClose).toHaveBeenCalledOnce();
  });

  it("explains local profile removal retains server Browser credentials without remote logout or reset", async () => {
    const profile1 = {
      id: "prof-1",
      name: "Keep Remote Server",
      url: "https://remote.test",
      authType: "basic" as const,
      username: "admin",
      createdAt: 1,
      autoConnect: true,
    };
    saveProfiles([profile1]);
    setAuthToken("tok-remote", profile1.id);

    const fetchMock = vi.fn(async () => new Response(null, { status: 204 }));
    vi.stubGlobal("fetch", fetchMock);

    await act(async () => {
      root?.render(
        createElement(ServerProfilesDialog, {
          open: true,
          onClose: () => undefined,
          onEditProfile: () => undefined,
        }),
      );
    });

    await page.getByTitle("Remove profile").click();
    await expect.element(page.getByRole("dialog")).toBeVisible();
    const dialogText = document.querySelector('[role="dialog"]')?.textContent ?? "";
    expect(dialogText).toMatch(/server Browser credentials are retained/i);

    await page.getByRole("button", { name: "Remove profile" }).click();
    await vi.waitFor(() => {
      expect(getProfiles()).toHaveLength(0);
    });
    expect(
      fetchMock.mock.calls.some(
        ([u]) =>
          String(u).includes("/api/auth/logout") ||
          String(u).includes("/api/browser/profile/reset"),
      ),
    ).toBe(false);
  });

  it("supports standalone Reset Browser data now preserving login and polling pending status in Chromium (W7)", async () => {
    const profile1 = {
      id: "prof-1",
      name: "Standalone Reset Host",
      url: "https://reset.test",
      authType: "basic" as const,
      username: "admin",
      createdAt: 1,
      autoConnect: true,
    };
    saveProfiles([profile1]);
    setActiveProfile(profile1.id);
    setAuthToken("tok-keep-login", profile1.id);

    const fetchMock = vi.fn(async (url: string | URL | Request, init?: RequestInit) => {
      const target = String(url);
      if (target.endsWith("/api/browser/capabilities")) {
        return new Response(
          JSON.stringify({
            available: true,
            managedProfilePresent: true,
            profileEpoch: "2",
          }),
          { status: 200 },
        );
      }
      if (target.endsWith("/api/browser/profile/reset") && init?.method === "POST") {
        const parsed = JSON.parse(String(init.body ?? "{}")) as Record<string, unknown>;
        return new Response(
          JSON.stringify({
            operationId: String(parsed.operationId),
            status: "cleanupPending",
            profileEpoch: "3",
            reason: "terminating browser process",
          }),
          { status: 202 },
        );
      }
      if (target.includes("/api/browser/profile/reset/")) {
        return new Response(
          JSON.stringify({
            operationId: "op-1",
            status: "completed",
            profileEpoch: "3",
          }),
          { status: 200 },
        );
      }
      return new Response(JSON.stringify({ sessions: [], nextCursor: null }), {
        status: 200,
      });
    });
    vi.stubGlobal("fetch", fetchMock);

    await act(async () => {
      root?.render(
        createElement(ServerSettingsDialog, {
          open: true,
          profile: profile1,
          onClose: () => undefined,
        }),
      );
    });

    await page.getByTestId("browser-reset-open-btn").click();
    await expect.element(page.getByTestId("browser-reset-confirm-dialog")).toBeVisible();
    const cancelBtn = document.querySelector<HTMLButtonElement>(
      '[data-testid="browser-reset-cancel-btn"]',
    )!;
    await vi.waitFor(() => {
      expect(document.activeElement).toBe(cancelBtn);
    });
    await page.getByTestId("browser-reset-confirm-btn").click();
    await expect.element(page.getByTestId("browser-reset-status-panel")).toBeVisible();
    expect(getAuthToken(profile1.id)).toBe("tok-keep-login");
    await page.getByTestId("browser-reset-status-btn").click();
    await vi.waitFor(() => {
      expect(
        document.querySelector('[data-testid="browser-reset-status-panel"]')?.textContent,
      ).toContain("Shared Browser data cleared (profile epoch 3)");
    });
    expect(getAuthToken(profile1.id)).toBe("tok-keep-login");
  });
});
