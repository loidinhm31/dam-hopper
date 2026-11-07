import { describe, expect, it } from "vitest";
import type { TerminalTarget } from "@/api/terminal-session-contract.js";
import { formatClaimKey } from "./resource-registry.js";
import { buildTerminalClaimKey } from "./terminal-claim-key.js";

describe("buildTerminalClaimKey", () => {
  const canonicalTarget: TerminalTarget = Object.freeze({
    profileId: "profile-alpha",
    generation: 2,
    serverEpoch: "f47ac10b-58cc-4372-a567-0e02b2c3d479",
    terminalId: "term-123",
    incarnation: "42",
  });

  it("produces byte-identical formatClaimKey output for targeted terminals", () => {
    const claimKey = buildTerminalClaimKey({ target: canonicalTarget });

    expect(claimKey).toEqual({
      resourceKind: "terminal",
      profileId: "profile-alpha",
      generation: 2,
      resourceId: "term-123",
      incarnation: "42",
      authority: "f47ac10b-58cc-4372-a567-0e02b2c3d479",
    });

    const formatted = formatClaimKey(claimKey);
    expect(formatted).toBe(
      "terminal/profile-alpha/2/term-123/inc:42/auth:f47ac10b-58cc-4372-a567-0e02b2c3d479",
    );
  });

  it("produces byte-identical formatClaimKey output for untargeted terminals with numeric incarnation", () => {
    const claimKey = buildTerminalClaimKey({
      profileId: "profile-alpha",
      generation: 1,
      sessionId: "term-123",
      incarnation: 42,
    });

    expect(claimKey).toEqual({
      resourceKind: "terminal",
      profileId: "profile-alpha",
      generation: 1,
      resourceId: "term-123",
      incarnation: 42,
    });

    const formatted = formatClaimKey(claimKey);
    expect(formatted).toBe("terminal/profile-alpha/1/term-123/inc:42");
  });

  it("produces byte-identical formatClaimKey output for untargeted terminals with undefined incarnation", () => {
    const claimKey = buildTerminalClaimKey({
      profileId: "profile-alpha",
      generation: 1,
      sessionId: "term-123",
      incarnation: undefined,
    });

    expect(claimKey).toEqual({
      resourceKind: "terminal",
      profileId: "profile-alpha",
      generation: 1,
      resourceId: "term-123",
      incarnation: undefined,
    });

    const formatted = formatClaimKey(claimKey);
    expect(formatted).toBe("terminal/profile-alpha/1/term-123");
  });

  it("produces distinct formatted keys for same terminalId with different profileId", () => {
    const keyA = formatClaimKey(
      buildTerminalClaimKey({
        target: { ...canonicalTarget, profileId: "profile-a" },
      }),
    );
    const keyB = formatClaimKey(
      buildTerminalClaimKey({
        target: { ...canonicalTarget, profileId: "profile-b" },
      }),
    );
    expect(keyA).not.toBe(keyB);
    expect(keyA).toContain("/profile-a/");
    expect(keyB).toContain("/profile-b/");
  });

  it("produces distinct formatted keys for same profile/id with replacement incarnation", () => {
    const keyV1 = formatClaimKey(
      buildTerminalClaimKey({
        target: { ...canonicalTarget, incarnation: "1" },
      }),
    );
    const keyV2 = formatClaimKey(
      buildTerminalClaimKey({
        target: { ...canonicalTarget, incarnation: "2" },
      }),
    );
    expect(keyV1).not.toBe(keyV2);
    expect(keyV1).toContain("/inc:1/");
    expect(keyV2).toContain("/inc:2/");
  });

  it("preserves exact incarnation types (string for target, number|undefined for untargeted)", () => {
    const targeted = buildTerminalClaimKey({ target: canonicalTarget });
    expect(typeof targeted.incarnation).toBe("string");
    expect(targeted.incarnation).toBe("42");

    const untargetedNumeric = buildTerminalClaimKey({
      profileId: "p",
      generation: 1,
      sessionId: "s",
      incarnation: 42,
    });
    expect(typeof untargetedNumeric.incarnation).toBe("number");
    expect(untargetedNumeric.incarnation).toBe(42);

    const untargetedUndefined = buildTerminalClaimKey({
      profileId: "p",
      generation: 1,
      sessionId: "s",
      incarnation: undefined,
    });
    expect(untargetedUndefined.incarnation).toBeUndefined();
  });
});
