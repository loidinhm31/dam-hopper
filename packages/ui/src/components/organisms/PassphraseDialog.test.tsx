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

    expect(markup).toContain("Remember for 30 days");
    expect(markup).toContain("Load Key &amp; Retry");
    expect(markup).toContain("~/.ssh/id_ed25519");
    expect(markup).toContain('for="ssh-credential-secret"');
    expect(markup).toContain('id="ssh-credential-remember"');
    expect(markup).toContain('aria-label="Close SSH credential dialog"');
    expect(markup).toContain(
      'aria-describedby="passphrase-dialog-description"',
    );
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

  it("disables the close control while credentials are loading", () => {
    const markup = renderToStaticMarkup(
      createElement(PassphraseDialog, {
        open: true,
        loading: true,
        onSubmit: vi.fn(),
        onCancel: vi.fn(),
      }),
    );

    expect(markup).toContain(
      '<button type="button" disabled="" aria-label="Close SSH credential dialog"',
    );
  });

  it("announces credential errors and associates them with the dialog", () => {
    const markup = renderToStaticMarkup(
      createElement(PassphraseDialog, {
        open: true,
        error: "SSH authentication failed.",
        onSubmit: vi.fn(),
        onCancel: vi.fn(),
      }),
    );

    expect(markup).toContain(
      'aria-describedby="passphrase-dialog-description passphrase-dialog-error"',
    );
    expect(markup).toContain(
      'id="passphrase-dialog-error" role="alert" aria-live="assertive"',
    );
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

  it("hides persistence for an agent-mode key fallback", () => {
    const markup = renderToStaticMarkup(
      createElement(PassphraseDialog, {
        open: true,
        onSubmit: vi.fn(),
        onCancel: vi.fn(),
        passwordAuth: { username: "operator", onSubmit: vi.fn() },
        saveForLaterAuth: "password",
      }),
    );

    expect(markup).toContain("Username and password");
    expect(markup).not.toContain("Remember for 30 days");
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
      document
        .querySelector("form")
        ?.dispatchEvent(
          new Event("submit", { bubbles: true, cancelable: true }),
        );
    });

    expect(onPasswordSubmit).toHaveBeenCalledWith("deploy", "secret", 0);
  });

  it("preserves the selected auth method and remember choice after a failed attempt", async () => {
    const onPasswordSubmit = vi.fn();
    const props = {
      open: true,
      onSubmit: vi.fn(),
      onCancel: vi.fn(),
      defaultSaveForLater: true,
      passwordAuth: {
        username: "operator",
        onSubmit: onPasswordSubmit,
      },
    } as const;
    const container = document.createElement("div");
    document.body.append(container);
    root = createRoot(container);
    await act(async () => root?.render(createElement(PassphraseDialog, props)));

    await act(async () => {
      const method = document.querySelector<HTMLSelectElement>(
        "#ssh-credential-auth-method",
      )!;
      method.value = "password";
      method.dispatchEvent(new Event("change", { bubbles: true }));
      setInputValue(
        document.querySelector<HTMLInputElement>("#ssh-credential-username")!,
        "deploy",
      );
      setInputValue(
        document.querySelector<HTMLInputElement>("#ssh-credential-secret")!,
        "secret",
      );
      document
        .querySelector("form")
        ?.dispatchEvent(
          new Event("submit", { bubbles: true, cancelable: true }),
        );
    });

    await act(async () =>
      root?.render(
        createElement(PassphraseDialog, {
          ...props,
          error: "SSH authentication failed.",
        }),
      ),
    );
    expect(onPasswordSubmit).toHaveBeenCalledWith("deploy", "secret", 30);
    expect(
      document.querySelector<HTMLSelectElement>("#ssh-credential-auth-method")
        ?.value,
    ).toBe("password");
    expect(
      document.querySelector<HTMLInputElement>("#ssh-credential-remember")
        ?.checked,
    ).toBe(true);
  });
});
