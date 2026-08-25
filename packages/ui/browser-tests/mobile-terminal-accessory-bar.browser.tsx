import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { page, userEvent } from "vitest/browser";
import { MobileTerminalAccessoryBar } from "@/components/organisms/MobileTerminalAccessoryBar.js";
import { TerminalScrollButtons } from "@/components/organisms/TerminalScrollButtons.js";
import "@/index.css";

vi.mock("@/contexts/AndroidChromeInputPolicyContext.js", () => ({
  useAndroidChromeInputPolicy: () => ({
    isAndroidChromeNativeInputSuppressed: false,
  }),
}));

const mockSettings = vi.hoisted(() => ({
  mobileCustomKeyboardEnabled: false,
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
  getTransport: () => ({ terminalWrite: mockTerminalWrite }),
}));

(
  globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;

describe("mobile terminal accessory bar in Chromium", () => {
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
          <div
            data-testid="terminal-output"
            style={{ position: "relative", minHeight: 0, flex: 1 }}
          >
            <TerminalScrollButtons sessionId="session-1" reserveAccessoryRail />
          </div>
          <MobileTerminalAccessoryBar sessionId="session-1" />
        </div>,
      );
    });
  }

  beforeEach(async () => {
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
  });

  it("keeps the key and keyboard controls tiny and aligned to the terminal edge", async () => {
    await page.viewport(375, 700);

    const controls = page.getByTestId("mobile-terminal-accessory-controls");
    await expect(controls).toBeVisible();
    await expect(controls).toHaveClass(/flex-col/);
    await expect(controls).toHaveClass(/gap-0\.5/);

    const keyButton = page.getByRole("button", { name: "Show terminal keys" });
    const keyboardButton = page.getByRole("button", {
      name: "Open mobile keyboard",
    });
    await expect(keyButton).toBeVisible();
    await expect(keyboardButton).toBeVisible();
    await expect(keyButton).toHaveClass(/h-10/);
    await expect(keyButton).toHaveClass(/w-10/);
    await expect(keyboardButton).toHaveClass(/h-10/);
    await expect(keyboardButton).toHaveClass(/w-10/);

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
    document
      .querySelector<HTMLButtonElement>('[aria-label="Send Escape"]')
      ?.focus();
    await userEvent.keyboard("{Enter}");
    expect(mockTerminalWrite).toHaveBeenCalledWith("session-1", "\x1b");
    await userEvent.keyboard(" ");
    expect(mockTerminalWrite).toHaveBeenLastCalledWith("session-1", "\x1b");
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

  it("stacks the floating triggers below scroll and keeps panels at the bottom", async () => {
    for (const width of [320, 375, 1280, 1440]) {
      await page.viewport(width, 420);
      const accessoryRect = document
        .querySelector<HTMLElement>(
          '[data-testid="mobile-terminal-accessory-bar"]',
        )
        ?.getBoundingClientRect();
      const scrollRect = document
        .querySelector<HTMLButtonElement>(
          '[aria-label="Show terminal scroll buttons"]',
        )
        ?.getBoundingClientRect();
      const keyRect = document
        .querySelector<HTMLButtonElement>('[aria-label="Show terminal keys"]')
        ?.getBoundingClientRect();
      const keyboardRect = document
        .querySelector<HTMLButtonElement>('[aria-label="Open mobile keyboard"]')
        ?.getBoundingClientRect();

      expect(accessoryRect).toBeDefined();
      expect(scrollRect).toBeDefined();
      expect(keyRect).toBeDefined();
      expect(keyboardRect).toBeDefined();
      expect(accessoryRect?.left).toBeGreaterThanOrEqual(0);
      expect(accessoryRect?.right).toBeLessThanOrEqual(window.innerWidth);
      expect(accessoryRect?.bottom).toBeLessThanOrEqual(window.innerHeight);
      expect(scrollRect?.bottom).toBeLessThanOrEqual((keyRect?.top ?? 0) - 4);
      expect(keyRect?.bottom).toBeLessThanOrEqual((keyboardRect?.top ?? 0) - 2);

      await userEvent.click(
        page.getByRole("button", { name: "Show terminal keys" }),
      );
      const panel = page.getByTestId("mobile-terminal-accessory-panel");
      await expect(panel).toBeVisible();
      expect(
        document
          .querySelector<HTMLElement>(
            '[data-testid="mobile-terminal-accessory-bar"]',
          )
          ?.querySelector('[data-testid="mobile-terminal-accessory-panel"]'),
      ).toBeNull();
      const panelRect = document
        .querySelector<HTMLElement>(
          '[data-testid="mobile-terminal-accessory-panel"]',
        )
        ?.getBoundingClientRect();
      expect(panelRect).toBeDefined();
      expect(panelRect?.left).toBeGreaterThanOrEqual(0);
      expect(panelRect?.right).toBeLessThanOrEqual(window.innerWidth);
      expect(panelRect?.top).toBeGreaterThanOrEqual(0);
      expect(panelRect?.bottom).toBeLessThanOrEqual(window.innerHeight);
      expect(panelRect?.bottom).toBeCloseTo(window.innerHeight, 0);

      await userEvent.keyboard("{Escape}");
      await expect(
        page.getByRole("button", { name: "Show terminal keys" }),
      ).toBeVisible();
    }
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
    expect(hostClick).not.toHaveBeenCalled();
  });

  it("uses the same custom keyboard on desktop when the setting is enabled", async () => {
    await page.viewport(1280, 700);
    mockSettings.mobileCustomKeyboardEnabled = true;
    mockViewport.compact = false;
    mockViewport.coarse = false;
    await renderSurface();

    await userEvent.click(
      page.getByRole("button", { name: "Open mobile keyboard" }),
    );

    await expect(
      page.getByRole("button", { name: "Toggle Shift" }),
    ).toBeVisible();
    expect(
      document.querySelector('input[placeholder="Type for terminal"]'),
    ).toBeNull();
  });

  it("uses the real custom keyboard on compact coarse-pointer surfaces", async () => {
    await page.viewport(375, 700);
    mockSettings.mobileCustomKeyboardEnabled = true;
    mockViewport.compact = true;
    mockViewport.coarse = true;
    await renderSurface();

    await userEvent.click(
      page.getByRole("button", { name: "Open mobile keyboard" }),
    );

    const shiftButton = page.getByRole("button", { name: "Toggle Shift" });
    await expect(shiftButton).toBeVisible();
    await expect(shiftButton).toHaveClass(/focus-visible:ring-2/);
    expect(
      document.querySelector('input[placeholder="Type for terminal"]'),
    ).toBeNull();

    const shiftElement = document.querySelector<HTMLButtonElement>(
      '[aria-label="Toggle Shift"]',
    );
    shiftElement?.focus();
    await userEvent.keyboard("{Enter}");
    expect(shiftElement?.getAttribute("aria-pressed")).toBe("true");
    await userEvent.keyboard(" ");
    expect(shiftElement?.getAttribute("aria-pressed")).toBe("false");

    const enterElement = document.querySelector<HTMLButtonElement>(
      '[aria-label="Send Enter"]',
    );
    enterElement?.focus();
    await userEvent.keyboard("{Enter}");
    expect(mockTerminalWrite).toHaveBeenCalledWith("session-1", "\r");
    await userEvent.keyboard(" ");
    expect(mockTerminalWrite).toHaveBeenLastCalledWith("session-1", "\r");
  });

  it("keeps the real flex host height across native and custom Type at 320x420", async () => {
    await page.viewport(320, 420);
    const nativeHeight = document
      .querySelector<HTMLElement>('[data-testid="terminal-surface"]')
      ?.getBoundingClientRect().height;
    expect(nativeHeight).toBeGreaterThan(0);
    await userEvent.click(
      page.getByRole("button", { name: "Open mobile keyboard" }),
    );
    await expect(page.getByPlaceholder("Type for terminal")).toBeVisible();
    expect(
      document
        .querySelector<HTMLElement>('[data-testid="terminal-surface"]')
        ?.getBoundingClientRect().height,
    ).toBe(nativeHeight);

    await userEvent.click(
      page.getByRole("button", { name: "Open mobile keyboard" }),
    );
    mockSettings.mobileCustomKeyboardEnabled = true;
    await renderSurface();
    const customHeight = document
      .querySelector<HTMLElement>('[data-testid="terminal-surface"]')
      ?.getBoundingClientRect().height;
    expect(customHeight).toBeGreaterThan(0);
    await userEvent.click(
      page.getByRole("button", { name: "Open mobile keyboard" }),
    );
    await expect(
      page.getByRole("button", { name: "Toggle Shift" }),
    ).toBeVisible();
    expect(
      document
        .querySelector<HTMLElement>('[data-testid="terminal-surface"]')
        ?.getBoundingClientRect().height,
    ).toBe(customHeight);
  });

  it("keeps an opened scroll rail above the floating triggers", async () => {
    await page.viewport(320, 420);
    const surfaceHeight = document
      .querySelector<HTMLElement>('[data-testid="terminal-surface"]')
      ?.getBoundingClientRect().height;
    expect(surfaceHeight).toBeGreaterThan(0);
    await userEvent.click(
      page.getByRole("button", { name: "Show terminal scroll buttons" }),
    );
    await expect(
      page.getByRole("group", { name: "Terminal scroll controls" }),
    ).toBeVisible();
    const keysButton = document.querySelector<HTMLButtonElement>(
      '[aria-label="Show terminal keys"]',
    );
    keysButton?.focus();
    await userEvent.keyboard("{Enter}");
    await expect(
      page.getByRole("button", { name: "Hide terminal keys" }),
    ).toBeVisible();
    const keyRect = document
      .querySelector<HTMLButtonElement>('[aria-label="Hide terminal keys"]')
      ?.getBoundingClientRect();
    const scrollButtonRect = document
      .querySelector<HTMLButtonElement>(
        '[aria-label="Hide terminal scroll buttons"]',
      )
      ?.getBoundingClientRect();
    expect(scrollButtonRect?.bottom).toBeLessThanOrEqual(
      (keyRect?.top ?? 0) - 4,
    );
    expect(
      document
        .querySelector<HTMLElement>('[data-testid="terminal-surface"]')
        ?.getBoundingClientRect().height,
    ).toBe(surfaceHeight);
  });
});
