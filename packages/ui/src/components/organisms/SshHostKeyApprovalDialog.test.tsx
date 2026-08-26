import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { SshHostKeyApprovalDialog } from "./SshHostKeyApprovalDialog.js";
import type {
  HostKeyChallenge,
  SshForwardProfile,
} from "@/lib/ssh-forward-host.js";

const profile: SshForwardProfile = {
  id: "22222222-2222-4222-8222-222222222222",
  scopeId: "11111111-1111-4111-8111-111111111111",
  name: "metrics",
  sshHost: "bastion.example",
  sshPort: 22,
  sshUser: "operator",
  auth: { mode: "agent" },
  localPort: 15432,
  targetHost: "127.0.0.1",
  targetPort: 5432,
  autoStart: false,
  reconnect: { enabled: true, maxAttempts: 5 },
  createdAt: "2026-08-10T12:34:56.789Z" as SshForwardProfile["createdAt"],
  updatedAt: "2026-08-10T12:34:56.789Z" as SshForwardProfile["updatedAt"],
};
const challenge: HostKeyChallenge = {
  challengeId: "33333333-3333-4333-8333-333333333333",
  profileId: profile.id,
  scopeId: profile.scopeId,
  generation: "1" as SshForwardProfile["createdAt"],
  sshHost: profile.sshHost,
  sshPort: profile.sshPort,
  algorithm: "ssh-ed25519",
  fingerprint: "SHA256:abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNO",
  expiresAt: "2026-08-10T12:35:56.789Z" as SshForwardProfile["createdAt"],
};

describe("SshHostKeyApprovalDialog", () => {
  it("shows exact unknown fingerprint and explicit start follow-up", () => {
    const markup = renderToStaticMarkup(
      <SshHostKeyApprovalDialog
        open
        profile={profile}
        challenge={challenge}
        pending={false}
        onApprove={() => {}}
        onClose={() => {}}
      />,
    );
    expect(markup).toContain(challenge.fingerprint);
    expect(markup).toContain("Runtime generation");
    expect(markup).toContain(challenge.generation);
    expect(markup).toContain("Approve exact fingerprint");
    expect(markup).toContain("Verify this fingerprint");
  });

  it("shows changed-key remediation without an approval control", () => {
    const markup = renderToStaticMarkup(
      <SshHostKeyApprovalDialog
        open
        profile={profile}
        errorCode="HOST_KEY_CHANGED"
        metadata={{
          trustPath: "C:\\App\\known-hosts.toml",
          executablePath: "C:\\App\\dam-hopper.exe",
        }}
        pending={false}
        onApprove={() => {}}
        onClose={() => {}}
      />,
    );
    expect(markup).toContain(
      "Connection blocked because the saved SSH host identity no longer matches.",
    );
    expect(markup).toContain("--ssh-forward-trust-repair remove-endpoint");
    expect(markup).toContain("C:\\App\\known-hosts.toml");
    expect(markup).toContain("Run from Command Prompt");
    expect(markup).not.toContain("operator@");
    expect(markup).not.toContain("Approve exact fingerprint");
  });
});
