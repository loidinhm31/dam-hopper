import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { OsShell } from "@/os/OsShell.js";
import { useWindowStore } from "@/os/window-store.js";
import { createDefaultOsSession } from "@/os/window-ops.js";
import { globalResourceRegistry } from "@/os/resource-registry.js";
import { useCognitoModeStore } from "@/stores/cognito-mode.js";
import { useOsNotificationStore } from "@/os/notifications.js";
import "@/index.css";
import "@/os/os.css";
import { EncryptProvider } from "@/contexts/EncryptContext.js";
import { arbitrateKeyboardEvent } from "@/os/input-arbiter.js";

describe("OS Input Isolation & Cognito Privacy Browser Tests", () => {
  let root: Root | null = null;
  let container: HTMLDivElement | null = null;

  beforeEach(() => {
    localStorage.clear();
    globalResourceRegistry.clear();
    useWindowStore.getState().setSession(createDefaultOsSession("desk-1", "Main"));
    useCognitoModeStore.getState().reset();
    useOsNotificationStore.getState().clearAll();

    container = document.createElement("div");
    container.style.width = "1440px";
    container.style.height = "900px";
    container.style.position = "relative";
    document.body.appendChild(container);
    root = createRoot(container);
  });

  afterEach(() => {
    if (root) {
      act(() => {
        root?.unmount();
      });
      root = null;
    }
    if (container?.parentElement) {
      container.parentElement.removeChild(container);
      container = null;
    }
  });

  const renderOsShell = async () => {
    await act(async () => {
      root?.render(
        <EncryptProvider>
          <OsShell />
        </EncryptProvider>,
      );
    });
  };

  it("blocks all physical keyboard inputs when Cognito privacy mode is active", async () => {
    await renderOsShell();

    // Enable Cognito mode
    act(() => {
      useCognitoModeStore.getState().toggle("Mod+Alt+KeyB");
    });
    expect(useCognitoModeStore.getState().active).toBe(true);

    const keyEvent = new KeyboardEvent("keydown", {
      key: "Enter",
      code: "Enter",
      bubbles: true,
      cancelable: true,
    });

    const disposition = arbitrateKeyboardEvent(keyEvent, {
      isCognitoActive: true,
      isComposing: false,
      isFrameFocused: false,
    });

    expect(disposition).toBe("cognito-blocked");
  });

  it("redacts notification entries immediately when Cognito is activated", async () => {
    useOsNotificationStore.getState().addNotification({
      profileId: "secret-production-server",
      generation: 1,
      title: "Agent OMP failed on /root/secrets.env",
      body: "Bearer token in terminal output",
      source: "agent",
      level: "warning",
      targetProject: "top-secret-project",
    });

    await renderOsShell();

    // Click notifications bell to open NotificationCenter
    const bellBtn = container?.querySelector('button[aria-label^="Notifications"]') as HTMLButtonElement | null;
    expect(bellBtn).not.toBeNull();

    await act(async () => {
      bellBtn?.click();
    });

    let notifTitle = container?.querySelector('[role="article"] span.font-medium');
    expect(notifTitle?.textContent).toBe("Agent OMP failed on /root/secrets.env");

    // Activate Cognito mode
    await act(async () => {
      useCognitoModeStore.getState().toggle("Mod+Alt+KeyB");
    });

    // Content is immediately redacted in DOM
    notifTitle = container?.querySelector('[role="article"] span.font-medium');
    expect(notifTitle?.textContent).toBe("Notification (Protected)");

    const notifBody = container?.querySelector('[role="article"] p');
    expect(notifBody?.textContent).toBe("Details hidden in Cognito Privacy Mode");
  });

  it("passes through IME composition and AltGr events without chord interference", async () => {
    await renderOsShell();

    const imeEvent = new KeyboardEvent("keydown", {
      key: "Process",
      keyCode: 229,
    });

    const disposition = arbitrateKeyboardEvent(imeEvent, {
      isCognitoActive: false,
      isComposing: true,
      isFrameFocused: false,
    });

    expect(disposition).toBe("ime-passthrough");
  });
});
