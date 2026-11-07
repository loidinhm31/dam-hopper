// @vitest-environment jsdom

import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { PinSetupDialog } from "./PinSetupDialog.js";
import { useLockScreenStore } from "@/stores/lock-screen.js";

// @ts-ignore
globalThis.IS_REACT_ACT_ENVIRONMENT = true;

function setInputValue(input: HTMLInputElement, value: string) {
  const setter = Object.getOwnPropertyDescriptor(
    HTMLInputElement.prototype,
    "value",
  )?.set;
  setter?.call(input, value);
  input.dispatchEvent(new Event("input", { bubbles: true }));
}

describe("PinSetupDialog", () => {
  let root: Root | null = null;
  let container: HTMLDivElement | null = null;

  beforeEach(() => {
    localStorage.clear();
    useLockScreenStore.getState().reset();
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
    localStorage.clear();
    useLockScreenStore.getState().reset();
    document.querySelectorAll('[data-testid="pin-setup-dialog"]').forEach((el) => {
      el.closest('[role="dialog"]')?.remove();
    });
  });

  it("does not render content when open is false", async () => {
    await act(async () => {
      root?.render(
        <PinSetupDialog open={false} onOpenChange={() => {}} mode="setup" />,
      );
    });

    const dialog = document.querySelector('[data-testid="pin-setup-dialog"]');
    expect(dialog).toBeNull();
  });

  it("renders honest labeling disclaimer in the dialog", async () => {
    await act(async () => {
      root?.render(
        <PinSetupDialog open={true} onOpenChange={() => {}} mode="setup" />,
      );
    });

    const dialog = document.querySelector('[data-testid="pin-setup-dialog"]');
    expect(dialog).not.toBeNull();
    expect(dialog?.textContent).toContain(
      "Stored locally in this browser for quick screen locking. Not a replacement for server authentication.",
    );
  });

  it("validates empty PIN, length bounds, and mismatched confirmation in setup mode", async () => {
    const onOpenChange = vi.fn();
    const onSuccess = vi.fn();

    await act(async () => {
      root?.render(
        <PinSetupDialog
          open={true}
          onOpenChange={onOpenChange}
          mode="setup"
          onSuccess={onSuccess}
        />,
      );
    });

    const form = document.querySelector("form");
    const newPinInput = document.getElementById("new-pin") as HTMLInputElement;
    const confirmPinInput = document.getElementById("confirm-pin") as HTMLInputElement;

    expect(newPinInput).not.toBeNull();
    expect(confirmPinInput).not.toBeNull();

    // 1. Submit empty
    await act(async () => {
      form?.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }));
    });
    expect(document.querySelector('[role="alert"]')?.textContent).toContain(
      "New PIN is required.",
    );
    expect(onSuccess).not.toHaveBeenCalled();

    // 2. Short PIN (less than 4 digits)
    await act(async () => {
      setInputValue(newPinInput, "12");
      setInputValue(confirmPinInput, "12");
    });

    await act(async () => {
      form?.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }));
    });
    expect(document.querySelector('[role="alert"]')?.textContent).toContain(
      "PIN must be between 4 and 8 digits.",
    );

    // 3. Mismatched confirmation
    await act(async () => {
      setInputValue(newPinInput, "1234");
      setInputValue(confirmPinInput, "1235");
    });

    await act(async () => {
      form?.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }));
    });
    expect(document.querySelector('[role="alert"]')?.textContent).toContain(
      "PINs do not match.",
    );
    expect(onSuccess).not.toHaveBeenCalled();
    expect(onOpenChange).not.toHaveBeenCalled();
  });

  it("successfully sets a 4-8 digit PIN and closes dialog on success", async () => {
    const onOpenChange = vi.fn();
    const onSuccess = vi.fn();

    await act(async () => {
      root?.render(
        <PinSetupDialog
          open={true}
          onOpenChange={onOpenChange}
          mode="setup"
          onSuccess={onSuccess}
        />,
      );
    });

    const form = document.querySelector("form");
    const newPinInput = document.getElementById("new-pin") as HTMLInputElement;
    const confirmPinInput = document.getElementById("confirm-pin") as HTMLInputElement;

    await act(async () => {
      setInputValue(newPinInput, "123456");
      setInputValue(confirmPinInput, "123456");
    });

    await act(async () => {
      form?.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }));
    });

    await vi.waitFor(() => {
      expect(useLockScreenStore.getState().hasPin).toBe(true);
    });
    expect(useLockScreenStore.getState().pinLength).toBe(6);
    expect(onSuccess).toHaveBeenCalledTimes(1);
    expect(onOpenChange).toHaveBeenCalledWith(false);
  });

  it("validates current PIN in change mode and displays error on wrong current PIN", async () => {
    // Setup initial PIN
    await act(async () => {
      await useLockScreenStore.getState().setPin("1111");
    });
    expect(useLockScreenStore.getState().hasPin).toBe(true);

    const onOpenChange = vi.fn();
    const onSuccess = vi.fn();

    await act(async () => {
      root?.render(
        <PinSetupDialog
          open={true}
          onOpenChange={onOpenChange}
          mode="change"
          onSuccess={onSuccess}
        />,
      );
    });

    const form = document.querySelector("form");
    const currentPinInput = document.getElementById("current-pin") as HTMLInputElement;
    const newPinInput = document.getElementById("new-pin") as HTMLInputElement;
    const confirmPinInput = document.getElementById("confirm-pin") as HTMLInputElement;

    // Submit with wrong current PIN
    await act(async () => {
      setInputValue(currentPinInput, "9999");
      setInputValue(newPinInput, "2222");
      setInputValue(confirmPinInput, "2222");
    });

    await act(async () => {
      form?.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }));
    });

    await vi.waitFor(() => {
      expect(document.querySelector('[role="alert"]')?.textContent).toContain(
        "Current PIN is incorrect.",
      );
    });
    expect(onSuccess).not.toHaveBeenCalled();
    expect(onOpenChange).not.toHaveBeenCalled();

    // Now submit with correct current PIN
    await act(async () => {
      setInputValue(currentPinInput, "1111");
    });

    await act(async () => {
      form?.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }));
    });

    await vi.waitFor(() => {
      expect(onSuccess).toHaveBeenCalledTimes(1);
    });
    expect(onOpenChange).toHaveBeenCalledWith(false);
  });
  it("validates current PIN in remove mode and removes PIN on success", async () => {
    await act(async () => {
      await useLockScreenStore.getState().setPin("3333");
    });
    expect(useLockScreenStore.getState().hasPin).toBe(true);

    const onOpenChange = vi.fn();
    const onSuccess = vi.fn();

    await act(async () => {
      root?.render(
        <PinSetupDialog
          open={true}
          onOpenChange={onOpenChange}
          mode="remove"
          onSuccess={onSuccess}
        />,
      );
    });

    const form = document.querySelector("form");
    const currentPinInput = document.getElementById("current-pin") as HTMLInputElement;

    // Try wrong PIN
    await act(async () => {
      setInputValue(currentPinInput, "0000");
    });

    await act(async () => {
      form?.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }));
    });

    await vi.waitFor(() => {
      expect(document.querySelector('[role="alert"]')?.textContent).toContain(
        "Current PIN is incorrect.",
      );
    });
    expect(useLockScreenStore.getState().hasPin).toBe(true);
    await act(async () => {
      setInputValue(currentPinInput, "3333");
    });
    await act(async () => {
      form?.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }));
    });

    await vi.waitFor(() => {
      expect(useLockScreenStore.getState().hasPin).toBe(false);
    });
    expect(onSuccess).toHaveBeenCalledTimes(1);
    expect(onOpenChange).toHaveBeenCalledWith(false);
  });

  it("resets form fields and error messages when closed and reopened", async () => {
    const onOpenChange = vi.fn();

    await act(async () => {
      root?.render(
        <PinSetupDialog
          open={true}
          onOpenChange={onOpenChange}
          mode="setup"
        />,
      );
    });

    const form = document.querySelector("form");
    const newPinInput = document.getElementById("new-pin") as HTMLInputElement;

    await act(async () => {
      setInputValue(newPinInput, "12");
    });

    await act(async () => {
      form?.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }));
    });

    expect(document.querySelector('[role="alert"]')).not.toBeNull();

    // Close dialog
    await act(async () => {
      root?.render(
        <PinSetupDialog
          open={false}
          onOpenChange={onOpenChange}
          mode="setup"
        />,
      );
    });

    // Reopen dialog
    await act(async () => {
      root?.render(
        <PinSetupDialog
          open={true}
          onOpenChange={onOpenChange}
          mode="setup"
        />,
      );
    });

    const reopenedInput = document.getElementById("new-pin") as HTMLInputElement;
    expect(reopenedInput.value).toBe("");
    expect(document.querySelector('[role="alert"]')).toBeNull();
  });

  it("closes dialog when Cancel button is clicked", async () => {
    const onOpenChange = vi.fn();

    await act(async () => {
      root?.render(
        <PinSetupDialog
          open={true}
          onOpenChange={onOpenChange}
          mode="setup"
        />,
      );
    });

    const cancelButton = Array.from(document.querySelectorAll("button")).find(
      (btn) => btn.textContent === "Cancel",
    );
    expect(cancelButton).toBeDefined();

    await act(async () => {
      cancelButton?.click();
    });

    expect(onOpenChange).toHaveBeenCalledWith(false);
  });

  it("prevents duplicate submissions while async operation is pending", async () => {
    const { promise, resolve } = Promise.withResolvers<void>();
    const setPinSpy = vi
      .spyOn(useLockScreenStore.getState(), "setPin")
      .mockImplementation(() => promise);

    await act(async () => {
      root?.render(
        <PinSetupDialog
          open={true}
          onOpenChange={() => {}}
          mode="setup"
        />,
      );
    });

    const form = document.querySelector("form");
    const newPinInput = document.getElementById("new-pin") as HTMLInputElement;
    const confirmPinInput = document.getElementById(
      "confirm-pin",
    ) as HTMLInputElement;

    await act(async () => {
      setInputValue(newPinInput, "1234");
      setInputValue(confirmPinInput, "1234");
    });

    // Dispatch two submit events in the same synchronous batch
    await act(async () => {
      form?.dispatchEvent(
        new Event("submit", { bubbles: true, cancelable: true }),
      );
      form?.dispatchEvent(
        new Event("submit", { bubbles: true, cancelable: true }),
      );
    });
    expect(setPinSpy).toHaveBeenCalledTimes(1);
    // Resolve pending operation
    await act(async () => {
      resolve();
    });
    setPinSpy.mockRestore();
  });

  it("displays operation failure error message when setPin throws", async () => {
    const setPinSpy = vi
      .spyOn(useLockScreenStore.getState(), "setPin")
      .mockRejectedValue(new Error("Storage quota exceeded"));

    await act(async () => {
      root?.render(
        <PinSetupDialog
          open={true}
          onOpenChange={() => {}}
          mode="setup"
        />,
      );
    });

    const form = document.querySelector("form");
    const newPinInput = document.getElementById("new-pin") as HTMLInputElement;
    const confirmPinInput = document.getElementById("confirm-pin") as HTMLInputElement;

    await act(async () => {
      setInputValue(newPinInput, "1234");
      setInputValue(confirmPinInput, "1234");
    });

    await act(async () => {
      form?.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }));
    });

    await vi.waitFor(() => {
      expect(document.querySelector('[role="alert"]')?.textContent).toContain(
        "Storage quota exceeded",
      );
    });
    setPinSpy.mockRestore();
  });

  it("freezes session mode when mode prop is omitted even if store hasPin flips mid-session", async () => {
    // Store initially has no PIN -> opens in setup mode
    expect(useLockScreenStore.getState().hasPin).toBe(false);

    await act(async () => {
      root?.render(
        <PinSetupDialog
          open={true}
          onOpenChange={() => {}}
        />,
      );
    });

    expect(document.querySelector('[data-testid="pin-setup-dialog"]')?.textContent).toContain(
      "Set Up Screen Lock PIN",
    );

    // Mid-session external hasPin flip does NOT disrupt the open setup form
    await act(async () => {
      useLockScreenStore.setState({ hasPin: true });
    });

    expect(document.querySelector('[data-testid="pin-setup-dialog"]')?.textContent).toContain(
      "Set Up Screen Lock PIN",
    );
  });

  it("does not invoke callbacks if async operation completes after unmount", async () => {
    const { promise, resolve } = Promise.withResolvers<void>();
    const setPinSpy = vi
      .spyOn(useLockScreenStore.getState(), "setPin")
      .mockImplementation(() => promise);

    const onSuccess = vi.fn();
    const onOpenChange = vi.fn();

    await act(async () => {
      root?.render(
        <PinSetupDialog
          open={true}
          onOpenChange={onOpenChange}
          mode="setup"
          onSuccess={onSuccess}
        />,
      );
    });

    const form = document.querySelector("form");
    const newPinInput = document.getElementById("new-pin") as HTMLInputElement;
    const confirmPinInput = document.getElementById("confirm-pin") as HTMLInputElement;

    await act(async () => {
      setInputValue(newPinInput, "1234");
      setInputValue(confirmPinInput, "1234");
    });

    await act(async () => {
      form?.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }));
    });
    expect(setPinSpy).toHaveBeenCalledTimes(1);

    // Unmount before completion
    await act(async () => {
      root?.unmount();
    });

    // Resolve operation
    await act(async () => {
      resolve();
    });

    expect(onSuccess).not.toHaveBeenCalled();
    expect(onOpenChange).not.toHaveBeenCalled();
    setPinSpy.mockRestore();
  });
});
