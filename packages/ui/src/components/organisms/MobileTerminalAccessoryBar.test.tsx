// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { MobileTerminalAccessoryBar } from "./MobileTerminalAccessoryBar.js";

const mockPolicy = vi.hoisted(() => ({ enabled: false }));
const mockSettings = vi.hoisted(() => ({ customKeyboard: false }));
const mockViewport = vi.hoisted(() => ({ compact: false, coarse: false }));
const mockTerminalWrite = vi.hoisted(() => vi.fn());

vi.mock("@/contexts/AndroidChromeInputPolicyContext.js", () => ({
  useAndroidChromeInputPolicy: () => ({
    isAndroidChromeNativeInputSuppressed: mockPolicy.enabled,
  }),
}));

vi.mock("@/stores/settings.js", () => ({
  useSettingsStore: (
    selector: (state: { mobileCustomKeyboardEnabled: boolean }) => unknown,
  ) => selector({ mobileCustomKeyboardEnabled: mockSettings.customKeyboard }),
}));

vi.mock("@/api/transport.js", () => ({
  getTransport: () => ({ terminalWrite: mockTerminalWrite }),
}));

vi.mock("@/hooks/use-compact-workspace.js", () => ({
  useCompactWorkspace: () => mockViewport.compact,
}));

vi.mock("@/hooks/use-coarse-pointer.js", () => ({
  useCoarsePointer: () => mockViewport.coarse,
}));

vi.mock("@/components/organisms/MobileTerminalCustomKeyboard.js", () => ({
  MobileTerminalCustomKeyboard: () => <div data-testid="custom-keyboard" />,
}));

vi.mock("@/components/organisms/MobileTerminalNativeKeyboardInput.js", () => ({
  MobileTerminalNativeKeyboardInput: () => (
    <input data-testid="native-keyboard" />
  ),
}));

vi.mock("@/components/organisms/MobileTerminalSpecialKeys.js", () => ({
  MobileTerminalSpecialKeys: ({
    onPress,
  }: {
    onPress: (id: string) => void;
  }) => (
    <button type="button" onClick={() => onPress("escape")}>
      Special
    </button>
  ),
}));

