// @vitest-environment jsdom

import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  SettingsHostBrowserSection,
  type SettingsHostBrowserSectionProps,
} from "./SettingsHostBrowserSection.js";
import type { DamHopperConfig } from "@/api/client.js";
import type { BrowserHostLiveStatus } from "@/api/browser-host-live-status.js";

const refetch = vi.fn();
let liveData: BrowserHostLiveStatus | undefined;
let liveError: Error | null = null;
vi.mock("@/api/browser-host-live-status.js", () => ({
  useBrowserHostLiveStatus: () => ({
    data: liveData,
    isError: liveError !== null,
    isFetching: false,
    error: liveError,
    refetch,
  }),
}));

const OWNER_A = { profileId: "profile-a", generation: 1 };
const OWNER_B = { profileId: "profile-b", generation: 1 };

function makeConfig(browser?: Record<string, unknown>): DamHopperConfig {
  return {
    workspace: { name: "ws", root: "." },
    projects: [],
    extraTop: { keep: true },
    server: {
      sessionChangesEnabled: true,
      sessionDbPath: "custom.db",
      ...(browser ? { browser } : {}),
    },
  };
}

function setValue(el: HTMLInputElement | HTMLTextAreaElement, value: string) {
  const proto =
    el instanceof HTMLTextAreaElement
      ? HTMLTextAreaElement.prototype
      : HTMLInputElement.prototype;
  Object.getOwnPropertyDescriptor(proto, "value")!.set!.call(el, value);
  el.dispatchEvent(new Event("input", { bubbles: true }));
}

