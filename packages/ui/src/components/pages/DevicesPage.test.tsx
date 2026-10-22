// @vitest-environment jsdom

import { createElement, act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { MemoryRouter } from "react-router-dom";
import type * as ServerConfigModule from "@/api/server-config.js";
import { DevicesPage } from "./DevicesPage.js";

vi.mock("@/components/templates/AppLayout.js", () => ({
  AppLayout: ({ children, title }: { children: React.ReactNode; title?: string }) => (
    <div data-testid="app-layout" data-title={title}>
      {children}
    </div>
  ),
}));

vi.mock("@/components/organisms/LoginDevicesSection.js", () => ({
  LoginDevicesSection: ({ profileId, variant }: { profileId?: string | null; variant?: string }) => (
    <div data-testid="login-devices-section" data-profile-id={profileId ?? ""} data-variant={variant ?? ""}>
      Mock Devices Section
    </div>
  ),
}));

vi.mock("@/api/server-config.js", async (importOriginal) => {
  const actual = await importOriginal<typeof ServerConfigModule>();
  return {
    ...actual,
    readServerProfiles: vi.fn(() => ({
      status: "available",
      profiles: [
        { id: "p1", name: "Server One", url: "http://localhost:4801", authType: "basic", createdAt: 1, autoConnect: true },
        { id: "p2", name: "Server Two", url: "http://localhost:4802", authType: "basic", createdAt: 2, autoConnect: true },
      ],
    })),
    getActiveProfileId: vi.fn(() => "p1"),
  };
});

describe("DevicesPage", () => {
  let container: HTMLDivElement;
  let root: Root | null = null;

  beforeEach(() => {
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
  });

  afterEach(() => {
    if (root) {
      act(() => {
        root?.unmount();
      });
      root = null;
    }
    container.remove();
    vi.clearAllMocks();
  });

  it("renders page layout and login devices section with active profile", async () => {
    await act(async () => {
      root?.render(
        createElement(MemoryRouter, null, createElement(DevicesPage)),
      );
    });

    const layout = container.querySelector('[data-testid="app-layout"]');
    expect(layout?.getAttribute("data-title")).toBe("Devices");

    const section = container.querySelector('[data-testid="login-devices-section"]');
    expect(section).toBeTruthy();
    expect(section?.getAttribute("data-profile-id")).toBe("p1");
    expect(section?.getAttribute("data-variant")).toBe("page");
  });

  it("allows switching server profile", async () => {
    await act(async () => {
      root?.render(
        createElement(MemoryRouter, null, createElement(DevicesPage)),
      );
    });

    const select = container.querySelector<HTMLSelectElement>("#devices-server-select");
    expect(select).toBeTruthy();
    expect(select?.value).toBe("p1");

    await act(async () => {
      if (select) {
        select.value = "p2";
        select.dispatchEvent(new Event("change", { bubbles: true }));
      }
    });

    const section = container.querySelector('[data-testid="login-devices-section"]');
    expect(section?.getAttribute("data-profile-id")).toBe("p2");
  });
});
