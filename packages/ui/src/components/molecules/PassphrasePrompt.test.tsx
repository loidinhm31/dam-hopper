import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { PassphrasePrompt } from "./PassphrasePrompt.js";

let prompting = true;

vi.mock("@/contexts/EncryptContext.js", () => ({
  useEncryptMode: () => ({
    isPrompting: prompting,
    promptingProject: "demo",
    resolvePrompt: vi.fn(),
    rejectPrompt: vi.fn(),
  }),
}));

describe("PassphrasePrompt", () => {
  beforeEach(() => {
    prompting = true;
  });

  it("renders enabled passphrase input and submit button", () => {
    const markup = renderToStaticMarkup(<PassphrasePrompt />);

    expect(markup).toContain('id="pp-input"');
    expect(markup).not.toMatch(/<input[^>]*id="pp-input"[^>]*disabled=""/);
    expect(markup).toMatch(/<button[^>]*type="submit"[^>]*>/);
    expect(markup).not.toMatch(/<button[^>]*type="submit"[^>]*disabled=""/);
  });
});
