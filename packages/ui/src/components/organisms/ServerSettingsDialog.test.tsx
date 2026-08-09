// @vitest-environment jsdom

import { createElement } from "react";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  getAuthToken,
  saveProfiles,
  setActiveProfile,
  setAuthToken,
} from "@/api/server-config.js";
import { ServerSettingsDialog } from "./ServerSettingsDialog.js";

const mockPolicy = vi.hoisted(() => ({ enabled: false }));

vi.mock("@/contexts/AndroidChromeInputPolicyContext.js", () => ({
  useAndroidChromeInputPolicy: () => ({
    isAndroidChromeNativeInputSuppressed: mockPolicy.enabled,
  }),
}));

let root: Root | null = null;

function setInputValue(input: HTMLInputElement, value: string): void {
  const setter = Object.getOwnPropertyDescriptor(
    HTMLInputElement.prototype,
    "value",
  )?.set;
  setter?.call(input, value);
  input.dispatchEvent(new Event("input", { bubbles: true }));
}

describe("ServerSettingsDialog Android Chrome policy", () => {
  beforeEach(() => {
    mockPolicy.enabled = false;
  });

  afterEach(() => {
    act(() => root?.unmount());
    root = null;
    document.body.innerHTML = "";
    localStorage.clear();
    sessionStorage.clear();
    vi.restoreAllMocks();
    vi.useRealTimers();
  });

  it("blocks server text fields and text-dependent actions", () => {
    mockPolicy.enabled = true;
    const markup = renderToStaticMarkup(
      createElement(ServerSettingsDialog, {
        open: true,
        profile: null,
        onClose: vi.fn(),
      }),
    );

    expect(markup).toContain('placeholder="http://localhost:4800" disabled=""');
    expect(markup).toContain(
      "Unavailable on Android Chrome: text entry is disabled",
    );
    expect(markup).toContain(">Cancel</button>");
  });

  it("clears the old profile token when saving a changed server URL", async () => {
    const profile = {
      id: "profile-a",
      name: "Old Server",
      url: "http://old.test",
      authType: "basic" as const,
      username: "user",
      createdAt: 1,
    };
    saveProfiles([profile]);
    setActiveProfile(profile.id);
    setAuthToken("old-token", profile.id);
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => ({
        ok: true,
        status: 200,
        json: async () => ({ token: "old-token" }),
      })),
    );

    const container = document.createElement("div");
    document.body.append(container);
    root = createRoot(container);
    await act(async () => {
      root?.render(
        createElement(ServerSettingsDialog, {
          open: true,
          profile,
          onClose: vi.fn(),
        }),
      );
    });

    const urlInput = document.querySelector<HTMLInputElement>(
      'input[placeholder="http://localhost:4800"]',
    );
    const passwordInput = document.querySelector<HTMLInputElement>(
      'input[type="password"]',
    );
    const testButton = [...document.querySelectorAll("button")].find(
      (button) => button.textContent === "Test connection",
    );
    expect(urlInput).not.toBeNull();
    expect(passwordInput).not.toBeNull();
    expect(testButton).not.toBeNull();

    await act(async () => {
      setInputValue(passwordInput!, "password");
      testButton!.click();
      await Promise.resolve();
    });
    expect(document.body.textContent).toContain("Reachable");

    await act(async () => {
      setInputValue(urlInput!, "https://new.test");
      await Promise.resolve();
    });
    const replacementTestButton = [...document.querySelectorAll("button")].find(
      (button) => button.textContent === "Test connection",
    );
    await act(async () => {
      replacementTestButton!.click();
      await Promise.resolve();
    });

    vi.useFakeTimers();
    const saveButton = [...document.querySelectorAll("button")].find(
      (button) => button.textContent === "Save profile",
    );
    expect(saveButton).not.toBeNull();
    await act(async () => saveButton!.click());

    expect(getAuthToken(profile.id)).toBeNull();
  });
});
