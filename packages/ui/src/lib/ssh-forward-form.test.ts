import { describe, expect, it } from "vitest";
import {
  buildSshConnectionProfile,
  buildSshForwardRule,
  draftFromSshConnectionProfile,
  draftFromSshForwardRule,
  newSshConnectionDraft,
  newSshForwardRuleDraft,
  isSafeSshHost,
  sshHostFromServerProfile,
  validateSshConnectionDraft,
  validateSshForwardRuleDraft,
} from "./ssh-forward-form.js";
import type { ServerProfile } from "@/api/server-config.js";
import type {
  SshConnectionProfile,
  SshForwardRule,
} from "./ssh-forward-host.js";

const source: ServerProfile = {
  id: "11111111-1111-4111-8111-111111111111",
  name: "Bastion",
  url: "https://Example.COM:4800/api",
  authType: "none",
  createdAt: 1,
};

const connection: SshConnectionProfile = {
  id: "22222222-2222-4222-8222-222222222222",
  scopeId: source.id,
  name: "Bastion SSH",
  sshHost: "old.example",
  sshPort: 22,
  sshUser: "operator",
  auth: { mode: "agent" },
  createdAt: "2026-08-10T12:34:56.789Z" as SshConnectionProfile["createdAt"],
  updatedAt: "2026-08-10T12:34:56.789Z" as SshConnectionProfile["updatedAt"],
};

const rule: SshForwardRule = {
  id: "44444444-4444-4444-8444-444444444444",
  scopeId: source.id,
  connectionProfileId: connection.id,
  name: "metrics",
  localPort: 15432,
  targetHost: "127.0.0.1",
  targetPort: 5432,
  desiredEnabled: false,
  reconnect: { enabled: true, maxAttempts: 5 },
  createdAt: "2026-08-10T12:34:56.789Z" as SshForwardRule["createdAt"],
  updatedAt: "2026-08-10T12:34:56.789Z" as SshForwardRule["updatedAt"],
};

describe("ssh-forward-form", () => {
  it("prefills only a safe HTTP hostname and SSH port", () => {
    const draft = newSshConnectionDraft(source);
    expect(draft.sshHost).toBe("example.com");
    expect(draft.sshPort).toBe("22");
    expect(draft.reviewed).toBe(false);
    expect(
      sshHostFromServerProfile({ ...source, url: "http://[::1]:4800" }),
    ).toBe("");
  });

  it("keeps connection and rule validation independent", () => {
    const connectionErrors = validateSshConnectionDraft({
      ...newSshConnectionDraft(null),
      name: "connection",
      sshHost: "[::1]",
      sshPort: "22.5",
      sshUser: "operator",
      reviewed: true,
    });
    expect(connectionErrors.sshHost).toBeDefined();
    expect(connectionErrors.sshPort).toBeDefined();

    const ruleErrors = validateSshForwardRuleDraft({
      ...newSshForwardRuleDraft(),
      name: "rule",
      localPort: "0",
      targetPort: "65536",
      reviewed: true,
    });
    expect(ruleErrors.localPort).toBeDefined();
    expect(ruleErrors.targetPort).toBeDefined();
  });

  it("rejects numeric dotted pseudo-hosts that native rejects", () => {
    expect(isSafeSshHost("123.456")).toBe(false);
    expect(isSafeSshHost("123")).toBe(false);
    expect(isSafeSshHost("192.168.1.20")).toBe(true);
  });

  it("mirrors native control-character validation for persisted text", () => {
    const connectionErrors = validateSshConnectionDraft({
      ...newSshConnectionDraft(null),
      name: "connection\nname",
      sshHost: "bastion.example",
      sshPort: "22",
      sshUser: "operator\u0007",
      reviewed: true,
    });
    expect(connectionErrors.name).toContain("control characters");
    expect(connectionErrors.sshUser).toContain("control characters");

    const ruleErrors = validateSshForwardRuleDraft({
      ...newSshForwardRuleDraft(),
      name: "rule\tname",
      localPort: "15432",
      targetPort: "5432",
      reviewed: true,
    });
    expect(ruleErrors.name).toContain("control characters");
  });

  it("builds credential-free connections and loopback-only rules", () => {
    const connectionDraft = {
      ...draftFromSshConnectionProfile(connection),
      reviewed: true,
    };
    const builtConnection = buildSshConnectionProfile(
      connectionDraft,
      connection.scopeId,
      connection,
    );
    expect(builtConnection?.id).toBe(connection.id);
    expect(builtConnection?.sshHost).toBe("old.example");

    const ruleDraft = {
      ...draftFromSshForwardRule(rule),
      reviewed: true,
    };
    const builtRule = buildSshForwardRule(
      ruleDraft,
      rule.scopeId,
      rule.connectionProfileId,
      rule,
    );
    expect(builtRule?.id).toBe(rule.id);
    expect(builtRule?.targetHost).toBe("127.0.0.1");
    expect(builtRule?.reconnect.maxAttempts).toBe(5);
  });
});
