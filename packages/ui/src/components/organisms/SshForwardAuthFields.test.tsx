import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import { SshForwardAuthFields } from "./SshForwardAuthFields.js";
import { newSshForwardDraft } from "@/lib/ssh-forward-form.js";

describe("SshForwardAuthFields", () => {
  it("offers only local inventory keys for profile-bound authentication", () => {
    const draft = {
      ...newSshForwardDraft(null),
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
});
