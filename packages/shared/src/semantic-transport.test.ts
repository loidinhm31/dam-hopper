import { describe, expect, it } from "vitest";
import {
  parseSemanticClientMessage,
  parseSemanticServerMessage,
  serializeSemanticClientMessage,
} from "./semantic-transport.js";
import { SemanticProtocolError } from "./semantic-protocol.js";

const uri = {
  profileId: "profile",
  projectId: "project",
  path: "src/main.rs",
  language: "rust",
} as const;
const trust = {
  projectId: "project",
  trust: "restricted",
  canTransition: true,
  transitionReason: "confirmationRequired",
  policyRevision: 0,
} as const;
const availability = {
  descriptorId: "rust-analyzer",
  language: "rust",
  state: "ready",
} as const;

describe("semantic transport", () => {
  it("parses full document lifecycle and rejects host fields", () => {
    expect(
      parseSemanticClientMessage({
        kind: "semantic:document_open",
        uri,
        documentVersion: 1,
        text: "unsaved",
      }),
    ).toMatchObject({ kind: "semantic:document_open", documentVersion: 1 });
    expect(() =>
      parseSemanticClientMessage({
        kind: "semantic:navigate",
        requestId: "request",
        documentVersion: 1,
        operation: "definition",
        uri,
        position: { line: 0, character: 0 },
        rootUri: "/tmp",
      }),
    ).toThrow(SemanticProtocolError);
  });

  it("serializes only bounded client messages", () => {
    const json = serializeSemanticClientMessage({
      kind: "semantic:project",
      profileId: "profile",
      projectId: "project",
    });
    expect(JSON.parse(json)).toEqual({
      kind: "semantic:project",
      profileId: "profile",
      projectId: "project",
    });
  });

  it("parses prewarm intent and rejects progress as a navigation response", () => {
    expect(
      parseSemanticClientMessage({
        kind: "semantic:prewarm",
        projectId: "project",
        language: "rust",
        tabGeneration: 1,
      }),
    ).toMatchObject({ kind: "semantic:prewarm", tabGeneration: 1 });
    expect(() =>
      parseSemanticServerMessage({
        kind: "semantic:progress",
        requestId: "request",
        documentVersion: 1,
        policyRevision: 0,
        state: "starting",
      }),
    ).not.toThrow();
  });

  it("accepts revocation trust events", () => {
    expect(
      parseSemanticServerMessage({
        kind: "semantic:trust_changed",
        projectId: "project",
        trust: { ...trust, trust: "revoked", canTransition: false },
        reason: "revoked",
      }),
    ).toMatchObject({ kind: "semantic:trust_changed", reason: "revoked" });
  });

  it("parses sanitized handshake and navigation responses", () => {
    expect(
      parseSemanticServerMessage({
        kind: "semantic:handshake",
        protocolVersion: 1,
        sessionEpoch: 1,
        workspaceGeneration: 1,
        availability: [availability],
        trust: [trust],
      }),
    ).toMatchObject({ kind: "semantic:handshake", protocolVersion: 1 });
    expect(
      parseSemanticServerMessage({
        kind: "targets",
        requestId: "request",
        documentVersion: 1,
        policyRevision: 0,
        targets: [
          {
            uri,
            range: {
              start: { line: 0, character: 0 },
              end: { line: 0, character: 1 },
            },
            label: "src/main.rs",
          },
        ],
      }),
    ).toMatchObject({ kind: "targets", requestId: "request" });
  });
});
