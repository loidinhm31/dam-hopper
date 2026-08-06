import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { page, userEvent } from "vitest/browser";
import { MobileTerminalAccessoryBar } from "@/components/organisms/MobileTerminalAccessoryBar.js";
import "@/index.css";

vi.mock("@/contexts/AndroidChromeInputPolicyContext.js", () => ({
  useAndroidChromeInputPolicy: () => ({
    isAndroidChromeNativeInputSuppressed: false,
  }),
}));

vi.mock("@/stores/settings.js", () => ({
  useSettingsStore: (
    selector: (state: { mobileCustomKeyboardEnabled: boolean }) => unknown,
  ) => selector({ mobileCustomKeyboardEnabled: false }),
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
  MobileTerminalSpecialKeys: () => <div data-testid="special-keys" />,
}));

(
  globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;

describe("mobile terminal accessory bar in Chromium", () => {
  let container: HTMLDivElement;
  let root: Root;

  beforeEach(async () => {
    container = document.createElement("div");
    document.body.append(container);
    root = createRoot(container);
    await act(async () =>
      root.render(<MobileTerminalAccessoryBar sessionId="session-1" />),
    );
  });

  afterEach(async () => {
    await act(async () => root.unmount());
    container.remove();
    document.body.innerHTML = "";
  });

  it("keeps the key and keyboard controls tiny and aligned to the terminal edge", async () => {
    await page.viewport(375, 700);

    const controls = page.getByTestId("mobile-terminal-accessory-controls");
    await expect(controls).toBeVisible();
    await expect(controls).toHaveClass(/justify-end/);
    await expect(controls).toHaveClass(/gap-0\.5/);

    const keyButton = page.getByRole("button", { name: "Show terminal keys" });
    const keyboardButton = page.getByRole("button", {
      name: "Open mobile keyboard",
    });
    await expect(keyButton).toBeVisible();
    await expect(keyboardButton).toBeVisible();
    await expect(keyButton).toHaveClass(/h-9/);
    await expect(keyButton).toHaveClass(/w-9/);
    await expect(keyboardButton).toHaveClass(/h-9/);
    await expect(keyboardButton).toHaveClass(/w-9/);

    await userEvent.click(keyButton);
    await expect(
      page.getByRole("button", { name: "Hide terminal keys" }),
    ).toBeVisible();

    await userEvent.click(keyboardButton);
    await expect(page.getByTestId("native-keyboard")).toBeVisible();
  });
});
