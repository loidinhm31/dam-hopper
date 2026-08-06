import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { PassphrasePrompt } from "./PassphrasePrompt.js";

let androidChromeSuppressed = false;
let prompting = true;

vi.mock("@/contexts/AndroidChromeInputPolicyContext.js", () => ({
  useAndroidChromeInputPolicy: () => ({
    isAndroidChromeNativeInputSuppressed: androidChromeSuppressed,
  }),
}));

vi.mock("@/contexts/EncryptContext.js", () => ({
  useEncryptMode: () => ({
    isPrompting: prompting,
    promptingProject: "demo",
    resolvePrompt: vi.fn(),
    rejectPrompt: vi.fn(),
  }),
}));

describe("PassphrasePrompt Android Chrome text actions", () => {
  beforeEach(() => {
    androidChromeSuppressed = false;
    prompting = true;
  });

  it("disables passphrase entry and submission when native text input is suppressed", () => {
    androidChromeSuppressed = true;
    const markup = renderToStaticMarkup(<PassphrasePrompt />);

    expect(markup).toContain('id="pp-input"');
    expect(markup).toMatch(/<input[^>]*id="pp-input"[^>]*disabled=""/);
    expect(markup).toContain(
      'title="Passphrase entry is unavailable in Android Chrome"',
    );
    expect(markup).toMatch(/<button[^>]*type="submit"[^>]*disabled=""/);
  });
});
