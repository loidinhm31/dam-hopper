import * as React from "react";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { userEvent } from "vitest/browser";
import type { DamHopperConfig } from "@/api/client.js";
import { ConfigEditor } from "@/components/organisms/ConfigEditor.js";
import "@/index.css";

Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });

describe("ConfigEditor reorder and focus retention in Chromium", () => {
  let root: Root | null = null;
  let container: HTMLDivElement | null = null;

  beforeEach(() => {
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
  });

  afterEach(async () => {
    if (root) {
      await act(async () => {
        root.unmount();
      });
      root = null;
    }
    if (container) {
      container.remove();
      container = null;
    }
  });

  it("preserves focus, DOM node, and expanded state in Chromium when projects sharing identical paths are reordered", async () => {
    const configV1: DamHopperConfig = {
      workspace: { name: "demo-ws", root: "/tmp" },
      projects: [
        { name: "api", path: ".", type: "custom" },
        { name: "web", path: ".", type: "custom" },
      ],
    };

    const configV2: DamHopperConfig = {
      workspace: { name: "demo-ws", root: "/tmp" },
      projects: [
        { name: "web", path: ".", type: "custom" },
        { name: "api", path: ".", type: "custom" },
      ],
    };

    let setExternalConfig!: (cfg: DamHopperConfig) => void;

    function Harness() {
      const [cfg, setCfg] = React.useState(configV1);
      setExternalConfig = setCfg;
      return <ConfigEditor config={cfg} onSave={vi.fn(async () => undefined)} />;
    }

    await act(async () => {
      root!.render(<Harness />);
    });

    // Expand project 'api'
    const apiButton = Array.from(container!.querySelectorAll("button")).find((b) =>
      b.textContent?.includes("api"),
    );
    expect(apiButton).toBeDefined();
    await userEvent.click(apiButton!);

    // Locate 'api' name input and focus it
    const inputsBefore = Array.from(container!.querySelectorAll("input"));
    const apiNameInput = inputsBefore.find((inp) => inp.value === "api");
    expect(apiNameInput).toBeDefined();

    await userEvent.click(apiNameInput!);
    expect(document.activeElement).toBe(apiNameInput);

    // Apply external reorder (web first, then api)
    await act(async () => {
      setExternalConfig(configV2);
      await Promise.resolve();
    });

    // Verify project headers reflect new order in DOM
    const projectHeadersAfter = Array.from(
      container!.querySelectorAll("button"),
    ).filter((b) => b.textContent?.includes("web") || b.textContent?.includes("api"));
    expect(projectHeadersAfter[0]?.textContent).toContain("web");
    expect(projectHeadersAfter[1]?.textContent).toContain("api");

    // Verify 'api' project form is still expanded and input is the exact same DOM node
    const inputsAfter = Array.from(container!.querySelectorAll("input"));
    const apiNameInputAfter = inputsAfter.find(
      (inp) => inp.value === "api" || inp.value === "api-service",
    );
    expect(apiNameInputAfter).toBe(apiNameInput);
    expect(document.activeElement).toBe(apiNameInput);
  });

  it("preserves existing project focus and DOM identity in Chromium when inserting a new project before them", async () => {
    const configV1: DamHopperConfig = {
      workspace: { name: "demo-ws", root: "/tmp" },
      projects: [
        { name: "api", path: ".", type: "custom" },
        { name: "web", path: ".", type: "custom" },
      ],
    };

    const configV2: DamHopperConfig = {
      workspace: { name: "demo-ws", root: "/tmp" },
      projects: [
        { name: "mobile", path: ".", type: "custom" },
        { name: "api", path: ".", type: "custom" },
        { name: "web", path: ".", type: "custom" },
      ],
    };

    let setExternalConfig!: (cfg: DamHopperConfig) => void;

    function Harness() {
      const [cfg, setCfg] = React.useState(configV1);
      setExternalConfig = setCfg;
      return <ConfigEditor config={cfg} onSave={vi.fn(async () => undefined)} />;
    }

    await act(async () => {
      root!.render(<Harness />);
    });

    // Expand project 'api'
    const apiButton = Array.from(container!.querySelectorAll("button")).find((b) =>
      b.textContent?.includes("api"),
    );
    expect(apiButton).toBeDefined();
    await userEvent.click(apiButton!);

    // Locate 'api' path input and focus it
    const inputsBefore = Array.from(container!.querySelectorAll("input"));
    const apiPathInput = inputsBefore.find((inp) => inp.value === ".");
    expect(apiPathInput).toBeDefined();

    await userEvent.click(apiPathInput!);
    expect(document.activeElement).toBe(apiPathInput);

    // Apply external config with insertion of 'mobile' before 'api'
    await act(async () => {
      setExternalConfig(configV2);
      await Promise.resolve();
    });

    // Verify headers reflect: mobile, api, web
    const projectHeadersAfter = Array.from(
      container!.querySelectorAll("button"),
    ).filter(
      (b) =>
        b.textContent?.includes("mobile") ||
        b.textContent?.includes("api") ||
        b.textContent?.includes("web"),
    );
    expect(projectHeadersAfter[0]?.textContent).toContain("mobile");
    expect(projectHeadersAfter[1]?.textContent).toContain("api");
    expect(projectHeadersAfter[2]?.textContent).toContain("web");

    // 'api' path input remains the exact same DOM node and activeElement
    expect(document.activeElement).toBe(apiPathInput);
  });
});
