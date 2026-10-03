import * as React from "react";
import { act, useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { page, userEvent } from "vitest/browser";
import { Terminal } from "@xterm/xterm";
import "@xterm/xterm/css/xterm.css";
import { useCognitoModeInputGuard } from "@/hooks/use-cognito-mode-input-guard.js";
import { CognitoModeOverlay } from "@/components/organisms/CognitoModeOverlay.js";
import { TerminalNotificationToastViewport } from "@/components/organisms/TerminalNotificationToastViewport.js";
import { useCognitoModeStore } from "@/stores/cognito-mode.js";
import { useSettingsStore } from "@/stores/settings.js";
import { useTerminalNotificationsStore } from "@/stores/terminal-notifications.js";
import { TerminalNotificationSound } from "@/lib/terminal-notification-sound.js";
import {
  DEFAULT_COGNITO_MODE_SHORTCUT,
  isMacPlatform,
} from "@/lib/shortcuts.js";
import type { TerminalAgentNotification } from "@/lib/terminal-notification-signal-parser.js";
import "@/index.css";

Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });

export interface CognitoHarnessHandle {
  terminal: Terminal | null;
  recordedBytes: string[];
  getClickCount: () => number;
  getPortalClickCount: () => number;
  openPortal: () => void;
}

let harnessHandle: CognitoHarnessHandle | null = null;

export function CognitoModeHarness({
  onReady,
}: {
  onReady?: (handle: CognitoHarnessHandle) => void;
}): React.JSX.Element {
  useCognitoModeInputGuard();
  const active = useCognitoModeStore((state) => state.active);
  const terminalHostRef = useRef<HTMLDivElement>(null);
  const terminalRef = useRef<Terminal | null>(null);
  const recordedBytesRef = useRef<string[]>([]);
  const [clickCount, setClickCount] = useState(0);
  const [portalClickCount, setPortalClickCount] = useState(0);
  const [showPortal, setShowPortal] = useState(false);

  const clickCountRef = useRef(0);
  const portalClickCountRef = useRef(0);

  useEffect(() => {
    clickCountRef.current = clickCount;
    portalClickCountRef.current = portalClickCount;
  }, [clickCount, portalClickCount]);

  useEffect(() => {
    if (!terminalHostRef.current) return;
    const term = new Terminal({ cols: 80, rows: 24, fontSize: 13 });
    terminalRef.current = term;
    term.open(terminalHostRef.current);
    const sub = term.onData((data) => {
      recordedBytesRef.current.push(data);
    });

    const handle: CognitoHarnessHandle = {
      terminal: term,
      recordedBytes: recordedBytesRef.current,
      getClickCount: () => clickCountRef.current,
      getPortalClickCount: () => portalClickCountRef.current,
      openPortal: () => setShowPortal(true),
    };
    harnessHandle = handle;
    onReady?.(handle);

    return () => {
      harnessHandle = null;
      sub.dispose();
      term.dispose();
      terminalRef.current = null;
    };
  }, [onReady]);

  return (
    <div className="relative min-h-screen w-screen bg-slate-900 p-4 text-slate-100">
      {/* 1. Cognito overlay portal */}
      <CognitoModeOverlay />

      {/* 2. Notification toast viewport */}
      <TerminalNotificationToastViewport />

      {/* 3. Portaled dialog if open (portaled directly to document.body) */}
      {showPortal &&
        createPortal(
          <div
            role="dialog"
            aria-label="Test Portal Dialog"
            className="fixed inset-12 z-50 rounded-lg border border-slate-700 bg-slate-800 p-6 shadow-2xl"
          >
            <h3 className="text-lg font-bold">Portal Dialog</h3>
            <button
              type="button"
              data-testid="portal-action-button"
              className="mt-4 rounded bg-blue-600 px-4 py-2 text-white"
              onClick={() => setPortalClickCount((c) => c + 1)}
            >
              Portal Action
            </button>
          </div>,
          document.body,
        )}

      {/* 4. Main content wrapped in data-cognito-mode-content */}
      <div
        data-cognito-mode-content=""
        inert={active ? true : undefined}
        aria-hidden={active ? "true" : undefined}
        className="contents"
      >
        <div className="flex flex-col gap-4">
          <div className="flex items-center gap-4">
            <button
              type="button"
              data-testid="regular-button"
              className="rounded bg-slate-700 px-4 py-2 text-white"
              onClick={() => setClickCount((c) => c + 1)}
            >
              Increment ({clickCount})
            </button>
            <button
              type="button"
              data-testid="open-portal-button"
              className="rounded bg-emerald-700 px-4 py-2 text-white"
              onClick={() => setShowPortal(true)}
            >
              Open Portal
            </button>
            <input
              data-testid="editable-input"
              aria-label="Editable input"
              defaultValue="initial content"
              className="rounded border border-slate-600 bg-slate-800 px-3 py-1 text-white"
            />
            <textarea
              data-testid="editable-textarea"
              aria-label="Editable textarea"
              defaultValue="multiline text"
              className="rounded border border-slate-600 bg-slate-800 px-3 py-1 text-white"
            />
          </div>

          <div
            ref={terminalHostRef}
            data-testid="terminal-host"
            className="h-[300px] w-[600px] border border-slate-700 bg-black"
          />
        </div>
      </div>
    </div>
  );
}

