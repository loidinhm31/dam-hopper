import * as React from "react";
import { act } from "react";
import { createRoot } from "react-dom/client";
import type { Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { useCognitoModeStore } from "@/stores/cognito-mode.js";
import { useSettingsStore } from "@/stores/settings.js";
import { CognitoModeOverlay } from "@/components/organisms/CognitoModeOverlay.js";
import "@/index.css";

Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });

describe("E2E: Privacy Heavy Blur Full-Screen Visual Mask", () => {
  let container: HTMLDivElement | null = null;
  let root: Root | null = null;

  beforeEach(() => {
    container = document.createElement("div");
    container.style.width = "100vw";
    container.style.height = "100vh";
    container.style.position = "relative";
    container.style.backgroundColor = "#0D1117";
    document.body.appendChild(container);
    root = createRoot(container);

    useSettingsStore.setState({
      cognitoModeStyle: "heavy-blur",
      cognitoModeShortcut: "Mod+Alt+KeyB",
    });
    useCognitoModeStore.getState().reset();
  });

  afterEach(() => {
    if (root) {
      act(() => {
        root?.unmount();
      });
      root = null;
    }
    if (container) {
      container.remove();
      container = null;
    }
    document.querySelectorAll("[data-cognito-mode-overlay]").forEach((el) => el.remove());
    useCognitoModeStore.getState().reset();
  });

  it("activates heavy blur privacy overlay, covers full viewport, and applies frosted styling", async () => {
    await act(async () => {
      root?.render(
        <div className="flex h-screen w-screen flex-col bg-[#0D1117] text-[#F1F5F9]">
          <CognitoModeOverlay />
          <header className="flex h-12 w-full items-center justify-between border-b border-[#2A3A52] bg-[#1E293B] px-4">
            <span className="font-bold text-[#38BDF8]">Dam-Hopper E2E</span>
            <div className="flex gap-2 text-xs">
              <span className="rounded bg-[#243248] px-2 py-1">Dashboard</span>
              <span className="rounded bg-[#0D1117] px-2 py-1">Workspace</span>
            </div>
          </header>
          <div className="flex flex-1 min-h-0">
            <aside className="w-64 border-r border-[#2A3A52] bg-[#1E293B] p-4 text-xs space-y-2">
              <div className="font-semibold text-[#94A3B8]">EXPLORER</div>
              <div>src/index.ts</div>
              <div>src/privacy.ts</div>
            </aside>
            <main className="flex-1 p-6 font-mono text-sm space-y-3">
              <h1 className="text-lg font-bold text-[#F8FAFC]">Privacy Security Guard</h1>
              <p className="text-[#22C55E]">const protectedPayload = &quot;confidential_sample_viewport_data&quot;;</p>
              <p className="text-[#94A3B8]">Full application viewport verification under heavy blur.</p>
            </main>
          </div>
        </div>,
      );
    });

    await act(async () => {
      useCognitoModeStore.getState().toggle("Mod+Alt+KeyB");
    });

    const overlay = document.querySelector<HTMLElement>("[data-cognito-mode-overlay]");
    expect(overlay).not.toBeNull();
    expect(overlay?.classList.contains("cognito-mode-overlay--heavy-blur")).toBe(true);

    const computed = window.getComputedStyle(overlay!);
    expect(computed.position).toBe("fixed");
    expect(computed.zIndex).toBe("10000");
    expect(computed.backgroundColor).toBe("rgba(148, 163, 184, 0.12)");
    expect(computed.backdropFilter).toMatch(/^blur\(16px\)/);
    expect(computed.boxShadow).toContain("inset");
  });
});
