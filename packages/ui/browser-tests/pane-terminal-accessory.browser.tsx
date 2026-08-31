import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { DndContext } from "@dnd-kit/core";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { page } from "vitest/browser";
import { PaneContainer } from "@/components/organisms/PaneContainer.js";
import type { PaneNode } from "@/types/terminal-layout.js";
import "@/index.css";

(
  globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;

const mockSettings = vi.hoisted(() => ({
  mobileCustomKeyboardEnabled: false,
  mobileCustomKeyboardFontSize: 11,
  mobileCustomKeyboardPadding: 6,
  mobileCustomKeyboardRowGap: 4,
  terminalCommitStatusEnabled: false,
  terminalScrollButtonsEnabled: true,
  terminalScrollStep: 3,
}));
const mockTerminal = vi.hoisted(() => ({
  focus: vi.fn(),
  attachCustomKeyEventHandler: vi.fn(),
  scrollToTop: vi.fn(),
  scrollLines: vi.fn(),
  scrollToBottom: vi.fn(),
}));
let terminalTextarea: HTMLTextAreaElement | null = null;

vi.mock("@/stores/settings.js", () => ({
  useSettingsStore: (selector?: (state: typeof mockSettings) => unknown) =>
    selector ? selector(mockSettings) : mockSettings,
}));

vi.mock("@/contexts/AndroidChromeInputPolicyContext.js", () => ({
  useAndroidChromeInputPolicy: () => ({
    isAndroidChromeNativeInputSuppressed: false,
  }),
}));

vi.mock("@/hooks/use-compact-workspace.js", () => ({
  useCompactWorkspace: () => true,
}));

vi.mock("@/hooks/use-coarse-pointer.js", () => ({
  useCoarsePointer: () => true,
}));

vi.mock("@/api/transport.js", () => ({
  getTransport: () => ({ terminalWrite: vi.fn() }),
}));

vi.mock("@/components/organisms/TabBar.js", () => ({
  TabBar: () => <div data-testid="pane-tab-bar" />,
}));

vi.mock("@/components/organisms/TerminalDockPreview.js", () => ({
  TerminalDockPreview: () => null,
}));

vi.mock("@/lib/terminal-host-attachment.js", () => ({
  attachTerminalsToHost: vi.fn(),
}));

vi.mock("@/lib/terminal-fit-scheduler.js", () => ({
  cancelScheduledTerminalFit: vi.fn(),
  scheduleTerminalFit: vi.fn(),
}));

vi.mock("@/lib/terminal-native-input-policy.js", () => ({
  syncNativeKeyboardSuppression: vi.fn(),
}));

vi.mock("@/lib/terminal-registry.js", () => ({
  terminalRegistry: {
    get: () => ({
      terminal: mockTerminal,
      fitAddon: {},
      findController: {},
    }),
  },
  subscribeToRegistry: () => () => {},
}));

const paneBase: PaneNode = {
  id: "pane:one",
  type: "pane",
  sessionIds: ["session-1", "session-2"],
  activeSessionId: "session-1",
};

const layout = {
  focusedPaneId: paneBase.id,
  getPanes: () => [paneBase],
  setFocusedPaneId: vi.fn(),
  setActiveSession: vi.fn(),
  splitPane: vi.fn(),
  closePane: vi.fn(),
};

describe("PaneContainer terminal accessory placement in Chromium", () => {
  let container: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    mockTerminal.focus.mockClear();
    mockTerminal.attachCustomKeyEventHandler.mockClear();
    terminalTextarea = document.createElement("textarea");
    terminalTextarea.className = "xterm-helper-textarea";
    document.body.append(terminalTextarea);
    mockTerminal.focus.mockImplementation(() => terminalTextarea?.focus());
    container = document.createElement("div");
    container.style.height = "420px";
    container.style.width = "1280px";
    document.body.append(container);
    root = createRoot(container);
  });
  afterEach(async () => {
    await act(async () => root.unmount());
    container.remove();
    terminalTextarea = null;
    document.body.innerHTML = "";
  });

  async function renderPane(activeSessionId: string) {
    const pane: PaneNode = { ...paneBase, activeSessionId };
    await act(async () => {
      root.render(
        <DndContext>
          <PaneContainer
            node={pane}
            layout={layout as never}
            mountedSessions={[]}
            openTabs={[
              {
                sessionId: "session-1",
                label: "First shell",
                title: {
                  baseLabel: "First shell",
                  ordinal: 1,
                  fullText: "First shell #1",
                },
              },
              {
                sessionId: "session-2",
                label: "Second shell",
                title: {
                  baseLabel: "Second shell",
                  ordinal: 2,
                  fullText: "Second shell #2",
                },
              },
            ]}
            activeSessionId={activeSessionId}
            onNewTerminal={vi.fn()}
            onSessionExit={vi.fn()}
            onSelectTab={vi.fn()}
            onCloseTab={vi.fn()}
            browserOpen
            onCloseBrowser={vi.fn()}
            renderBrowserContent={() => (
              <div data-testid="browser-pane">Browser pane</div>
            )}
          />
        </DndContext>,
      );
    });
  }

  it("keeps one real accessory in the terminal area and retargets the active session", async () => {
    await page.viewport(1280, 420);
    await renderPane("session-1");

    const outputHost = document.querySelector<HTMLElement>(
      '[data-testid="terminal-pane-output-host"]',
    );
    const browserPane = document.querySelector<HTMLElement>(
      '[data-testid="browser-pane"]',
    );
    expect(outputHost).not.toBeNull();
    expect(browserPane).not.toBeNull();
    const terminalArea = outputHost?.parentElement;
    expect(
      terminalArea?.querySelectorAll(
        '[data-testid="mobile-terminal-accessory-bar"]',
      ),
    ).toHaveLength(1);
    expect(
      document.querySelectorAll(
        '[data-testid="mobile-terminal-accessory-bar"]',
      ),
    ).toHaveLength(1);
    expect(
      browserPane?.querySelector(
        '[data-testid="mobile-terminal-accessory-bar"]',
      ),
    ).toBeNull();
    expect(
      terminalArea
        ?.querySelector('[data-testid="mobile-terminal-accessory-bar"]')
        ?.getAttribute("data-session-id"),
    ).toBe("session-1");
    const scrollTrigger = document.querySelector<HTMLButtonElement>(
      '[aria-label="Show terminal scroll buttons"]',
    );
    expect(scrollTrigger).not.toBeNull();
    expect(
      terminalArea?.querySelectorAll(
        '[aria-label="Show terminal scroll buttons"]',
      ),
    ).toHaveLength(1);
    expect(
      browserPane?.querySelector(
        '[aria-label="Show terminal scroll buttons"]',
      ),
    ).toBeNull();
    expect(scrollTrigger?.parentElement?.getAttribute("style")).toContain(
      "6.25rem",
    );

    await act(async () => scrollTrigger?.click());
    expect(
      terminalArea?.querySelector(
        '[role="group"][aria-label="Terminal scroll controls"]',
      ),
    ).not.toBeNull();

    await act(async () =>
      terminalArea
        ?.querySelector<HTMLButtonElement>('[aria-label="Show terminal keys"]')
        ?.click(),
    );
    const scrollRail = terminalArea?.querySelector<HTMLElement>(
      '[aria-label="Hide terminal scroll buttons"]',
    )?.parentElement;
    const accessoryPanel = terminalArea?.querySelector<HTMLElement>(
      '[data-testid="mobile-terminal-accessory-panel"]',
    );
    expect(scrollRail?.getAttribute("style")).toContain("100%");
    const scrollBounds = scrollRail?.getBoundingClientRect();
    const accessoryBounds = accessoryPanel?.getBoundingClientRect();
    expect(
      scrollBounds &&
        accessoryBounds &&
        (scrollBounds.bottom <= accessoryBounds.top ||
          scrollBounds.top >= accessoryBounds.bottom),
    ).toBe(true);
    await act(async () =>
      terminalArea
        ?.querySelector<HTMLButtonElement>('[aria-label="Hide terminal keys"]')
        ?.click(),
    );
    expect(
      terminalArea?.querySelector('[data-testid="mobile-terminal-accessory-panel"]'),
    ).toBeNull();
    expect(
      terminalArea?.querySelectorAll(
        '[aria-label="Show terminal scroll buttons"], [aria-label="Hide terminal scroll buttons"]',
      ),
    ).toHaveLength(1);

    await renderPane("session-2");

    expect(
      document.querySelectorAll(
        '[data-testid="mobile-terminal-accessory-bar"]',
      ),
    ).toHaveLength(1);
    expect(
      terminalArea
        ?.querySelector('[data-testid="mobile-terminal-accessory-bar"]')
        ?.getAttribute("data-session-id"),
    ).toBe("session-2");
    expect(
      browserPane?.querySelector(
        '[data-testid="mobile-terminal-accessory-bar"]',
      ),
    ).toBeNull();
    expect(
      terminalArea?.querySelectorAll(
        '[aria-label="Show terminal scroll buttons"], [aria-label="Hide terminal scroll buttons"]',
      ),
    ).toHaveLength(1);
    expect(
      browserPane?.querySelector(
        '[aria-label="Show terminal scroll buttons"], [aria-label="Hide terminal scroll buttons"]',
      ),
    ).toBeNull();
  });
  it("retains Global Search focus when only the pane callback changes", async () => {
    await page.viewport(1280, 420);
    await renderPane("session-1");
    const globalSearchInput = document.createElement("input");
    globalSearchInput.setAttribute("aria-label", "Global Search");
    document.body.append(globalSearchInput);
    globalSearchInput.focus();
    const initialFocusCount = mockTerminal.focus.mock.calls.length;

    await renderPane("session-1");

    expect(document.activeElement).toBe(globalSearchInput);
    expect(mockTerminal.focus).toHaveBeenCalledTimes(initialFocusCount);
  });
});
