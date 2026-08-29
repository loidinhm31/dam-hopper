import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { page, userEvent } from "vitest/browser";
import { MobileTerminalAccessoryBar } from "@/components/organisms/MobileTerminalAccessoryBar.js";
import { TerminalRuntimeOutput } from "@/components/organisms/TerminalRuntimeOutput.js";

import "@/index.css";

vi.mock("@/contexts/AndroidChromeInputPolicyContext.js", () => ({
  useAndroidChromeInputPolicy: () => ({
    isAndroidChromeNativeInputSuppressed: false,
  }),
}));

const mockSettings = vi.hoisted(() => ({
  mobileCustomKeyboardEnabled: false,
  terminalScrollButtonsEnabled: true,
  terminalScrollStep: 3,
  mobileCustomKeyboardFontSize: 11,
  mobileCustomKeyboardPadding: 6,
  mobileCustomKeyboardRowGap: 4,
}));

const mockViewport = vi.hoisted(() => ({ compact: true, coarse: true }));

vi.mock("@/stores/settings.js", () => ({
  useSettingsStore: (selector?: (state: typeof mockSettings) => unknown) =>
    selector ? selector(mockSettings) : mockSettings,
}));

vi.mock("@/hooks/use-compact-workspace.js", () => ({
  useCompactWorkspace: () => mockViewport.compact,
}));

vi.mock("@/hooks/use-coarse-pointer.js", () => ({
  useCoarsePointer: () => mockViewport.coarse,
}));

const mockTerminalWrite = vi.hoisted(() => vi.fn());
const hostClick = vi.hoisted(() => vi.fn());
vi.mock("@/api/transport.js", () => ({
  getTransportGeneration: () => 0,
  subscribeTransportChanges: () => () => {},
  getTransport: () => ({ terminalWrite: mockTerminalWrite }),
}));

