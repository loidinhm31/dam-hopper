// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { AppLauncher } from "./AppLauncher.js";
import { useWindowStore } from "./window-store.js";
import { createDefaultOsSession, openWindow } from "./window-ops.js";
import * as dockPins from "./dock-pins.js";
import * as actionExecutor from "./action-executor.js";

function clickElement(el: HTMLElement) {
  act(() => {
    el.dispatchEvent(
      new MouseEvent("click", {
        bubbles: true,
        cancelable: true,
      }),
    );
  });
}

describe("AppLauncher", () => {
  let container: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    localStorage.clear();
    dockPins._reloadDockPinsFromStorageForTesting();
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);

    const session = createDefaultOsSession("d1", "Main");
    useWindowStore.setState({ session });
  });

  afterEach(() => {
    act(() => {
      root.unmount();
    });
    container.remove();
    vi.restoreAllMocks();
  });

  it("does not render when isOpen is false", () => {
    act(() => {
      root.render(<AppLauncher isOpen={false} onClose={() => {}} />);
    });
    expect(container.querySelector("[data-testid='app-launcher-panel']")).toBeNull();
  });

  it("renders when isOpen is true and displays all 17 apps", () => {
    act(() => {
      root.render(<AppLauncher isOpen={true} onClose={() => {}} />);
    });

    const panel = container.querySelector(
      "[data-testid='app-launcher-panel']",
    ) as HTMLElement;
    expect(panel).not.toBeNull();

    // 17 apps in manifest
    const cards = container.querySelectorAll("[data-testid^='app-card-']");
    expect(cards.length).toBe(17);
  });

  it("filters apps by search input", () => {
    act(() => {
      root.render(<AppLauncher isOpen={true} onClose={() => {}} />);
    });

    const input = container.querySelector(
      "[data-testid='app-launcher-search']",
    ) as HTMLInputElement;
    expect(input).not.toBeNull();
    act(() => {
      const valueSetter = Object.getOwnPropertyDescriptor(
        window.HTMLInputElement.prototype,
        "value",
      )?.set;
      valueSetter?.call(input, "terminal");
      input.dispatchEvent(new Event("input", { bubbles: true }));
      input.dispatchEvent(new Event("change", { bubbles: true }));
    });

    const cards = container.querySelectorAll("[data-testid^='app-card-']");
    expect(cards.length).toBe(1);
    expect(container.querySelector("[data-testid='app-card-terminals']")).not.toBeNull();
  });

  it("launches app and closes launcher when app card is clicked", () => {
    const onLaunchMock = vi.fn();
    const onCloseMock = vi.fn();

    act(() => {
      root.render(
        <AppLauncher
          isOpen={true}
          onClose={onCloseMock}
          onLaunchApp={onLaunchMock}
        />,
      );
    });

    const card = container.querySelector(
      "[data-testid='app-card-editor']",
    ) as HTMLElement;
    clickElement(card);

    expect(onLaunchMock).toHaveBeenCalledWith("editor");
    expect(onCloseMock).toHaveBeenCalled();
  });

  it("executes action via action-executor when no onLaunchApp prop is provided", () => {
    const executeSpy = vi
      .spyOn(actionExecutor, "executeAction")
      .mockResolvedValue({ kind: "executed" });
    const onCloseMock = vi.fn();

    act(() => {
      root.render(<AppLauncher isOpen={true} onClose={onCloseMock} />);
    });

    const card = container.querySelector(
      "[data-testid='app-card-settings']",
    ) as HTMLElement;
    clickElement(card);

    expect(executeSpy).toHaveBeenCalledWith(
      expect.objectContaining({
        id: "app.settings.open",
        context: expect.objectContaining({
          kind: "desktop",
          desktopId: "d1",
        }),
      }),
    );
    expect(onCloseMock).toHaveBeenCalled();
  });

  it("pins/unpins unopened app directly without launching the app", () => {
    const toggleSpy = vi.spyOn(dockPins, "toggleDockPin");
    const onLaunchMock = vi.fn();

    act(() => {
      root.render(
        <AppLauncher
          isOpen={true}
          onClose={() => {}}
          onLaunchApp={onLaunchMock}
        />,
      );
    });

    // Pin recipes (which is unopened and unpinned by default)
    const pinBtn = container.querySelector(
      "[data-testid='app-pin-btn-recipes']",
    ) as HTMLElement;
    expect(pinBtn).not.toBeNull();
    clickElement(pinBtn);

    expect(toggleSpy).toHaveBeenCalledWith("recipes");
    expect(onLaunchMock).not.toHaveBeenCalled();
  });

  it("closes when Escape key is pressed", () => {
    const onCloseMock = vi.fn();

    act(() => {
      root.render(<AppLauncher isOpen={true} onClose={onCloseMock} />);
    });

    act(() => {
      window.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
    });

    expect(onCloseMock).toHaveBeenCalled();
  });

  it("closes when clicking on backdrop", () => {
    const onCloseMock = vi.fn();

    act(() => {
      root.render(<AppLauncher isOpen={true} onClose={onCloseMock} />);
    });

    const backdrop = container.querySelector(
      "[data-testid='app-launcher-backdrop']",
    ) as HTMLElement;
    clickElement(backdrop);

    expect(onCloseMock).toHaveBeenCalled();
  });

  it("shows running indicators on apps with active windows", () => {
    let session = useWindowStore.getState().session;
    session = openWindow(session, {
      id: "term-1",
      appId: "terminals",
      title: "Bash",
      ctx: { profileId: "p1" },
      mode: "tile",
    });
    useWindowStore.setState({ session });

    act(() => {
      root.render(<AppLauncher isOpen={true} onClose={() => {}} />);
    });

    const termCard = container.querySelector(
      "[data-testid='app-card-terminals']",
    ) as HTMLElement;
    expect(termCard.querySelector("[title='Running']")).not.toBeNull();

    const editorCard = container.querySelector(
      "[data-testid='app-card-editor']",
    ) as HTMLElement;
    expect(editorCard.querySelector("[title='Running']")).toBeNull();
  });
});
