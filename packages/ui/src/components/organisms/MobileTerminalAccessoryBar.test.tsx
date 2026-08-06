// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { MobileTerminalAccessoryBar } from "./MobileTerminalAccessoryBar.js";

const mockPolicy = vi.hoisted(() => ({ enabled: false }));
const mockSettings = vi.hoisted(() => ({ customKeyboard: false }));

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
  getTransport: () => ({ terminalWrite: vi.fn() }),
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
    <button type="button" onClick={() => onPress("enter")}>
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
        ?.dispatchEvent(new Event("pointerdown", { bubbles: true }));
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
        ?.dispatchEvent(new Event("pointerdown", { bubbles: true }));
    });

    expect(
      container.querySelector("[data-testid=native-keyboard]"),
    ).not.toBeNull();
    expect(container.querySelector("[data-testid=custom-keyboard]")).toBeNull();
  });
});
