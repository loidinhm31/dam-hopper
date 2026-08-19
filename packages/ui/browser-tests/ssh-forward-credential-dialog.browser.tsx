import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { PassphraseDialog } from "@/components/organisms/PassphraseDialog.js";
import "@/index.css";

(
  globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;

function setInputValue(element: HTMLInputElement, value: string) {
  const setter = Object.getOwnPropertyDescriptor(
    HTMLInputElement.prototype,
    "value",
  )?.set;
  setter?.call(element, value);
  element.dispatchEvent(new Event("input", { bubbles: true }));
}

describe("SSH forwarding credential dialog in Chromium", () => {
  let container: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    container = document.createElement("div");
    document.body.append(container);
    root = createRoot(container);
  });

  afterEach(async () => {
    await act(async () => root.unmount());
    container.remove();
  });

  it("offers username/password authentication and submits it from the dialog", async () => {
    const onPasswordSubmit = vi.fn();
    const onCancel = vi.fn();

    await act(async () =>
      root.render(
        <PassphraseDialog
          open
          onSubmit={vi.fn()}
          onCancel={onCancel}
          title="Unlock SSH key for staging"
          defaultSaveForLater
          passwordAuth={{ username: "operator", onSubmit: onPasswordSubmit }}
        />,
      ),
    );

    const dialog = container.querySelector<HTMLElement>('[role="dialog"]');
    expect(dialog).not.toBeNull();
    expect(dialog).toHaveAttribute("aria-modal", "true");
    await vi.waitFor(() =>
      expect(document.activeElement).toBe(
        dialog?.querySelector('input[type="password"]'),
      ),
    );

    const method = dialog?.querySelector<HTMLSelectElement>("select");
    expect(method).not.toBeNull();
    await act(async () => {
      method!.value = "password";
      method!.dispatchEvent(new Event("change", { bubbles: true }));
    });

    const username = dialog?.querySelector<HTMLInputElement>(
      'input[autocomplete="username"]',
    );
    const password = dialog?.querySelector<HTMLInputElement>(
      'input[autocomplete="current-password"]',
    );
    expect(username?.value).toBe("operator");
    expect(password).not.toBeNull();
    expect(
      dialog?.querySelector<HTMLInputElement>('input[type="checkbox"]')
        ?.checked,
    ).toBe(true);

    await act(async () => {
      setInputValue(username!, "deploy");
      setInputValue(password!, "secret");
    });
    await act(async () => {
      dialog
        ?.querySelector<HTMLButtonElement>('button[type="submit"]')
        ?.click();
    });
    expect(onPasswordSubmit).toHaveBeenCalledWith("deploy", "secret", 30);

    await act(async () => {
      document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape" }));
    });
    expect(onCancel).toHaveBeenCalled();
  });
});
