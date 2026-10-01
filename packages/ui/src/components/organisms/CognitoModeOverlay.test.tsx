// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { CognitoModeOverlay } from "./CognitoModeOverlay.js";
import { useCognitoModeStore } from "@/stores/cognito-mode.js";
import { useSettingsStore } from "@/stores/settings.js";

describe("CognitoModeOverlay", () => {
  let root: Root | null = null;
  let container: HTMLDivElement | null = null;

  beforeEach(() => {
    useCognitoModeStore.getState().reset();
    useSettingsStore.setState({
      cognitoModeStyle: "heavy-blur",
      cognitoModeShortcut: "Mod+Alt+KeyB",
    });
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
  });

  afterEach(async () => {
    if (root) {
      await act(async () => {
        root?.unmount();
      });
    }
    container?.remove();
    root = null;
    container = null;
    useCognitoModeStore.getState().reset();
    // Clean up any remaining overlays in body
    document
      .querySelectorAll("[data-cognito-mode-overlay]")
      .forEach((el) => el.remove());
  });

  it("renders null into body when inactive", async () => {
    await act(async () => {
      root?.render(<CognitoModeOverlay />);
    });

    const overlay = document.querySelector("[data-cognito-mode-overlay]");
    expect(overlay).toBeNull();
  });

  it("renders into document.body when active with heavy-blur style by default", async () => {
    useCognitoModeStore.getState().toggle("Mod+Alt+KeyB");

    await act(async () => {
      root?.render(<CognitoModeOverlay />);
    });

    const overlay = document.querySelector<HTMLElement>(
      "[data-cognito-mode-overlay]",
    );
    expect(overlay).not.toBeNull();
    expect(overlay?.parentElement).toBe(document.body);
    expect(overlay?.className).toContain("cognito-mode-overlay");
    expect(overlay?.className).toContain("cognito-mode-overlay--heavy-blur");
    expect(overlay?.tabIndex).toBe(-1);
    expect(overlay?.getAttribute("role")).toBe("region");
  });

  it("applies black-screen style when configured in settings", async () => {
    useSettingsStore.setState({ cognitoModeStyle: "black-screen" });
    useCognitoModeStore.getState().toggle("Mod+Alt+KeyB");

    await act(async () => {
      root?.render(<CognitoModeOverlay />);
    });

    const overlay = document.querySelector<HTMLElement>(
      "[data-cognito-mode-overlay]",
    );
    expect(overlay).not.toBeNull();
    expect(overlay?.className).toContain("cognito-mode-overlay--black-screen");
    expect(overlay?.className).not.toContain(
      "cognito-mode-overlay--heavy-blur",
    );
  });

  it("contains screen-reader-only accessible description with formatted shortcut", async () => {
    useCognitoModeStore.getState().toggle("Mod+Alt+KeyB");

    await act(async () => {
      root?.render(<CognitoModeOverlay />);
    });

    const overlay = document.querySelector<HTMLElement>(
      "[data-cognito-mode-overlay]",
    );
    const srOnly = overlay?.querySelector(".sr-only");
    expect(srOnly).not.toBeNull();
    expect(srOnly?.textContent).toContain("Cognito privacy mode is active");
    expect(srOnly?.textContent).toContain("dismiss");
  });

  it("focuses the overlay focus sink on mount when active", async () => {
    useCognitoModeStore.getState().toggle("Mod+Alt+KeyB");

    await act(async () => {
      root?.render(<CognitoModeOverlay />);
    });

    const overlay = document.querySelector<HTMLElement>(
      "[data-cognito-mode-overlay]",
    );
    expect(document.activeElement).toBe(overlay);
  });

  it("removes the overlay from document.body on deactivation", async () => {
    useCognitoModeStore.getState().toggle("Mod+Alt+KeyB");

    await act(async () => {
      root?.render(<CognitoModeOverlay />);
    });

    expect(
      document.querySelector("[data-cognito-mode-overlay]"),
    ).not.toBeNull();

    await act(async () => {
      useCognitoModeStore.getState().toggle("Mod+Alt+KeyB");
    });

    expect(document.querySelector("[data-cognito-mode-overlay]")).toBeNull();
  });

  it("removes the overlay from document.body on unmount", async () => {
    useCognitoModeStore.getState().toggle("Mod+Alt+KeyB");

    await act(async () => {
      root?.render(<CognitoModeOverlay />);
    });

    expect(
      document.querySelector("[data-cognito-mode-overlay]"),
    ).not.toBeNull();

    await act(async () => {
      root?.unmount();
      root = null;
    });

    expect(document.querySelector("[data-cognito-mode-overlay]")).toBeNull();
  });
});