(
  globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;

describe("mobile terminal accessory bar in Chromium", () => {
  const VIEWPORTS = [
    { width: 320, height: 420 },
    { width: 375, height: 700 },
    { width: 700, height: 375 },
    { width: 1280, height: 700 },
    { width: 1440, height: 700 },
  ] as const;

  function setSafeAreaBottom(value: number): void {
    document.documentElement.style.setProperty(
      "--safe-area-bottom",
      `${value}px`,
    );
  }

  function setSafeAreaRight(value: number): void {
    document.documentElement.style.setProperty(
      "--safe-area-right",
      `${value}px`,
    );
  }

  function rect(testId: string): DOMRect | undefined {
    return document
      .querySelector<HTMLElement>(`[data-testid="${testId}"]`)
      ?.getBoundingClientRect();
  }

  function buttonRect(label: string): DOMRect | undefined {
    return document
      .querySelector<HTMLButtonElement>(`[aria-label="${label}"]`)
      ?.getBoundingClientRect();
  }

  function groupRect(label: string): DOMRect | undefined {
    return document
      .querySelector<HTMLElement>(`[role="group"][aria-label="${label}"]`)
      ?.getBoundingClientRect();
  }

  function expectInViewport(target: DOMRect | undefined): void {
    expect(target).toBeDefined();
    expect(target?.top).toBeGreaterThanOrEqual(0);
    expect(target?.left).toBeGreaterThanOrEqual(0);
    expect(target?.right).toBeLessThanOrEqual(window.innerWidth);
    expect(target?.bottom).toBeLessThanOrEqual(window.innerHeight);
  }

  function expectAtLeastBottomClearance(
    target: DOMRect | undefined,
    clearance: number,
  ): void {
    expectInViewport(target);
    expect(target?.bottom).toBeLessThanOrEqual(window.innerHeight - clearance);
  }

  let container: HTMLDivElement;
  let root: Root;

  async function renderSurface() {
    await act(async () => {
      root.render(
        <div
          data-testid="terminal-surface"
          onClick={hostClick}
          style={{
            position: "relative",
            display: "flex",
            flexDirection: "column",
            width: "100%",
            height: "100%",
          }}
        >
          <TerminalRuntimeOutput
            activeSessionId="session-1"
            mountedSessions={[]}
            renderTerminals={false}
          />
        </div>,
      );
    });
  }

  beforeEach(async () => {
    setSafeAreaBottom(0);
    setSafeAreaRight(0);
    container = document.createElement("div");
    container.style.width = "100vw";
    container.style.height = "100vh";
    document.body.append(container);
    root = createRoot(container);
    mockTerminalWrite.mockClear();
    hostClick.mockClear();
    mockSettings.mobileCustomKeyboardEnabled = false;
    mockViewport.compact = true;
    mockViewport.coarse = true;
    await renderSurface();
  });

  afterEach(async () => {
    await act(async () => root.unmount());
    container.remove();
    document.body.innerHTML = "";
    document.documentElement.style.removeProperty("--safe-area-bottom");
    document.documentElement.style.removeProperty("--safe-area-right");
  });

  it("keeps 44px controls and keyboard actions aligned with the raised terminal edge", async () => {
    await page.viewport(375, 700);

    const controls = page.getByTestId("mobile-terminal-accessory-controls");
    await expect(controls).toBeVisible();
    await expect(controls).toHaveClass(/flex-col/);
    await expect(controls).toHaveClass(/gap-1/);

    const keyButton = page.getByRole("button", { name: "Show terminal keys" });
    const keyboardButton = page.getByRole("button", {
      name: "Open mobile keyboard",
    });
    await expect(keyButton).toBeVisible();
    await expect(keyboardButton).toBeVisible();
    await expect(keyButton).toHaveClass(/h-11/);
    await expect(keyButton).toHaveClass(/w-11/);
    await expect(keyboardButton).toHaveClass(/h-11/);
    await expect(keyboardButton).toHaveClass(/w-11/);

    const surfaceHeight = document
      .querySelector<HTMLElement>('[data-testid="terminal-surface"]')
      ?.getBoundingClientRect().height;
    await userEvent.click(keyButton);
    const expandedKeys = page.getByRole("button", {
      name: "Hide terminal keys",
    });
    await expect(expandedKeys).toBeVisible();
    const keysPanelId = document
      .querySelector<HTMLButtonElement>('[aria-label="Hide terminal keys"]')
      ?.getAttribute("aria-controls");
    expect(keysPanelId).toBeTruthy();
    expect(document.getElementById(keysPanelId ?? "")).not.toBeNull();
    const escapeButton = page.getByRole("button", { name: "Send Escape" });
    await expect(escapeButton).toBeVisible();
    await expect(escapeButton).toHaveClass(/focus-visible:ring-2/);
    await expect(
      page.getByRole("group", { name: "Terminal keys" }),
    ).toBeVisible();
    expect(
      Array.from(
        document
          .querySelector<HTMLElement>(
            '[role="group"][aria-label="Terminal keys"]',
          )
          ?.querySelectorAll("button") ?? [],
      ).map((button) => button.getAttribute("aria-label")),
    ).toEqual([
      "Send Escape",
      "Send Tab",
      "Send Ctrl+C",
      "Send Enter",
      "Send Page Up",
      "Send Page Down",
      "Send Arrow Up",
      "Send Arrow Down",
      "Send Arrow Left",
      "Send Arrow Right",
    ]);
    mockTerminalWrite.mockClear();
    escapeButton.element().click();
    expect(mockTerminalWrite).toHaveBeenCalledTimes(1);
    expect(mockTerminalWrite).toHaveBeenLastCalledWith("session-1", "\x1b");
    document
      .querySelector<HTMLButtonElement>('[aria-label="Send Escape"]')
      ?.focus();
    mockTerminalWrite.mockClear();
    await userEvent.keyboard("{Enter}");
    expect(mockTerminalWrite).toHaveBeenCalledTimes(1);
    expect(mockTerminalWrite).toHaveBeenLastCalledWith("session-1", "\x1b");
    mockTerminalWrite.mockClear();
    await userEvent.keyboard(" ");
    expect(mockTerminalWrite).toHaveBeenCalledTimes(1);
    expect(mockTerminalWrite).toHaveBeenLastCalledWith("session-1", "\x1b");
    const enterButton = page.getByRole("button", { name: "Send Enter" });
    await expect(enterButton).toBeVisible();
    mockTerminalWrite.mockClear();
    await userEvent.click(enterButton);
    expect(mockTerminalWrite).toHaveBeenCalledTimes(1);
    expect(mockTerminalWrite).toHaveBeenLastCalledWith("session-1", "\r");
    document
      .querySelector<HTMLButtonElement>('[aria-label="Send Enter"]')
      ?.focus();
    mockTerminalWrite.mockClear();
    await userEvent.keyboard("{Enter}");
    expect(mockTerminalWrite).toHaveBeenCalledTimes(1);
    expect(mockTerminalWrite).toHaveBeenLastCalledWith("session-1", "\r");
    expect(
      document
        .querySelector<HTMLElement>('[data-testid="terminal-surface"]')
        ?.getBoundingClientRect().height,
    ).toBe(surfaceHeight);

    await userEvent.click(keyboardButton);
    await expect(page.getByPlaceholder("Type for terminal")).toBeVisible();
    const keyboardPanelId = document
      .querySelector<HTMLButtonElement>('[aria-label="Open mobile keyboard"]')
      ?.getAttribute("aria-controls");
    expect(keyboardPanelId).toBeTruthy();
    expect(document.getElementById(keyboardPanelId ?? "")).not.toBeNull();
    expect(document.activeElement).toBe(
      document.querySelector('input[placeholder="Type for terminal"]'),
    );
    expect(
      document
        .querySelector<HTMLElement>('[data-testid="terminal-surface"]')
        ?.getBoundingClientRect().height,
    ).toBe(surfaceHeight);
  });

  it("keeps expanded keys actions clear of floating triggers", async () => {
    const cases = [
      { width: 320, height: 420, safeRight: 0 },
      { width: 375, height: 700, safeRight: 0 },
      { width: 700, height: 375, safeRight: 0 },
      { width: 700, height: 375, safeRight: 24 },
    ];

    for (const { width, height, safeRight } of cases) {
      await page.viewport(width, height);
      setSafeAreaBottom(0);
      setSafeAreaRight(safeRight);
      await userEvent.click(
        page.getByRole("button", { name: "Show terminal keys" }),
      );

      const enterButton = page.getByRole("button", { name: "Send Enter" });
      await expect(enterButton).toBeVisible();
      const enterElement = enterButton.element() as HTMLButtonElement;
      const enterRect = enterElement.getBoundingClientRect();
      const triggerRect = buttonRect("Hide terminal keys");
      const hitTarget = document.elementFromPoint(
        enterRect.left + enterRect.width / 2,
        enterRect.top + enterRect.height / 2,
      );

      expect(enterRect.right).toBeLessThanOrEqual(
        (triggerRect?.left ?? window.innerWidth) - 1,
      );
      expect(hitTarget && enterElement.contains(hitTarget)).toBe(true);
      await userEvent.click(enterButton);
      expect(mockTerminalWrite).toHaveBeenLastCalledWith("session-1", "\r");

      await userEvent.click(
        page.getByRole("button", { name: "Hide terminal keys" }),
      );
      await expect(
        page.getByRole("button", { name: "Show terminal keys" }),
      ).toBeVisible();
    }
  });

  it("keeps expanded accessory panels inside the viewport", async () => {
    for (const { width, height } of VIEWPORTS) {
      await page.viewport(width, height);
      setSafeAreaBottom(0);
      setSafeAreaRight(0);

      await userEvent.click(
        page.getByRole("button", { name: "Show terminal keys" }),
      );
      await expect(
        page.getByRole("button", { name: "Send Escape" }),
      ).toBeVisible();
      expectInViewport(rect("mobile-terminal-accessory-panel"));
      await userEvent.click(
        page.getByRole("button", { name: "Hide terminal keys" }),
      );

      await userEvent.click(
        page.getByRole("button", { name: "Open mobile keyboard" }),
      );
      await expect(page.getByPlaceholder("Type for terminal")).toBeVisible();
      expectInViewport(rect("mobile-terminal-accessory-panel"));
      await userEvent.click(
        page.getByRole("button", { name: "Open mobile keyboard" }),
      );
    }
  });

  it("keeps floating controls in bounds with additive safe-area clearance", async () => {
    for (const { width, height } of VIEWPORTS) {
      await page.viewport(width, height);
      const accessoryRect = rect("mobile-terminal-accessory-bar");
      const scrollRect = buttonRect("Show terminal scroll buttons");
      const keyRect = buttonRect("Show terminal keys");
      const keyboardRect = buttonRect("Open mobile keyboard");

      expectInViewport(accessoryRect);
      expectInViewport(scrollRect);
      expectAtLeastBottomClearance(keyRect, 48);
      expectAtLeastBottomClearance(keyboardRect, 48);
      expect(scrollRect?.bottom).toBeLessThanOrEqual((keyRect?.top ?? 0) - 8);
      expect(keyRect?.bottom).toBeLessThanOrEqual((keyboardRect?.top ?? 0) - 4);
    }

    await page.viewport(375, 700);
    const zeroInsetKeyBottom = buttonRect("Show terminal keys")?.bottom;
    const zeroInsetKeyboardBottom = buttonRect("Open mobile keyboard")?.bottom;
    expect(zeroInsetKeyBottom).toBeDefined();
    expect(zeroInsetKeyboardBottom).toBeDefined();
    setSafeAreaBottom(24);
    const safeInsetKeyBottom = buttonRect("Show terminal keys")?.bottom;
    const safeInsetKeyboardBottom = buttonRect("Open mobile keyboard")?.bottom;
    expect(safeInsetKeyBottom).toBeDefined();
    expect(safeInsetKeyboardBottom).toBeDefined();
    expect(zeroInsetKeyBottom! - safeInsetKeyBottom!).toBeCloseTo(24, 0);
    expect(zeroInsetKeyboardBottom! - safeInsetKeyboardBottom!).toBeCloseTo(
      24,
      0,
    );
    expect(safeInsetKeyBottom).toBeLessThanOrEqual(window.innerHeight - 48);
    expect(safeInsetKeyboardBottom).toBeLessThanOrEqual(
      window.innerHeight - 48,
    );
    setSafeAreaRight(24);
    expect(buttonRect("Show terminal keys")?.right).toBeLessThanOrEqual(
      window.innerWidth - 24,
    );
  });

  it("prevents terminal-surface propagation while keeping Type input focusable", async () => {
    await userEvent.click(
      page.getByRole("button", { name: "Open mobile keyboard" }),
    );
    const input = page.getByPlaceholder("Type for terminal");
    await input.fill("ls");
    expect(document.activeElement).toBe(
      document.querySelector('input[placeholder="Type for terminal"]'),
    );
    expect(mockTerminalWrite).toHaveBeenCalledWith("session-1", "ls");
    const nativeInput = document.querySelector<HTMLInputElement>(
      'input[placeholder="Type for terminal"]',
    );
    const enter = new KeyboardEvent("keydown", {
      key: "Enter",
      bubbles: true,
      cancelable: true,
    });
    nativeInput?.dispatchEvent(enter);
    expect(enter.defaultPrevented).toBe(true);
    expect(mockTerminalWrite).toHaveBeenLastCalledWith("session-1", "\r");

    const backspace = new KeyboardEvent("keydown", {
      key: "Backspace",
      bubbles: true,
      cancelable: true,
    });
    nativeInput?.dispatchEvent(backspace);
    expect(backspace.defaultPrevented).toBe(true);
    expect(mockTerminalWrite).toHaveBeenLastCalledWith("session-1", "\x7f");
    expect(hostClick).not.toHaveBeenCalled();
  });

  it("uses the same custom keyboard on desktop when the setting is enabled", async () => {
    await page.viewport(1280, 700);
    mockSettings.mobileCustomKeyboardEnabled = true;
    mockViewport.compact = false;
    mockViewport.coarse = false;
    await renderSurface();

    await userEvent.click(
      page.getByRole("button", { name: "Open custom terminal keyboard" }),
    );

    await expect(
      page.getByRole("button", { name: "Toggle Shift" }).first(),
    ).toBeVisible();
    const desktopKeyboard = page.getByTestId("mobile-terminal-custom-keyboard");
    const desktopKeyboardElement = desktopKeyboard.element() as HTMLElement;
    const desktopKeyboardRect = desktopKeyboardElement.getBoundingClientRect();
    const desktopRows = Array.from(
      desktopKeyboardElement.querySelectorAll<HTMLElement>(
        "[data-keyboard-row]",
      ),
    );
    expect(desktopRows).toHaveLength(5);
    for (const row of desktopRows) {
      const rowRect = row.getBoundingClientRect();
      expect(rowRect.left).toBeCloseTo(desktopKeyboardRect.left, 0);
      expect(rowRect.right).toBeCloseTo(desktopKeyboardRect.right, 0);
    }
    const desktopNumberKey = page.getByRole("button", { name: "Send 1" });
    expect(
      (desktopNumberKey.element() as HTMLButtonElement).getBoundingClientRect()
        .width,
    ).toBeGreaterThan(44);
    expect(
      document.querySelector('input[placeholder="Type for terminal"]'),
    ).toBeNull();
  });

  it("scales the custom keyboard for compact coarse-pointer surfaces", async () => {
    await page.viewport(375, 700);
    mockSettings.mobileCustomKeyboardEnabled = true;
    mockViewport.compact = true;
    mockViewport.coarse = true;
    await renderSurface();

    await userEvent.click(
      page.getByRole("button", { name: "Open custom terminal keyboard" }),
    );

    const customKeyboard = page.getByTestId("mobile-terminal-custom-keyboard");
    await expect(customKeyboard).toBeVisible();
    await expect(customKeyboard).toHaveClass(/overflow-x-auto/);
    const shiftButton = page
      .getByRole("button", { name: "Toggle Shift" })
      .first();
    const numberElement = document.querySelector<HTMLButtonElement>(
      '[data-key-id="text-1"]',
    );
    expect(numberElement).not.toBeNull();
    const numberRect = numberElement!.getBoundingClientRect();
    expect(numberRect.width).toBeGreaterThanOrEqual(24);
    expect(numberRect.width).toBeLessThan(44);
    expect(numberRect.height).toBeGreaterThanOrEqual(44);
    expect(numberElement!.textContent).toBe("1!");
    expect(document.documentElement.scrollWidth).toBeLessThanOrEqual(
      window.innerWidth,
    );
    expect(document.body.scrollWidth).toBeLessThanOrEqual(window.innerWidth);
    await userEvent.click(shiftButton);
    await expect(shiftButton).toHaveAttribute("aria-pressed", "true");
    expect(numberElement!.textContent).toBe("!");
    expect(numberElement!.getAttribute("aria-label")).toBe(
      "Send exclamation mark",
    );
    mockTerminalWrite.mockClear();
    await act(async () => {
      numberElement!.click();
    });
    expect(mockTerminalWrite).toHaveBeenLastCalledWith("session-1", "!");
    await expect(shiftButton).toHaveAttribute("aria-pressed", "false");
    expect(numberElement!.textContent).toBe("1!");
    expect(numberElement!.getAttribute("aria-label")).toBe("Send 1");
    const customEnter = page.getByRole("button", { name: "Send Enter" });
    await expect(customEnter).toBeVisible();
    mockTerminalWrite.mockClear();
    await userEvent.click(customEnter);
    expect(mockTerminalWrite).toHaveBeenCalledTimes(1);
    expect(mockTerminalWrite).toHaveBeenLastCalledWith("session-1", "\r");
    const customBackspace = page.getByRole("button", {
      name: "Send Backspace",
    });
    await expect(customBackspace).toBeVisible();
    expect(customBackspace.element().textContent).toBe("Backspace");
    customBackspace.element().focus();
    mockTerminalWrite.mockClear();
    await userEvent.keyboard("{Enter}");
    expect(mockTerminalWrite).toHaveBeenCalledTimes(1);
    expect(mockTerminalWrite).toHaveBeenLastCalledWith("session-1", "\x7f");

    await userEvent.click(
      page.getByRole("button", { name: "Show Function Layer" }),
    );
    await expect(
      page.getByRole("button", { name: "Send Enter" }),
    ).toBeVisible();
    const functionBackspace = page.getByRole("button", {
      name: "Send Backspace",
    });
    await expect(functionBackspace).toBeVisible();
    expect(functionBackspace.element().textContent).toBe("Backspace");
    mockTerminalWrite.mockClear();
    functionBackspace.element().click();
    expect(mockTerminalWrite).toHaveBeenCalledTimes(1);
    expect(mockTerminalWrite).toHaveBeenLastCalledWith("session-1", "\x7f");
    mockTerminalWrite.mockClear();
    await userEvent.click(functionBackspace);
    expect(mockTerminalWrite).toHaveBeenCalledTimes(1);
    expect(mockTerminalWrite).toHaveBeenLastCalledWith("session-1", "\x7f");
  });

  it("keeps the physical custom keyboard reachable with the scroll rail open", async () => {
    const cases = [
      { width: 320, height: 420, safeBottom: 0, safeRight: 0 },
      { width: 700, height: 375, safeBottom: 24, safeRight: 24 },
    ];

    mockSettings.mobileCustomKeyboardEnabled = true;
    for (const { width, height, safeBottom, safeRight } of cases) {
      await page.viewport(width, height);
      setSafeAreaBottom(safeBottom);
      setSafeAreaRight(safeRight);
      await renderSurface();

      await userEvent.click(
        page.getByRole("button", { name: "Open custom terminal keyboard" }),
      );
      await expect(
        page.getByRole("button", { name: "Toggle Shift" }).first(),
      ).toBeVisible();
      await userEvent.click(
        page.getByRole("button", { name: "Show terminal scroll buttons" }),
      );
      await expect(
        page.getByRole("group", { name: "Terminal scroll controls" }),
      ).toBeVisible();

      const panelRect = rect("mobile-terminal-accessory-panel");
      const railRect = groupRect("Terminal scroll controls");
      const keyRect = buttonRect("Show terminal keys");
      const backspaceButton = page.getByRole("button", {
        name: "Send Backspace",
      });
      await expect(backspaceButton).toBeVisible();
      const backspaceElement = backspaceButton.element() as HTMLButtonElement;
      backspaceElement.scrollIntoView({
        block: "nearest",
        inline: "nearest",
      });
      const backspaceRect = backspaceElement.getBoundingClientRect();
      expect(backspaceRect.left).toBeGreaterThanOrEqual(0);
      expect(backspaceRect.right).toBeLessThanOrEqual(window.innerWidth);
      const hitTarget = document.elementFromPoint(
        backspaceRect.left + backspaceRect.width / 2,
        backspaceRect.top + backspaceRect.height / 2,
      );

      expectInViewport(panelRect);
      expectInViewport(railRect);
      expect(railRect?.bottom).toBeLessThanOrEqual((keyRect?.top ?? 0) - 8);
      expect(hitTarget && backspaceElement.contains(hitTarget)).toBe(true);
      await userEvent.click(backspaceButton);
      expect(mockTerminalWrite).toHaveBeenLastCalledWith("session-1", "\x7f");

      await userEvent.click(
        page.getByRole("button", { name: "Hide terminal scroll buttons" }),
      );
      await expect(
        page.getByRole("button", { name: "Show terminal scroll buttons" }),
      ).toBeVisible();
      await userEvent.click(
        page.getByRole("button", { name: "Open custom terminal keyboard" }),
      );
      await expect(
        page.getByRole("button", { name: "Show terminal keys" }),
      ).toBeVisible();
    }
  });

  it("keeps the real flex host height across native and custom Type at 320x420", async () => {
    await page.viewport(320, 420);
    const nativeHeight = rect("terminal-surface")?.height;
    expect(nativeHeight).toBeGreaterThan(0);
    await userEvent.click(
      page.getByRole("button", { name: "Open mobile keyboard" }),
    );
    await expect(page.getByPlaceholder("Type for terminal")).toBeVisible();
    expect(rect("terminal-surface")?.height).toBe(nativeHeight);
    expect(rect("terminal-runtime-output-host")?.height).toBeGreaterThan(0);

    await userEvent.click(
      page.getByRole("button", { name: "Open mobile keyboard" }),
    );
    mockSettings.mobileCustomKeyboardEnabled = true;
    await renderSurface();
    const customHeight = rect("terminal-surface")?.height;
    expect(customHeight).toBeGreaterThan(0);
    expect(rect("terminal-runtime-output-host")?.height).toBeGreaterThan(0);
    await userEvent.click(
      page.getByRole("button", { name: "Open custom terminal keyboard" }),
    );
    await expect(
      page.getByRole("button", { name: "Toggle Shift" }).first(),
    ).toBeVisible();
    expect(rect("terminal-surface")?.height).toBe(customHeight);
    expect(rect("terminal-runtime-output-host")?.height).toBeGreaterThan(0);
  });

  it("keeps an opened scroll rail above the floating triggers", async () => {
    setSafeAreaBottom(0);
    for (const { width, height } of VIEWPORTS) {
      await page.viewport(width, height);
      const outputRect = rect("terminal-runtime-output-host");
      await userEvent.click(
        page.getByRole("button", { name: "Show terminal scroll buttons" }),
      );
      await expect(
        page.getByRole("group", { name: "Terminal scroll controls" }),
      ).toBeVisible();
      const railRect = groupRect("Terminal scroll controls");
      const scrollTriggerRect = buttonRect("Hide terminal scroll buttons");
      const keyRect = buttonRect("Show terminal keys");
      expectInViewport(railRect);
      expectInViewport(scrollTriggerRect);
      expect(railRect?.top).toBeGreaterThanOrEqual(outputRect?.top ?? 0);
      expect(railRect?.bottom).toBeLessThanOrEqual((keyRect?.top ?? 0) - 8);
      expect(scrollTriggerRect?.bottom).toBeLessThanOrEqual(
        (keyRect?.top ?? 0) - 8,
      );
      expect(railRect?.bottom).toBeLessThanOrEqual(
        outputRect?.bottom ?? window.innerHeight,
      );

      const keysButton = document.querySelector<HTMLButtonElement>(
        '[aria-label="Show terminal keys"]',
      );
      keysButton?.focus();
      await userEvent.keyboard("{Enter}");
      const expandedKeys = page.getByRole("button", {
        name: "Hide terminal keys",
      });
      await expect(expandedKeys).toBeVisible();
      const expandedRail = page.getByRole("group", {
        name: "Terminal scroll controls",
      });
      const expandedRailRect = (
        expandedRail.element() as HTMLElement
      ).getBoundingClientRect();
      const expandedOutputRect = rect("terminal-runtime-output-host");
      const expandedKeyRect = (
        expandedKeys.element() as HTMLButtonElement
      ).getBoundingClientRect();
      expect(expandedRailRect.bottom).toBeLessThanOrEqual(
        expandedOutputRect?.bottom ?? window.innerHeight,
      );
      expect(expandedRailRect.bottom).toBeLessThanOrEqual(
        expandedKeyRect.top - 8,
      );
      await userEvent.keyboard("{Escape}");
    }

    await page.viewport(700, 375);
    setSafeAreaBottom(24);
    const outputRect = rect("terminal-runtime-output-host");
    await userEvent.click(
      page.getByRole("button", { name: "Show terminal scroll buttons" }),
    );
    await expect(
      page.getByRole("group", { name: "Terminal scroll controls" }),
    ).toBeVisible();
    const safeRailRect = groupRect("Terminal scroll controls");
    expectInViewport(safeRailRect);
    expect(safeRailRect?.top).toBeGreaterThanOrEqual(outputRect?.top ?? 0);
    expect(safeRailRect?.bottom).toBeLessThanOrEqual(
      (buttonRect("Show terminal keys")?.top ?? 0) - 8,
    );
  });
});
