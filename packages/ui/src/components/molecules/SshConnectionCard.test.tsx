import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { SshConnectionCard } from "./SshConnectionCard.js";
import type {
  HostKeyChallenge,
  SshConnectionProfile,
  SshForwardRule,
} from "@/lib/ssh-forward-host.js";

const connection: SshConnectionProfile = {
  id: "22222222-2222-4222-8222-222222222222",
  scopeId: "11111111-1111-4111-8111-111111111111",
  name: "Bastion",
  sshHost: "bastion.example",
  sshPort: 22,
  sshUser: "operator",
  auth: { mode: "agent" },
  createdAt: "2026-08-10T12:34:56.789Z" as SshConnectionProfile["createdAt"],
  updatedAt: "2026-08-10T12:34:56.789Z" as SshConnectionProfile["updatedAt"],
};
const rule: SshForwardRule = {
  id: "44444444-4444-4444-8444-444444444444",
  scopeId: connection.scopeId,
  connectionProfileId: connection.id,
  name: "metrics",
  localPort: 15432,
  targetHost: "127.0.0.1",
  targetPort: 5432,
  desiredEnabled: false,
  reconnect: { enabled: true, maxAttempts: 5 },
  createdAt: connection.createdAt,
  updatedAt: connection.updatedAt,
};

describe("SshConnectionCard", () => {
  it("groups rules and exposes fixed-expiry saved credential metadata", () => {
    const markup = renderToStaticMarkup(
      <SshConnectionCard
        connection={connection}
        runtime={{
          connectionProfileId: connection.id,
          generation: "2" as never,
          state: "established",
          retryAttempt: 0,
          activeChannels: 1,
          stateChangedAt: connection.updatedAt,
        }}
        credential={{
          connectionProfileId: connection.id,
          status: "saved",
          expiresAt: "2026-09-09T12:34:56.789Z" as never,
        }}
        rules={[rule]}
        ruleRuntimes={new Map()}
        pending={false}
        onConnect={() => {}}
        onDisconnect={() => {}}
        onEdit={() => {}}
        onDelete={() => {}}
        onForget={() => {}}
        onTrust={() => {}}
        onAddRule={() => {}}
        onEditRule={() => {}}
        onDeleteRule={() => {}}
        onSetRuleEnabled={() => {}}
        onBlockedAction={() => {}}
      />,
    );
    expect(markup).toContain("Established");
    expect(markup).toContain('role="status"');
    expect(markup).toContain("expires 2026-09-09T12:34:56.789Z");
    expect(markup).toContain("Forwarding rules");
    expect(markup).toContain("127.0.0.1:15432");
  });

  it("shows host-key review when a challenge arrives before an error snapshot", () => {
    const challenge: HostKeyChallenge = {
      challengeId: "challenge-1",
      connectionProfileId: connection.id,
      scopeId: connection.scopeId,
      generation: "2" as never,
      sshHost: connection.sshHost,
      sshPort: connection.sshPort,
      algorithm: "ssh-ed25519",
      fingerprint: "SHA256:example",
      expiresAt: "2026-08-10T12:35:56.789Z" as never,
    };
    const markup = renderToStaticMarkup(
      <SshConnectionCard
        connection={connection}
        challenge={challenge}
        rules={[]}
        ruleRuntimes={new Map()}
        pending={false}
        onConnect={() => {}}
        onDisconnect={() => {}}
        onEdit={() => {}}
        onDelete={() => {}}
        onForget={() => {}}
        onTrust={() => {}}
        onAddRule={() => {}}
        onEditRule={() => {}}
        onDeleteRule={() => {}}
        onSetRuleEnabled={() => {}}
        onBlockedAction={() => {}}
      />,
    );
    expect(markup).toContain("Review the host fingerprint before connecting");
    expect(markup).toContain("Review host fingerprint");
  });
});
