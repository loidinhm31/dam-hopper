import { describe, expect, it } from "vitest";
import {
  MAX_SEMANTIC_TARGETS,
  MAX_SEMANTIC_POSITION,
  PREWARM_DWELL_MS,
  SEMANTIC_NAVIGATION_UI_BRANCH,
  SemanticProtocolError,
  parseSemanticProtocolRange,
  parseSemanticProtocolRequest,
  parseSemanticProtocolTargets,
  parseSemanticProtocolUri,
  parseSemanticProtocolAvailability,
  parseSemanticProtocolCancellation,
  parseSemanticProtocolTrustState,
  parseSemanticProtocolTrustChallenge,
  parseSemanticProtocolResponse,
  parseSemanticTrustTransition,
  serializeSemanticNavigationRequest,
} from "./semantic-protocol.js";

const uri = {
  profileId: "profile-a",
  projectId: "project-a",
  path: "src/main.rs",
  language: "rust",
} as const;

describe("semantic protocol", () => {
  it("serializes only browser-safe navigation fields", () => {
    const json = serializeSemanticNavigationRequest({
      requestId: "request-a",
      documentVersion: 2,
      operation: "definition",
      uri,
      position: { line: 2, character: 4 },
      maxTargets: 2,
    });

    expect(JSON.parse(json)).toEqual({
      requestId: "request-a",
      documentVersion: 2,
      operation: "definition",
      uri,
      position: { line: 2, character: 4 },
      maxTargets: 2,
    });
    expect(json).not.toMatch(/file:|rootUri|executable|command|method/i);
  });

  it.each([
    { ...uri, path: "/etc/passwd" },
    { ...uri, path: "../outside.rs" },
    { ...uri, path: "src\\main.rs" },
    { ...uri, path: "file:///tmp/main.rs" },
    { ...uri, path: "file:/tmp/main.rs" },
    { ...uri, path: "file:relative.rs" },
    { ...uri, path: " src/main.rs" },
    { ...uri, path: "src/main.rs " },
    { ...uri, path: "C:/tmp/main.rs" },
    { ...uri, profileId: "file:///profile" },
    { ...uri, projectId: "project/child" },
  ])("rejects non-relative URI identity %#", (unsafeUri) => {
    expect(() => parseSemanticProtocolUri(unsafeUri)).toThrow(
      SemanticProtocolError,
    );
  });

  it.each([
    {
      requestId: "r",
      operation: "definition",
      uri,
      position: { line: 0, character: 0 },
    },
    {
      requestId: "not an opaque id",
      documentVersion: 0,
      operation: "definition",
      uri,
      position: { line: 0, character: 0 },
    },
    {
      requestId: "r",
      documentVersion: 0,
      operation: "definition",
      uri,
      position: { line: -1, character: 0 },
    },
    {
      requestId: "r",
      documentVersion: 0,
      operation: "raw",
      uri,
      position: { line: 0, character: 0 },
    },
    {
      requestId: "r",
      documentVersion: 0,
      operation: "definition",
      uri,
      position: { line: 0, character: 0 },
      rootUri: "/tmp",
    },
    {
      requestId: "r",
      documentVersion: 0,
      operation: "definition",
      uri,
      position: { line: 0, character: 0 },
      executable: "rust-analyzer",
    },
    {
      requestId: "r",
      documentVersion: 0,
      operation: "definition",
      uri,
      position: { line: 0, character: 0 },
      method: "workspace/executeCommand",
    },
  ])("rejects forbidden or invalid navigation input %#", (request) => {
    expect(() => parseSemanticProtocolRequest(request)).toThrow(
      SemanticProtocolError,
    );
  });

  it("enforces UTF-16 range ordering and result caps", () => {
    expect(
      parseSemanticProtocolRange({
        start: { line: 1, character: 3 },
        end: { line: 1, character: 3 },
      }),
    ).toEqual({
      start: { line: 1, character: 3 },
      end: { line: 1, character: 3 },
    });
    expect(() =>
      parseSemanticProtocolRange({
        start: { line: 2, character: 0 },
        end: { line: 1, character: 9 },
      }),
    ).toThrow(SemanticProtocolError);
    expect(() =>
      parseSemanticProtocolRequest({
        requestId: "r",
        documentVersion: 0,
        operation: "references",
        uri,
        position: { line: MAX_SEMANTIC_POSITION + 1, character: 0 },
      }),
    ).toThrow(SemanticProtocolError);
    expect(() =>
      parseSemanticProtocolTargets([
        {
          uri,
          range: {
            start: { line: 0, character: 0 },
            end: { line: 0, character: 1 },
          },
          label: "x".repeat(513),
        },
      ]),
    ).toThrow(SemanticProtocolError);
    expect(() =>
      parseSemanticProtocolTargets([
        {
          uri,
          range: {
            start: { line: 0, character: 0 },
            end: { line: 0, character: 1 },
          },
          label: "label\0",
        },
      ]),
    ).toThrow(SemanticProtocolError);
    expect(() =>
      parseSemanticProtocolRequest({
        requestId: "r",
        documentVersion: 0,
        operation: "references",
        uri,
        position: { line: 0, character: 0 },
        maxTargets: MAX_SEMANTIC_TARGETS + 1,
      }),
    ).toThrow(SemanticProtocolError);
  });

  it("accepts only server-challenge trust transition inputs", () => {
    expect(
      parseSemanticTrustTransition({
        projectId: "project-a",
        desiredTrust: "trusted",
        confirmation: "challenge-token",
      }),
    ).toEqual({
      projectId: "project-a",
      desiredTrust: "trusted",
      confirmation: "challenge-token",
    });
    expect(() =>
      parseSemanticTrustTransition({
        projectId: "project-a",
        desiredTrust: "trusted",
        confirmation: "challenge-token",
        initializationOptions: {},
      }),
    ).toThrow(SemanticProtocolError);
  });

  it("allows only stable availability and trust reason codes", () => {
    expect(
      parseSemanticProtocolAvailability({
        descriptorId: "rust-analyzer",
        language: "rust",
        state: "bundleUnavailable",
        reason: "releaseManifestMissing",
      }),
    ).toMatchObject({ reason: "releaseManifestMissing" });
    expect(() =>
      parseSemanticProtocolAvailability({
        descriptorId: "rust-analyzer",
        language: "rust",
        state: "crashed",
        reason: "/srv/rust-analyzer stderr",
      }),
    ).toThrow(SemanticProtocolError);
    expect(
      parseSemanticProtocolTrustState({
        projectId: "project-a",
        trust: "restricted",
        canTransition: true,
        transitionReason: "confirmationRequired",
        policyRevision: 2,
      }),
    ).toMatchObject({ transitionReason: "confirmationRequired" });
    expect(
      parseSemanticProtocolTrustChallenge({
        projectId: "project-a",
        challenge: "one-time",
        policyRevision: 2,
        expiresAt: 100,
      }),
    ).toMatchObject({ policyRevision: 2, expiresAt: 100 });
  });

  it("binds results and cancellation to request, document, and policy revisions", () => {
    const context = {
      requestId: "request-a",
      documentVersion: 7,
      policyRevision: 3,
    };
    expect(
      parseSemanticProtocolResponse({
        ...context,
        kind: "stale",
      }),
    ).toEqual({ ...context, kind: "stale" });
    expect(
      parseSemanticProtocolResponse({
        ...context,
        kind: "error",
        error: "policyChanged",
      }),
    ).toEqual({ ...context, kind: "error", error: "policyChanged" });
    expect(
      parseSemanticProtocolCancellation({
        requestId: "request-a",
        documentVersion: 7,
      }),
    ).toEqual({ requestId: "request-a", documentVersion: 7 });
    expect(() =>
      parseSemanticProtocolResponse({
        ...context,
        kind: "cancelled",
        targets: [],
      }),
    ).toThrow(SemanticProtocolError);
    expect(() =>
      parseSemanticProtocolCancellation({
        requestId: "request-a",
        documentVersion: Number.MAX_SAFE_INTEGER + 1,
      }),
    ).toThrow(SemanticProtocolError);
  });

  it("rejects escaped result payloads over the shared one MiB limit", () => {
    const largeTarget = {
      uri: {
        ...uri,
        path: '"'.repeat(1024),
      },
      range: {
        start: { line: 0, character: 0 },
        end: { line: 0, character: 1 },
      },
      label: '"'.repeat(512),
    };
    expect(() =>
      parseSemanticProtocolResponse({
        kind: "targets",
        requestId: "request-a",
        documentVersion: 1,
        policyRevision: 1,
        targets: Array.from(
          { length: MAX_SEMANTIC_TARGETS },
          () => largeTarget,
        ),
      }),
    ).toThrow(SemanticProtocolError);
  });

  it("freezes the required delayed-prewarm dwell", () => {
    expect(PREWARM_DWELL_MS).toBe(750);
    expect(SEMANTIC_NAVIGATION_UI_BRANCH).toBe("sharedVirtualizedResults");
  });
});
