// @vitest-environment jsdom
import { createElement } from "react";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  buildPassphraseDialogSubmission,
  PassphraseDialog,
} from "./PassphraseDialog.js";

const mockPolicy = vi.hoisted(() => ({ enabled: false }));

vi.mock("@/contexts/AndroidChromeInputPolicyContext.js", () => ({
  useAndroidChromeInputPolicy: () => ({
    isAndroidChromeNativeInputSuppressed: mockPolicy.enabled,
  }),
}));

let root: Root | null = null;

function setInputValue(input: HTMLInputElement, value: string): void {
  const setter = Object.getOwnPropertyDescriptor(
    HTMLInputElement.prototype,
    "value",
  )?.set;
  setter?.call(input, value);
  input.dispatchEvent(new Event("input", { bubbles: true }));
}

afterEach(() => {
  act(() => root?.unmount());
  root = null;
  document.body.innerHTML = "";
});

describe("PassphraseDialog", () => {
  beforeEach(() => {
    mockPolicy.enabled = false;
  });

  it("renders the save-for-later copy when open", () => {
    const markup = renderToStaticMarkup(
      createElement(PassphraseDialog, {
        open: true,
        onSubmit: vi.fn(),
        onCancel: vi.fn(),
        availableKeys: ["id_ed25519"],
      }),
    );

    expect(markup).toContain(
      "Save for later when device credential storage is available.",
    );
    expect(markup).toContain("Load Key &amp; Retry");
    expect(markup).toContain("~/.ssh/id_ed25519");
  });

  it("renders nothing when closed", () => {
    const markup = renderToStaticMarkup(
      createElement(PassphraseDialog, {
        open: false,
        onSubmit: vi.fn(),
        onCancel: vi.fn(),
      }),
    );

    expect(markup).toBe("");
  });

  it("disables passphrase submission with an accessible explanation on Android Chrome", () => {
    mockPolicy.enabled = true;
    const markup = renderToStaticMarkup(
      createElement(PassphraseDialog, {
        open: true,
        onSubmit: vi.fn(),
        onCancel: vi.fn(),
      }),
    );

    expect(markup).toContain(
      "Text entry and Load Key &amp; Retry are unavailable",
    );
    expect(markup).toContain(
      'aria-describedby="passphrase-dialog-android-description"',
    );
    expect(markup).toContain('type="submit"');
    expect(markup).toContain('disabled=""');
  });

  it("builds a submission payload that preserves save-for-later", () => {
    expect(
      buildPassphraseDialogSubmission("secret", "id_ed25519", true),
    ).toEqual({
      passphrase: "secret",
      keyPath: "id_ed25519",
      saveForLater: true,
    });
  });

  it("keeps default key selection explicit in the submission payload", () => {
    expect(buildPassphraseDialogSubmission("secret", "", true)).toEqual({
      passphrase: "secret",
      keyPath: undefined,
      saveForLater: true,
    });
  });

  it("supports an ephemeral native forwarding unlock without save controls", () => {
    const markup = renderToStaticMarkup(
      createElement(PassphraseDialog, {
        open: true,
        onSubmit: vi.fn(),
        onCancel: vi.fn(),
        title: "Unlock SSH key",
        description: "Used only in memory.",
        submitLabel: "Unlock and retry",
        allowSaveForLater: false,
        requireKeySelection: true,
        keyOptions: [
          { value: "key-1", label: "id_ed25519 (passphrase required)" },
        ],
      }),
    );

    expect(markup).toContain("Unlock SSH key");
    expect(markup).toContain("Used only in memory.");
    expect(markup).toContain("id_ed25519 (passphrase required)");
    expect(markup).toContain("Unlock and retry");
    expect(markup).not.toContain("Save for later");
  });

  it("offers VS Code-style username and password authentication", () => {
    const markup = renderToStaticMarkup(
      createElement(PassphraseDialog, {
        open: true,
        onSubmit: vi.fn(),
        onCancel: vi.fn(),
        passwordAuth: { username: "operator", onSubmit: vi.fn() },
      }),
    );

    expect(markup).toContain("Authentication method");
    expect(markup).toContain("Username and password");
  });

  it("submits the edited username and password through the password method", async () => {
    const onPasswordSubmit = vi.fn();
    const container = document.createElement("div");
    document.body.append(container);
    root = createRoot(container);
    await act(async () => {
      root?.render(
        createElement(PassphraseDialog, {
          open: true,
          onSubmit: vi.fn(),
          onCancel: vi.fn(),
          passwordAuth: {
            username: "operator",
            onSubmit: onPasswordSubmit,
          },
        }),
      );
    });

    await act(async () => {
      const method = document.querySelector("select") as HTMLSelectElement;
      method.value = "password";
      method.dispatchEvent(new Event("change", { bubbles: true }));
      setInputValue(
        document.querySelector<HTMLInputElement>('input[type="text"]')!,
        "deploy",
      );
      setInputValue(
        document.querySelector<HTMLInputElement>('input[type="password"]')!,
        "secret",
      );
    });
    await act(async () => {
      document.querySelector("form")?.dispatchEvent(
        new Event("submit", { bubbles: true, cancelable: true }),
      );
    });

    expect(onPasswordSubmit).toHaveBeenCalledWith("deploy", "secret");
  });
});
