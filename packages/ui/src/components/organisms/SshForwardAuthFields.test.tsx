import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import { SshForwardAuthFields } from "./SshForwardAuthFields.js";
import { newSshConnectionDraft } from "@/lib/ssh-forward-form.js";

describe("SshForwardAuthFields", () => {
  it("offers only local inventory keys for connection authentication", () => {
    const draft = {
      ...newSshConnectionDraft(null),
      authMode: "key" as const,
    };
    const markup = renderToStaticMarkup(
      <SshForwardAuthFields
        draft={draft}
        errors={{}}
        keys={[
          {
            keyId: "agent-0",
            label: "Agent identity 1",
            algorithm: "ssh-ed25519",
            fingerprint: "SHA256:agent",
            encrypted: false,
            source: "agent",
          },
          {
            keyId: "key-local",
            label: "work (passphrase required)",
            algorithm: "ssh-ed25519",
            fingerprint: "SHA256:local",
            encrypted: true,
            source: "local",
          },
        ]}
        keyError={null}
        onUpdate={vi.fn()}
      />,
    );
    expect(markup).toContain("Local SSH key (passphrase if needed)");
    expect(markup).toContain("key-local");
    expect(markup).not.toContain("agent-0");
  });

  it("associates inventory failures with the key selector", () => {
    const draft = {
      ...newSshConnectionDraft(null),
      authMode: "key" as const,
    };
    const markup = renderToStaticMarkup(
      <SshForwardAuthFields
        draft={draft}
        errors={{ keyId: "Select a local key." }}
        keys={null}
        keyError="Local key inventory unavailable."
        onUpdate={vi.fn()}
      />,
    );

    expect(markup).toContain('id="ssh-forward-key-id"');
    expect(markup).toContain('aria-invalid="true"');
    expect(markup).toContain(
      'aria-describedby="ssh-forward-key-id-error ssh-forward-key-inventory-error"',
    );
    expect(markup).toContain(
      'id="ssh-forward-key-inventory-error" role="alert"',
    );
  });
});
