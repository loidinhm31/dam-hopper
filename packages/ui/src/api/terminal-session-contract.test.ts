import { describe, expect, it } from "vitest";
import {
  decodeTerminationHeaders,
} from "./ws-transport.js";
import {
  createTerminalTargetFromObservation,
  isCanonicalPositiveU64,
  isTerminalInventoryRowEligible,
  isTerminalInventoryTerminationState,
  isTerminationResultValid,
  proveNumericEvidenceJoin,
  resolveWindowTerminalObservation,
  type TerminalInventoryObservation,
  type TerminalInventoryRow,
  type TerminalTarget,
  type TerminationMetadata,
  type TerminationOrigin,
  type TerminationState,
} from "./terminal-session-contract.js";
import {
  captureTerminalTarget,
  reconcileTermination,
} from "../lib/terminal-session-actions.js";
import fixtures from "./terminal-termination-fixtures.json";

describe("Terminal Session Contract Specifications (C1–C5)", () => {
  describe("maxU64ExactEligibility", () => {
    for (const fixture of fixtures.maxU64ExactEligibility) {
      it(fixture.id, () => {
        const row = fixture.input as unknown as TerminalInventoryRow;
        const eligible = isTerminalInventoryRowEligible(row);
        expect(eligible).toBe(fixture.expected.eligible);
        expect(isCanonicalPositiveU64(fixture.input.incarnationExact)).toBe(
          fixture.expected.isCanonicalPositiveU64,
        );

        const observation: TerminalInventoryObservation = {
          owner: { profileId: "prof-1", generation: 1 },
          termination: { version: 1, serverEpoch: "e7b0c36b-67df-4f0e-b7d5-866468453483" },
          sessions: [row],
        };
        const target = createTerminalTargetFromObservation(observation, row);
        expect(target).not.toBeNull();
        expect(target?.incarnation).toBe(fixture.input.incarnationExact);
      });
    }
  });

  describe("canonicalExactLegacySafeAgreementAndDisagreement", () => {
    for (const fixture of fixtures.canonicalExactLegacySafeAgreementAndDisagreement) {
      it(fixture.id, () => {
        const row = fixture.input as unknown as TerminalInventoryRow;
        const eligible = isTerminalInventoryRowEligible(row);
        expect(eligible).toBe(fixture.expected.eligible);
      });
    }
  });

  describe("malformedOrMissingExactNeverNumericFallback", () => {
    for (const fixture of fixtures.malformedOrMissingExactNeverNumericFallback) {
      it(fixture.id, () => {
        const row = fixture.input as unknown as TerminalInventoryRow;
        const eligible = isTerminalInventoryRowEligible(row);
        expect(eligible).toBe(fixture.expected.eligible);
      });
    }
  });

  describe("headersValidation", () => {
    for (const fixture of fixtures.headersValidation) {
      it(fixture.id, () => {
        const metadata = decodeTerminationHeaders(fixture.headers);
        expect(metadata).toEqual(fixture.expected.metadata);
      });
    }
  });

  describe("downstreamNumericJoinRefusal", () => {
    for (const fixture of fixtures.downstreamNumericJoinRefusal) {
      it(fixture.id, () => {
        const permitted = proveNumericEvidenceJoin(
          fixture.numericEvidence,
          fixture.targetIncarnationExact,
        );
        expect(permitted).toBe(fixture.expected.joinPermitted);
      });
    }
  });

  describe("sixFlatTerminationStates", () => {
    for (const fixture of fixtures.sixFlatTerminationStates) {
      it(fixture.id, () => {
        const valid = isTerminalInventoryTerminationState(fixture.input.terminationState);
        expect(valid).toBe(fixture.expected.valid);
      });
    }
  });

  describe("sameIdsAcrossEpochs", () => {
    for (const fixture of fixtures.sameIdsAcrossEpochs) {
      it(fixture.id, () => {
        const target = fixture.target as TerminalTarget;
        const incoming = fixture.incomingObservation;
        const row = {
          id: incoming.terminalId,
          incarnationExact: incoming.incarnationExact,
          terminationState: "exited",
        } as TerminalInventoryRow;
        const currentObservation: TerminalInventoryObservation = {
          owner: { profileId: target.profileId, generation: target.generation },
          termination: { version: 1, serverEpoch: incoming.serverEpoch },
          sessions: [row],
        };
        const incomingTarget = createTerminalTargetFromObservation(currentObservation, row);
        expect(incomingTarget).not.toBeNull();
        expect(incomingTarget?.serverEpoch === target.serverEpoch).toBe(fixture.expected.targetMatch);
        const priorAction: TerminationState = {
          status: "terminationRequested",
          target,
          origin: "live",
        };
        const reconciled = reconcileTermination(priorAction, currentObservation);
        expect(reconciled).toBe(priorAction);
      });
    }
  });

  describe("terminationEndpoints", () => {
    for (const fixture of fixtures.terminationEndpoints) {
      it(fixture.id, () => {
        const target = fixture.target as TerminalTarget;
        const origin = fixture.origin as TerminationOrigin;
        const valid = isTerminationResultValid(
          fixture.status,
          fixture.body,
          target,
          origin,
        );
        expect(valid).toBe("valid" in fixture.expected ? fixture.expected.valid : false);
      });
    }
  });

  describe("signalAndLossReconciliation", () => {
    for (const fixture of fixtures.signalAndLossReconciliation) {
      if (!("lossScenario" in fixture)) continue;
      it(fixture.id, () => {
        const target = fixture.target as TerminalTarget;
        const origin = fixture.origin as TerminationOrigin;
        const authority = fixture.authority;
        const priorAction: TerminationState = {
          status: "outcomeUnknown",
          target,
          origin,
        };
        const rows =
          "subsequentObservationRow" in fixture
            ? [fixture.subsequentObservationRow as unknown as TerminalInventoryRow]
            : ("subsequentObservationRows" in fixture
                ? (fixture.subsequentObservationRows as unknown as TerminalInventoryRow[])
                : []);
        const observation: TerminalInventoryObservation = {
          owner: authority.owner,
          termination: authority.termination as unknown as TerminationMetadata,
          sessions: rows,
        };
        const reconciled = reconcileTermination(priorAction, observation);
        expect(reconciled.status).toBe(fixture.expected.finalStatus);
        expect(reconciled.target).toEqual(target);
      });
    }
  });

  describe("captureTerminalTarget", () => {
    it("captures live session target and live origin when row is live and alive is true", () => {
      const row: TerminalInventoryRow = {
        id: "term-1",
        command: "bash",
        cwd: "/home",
        type: "terminal",
        startedAt: 100,
        alive: true,
        incarnation: 42,
        incarnationExact: "42",
        terminationState: "live",
      };
      const obs: TerminalInventoryObservation = {
        owner: { profileId: "prof-1", generation: 1 },
        termination: { version: 1, serverEpoch: "e7b0c36b-67df-4f0e-b7d5-866468453483" },
        sessions: [row],
      };
      const captured = captureTerminalTarget(obs, "term-1");
      expect(captured).not.toBeNull();
      expect(captured?.status).toBe("captured");
      expect(captured?.origin).toBe("live");
      expect(captured?.target).toEqual({
        profileId: "prof-1",
        generation: 1,
        serverEpoch: "e7b0c36b-67df-4f0e-b7d5-866468453483",
        terminalId: "term-1",
        incarnation: "42",
      });
    });

    it("captures restartPending session target and restartPending origin when alive is false", () => {
      const row: TerminalInventoryRow = {
        id: "term-2",
        command: "npm start",
        cwd: "/home",
        type: "terminal",
        startedAt: 100,
        alive: false,
        incarnation: 55,
        incarnationExact: "55",
        terminationState: "restartPending",
      };
      const obs: TerminalInventoryObservation = {
        owner: { profileId: "prof-1", generation: 1 },
        termination: { version: 1, serverEpoch: "e7b0c36b-67df-4f0e-b7d5-866468453483" },
        sessions: [row],
      };
      const captured = captureTerminalTarget(obs, "term-2");
      expect(captured).not.toBeNull();
      expect(captured?.origin).toBe("restartPending");
    });

    it("rejects capturing target for exited, restartCancelled, or unavailable sessions", () => {
      const states = ["exited", "restartCancelled", "unavailable"] as const;
      for (const st of states) {
        const row: TerminalInventoryRow = {
          id: `term-${st}`,
          command: "bash",
          cwd: "/home",
          type: "terminal",
          startedAt: 100,
          alive: false,
          incarnation: 1,
          incarnationExact: "1",
          terminationState: st,
        };
        const obs: TerminalInventoryObservation = {
          owner: { profileId: "prof-1", generation: 1 },
          termination: { version: 1, serverEpoch: "e7b0c36b-67df-4f0e-b7d5-866468453483" },
          sessions: [row],
        };
        expect(captureTerminalTarget(obs, `term-${st}`)).toBeNull();
      }
    });

    it("rejects capturing target when alive boolean is inconsistent with terminationState", () => {
      const row: TerminalInventoryRow = {
        id: "term-inconsistent",
        command: "bash",
        cwd: "/home",
        type: "terminal",
        startedAt: 100,
        alive: false, // inconsistent with live
        incarnation: 1,
        incarnationExact: "1",
        terminationState: "live",
      };
      const obs: TerminalInventoryObservation = {
        owner: { profileId: "prof-1", generation: 1 },
        termination: { version: 1, serverEpoch: "e7b0c36b-67df-4f0e-b7d5-866468453483" },
        sessions: [row],
      };
      expect(captureTerminalTarget(obs, "term-inconsistent")).toBeNull();
    });
  });

  describe("resolveWindowTerminalObservation", () => {
    const sampleEpoch = "e7b0c36b-67df-4f0e-b7d5-866468453483";
    const sampleObservation: TerminalInventoryObservation = {
      owner: { profileId: "prof-1", generation: 1 },
      termination: { version: 1, serverEpoch: sampleEpoch },
      sessions: [
        {
          id: "term-1",
          command: "bash",
          cwd: "/home",
          type: "terminal",
          startedAt: 100,
          alive: true,
          incarnation: 42,
          incarnationExact: "42",
          terminationState: "live",
        },
        {
          id: "term-max-u64",
          command: "bash",
          cwd: "/home",
          type: "terminal",
          startedAt: 100,
          alive: true,
          incarnation: 9007199254740992,
          incarnationExact: "9007199254740993",
          terminationState: "live",
        },
      ],
    };

    it("matches exact string equality for ordinary window with full originating provenance", () => {
      const win = {
        id: "win-1",
        appId: "terminals",
        appState: {
          sessionId: "term-1",
          incarnationExact: "42",
          profileId: "prof-1",
          generation: 1,
          serverEpoch: sampleEpoch,
        },
      };
      const res = resolveWindowTerminalObservation(win, [sampleObservation]);
      expect(res.target).not.toBeNull();
      expect(res.target?.incarnation).toBe("42");
      expect(res.target?.serverEpoch).toBe(sampleEpoch);
      expect(res.target?.generation).toBe(1);
      expect(res.availability).toBe("live");
    });

    it("matches safe integer incarnation losslessly for ordinary window with full originating provenance", () => {
      const win = {
        id: "win-1",
        appId: "terminals",
        appState: {
          sessionId: "term-1",
          incarnation: 42,
          profileId: "prof-1",
          generation: 1,
          serverEpoch: sampleEpoch,
        },
      };
      const res = resolveWindowTerminalObservation(win, [sampleObservation]);
      expect(res.target).not.toBeNull();
      expect(res.target?.incarnation).toBe("42");
      expect(res.target?.serverEpoch).toBe(sampleEpoch);
      expect(res.target?.generation).toBe(1);
    });

    it("rejects ordinary window missing originating serverEpoch", () => {
      const win = {
        id: "win-no-epoch",
        appId: "terminals",
        appState: { sessionId: "term-1", incarnationExact: "42", profileId: "prof-1", generation: 1 },
      };
      const res = resolveWindowTerminalObservation(win, [sampleObservation]);
      expect(res.target).toBeNull();
      expect(res.availability).toBe("unknown");
    });

    it("rejects ordinary window missing originating generation", () => {
      const win = {
        id: "win-no-gen",
        appId: "terminals",
        appState: { sessionId: "term-1", incarnationExact: "42", profileId: "prof-1", serverEpoch: sampleEpoch },
      };
      const res = resolveWindowTerminalObservation(win, [sampleObservation]);
      expect(res.target).toBeNull();
      expect(res.availability).toBe("unknown");
    });

    it("rejects ordinary window with mismatched originating serverEpoch", () => {
      const win = {
        id: "win-diff-epoch",
        appId: "terminals",
        appState: {
          sessionId: "term-1",
          incarnationExact: "42",
          profileId: "prof-1",
          generation: 1,
          serverEpoch: "11111111-2222-3333-4444-555555555555",
        },
      };
      const res = resolveWindowTerminalObservation(win, [sampleObservation]);
      expect(res.target).toBeNull();
      expect(res.availability).toBe("unknown");
    });

    it("rejects ordinary window with conflicting numeric and string incarnation", () => {
      const win = {
        id: "win-conflict-inc",
        appId: "terminals",
        appState: {
          sessionId: "term-1",
          incarnation: 42,
          incarnationExact: "43",
          profileId: "prof-1",
          generation: 1,
          serverEpoch: sampleEpoch,
        },
      };
      const res = resolveWindowTerminalObservation(win, [sampleObservation]);
      expect(res.target).toBeNull();
      expect(res.availability).toBe("unknown");
    });

    it("rejects ordinary window without stored incarnation, returning target null and unknown", () => {
      const win = {
        id: "win-raw",
        appId: "terminals",
        appState: { sessionId: "term-1", profileId: "prof-1" },
      };
      const res = resolveWindowTerminalObservation(win, [sampleObservation]);
      expect(res.target).toBeNull();
      expect(res.availability).toBe("unknown");
    });

    it("rejects ordinary window with unsafe numeric incarnation rounding match", () => {
      const win = {
        id: "win-unsafe",
        appId: "terminals",
        // Unsafe JS number 9007199254740992 != exact "9007199254740993"
        appState: {
          sessionId: "term-max-u64",
          incarnation: 9007199254740992,
          profileId: "prof-1",
          generation: 1,
          serverEpoch: sampleEpoch,
        },
      };
      const res = resolveWindowTerminalObservation(win, [sampleObservation]);
      expect(res.target).toBeNull();
      expect(res.availability).toBe("unknown");
    });

    it("rejects captured target when row incarnation exact disagrees", () => {
      const capturedTarget: TerminalTarget = {
        profileId: "prof-1",
        generation: 1,
        serverEpoch: sampleEpoch,
        terminalId: "term-1",
        incarnation: "999", // disagrees with row's "42"
      };
      const win = {
        id: "win-captured",
        appId: "terminals",
        runtimeIdentity: { kind: "terminal", target: capturedTarget },
        appState: { sessionId: "term-1" },
      };
      const res = resolveWindowTerminalObservation(win, [sampleObservation]);
      // Unobserved/mismatched preserves capturedTarget with unknown availability
      expect(res.target).toBe(capturedTarget);
      expect(res.availability).toBe("unknown");
    });

    it("rejects observation with null owner, returning target null and unknown", () => {
      const nullOwnerObservation: TerminalInventoryObservation = {
        owner: null as unknown as { profileId: string; generation: number },
        termination: { version: 1, serverEpoch: sampleEpoch },
        sessions: [
          {
            id: "term-1",
            command: "bash",
            cwd: "/home",
            type: "terminal",
            startedAt: 100,
            alive: true,
            incarnation: 42,
            incarnationExact: "42",
            terminationState: "live",
          },
        ],
      };
      const win = {
        id: "win-1",
        appId: "terminals",
        appState: { sessionId: "term-1", incarnationExact: "42", profileId: "prof-1" },
      };
      const res = resolveWindowTerminalObservation(win, [nullOwnerObservation]);
      expect(res.target).toBeNull();
      expect(res.availability).toBe("unknown");
    });

    it("rejects captured target when row has safe integer disagreement with incarnationExact", () => {
      const disagreementObservation: TerminalInventoryObservation = {
        owner: { profileId: "prof-1", generation: 1 },
        termination: { version: 1, serverEpoch: sampleEpoch },
        sessions: [
          {
            id: "term-1",
            command: "bash",
            cwd: "/home",
            type: "terminal",
            startedAt: 100,
            alive: true,
            incarnation: 43, // safe integer 43 disagrees with incarnationExact "42"
            incarnationExact: "42",
            terminationState: "live",
          },
        ],
      };
      const capturedTarget: TerminalTarget = {
        profileId: "prof-1",
        generation: 1,
        serverEpoch: sampleEpoch,
        terminalId: "term-1",
        incarnation: "42",
      };
      const win = {
        id: "win-captured",
        appId: "terminals",
        runtimeIdentity: { kind: "terminal", target: capturedTarget },
        appState: { sessionId: "term-1" },
      };
      const res = resolveWindowTerminalObservation(win, [disagreementObservation]);
      expect(res.availability).toBe("unknown");
    });

    it("does not infer typed lifecycle state from alive boolean alone when terminationState is undefined", () => {
      const malformedObservation: TerminalInventoryObservation = {
        owner: { profileId: "prof-1", generation: 1 },
        termination: { version: 1, serverEpoch: sampleEpoch },
        sessions: [
          {
            id: "term-1",
            command: "bash",
            cwd: "/home",
            type: "terminal",
            startedAt: 100,
            alive: true, // alive is true, but terminationState is missing
            incarnation: 42,
            incarnationExact: "42",
          },
        ],
      };
      const win = {
        id: "win-1",
        appId: "terminals",
        appState: {
          sessionId: "term-1",
          incarnationExact: "42",
          profileId: "prof-1",
          generation: 1,
          serverEpoch: sampleEpoch,
        },
      };
      const res = resolveWindowTerminalObservation(win, [malformedObservation]);
      expect(res.target).not.toBeNull();
      // Must be "unknown", NEVER inferred as "live" from alive: true
      expect(res.availability).toBe("unknown");
    });

    it("maps terminationRequested state accurately without escaping to live", () => {
      const requestedObservation: TerminalInventoryObservation = {
        owner: { profileId: "prof-1", generation: 1 },
        termination: { version: 1, serverEpoch: sampleEpoch },
        sessions: [
          {
            id: "term-1",
            command: "bash",
            cwd: "/home",
            type: "terminal",
            startedAt: 100,
            alive: true,
            incarnation: 42,
            incarnationExact: "42",
            terminationState: "terminationRequested",
          },
        ],
      };
      const win = {
        id: "win-1",
        appId: "terminals",
        appState: {
          sessionId: "term-1",
          incarnationExact: "42",
          profileId: "prof-1",
          generation: 1,
          serverEpoch: sampleEpoch,
        },
      };
      const res = resolveWindowTerminalObservation(win, [requestedObservation]);
      expect(res.target).not.toBeNull();
      expect(res.availability).toBe("terminationRequested");
    });

    it("rejects ordinary window when originating generation does not match observation", () => {
      const win = {
        id: "win-1",
        appId: "terminals",
        appState: {
          sessionId: "term-1",
          incarnationExact: "42",
          profileId: "prof-1",
          generation: 2,
          serverEpoch: sampleEpoch,
        },
      };
      const res = resolveWindowTerminalObservation(win, [sampleObservation]); // generation is 1
      expect(res.target).toBeNull();
      expect(res.availability).toBe("unknown");
    });
  });
});