describe("SettingsHostBrowserSection", () => {
  let container: HTMLDivElement;
  let root: Root;
  const updateConfig = vi.fn();

  const q = <T extends Element>(sel: string) =>
    container.querySelector<T>(sel) as T;
  const exec = () => q<HTMLInputElement>("#host-browser-executable");
  const profileRoot = () => q<HTMLInputElement>("#host-browser-profile-root");
  const origins = () => q<HTMLTextAreaElement>("#host-browser-origins");
  const save = () => q<HTMLButtonElement>('[data-testid="host-browser-save"]');
  const toggle = () =>
    q<HTMLButtonElement>('button[aria-label="Enable Host Browser"]');
  const txt = (id: string) =>
    container.querySelector(`[data-testid="${id}"]`)?.textContent ?? null;

  function render(
    config: DamHopperConfig | undefined,
    props: Partial<SettingsHostBrowserSectionProps> = {},
  ) {
    act(() => {
      root.render(
        <SettingsHostBrowserSection
          config={config}
          isLoading={false}
          owner={OWNER_A}
          targetReady
          updateConfig={updateConfig}
          isSaving={false}
          {...props}
        />,
      );
    });
  }

  beforeEach(() => {
    liveData = undefined;
    liveError = null;
    refetch.mockReset();
    updateConfig.mockReset();
    updateConfig.mockResolvedValue(undefined);
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
  });

  afterEach(() => {
    act(() => root.unmount());
    container.remove();
  });

  it("renders current values from config", () => {
    render(
      makeConfig({
        enabled: true,
        executablePath: "/usr/bin/chromium",
        profileRoot: "/srv/profiles",
        allowedTargetOrigins: ["http://127.0.0.1:5173", "http://10.0.0.5:3000"],
      }),
      { targetLabel: "Prod (https://prod.example.com)" },
    );
    expect(toggle().getAttribute("aria-checked")).toBe("true");
    expect(exec().value).toBe("/usr/bin/chromium");
    expect(profileRoot().value).toBe("/srv/profiles");
    expect(origins().value).toBe("http://127.0.0.1:5173\nhttp://10.0.0.5:3000");
    expect(container.textContent).toContain(
      "Target Server: Prod (https://prod.example.com)",
    );
    expect(save().disabled).toBe(true); // unchanged
  });

  it("defaults to disabled with empty fields when no browser table exists", () => {
    render(makeConfig());
    expect(toggle().getAttribute("aria-checked")).toBe("false");
    expect(exec().value).toBe("");
    expect(profileRoot().placeholder).toContain("browser-profiles");
  });

  it("requires an executable path to enable", () => {
    render(makeConfig());
    act(() => toggle().click());
    expect(toggle().getAttribute("aria-checked")).toBe("true");
    expect(save().disabled).toBe(true);
    expect(exec().getAttribute("aria-invalid")).toBe("true");
    expect(container.textContent).toContain("Required to enable.");

    act(() => setValue(exec(), "/usr/bin/chromium"));
    expect(save().disabled).toBe(false);
  });

  it("saves a PUT body that preserves untouched browser and server keys", async () => {
    const budgets = { maxProcesses: 3, maxWidth: 1280 };
    const config = makeConfig({
      enabled: false,
      budgets,
      deniedDestinations: ["10.9.9.9"],
      allowedAssetOrigins: ["https://cdn.example.com"],
      allowedDevOrigins: ["http://localhost:3000"],
    });
    render(config);
    act(() => toggle().click());
    act(() => setValue(exec(), "  /usr/bin/chromium  "));
    await act(async () => save().click());

    expect(updateConfig).toHaveBeenCalledTimes(1);
    const body = updateConfig.mock.calls[0][0] as DamHopperConfig;
    expect(body.extraTop).toEqual({ keep: true });
    expect(body.server).toEqual({
      sessionChangesEnabled: true,
      sessionDbPath: "custom.db",
      browser: {
        enabled: true,
        executablePath: "/usr/bin/chromium",
        budgets,
        deniedDestinations: ["10.9.9.9"],
        allowedAssetOrigins: ["https://cdn.example.com"],
        allowedDevOrigins: ["http://localhost:3000"],
      },
    });
    // profileRoot stays omitted when empty
    expect("profileRoot" in (body.server!.browser as object)).toBe(false);
    // input config must not be mutated
    expect(config.server!.browser).toMatchObject({ enabled: false });
    expect("executablePath" in config.server!.browser!).toBe(false);
  });

  it("parses origins one per line, trimmed, dropping blank lines", async () => {
    render(makeConfig({ enabled: true, executablePath: "/usr/bin/chromium" }));
    act(() =>
      setValue(
        origins(),
        "  http://127.0.0.1:5173  \n\n\r\nhttp://192.168.1.10:8080\n   \n",
      ),
    );
    await act(async () => save().click());
    const body = updateConfig.mock.calls[0][0] as DamHopperConfig;
    expect(body.server!.browser!.allowedTargetOrigins).toEqual([
      "http://127.0.0.1:5173",
      "http://192.168.1.10:8080",
    ]);
  });

  it("sends profileRoot when set and drops it when cleared", async () => {
    render(
      makeConfig({
        enabled: true,
        executablePath: "/usr/bin/chromium",
        profileRoot: "/old",
      }),
    );
    act(() => setValue(profileRoot(), ""));
    await act(async () => save().click());
    const body = updateConfig.mock.calls[0][0] as DamHopperConfig;
    expect("profileRoot" in body.server!.browser!).toBe(false);
  });

  it("shows the server validation error verbatim and no restart notice", async () => {
    const msg =
      "server.browser.executable_path: browser executable unavailable: /nonexistent is not a file";
    updateConfig.mockRejectedValueOnce(new Error(msg));
    render(makeConfig());
    act(() => toggle().click());
    act(() => setValue(exec(), "/nonexistent"));
    await act(async () => save().click());
    expect(txt("host-browser-error")).toBe(msg);
    expect(txt("host-browser-restart-notice")).toBeNull();
    expect(save().disabled).toBe(false); // can retry
  });

  it("shows the restart notice after a successful save", async () => {
    render(makeConfig());
    act(() => toggle().click());
    act(() => setValue(exec(), "/usr/bin/chromium"));
    await act(async () => save().click());
    expect(txt("host-browser-restart-notice")).toBe(
      "Saved. Restart the server to apply.",
    );
    expect(txt("host-browser-error")).toBeNull();
    expect(refetch).toHaveBeenCalled();
  });

  it("reports restart pending when saved enabled but live host is unavailable", () => {
    liveData = {
      available: false,
      unavailableReason: "browser host disabled in configuration",
    };
    render(makeConfig({ enabled: true, executablePath: "/usr/bin/chromium" }));
    expect(txt("host-browser-live-status")).toContain(
      "Enabled in the saved config but not running yet. Restart the server to apply.",
    );
  });

  it("surfaces other live unavailable reasons and running state honestly", () => {
    liveData = { available: false, unavailableReason: "unsafe executable permissions: x" };
    render(makeConfig({ enabled: true, executablePath: "/x" }));
    expect(txt("host-browser-live-status")).toContain(
      "Not available: unsafe executable permissions: x",
    );

    liveData = { available: true };
    render(makeConfig({ enabled: true, executablePath: "/x" }));
    expect(txt("host-browser-live-status")).toContain("Running and available.");

    render(makeConfig({ enabled: false }));
    expect(txt("host-browser-live-status")).toContain(
      "Running now, but the saved config disables it. Restart the server",
    );
  });

  it("never shows cached 'Running and available' once the capabilities query errors", () => {
    liveData = { available: true }; // stale data retained by react-query after a failed refetch
    liveError = new Error("capabilities request failed");
    render(makeConfig({ enabled: true, executablePath: "/x" }));
    expect(txt("host-browser-live-status")).toContain("unavailable (capabilities request failed)");
    expect(txt("host-browser-live-status")).not.toContain("Running and available.");
  });

  it("never shows cached 'Running and available' while the target server is not connected", () => {
    liveData = { available: true };
    render(makeConfig({ enabled: true, executablePath: "/x" }), { targetReady: false });
    expect(txt("host-browser-live-status")).toContain("unavailable (target server not connected)");
    expect(txt("host-browser-live-status")).not.toContain("Running and available.");
  });

  it("ignores save results after the target server changed", async () => {
    const { promise, reject: rejectSave } = Promise.withResolvers<void>();
    updateConfig.mockReturnValueOnce(promise);
    render(makeConfig());
    act(() => toggle().click());
    act(() => setValue(exec(), "/usr/bin/chromium"));
    await act(async () => save().click());

    render(makeConfig(), { owner: OWNER_B }); // user switched target server
    await act(async () => rejectSave(new Error("late failure from server A")));

    expect(txt("host-browser-error")).toBeNull();
    expect(txt("host-browser-restart-notice")).toBeNull();
  });

  it("disables editing while config loads or the target is not ready", () => {
    render(undefined, { isLoading: true });
    expect(exec().disabled).toBe(true);
    expect(toggle().disabled).toBe(true);
    render(makeConfig(), { targetReady: false });
    expect(exec().disabled).toBe(true);
    expect(save().disabled).toBe(true);
  });
});
