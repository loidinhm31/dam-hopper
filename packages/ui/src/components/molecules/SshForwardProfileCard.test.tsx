import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { SshForwardProfileCard } from "./SshForwardProfileCard.js";
import type { SshForwardProfile } from "@/lib/ssh-forward-host.js";

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

describe("SshForwardProfileCard", () => {
  it("shows loopback limitation and stop-before-edit behavior", () => {
    const markup = renderToStaticMarkup(
      <SshForwardProfileCard
        profile={profile}
        runtime={{
          profileId: profile.id,
          generation: "1" as SshForwardProfile["createdAt"],
          state: "running",
          bindHost: "127.0.0.1",
          localPort: profile.localPort,
          retryAttempt: 0,
          activeChannels: 0,
          autoStartDisposition: "notRequested",
          stateChangedAt: profile.updatedAt,
        }}
        pending={false}
        onStart={() => {}}
        onStop={() => {}}
        onRestart={() => {}}
        onEdit={() => {}}
        onDelete={() => {}}
        onTrust={() => {}}
        onBlockedAction={() => {}}
      />,
    );
    expect(markup).toContain("Any process on this computer can connect");
    expect(markup).toContain("Stop");
    expect(markup).toContain("127.0.0.1:15432");
  });

  it("renders changed-key review without an unknown challenge", () => {
    const markup = renderToStaticMarkup(
      <SshForwardProfileCard
        profile={profile}
        runtime={{
          profileId: profile.id,
          generation: "1" as SshForwardProfile["createdAt"],
          state: "failed",
          bindHost: "127.0.0.1",
          localPort: profile.localPort,
          retryAttempt: 0,
          activeChannels: 0,
          autoStartDisposition: "notRequested",
          stateChangedAt: profile.updatedAt,
          errorCode: "HOST_KEY_CHANGED",
        }}
        pending={false}
        onStart={() => {}}
        onStop={() => {}}
        onRestart={() => {}}
        onEdit={() => {}}
        onDelete={() => {}}
        onTrust={() => {}}
        onBlockedAction={() => {}}
      />,
    );
    expect(markup).toContain("Review host fingerprint");
    expect(markup).toContain("SSH host identity changed");
  });
});
