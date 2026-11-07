// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useWindowStore } from "@/os/window-store.js";
import { HubTerminalClaimPlaceholder } from "./HubTerminalClaimPlaceholder.js";

describe("HubTerminalClaimPlaceholder", () => {
  let container: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
  });

  afterEach(() => {
    act(() => {
      root.unmount();
    });
    container.remove();
    document.body.innerHTML = "";
  });

  it("renders unresolved message without Go-to button", () => {
    act(() => {
      root.render(
        <HubTerminalClaimPlaceholder
          reason="unresolved"
          sessionLabel="Test Session"
        />,
      );
    });

    expect(container.textContent).toContain("Terminal session unresolved");
    expect(container.textContent).toContain('Session "Test Session" is not currently available');
    expect(container.querySelector("button")).toBeNull();
  });

  it("renders claimed-elsewhere with Go-to button that invokes revealWindow", () => {
    const revealSpy = vi.spyOn(useWindowStore.getState(), "revealWindow").mockImplementation(() => {});

    act(() => {
      root.render(
        <HubTerminalClaimPlaceholder
          reason="claimed-elsewhere"
          holderWindowId="win-42"
          sessionLabel="Demo Tab"
        />,
      );
    });

    expect(container.textContent).toContain("Terminal open in another window");
    expect(container.textContent).toContain('Session "Demo Tab" is currently active');
    const button = container.querySelector("button");
    expect(button).not.toBeNull();
    expect(button?.textContent).toContain("Go to window");

    act(() => {
      button?.click();
    });

    expect(revealSpy).toHaveBeenCalledWith("win-42");
    revealSpy.mockRestore();
  });

  it("renders legacy-presenter with Go-to button", () => {
    const revealSpy = vi.spyOn(useWindowStore.getState(), "revealWindow").mockImplementation(() => {});

    act(() => {
      root.render(
        <HubTerminalClaimPlaceholder
          reason="legacy-presenter"
          holderWindowId="win-standalone"
        />,
      );
    });

    expect(container.textContent).toContain("Terminal open in another window");
    const button = container.querySelector("button");
    expect(button).not.toBeNull();

    act(() => {
      button?.click();
    });

    expect(revealSpy).toHaveBeenCalledWith("win-standalone");
    revealSpy.mockRestore();
  });
});
