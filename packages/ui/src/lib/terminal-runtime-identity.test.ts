import { describe, expect, it } from "vitest";
import type { ConnectionSnapshot } from "@/api/connections.js";
import { terminalKey } from "@/api/ownership.js";
import type { TerminalTarget } from "@/api/terminal-session-contract.js";
import {
  buildTerminalRuntimeIndex,
  parseStrictLogicalTerminalKey,
  resolveTerminalRuntimeTarget,
  type TerminalRuntimeCandidate,
} from "./terminal-runtime-identity.js";

describe("terminal-runtime-identity", () => {
  const profileId = "profile-1";
  const terminalId = "term-42";
  const validLogicalKey = terminalKey({ profileId, id: terminalId });
  const serverEpoch = "a1b2c3d4-e5f6-4a5b-8c9d-0e1f2a3b4c5d";

  const targetV1: TerminalTarget = Object.freeze({
    profileId,
    generation: 2,
    serverEpoch,
    terminalId,
    incarnation: "1",
  });

  const targetV2: TerminalTarget = Object.freeze({
    profileId,
    generation: 2,
    serverEpoch,
    terminalId,
    incarnation: "2",
  });

  function createConnectedSnapshot(
    pId: string = profileId,
    gen: number = 2,
  ): ConnectionSnapshot {
    return Object.freeze({
      owner: Object.freeze({ profileId: pId, generation: gen }),
      status: "connected",
      intent: true,
      lastTransitionTime: Date.now(),
      consecutiveFailures: 0,
      transport: null,
      api: null,
    }) as unknown as ConnectionSnapshot;
  }

  const defaultGetSnapshot = (pId: string) =>
    pId === profileId ? createConnectedSnapshot(profileId, 2) : null;

  it("happy path: resolves exact terminationTarget from connected candidate", () => {
    const candidate: TerminalRuntimeCandidate = {
      profileId,
      id: terminalId,
      terminationTarget: targetV1,
    };

    const resolved = resolveTerminalRuntimeTarget(
      validLogicalKey,
      [candidate],
      defaultGetSnapshot,
    );
    expect(resolved).toBe(targetV1);

    const index = buildTerminalRuntimeIndex([candidate], defaultGetSnapshot);
    expect(index.get(validLogicalKey)).toBe(targetV1);
  });

  it("returns undefined when terminationTarget is null", () => {
    const candidate: TerminalRuntimeCandidate = {
      profileId,
      id: terminalId,
      terminationTarget: null,
    };

    const resolved = resolveTerminalRuntimeTarget(
      validLogicalKey,
      [candidate],
      defaultGetSnapshot,
    );
    expect(resolved).toBeUndefined();
  });

  it("returns undefined when snapshot is missing or disconnected", () => {
    const candidate: TerminalRuntimeCandidate = {
      profileId,
      id: terminalId,
      terminationTarget: targetV1,
    };

    // Missing snapshot
    const resolvedMissing = resolveTerminalRuntimeTarget(
      validLogicalKey,
      [candidate],
      () => null,
    );
    expect(resolvedMissing).toBeUndefined();

    // Disconnected snapshot
    const disconnectedSnapshot = {
      ...createConnectedSnapshot(),
      status: "disconnected" as const,
    };
    const resolvedDisconnected = resolveTerminalRuntimeTarget(
      validLogicalKey,
      [candidate],
      () => disconnectedSnapshot,
    );
    expect(resolvedDisconnected).toBeUndefined();
  });

  it("returns undefined when owner generation is retired/mismatched", () => {
    const candidate: TerminalRuntimeCandidate = {
      profileId,
      id: terminalId,
      terminationTarget: targetV1, // generation: 2
    };

    // Snapshot has generation 3 (generation progressed/retired)
    const retiredSnapshot = createConnectedSnapshot(profileId, 3);
    const resolved = resolveTerminalRuntimeTarget(
      validLogicalKey,
      [candidate],
      () => retiredSnapshot,
    );
    expect(resolved).toBeUndefined();
  });

  it("returns undefined when snapshot owner profileId mismatches candidate", () => {
    const candidate: TerminalRuntimeCandidate = {
      profileId,
      id: terminalId,
      terminationTarget: targetV1,
    };

    const mismatchedSnapshot = createConnectedSnapshot("other-profile", 2);
    const resolved = resolveTerminalRuntimeTarget(
      validLogicalKey,
      [candidate],
      () => mismatchedSnapshot,
    );
    expect(resolved).toBeUndefined();
  });

  it("returns undefined when target.profileId or target.terminalId mismatches candidate", () => {
    const mismatchProfileCandidate: TerminalRuntimeCandidate = {
      profileId,
      id: terminalId,
      terminationTarget: { ...targetV1, profileId: "different-profile" },
    };
    expect(
      resolveTerminalRuntimeTarget(
        validLogicalKey,
        [mismatchProfileCandidate],
        defaultGetSnapshot,
      ),
    ).toBeUndefined();

    const mismatchIdCandidate: TerminalRuntimeCandidate = {
      profileId,
      id: terminalId,
      terminationTarget: { ...targetV1, terminalId: "different-id" },
    };
    expect(
      resolveTerminalRuntimeTarget(
        validLogicalKey,
        [mismatchIdCandidate],
        defaultGetSnapshot,
      ),
    ).toBeUndefined();
  });

  it("returns undefined for non-canonical UUID serverEpoch or non-canonical incarnation", () => {
    const badEpochCandidate: TerminalRuntimeCandidate = {
      profileId,
      id: terminalId,
      terminationTarget: { ...targetV1, serverEpoch: "not-a-uuid" },
    };
    expect(
      resolveTerminalRuntimeTarget(
        validLogicalKey,
        [badEpochCandidate],
        defaultGetSnapshot,
      ),
    ).toBeUndefined();

    const badIncarnationCandidate: TerminalRuntimeCandidate = {
      profileId,
      id: terminalId,
      terminationTarget: { ...targetV1, incarnation: "0" }, // not positive
    };
    expect(
      resolveTerminalRuntimeTarget(
        validLogicalKey,
        [badIncarnationCandidate],
        defaultGetSnapshot,
      ),
    ).toBeUndefined();

    const nonNumericIncarnationCandidate: TerminalRuntimeCandidate = {
      profileId,
      id: terminalId,
      terminationTarget: { ...targetV1, incarnation: "foo" },
    };
    expect(
      resolveTerminalRuntimeTarget(
        validLogicalKey,
        [nonNumericIncarnationCandidate],
        defaultGetSnapshot,
      ),
    ).toBeUndefined();
  });

  it("strictly rejects malformed keys, 3-tuple instance keys, and 5-tuple runtime target keys", () => {
    expect(parseStrictLogicalTerminalKey("not json")).toBeNull();
    expect(parseStrictLogicalTerminalKey("")).toBeNull();
    expect(parseStrictLogicalTerminalKey(JSON.stringify(["p"]))).toBeNull();
    // 3-element instance key: [profileId, id, incarnation]
    expect(
      parseStrictLogicalTerminalKey(JSON.stringify(["p", "id", 1])),
    ).toBeNull();
    // 5-element runtime target key: [profileId, gen, epoch, id, inc]
    expect(
      parseStrictLogicalTerminalKey(
        JSON.stringify(["p", 1, serverEpoch, "id", "1"]),
      ),
    ).toBeNull();
    // Non-string elements
    expect(parseStrictLogicalTerminalKey(JSON.stringify([1, 2]))).toBeNull();

    // Valid 2-element tuple parses
    expect(parseStrictLogicalTerminalKey(validLogicalKey)).toEqual({
      profileId,
      id: terminalId,
    });
  });

  it("replacement incarnation returns the NEW target only", () => {
    const candidateV1: TerminalRuntimeCandidate = {
      profileId,
      id: terminalId,
      terminationTarget: targetV1, // incarnation: "1"
    };
    const candidateV2: TerminalRuntimeCandidate = {
      profileId,
      id: terminalId,
      terminationTarget: targetV2, // incarnation: "2"
    };

    // Supplied in updated inventory order [candidateV1, candidateV2]
    const resolved = resolveTerminalRuntimeTarget(
      validLogicalKey,
      [candidateV1, candidateV2],
      defaultGetSnapshot,
    );
    expect(resolved).toBe(targetV2);
    expect(resolved?.incarnation).toBe("2");

    // Supplied in reverse order [candidateV2, candidateV1], higher incarnation still wins
    const resolvedReverse = resolveTerminalRuntimeTarget(
      validLogicalKey,
      [candidateV2, candidateV1],
      defaultGetSnapshot,
    );
    expect(resolvedReverse).toBe(targetV2);
    expect(resolvedReverse?.incarnation).toBe("2");

    // Index agrees
    const index = buildTerminalRuntimeIndex(
      [candidateV1, candidateV2],
      defaultGetSnapshot,
    );
    expect(index.get(validLogicalKey)).toBe(targetV2);
  });

  it("fails closed (returns undefined) when candidates have conflicting serverEpoch values", () => {
    const candidateEpoch1: TerminalRuntimeCandidate = {
      profileId,
      id: terminalId,
      terminationTarget: targetV1, // serverEpoch: serverEpoch
    };
    const candidateEpoch2: TerminalRuntimeCandidate = {
      profileId,
      id: terminalId,
      terminationTarget: {
        ...targetV1,
        serverEpoch: "b2c3d4e5-f6a7-4b5c-9d0e-1f2a3b4c5d6e",
        incarnation: "99",
      },
    };

    // Conflicting epochs cannot establish authority -> fail closed
    const resolved = resolveTerminalRuntimeTarget(
      validLogicalKey,
      [candidateEpoch1, candidateEpoch2],
      defaultGetSnapshot,
    );
    expect(resolved).toBeUndefined();

    const index = buildTerminalRuntimeIndex(
      [candidateEpoch1, candidateEpoch2],
      defaultGetSnapshot,
    );
    expect(index.get(validLogicalKey)).toBeUndefined();
  });

  it("resolves sequentially across separate old and current inventory snapshots", () => {
    const oldInventory: TerminalRuntimeCandidate[] = [
      { profileId, id: terminalId, terminationTarget: targetV1 },
    ];
    const currentInventory: TerminalRuntimeCandidate[] = [
      { profileId, id: terminalId, terminationTarget: targetV2 },
    ];

    const oldResolved = resolveTerminalRuntimeTarget(
      validLogicalKey,
      oldInventory,
      defaultGetSnapshot,
    );
    expect(oldResolved).toBe(targetV1);

    const currentResolved = resolveTerminalRuntimeTarget(
      validLogicalKey,
      currentInventory,
      defaultGetSnapshot,
    );
    expect(currentResolved).toBe(targetV2);
  });
});