async function triggerCognitoShortcut(code = "KeyB", key = "b"): Promise<void> {
  await act(async () => {
    const isMac = isMacPlatform();
    window.dispatchEvent(
      new KeyboardEvent("keydown", {
        code,
        key,
        ctrlKey: !isMac,
        metaKey: isMac,
        altKey: true,
        bubbles: true,
        cancelable: true,
      }),
    );
    window.dispatchEvent(
      new KeyboardEvent("keyup", {
        code,
        key,
        ctrlKey: !isMac,
        metaKey: isMac,
        altKey: true,
        bubbles: true,
        cancelable: true,
      }),
    );
  });
}

function findMediaRule(
  rules: CSSRuleList,
  predicate: (rule: CSSMediaRule) => boolean,
): CSSMediaRule | null {
  for (const rule of Array.from(rules)) {
    if (rule instanceof CSSMediaRule && predicate(rule)) {
      return rule;
    }
    if ("cssRules" in rule) {
      const nested = findMediaRule((rule as CSSGroupingRule).cssRules, predicate);
      if (nested) return nested;
    }
  }
  return null;
}
describe("Cognito Mode Real-Browser Regressions", () => {
  let root: Root | null = null;
  let container: HTMLDivElement | null = null;

  beforeEach(async () => {
    useCognitoModeStore.getState().reset();
    useSettingsStore.setState({
      cognitoModeShortcut: DEFAULT_COGNITO_MODE_SHORTCUT,
      cognitoModeStyle: "heavy-blur",
    });
    useTerminalNotificationsStore.getState().clearNotifications();

    await page.viewport(1280, 800);
    container = document.createElement("div");
    document.body.append(container);
    root = createRoot(container);
    await act(async () => {
      root?.render(<CognitoModeHarness />);
    });
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
    harnessHandle = null;
    useCognitoModeStore.getState().reset();
    useTerminalNotificationsStore.getState().clearNotifications();
  });

  it("mounts initial state with interactive terminal and inputs, no overlay", async () => {
    expect(document.querySelector("[data-cognito-mode-overlay]")).toBeNull();
    const content = document.querySelector("[data-cognito-mode-content]");
    expect(content).not.toBeNull();
    expect(content?.hasAttribute("inert")).toBe(false);

    expect(harnessHandle?.terminal).not.toBeNull();
    harnessHandle?.terminal?.focus();

    await userEvent.keyboard("ls");
    expect(harnessHandle?.recordedBytes.join("")).toContain("ls");

    const button = page.getByTestId("regular-button");
    await userEvent.click(button);
    expect(harnessHandle?.getClickCount()).toBe(1);

    const input = page.getByTestId("editable-input");
    await userEvent.fill(input, "updated content");
    expect((input.element() as HTMLInputElement).value).toBe("updated content");
  });

  it("activates on configured shortcut, traps focus at overlay sink, and sets content inert", async () => {
    await triggerCognitoShortcut();

    expect(useCognitoModeStore.getState().active).toBe(true);
    expect(useCognitoModeStore.getState().activationShortcut).toBe(DEFAULT_COGNITO_MODE_SHORTCUT);

    const overlay = document.querySelector<HTMLElement>("[data-cognito-mode-overlay]");
    expect(overlay).not.toBeNull();
    expect(overlay?.getAttribute("role")).toBe("region");
    expect(overlay?.getAttribute("aria-label")).toBe("Cognito privacy mode");
    expect(overlay?.tabIndex).toBe(-1);

    // Overlay is focused
    expect(document.activeElement).toBe(overlay);

    // Content container is inert and aria-hidden
    const content = document.querySelector("[data-cognito-mode-content]");
    expect(content?.hasAttribute("inert")).toBe(true);
    expect(content?.getAttribute("aria-hidden")).toBe("true");
  });

  it("isolates all input while active: terminal onData receives zero bytes, clicks and keystrokes are blocked", async () => {
    harnessHandle?.terminal?.focus();
    await triggerCognitoShortcut();
    expect(useCognitoModeStore.getState().active).toBe(true);

    // Clear bytes from any prior setup
    if (harnessHandle) {
      harnessHandle.recordedBytes.length = 0;
    }

    // Attempt typing dangerous commands via browser keyboard
    await userEvent.keyboard("rm -rf /{Enter}");
    await userEvent.keyboard("{Escape}{Tab}{Backspace}");

    // Terminal received ZERO input bytes
    expect(harnessHandle?.recordedBytes.length).toBe(0);

    // Attempt clicking regular button - direct click event is suppressed by input guard
    const initialClicks = harnessHandle?.getClickCount() ?? 0;
    const button = page.getByTestId("regular-button");
    const clickEvent = new MouseEvent("click", { bubbles: true, cancelable: true });
    button.element().dispatchEvent(clickEvent);
    expect(clickEvent.defaultPrevented).toBe(true);
    expect(harnessHandle?.getClickCount()).toBe(initialClicks);

    // Attempt typing into editable input
    const input = page.getByTestId("editable-input");
    const originalValue = (input.element() as HTMLInputElement).value;
    const inputClickEvent = new MouseEvent("click", { bubbles: true, cancelable: true });
    input.element().dispatchEvent(inputClickEvent);
    expect(inputClickEvent.defaultPrevented).toBe(true);
    await userEvent.keyboard("injected text");
    expect((input.element() as HTMLInputElement).value).toBe(originalValue);

    // Focus attempt inside content is redirected to overlay sink
    (input.element() as HTMLInputElement).focus();
    const overlay = document.querySelector("[data-cognito-mode-overlay]");
    expect(document.activeElement).toBe(overlay);
  });

  it("body-portaled dialog interactions are suppressed while masked and cannot beat the mask", async () => {
    // Open portal dialog before activating mask
    await act(async () => {
      harnessHandle?.openPortal();
    });

    const portalButton = page.getByTestId("portal-action-button");
    await expect.element(portalButton).toBeVisible();

    // Activate mask
    await triggerCognitoShortcut();
    expect(useCognitoModeStore.getState().active).toBe(true);

    // Attempt clicking the portaled button: direct synthetic click is prevented by input guard
    const initialPortalClicks = harnessHandle?.getPortalClickCount() ?? 0;
    const portalClickEvent = new MouseEvent("click", { bubbles: true, cancelable: true });
    portalButton.element().dispatchEvent(portalClickEvent);
    expect(portalClickEvent.defaultPrevented).toBe(true);
    expect(harnessHandle?.getPortalClickCount()).toBe(initialPortalClicks);

    // Attempt focusing the portaled button redirects back to overlay sink
    (portalButton.element() as HTMLButtonElement).focus();
    const overlay = document.querySelector("[data-cognito-mode-overlay]");
    expect(document.activeElement).toBe(overlay);
  });

  it("dismissal via same shortcut restores interactivity and xterm onData captures subsequent typing", async () => {
    harnessHandle?.terminal?.focus();
    await triggerCognitoShortcut();
    expect(useCognitoModeStore.getState().active).toBe(true);

    if (harnessHandle) {
      harnessHandle.recordedBytes.length = 0;
    }

    // Dismiss with same shortcut
    await triggerCognitoShortcut();
    expect(useCognitoModeStore.getState().active).toBe(false);

    // Overlay is removed
    expect(document.querySelector("[data-cognito-mode-overlay]")).toBeNull();

    // Content is no longer inert
    const content = document.querySelector("[data-cognito-mode-content]");
    expect(content?.hasAttribute("inert")).toBe(false);
    expect(content?.hasAttribute("aria-hidden")).toBe(false);

    // Normal typing is now received by terminal onData
    harnessHandle?.terminal?.focus();
    await userEvent.keyboard("pwd{Enter}");
    expect(harnessHandle?.recordedBytes.join("")).toContain("pwd");

    // Normal button clicks work
    const prevClicks = harnessHandle?.getClickCount() ?? 0;
    const button = page.getByTestId("regular-button");
    await userEvent.click(button);
    expect(harnessHandle?.getClickCount()).toBe(prevClicks + 1);
  });

  it("notification toasts render above the mask with zIndex 10001 and reject pointer interaction while active", async () => {
    await triggerCognitoShortcut();
    expect(useCognitoModeStore.getState().active).toBe(true);

    const notification: TerminalAgentNotification = {
      source: "agent-status",
      sessionId: "test-session-1",
      agent: "Claude",
      title: "Claude needs attention",
      body: "Test qualification event",
      status: "needs-attention",
      receivedAt: Date.now(),
      profileId: "default",
    };

    await act(async () => {
      useTerminalNotificationsStore.getState().addNotification(notification, {
        showToast: true,
      });
    });

    const toastViewport = document.querySelector<HTMLElement>(
      'aside[aria-label="Terminal notification alerts"]',
    );
    expect(toastViewport).not.toBeNull();
    // Verify toast is stacked ABOVE the mask (z-index 10001 > overlay 10000)
    expect(toastViewport?.style.zIndex).toBe("10001");
    expect(toastViewport?.textContent).toContain("Claude needs attention");

    // Toast button is visible above the mask, but clicks on it are intercepted by input guard
    const toastButton = page.getByRole("button", {
      name: /Claude needs attention\. Open terminal/,
    });
    const clickEvent = new MouseEvent("click", { bubbles: true, cancelable: true });
    toastButton.element().dispatchEvent(clickEvent);
    expect(clickEvent.defaultPrevented).toBe(true);

    // Notification is still unread / active because click was intercepted
    const record = useTerminalNotificationsStore
      .getState()
      .notifications.find((n) => n.event.title === "Claude needs attention");
    expect(record?.read).toBe(false);

    // Toast can be dismissed programmatically / via timer
    await act(async () => {
      useTerminalNotificationsStore.getState().clearNotifications();
    });
    expect(toastViewport?.textContent).not.toContain("Claude needs attention");
  });

  it("applies correct CSS classes and computed styles for heavy-blur and black-screen styles", async () => {
    // 1. Activate Heavy Blur
    await act(async () => {
      useSettingsStore.setState({ cognitoModeStyle: "heavy-blur" });
    });
    await triggerCognitoShortcut();
    let overlay = document.querySelector<HTMLElement>("[data-cognito-mode-overlay]");
    expect(overlay).not.toBeNull();
    expect(overlay?.classList.contains("cognito-mode-overlay--heavy-blur")).toBe(true);

    // Verify Chromium supports backdrop-filter and applies frosted-glass styling
    expect(CSS.supports("backdrop-filter", "blur(20px) saturate(140%)")).toBe(true);
    let computed = window.getComputedStyle(overlay!);
    expect(computed.backgroundColor).toBe("rgba(13, 17, 23, 0.52)");
    expect(computed.backdropFilter).toMatch(/^blur\(20px\)\s+saturate\((?:140%|1\.4)\)$/);
    expect(computed.boxShadow).toMatch(
      /rgba\(255,\s*255,\s*255,\s*0\.05\)\s+0px\s+0px\s+0px\s+1px\s+inset/,
    );

    // Dismiss
    await triggerCognitoShortcut();

    // 2. Switch style to Black Screen
    await act(async () => {
      useSettingsStore.setState({ cognitoModeStyle: "black-screen" });
    });
    await triggerCognitoShortcut();
    overlay = document.querySelector<HTMLElement>("[data-cognito-mode-overlay]");
    expect(overlay).not.toBeNull();
    expect(overlay?.classList.contains("cognito-mode-overlay--black-screen")).toBe(true);
    expect(overlay?.classList.contains("cognito-mode-overlay--heavy-blur")).toBe(false);

    computed = window.getComputedStyle(overlay!);
    expect(computed.backgroundColor).toBe("rgb(0, 0, 0)");
    expect(computed.backdropFilter).toBe("none");
    expect(computed.boxShadow).toBe("none");

    await triggerCognitoShortcut();
  });

  it("applies the production reduced-transparency override as opaque black when its media query matches", async () => {
    // Find the production media rule, including if a bundler nests it in @layer.
    let targetRule: CSSMediaRule | null = null;
    for (const sheet of Array.from(document.styleSheets)) {
      try {
        targetRule = findMediaRule(
          sheet.cssRules,
          (rule) => rule.media.mediaText.includes("prefers-reduced-transparency"),
        );
      } catch {
        // Ignore cross-origin stylesheets if any.
      }
      if (targetRule) break;
    }

    expect(targetRule).not.toBeNull();
    expect(targetRule!.media.mediaText).toContain("prefers-reduced-transparency");
    expect(targetRule!.media.mediaText).toContain("reduce");
    const overrideRule = Array.from(targetRule!.cssRules).find(
      (rule): rule is CSSStyleRule =>
        rule instanceof CSSStyleRule &&
        rule.selectorText === ".cognito-mode-overlay--heavy-blur",
    );
    expect(overrideRule).toBeDefined();
    expect(overrideRule!.style.getPropertyValue("-webkit-backdrop-filter")).toBe("none");

    const originalMedia = targetRule!.media.mediaText;

    try {
      targetRule!.media.mediaText = "all";

      await act(async () => {
        useSettingsStore.setState({ cognitoModeStyle: "heavy-blur" });
      });
      await triggerCognitoShortcut();

      const overlay = document.querySelector<HTMLElement>("[data-cognito-mode-overlay]");
      expect(overlay).not.toBeNull();
      expect(overlay?.classList.contains("cognito-mode-overlay--heavy-blur")).toBe(true);

      const computed = window.getComputedStyle(overlay!);
      expect(computed.backgroundColor).toBe("rgb(0, 0, 0)");
      expect(computed.backdropFilter).toBe("none");
      expect(computed.boxShadow).toBe("none");

      await triggerCognitoShortcut();
    } finally {
      targetRule!.media.mediaText = originalMedia;
    }
  });

  it("preserves deterministic audio playback while active", async () => {
    await triggerCognitoShortcut();
    expect(useCognitoModeStore.getState().active).toBe(true);

    const sound = new TerminalNotificationSound();
    expect(() => sound.play("default", 100)).not.toThrow();
  });

  it("freezes activation shortcut so settings change during active mode cannot lock out dismissal", async () => {
    await act(async () => {
      useSettingsStore.setState({ cognitoModeShortcut: "Mod+Alt+KeyB" });
    });
    await triggerCognitoShortcut("KeyB", "b");
    expect(useCognitoModeStore.getState().active).toBe(true);
    expect(useCognitoModeStore.getState().activationShortcut).toBe("Mod+Alt+KeyB");

    // External settings change (e.g. sync/hydration) while active
    await act(async () => {
      useSettingsStore.setState({ cognitoModeShortcut: "Mod+Alt+KeyK" });
    });

    // Trying new shortcut fails dismissal because old activation chord is frozen
    await triggerCognitoShortcut("KeyK", "k");
    expect(useCognitoModeStore.getState().active).toBe(true);

    // Original chord successfully dismisses
    await triggerCognitoShortcut("KeyB", "b");
    expect(useCognitoModeStore.getState().active).toBe(false);
  });
});
