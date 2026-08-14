import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import { SshForwardProfileDialog } from "./SshForwardProfileDialog.js";

describe("SshForwardProfileDialog", () => {
  it("renders reviewed explicit fields without secret or path controls", () => {
    const markup = renderToStaticMarkup(
      <SshForwardProfileDialog
        open
        scopeId="11111111-1111-4111-8111-111111111111"
        existing={null}
        sourceProfile={{
          id: "11111111-1111-4111-8111-111111111111",
          name: "Bastion",
          url: "https://bastion.example:4800",
          authType: "none",
          createdAt: 1,
        }}
        pending={false}
        error={null}
        onClose={() => {}}
        onSubmit={vi.fn()}
        onListKeys={vi.fn()}
      />,
    );
    expect(markup).toContain("I reviewed the SSH endpoint");
    expect(markup).toContain("127.0.0.1 (fixed)");
    expect(markup).toContain("OS SSH agent (recommended)");
    expect(markup).not.toContain("passphrase");
    expect(markup).not.toContain("keychain");
    expect(markup).not.toContain('type="password"');
  });
});
