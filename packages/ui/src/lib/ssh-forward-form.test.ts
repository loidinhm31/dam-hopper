import { describe, expect, it } from "vitest";
import {
  buildSshForwardProfile,
  draftFromSshForwardProfile,
  newSshForwardDraft,
  sshHostFromServerProfile,
  validateSshForwardDraft,
} from "./ssh-forward-form.js";
import type { ServerProfile } from "@/api/server-config.js";
import type { SshForwardProfile } from "./ssh-forward-host.js";

const source: ServerProfile = {
  id: "11111111-1111-4111-8111-111111111111",
  name: "Bastion",
  url: "https://Example.COM:4800/api",
  authType: "none",
  createdAt: 1,
};

const saved: SshForwardProfile = {
  id: "22222222-2222-4222-8222-222222222222",
  scopeId: source.id,
  name: "Saved forward",
  sshHost: "old.example",
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

describe("ssh-forward-form", () => {
  it("prefills only safe HTTP hostname and SSH port", () => {
    const draft = newSshForwardDraft(source);
    expect(draft.sshHost).toBe("example.com");
    expect(draft.sshPort).toBe("22");
    expect(draft.reviewed).toBe(false);
    expect(
      sshHostFromServerProfile({ ...source, url: "http://[::1]:4800" }),
    ).toBe("");
  });

  it("rejects non-integer, wildcard, IPv6, zero, and out-of-range ports", () => {
    const draft = {
      ...newSshForwardDraft(null),
      name: "forward",
      sshHost: "[::1]",
      sshPort: "22.5",
      sshUser: "operator",
      localPort: "0",
      targetPort: "65536",
      reviewed: true,
    };
    const errors = validateSshForwardDraft(draft);
    expect(errors.sshHost).toBeDefined();
    expect(errors.sshPort).toBeDefined();
    expect(errors.localPort).toBeDefined();
    expect(errors.targetPort).toBeDefined();
    expect(
      validateSshForwardDraft({ ...draft, sshHost: "*" }).sshHost,
    ).toBeDefined();
  });

  it("builds fixed loopback targets and keeps saved endpoint values independent", () => {
    const draft = { ...draftFromSshForwardProfile(saved), reviewed: true };
    const profile = buildSshForwardProfile(draft, saved.scopeId, saved);
    expect(profile).not.toBeNull();
    expect(profile?.id).toBe(saved.id);
    expect(profile?.createdAt).toBe(saved.createdAt);
    expect(profile?.sshHost).toBe("old.example");
    expect(profile?.targetHost).toBe("127.0.0.1");
    expect(profile?.reconnect.maxAttempts).toBe(5);
  });
});