describe("MobileTerminalAccessoryBar", () => {
  let container: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
    mockPolicy.enabled = false;
    mockSettings.customKeyboard = false;
    mockViewport.compact = false;
    mockViewport.coarse = false;
    mockTerminalWrite.mockClear();
    container = document.createElement("div");
    document.body.append(container);
    root = createRoot(container);
    vi.stubGlobal("requestAnimationFrame", (callback: FrameRequestCallback) => {
      callback(0);
      return 1;
    });
  });

  afterEach(async () => {
    await act(async () => root.unmount());
    container.remove();
    vi.unstubAllGlobals();
  });

  function renderBar(): void {
    act(() => {
      root.render(<MobileTerminalAccessoryBar sessionId="session-1" />);
    });
  }

  it("forces the custom keyboard and omits native input when Android policy is active", () => {
    mockPolicy.enabled = true;
    renderBar();

    act(() => {
      container
        .querySelector<HTMLButtonElement>(
          '[aria-label="Open custom terminal keyboard"]',
        )
        ?.click();
    });

    expect(
      container.querySelector("[data-testid=custom-keyboard]"),
    ).not.toBeNull();
    expect(container.querySelector("[data-testid=native-keyboard]")).toBeNull();
  });

  it("keeps the persisted native path outside Android policy", () => {
    renderBar();

    act(() => {
      container
        .querySelector<HTMLButtonElement>('[aria-label="Open mobile keyboard"]')
        ?.click();
    });

    expect(
      container.querySelector("[data-testid=native-keyboard]"),
    ).not.toBeNull();
    expect(container.querySelector("[data-testid=custom-keyboard]")).toBeNull();
  });

  it("uses the same custom keyboard on desktop when the setting is enabled", () => {
    mockSettings.customKeyboard = true;
    renderBar();

    act(() => {
      container
        .querySelector<HTMLButtonElement>('[aria-label="Open mobile keyboard"]')
        ?.click();
    });

    expect(
      container.querySelector("[data-testid=custom-keyboard]"),
    ).not.toBeNull();
    expect(container.querySelector("[data-testid=native-keyboard]")).toBeNull();
  });

  it("uses the custom keyboard on fine-pointer desktop surfaces too", () => {
    mockSettings.customKeyboard = true;
    renderBar();

    act(() => {
      container
        .querySelector<HTMLButtonElement>('[aria-label="Open mobile keyboard"]')
        ?.click();
    });

    expect(
      container.querySelector("[data-testid=custom-keyboard]"),
    ).not.toBeNull();
    expect(container.querySelector("[data-testid=native-keyboard]")).toBeNull();
  });

  it("renders a floating control group while preserving accessible labels", () => {
    renderBar();

    const buttons = container.querySelectorAll("button");
    expect(buttons).toHaveLength(2);
    expect(
      container.querySelector('[role="group"]')?.getAttribute("aria-label"),
    ).toBe("Terminal keyboard controls");
    expect(
      container.querySelector("[data-testid=mobile-terminal-accessory-bar]")
        ?.className,
    ).toContain("pointer-events-none");
    expect(
      container.querySelector(
        "[data-testid=mobile-terminal-accessory-controls]",
      )?.className,
    ).toContain("flex-col");
    expect(
      container.querySelector(
        "[data-testid=mobile-terminal-accessory-controls]",
      )?.className,
    ).toContain("gap-0.5");
    expect(buttons[0]?.getAttribute("aria-label")).toBe("Show terminal keys");
    expect(buttons[0]?.getAttribute("aria-expanded")).toBe("false");
    expect(buttons[0]?.className).toContain("h-10");
    expect(buttons[0]?.className).toContain("w-10");
    expect(buttons[0]?.querySelector(".sr-only")?.textContent).toBe("Keys");
    expect(buttons[1]?.getAttribute("aria-expanded")).toBe("false");
    expect(buttons[1]?.className).toContain("h-10");
    expect(buttons[1]?.className).toContain("w-10");
    expect(buttons[1]?.querySelector(".sr-only")?.textContent).toBe("Kbd");
  });

  it("keeps control events out of the terminal while allowing native Type focus", async () => {
    const hostClick = vi.fn();
    await act(async () => {
      root.render(
        <div onClick={hostClick}>
          <MobileTerminalAccessoryBar sessionId="session-1" />
        </div>,
      );
    });

    const focusTarget = document.createElement("input");
    document.body.append(focusTarget);
    focusTarget.focus();

    const keysButton = container.querySelector<HTMLButtonElement>(
      '[aria-label="Show terminal keys"]',
    );
    expect(keysButton).not.toBeNull();
    const triggerPress = new MouseEvent("mousedown", {
      bubbles: true,
      cancelable: true,
    });
    keysButton?.dispatchEvent(triggerPress);
    expect(triggerPress.defaultPrevented).toBe(true);
    expect(document.activeElement).toBe(focusTarget);

    await act(async () => keysButton?.click());
    expect(
      container.querySelector('[aria-label="Hide terminal keys"]'),
    ).not.toBeNull();
    const keysButtonId = keysButton?.getAttribute("aria-controls");
    expect(keysButtonId).toBeTruthy();
    expect(document.getElementById(keysButtonId ?? "")).not.toBeNull();
    const specialButton = container.querySelector<HTMLButtonElement>(
      "button:not([aria-label])",
    );
    expect(specialButton?.textContent).toBe("Special");
    expect(
      container
        .querySelector("[data-testid=mobile-terminal-accessory-bar]")
        ?.querySelector("[data-testid=mobile-terminal-accessory-panel]"),
    ).toBeNull();
    expect(
      container.querySelector("[data-testid=mobile-terminal-accessory-panel]"),
    ).not.toBeNull();
    await act(async () => specialButton?.click());
    expect(mockTerminalWrite).toHaveBeenCalledWith("session-1", "\x1b");
    expect(hostClick).not.toHaveBeenCalled();

    await act(async () =>
      container
        .querySelector<HTMLButtonElement>('[aria-label="Hide terminal keys"]')
        ?.click(),
    );
    await act(async () =>
      container
        .querySelector<HTMLButtonElement>('[aria-label="Open mobile keyboard"]')
        ?.click(),
    );
    const nativeInput = container.querySelector<HTMLInputElement>(
      "[data-testid=native-keyboard]",
    );
    expect(nativeInput).not.toBeNull();
    const keyboardButton = container.querySelector<HTMLButtonElement>(
      '[aria-label="Open mobile keyboard"]',
    );
    const keyboardButtonId = keyboardButton?.getAttribute("aria-controls");
    expect(keyboardButtonId).toBeTruthy();
    expect(document.getElementById(keyboardButtonId ?? "")).not.toBeNull();
    const inputPress = new MouseEvent("mousedown", {
      bubbles: true,
      cancelable: true,
    });
    nativeInput?.dispatchEvent(inputPress);
    expect(inputPress.defaultPrevented).toBe(false);
    nativeInput?.focus();
    expect(document.activeElement).toBe(nativeInput);
    expect(hostClick).not.toHaveBeenCalled();

    focusTarget.remove();
  });

  it("dismisses expanded controls with Escape and restores trigger focus", async () => {
    renderBar();
    const keysButton = container.querySelector<HTMLButtonElement>(
      '[aria-label="Show terminal keys"]',
    );
    keysButton?.focus();
    await act(async () => keysButton?.click());
    expect(
      container.querySelector('[aria-label="Hide terminal keys"]'),
    ).not.toBeNull();

    const escape = new globalThis.KeyboardEvent("keydown", {
      key: "Escape",
      bubbles: true,
      cancelable: true,
    });
    await act(async () => document.dispatchEvent(escape));
    expect(escape.defaultPrevented).toBe(true);
    expect(
      container.querySelector('[aria-label="Hide terminal keys"]'),
    ).toBeNull();
    expect(document.activeElement).toBe(keysButton);
  });
});
