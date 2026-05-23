import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import {
  buildPassphraseDialogSubmission,
  PassphraseDialog,
} from "./PassphraseDialog.js";

describe("PassphraseDialog", () => {
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

  it("builds a submission payload that preserves save-for-later", () => {
    expect(
      buildPassphraseDialogSubmission(
        "secret",
        "id_ed25519",
        true,
      ),
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
});
