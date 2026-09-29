import { describe, expect, it } from "vitest";
import {
  MAX_BRIDGE_PAYLOAD_BYTES,
  UI_BRIDGE_VERSION,
  validateAdvisorWorkspaceContext,
  validateFramePortMessage,
  validateFrameReady,
} from "./bridge-validators.js";

const fence = {
  bridgeVersion: UI_BRIDGE_VERSION,
  frameSession: "session-1",
  activationGeneration: 3,
};
const operations = new Set(["history.summary"]);

describe("plugin bridge validators", () => {
  it("accepts only the exact canonical frame.ready envelope", () => {
    expect(
      validateFrameReady(
        { type: "frame.ready", ...fence },
        fence.frameSession,
        fence.activationGeneration,
      ),
    ).toMatchObject({ type: "frame.ready" });
    expect(() =>
      validateFrameReady(
        { type: "frame.ready", ...fence, nonce: "legacy" },
        fence.frameSession,
        fence.activationGeneration,
      ),
    ).toThrow(/Unknown bridge field/);
  });

  it("rejects E03 params and requires canonical payload", () => {
    expect(() =>
      validateFramePortMessage(
        {
          type: "request",
          ...fence,
          requestId: "request-1",
          operation: "history.summary",
          params: {},
        },
        fence.frameSession,
        fence.activationGeneration,
        "nonce-1",
        operations,
      ),
    ).toThrow(/payload|Unknown bridge field/);
    expect(
      validateFramePortMessage(
        {
          type: "request",
          ...fence,
          requestId: "request-1",
          operation: "history.summary",
          payload: {},
        },
        fence.frameSession,
        fence.activationGeneration,
        "nonce-1",
        operations,
      ),
    ).toMatchObject({ payload: {} });
  });

  it("rejects operations outside the installation allowlist", () => {
    expect(() =>
      validateFramePortMessage(
        {
          type: "request",
          ...fence,
          requestId: "request-1",
          operation: "generic.fetch",
          payload: { url: "https://example.invalid" },
        },
        fence.frameSession,
        fence.activationGeneration,
        "nonce-1",
        operations,
      ),
    ).toThrow(/not allowed/);
  });

  it("bounds payload bytes before admission", () => {
    expect(() =>
      validateFramePortMessage(
        {
          type: "request",
          ...fence,
          requestId: "request-1",
          operation: "history.summary",
          payload: "x".repeat(MAX_BRIDGE_PAYLOAD_BYTES),
        },
        fence.frameSession,
        fence.activationGeneration,
        "nonce-1",
        operations,
      ),
    ).toThrow(/16 MiB/);
  });
  it("validates conformant advisor workspace context and rejects malformed shapes", () => {
    const valid = {
      revision: 1,
      authorityKey: "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef",
      project: {
        projectId: "fedcba9876543210fedcba9876543210fedcba9876543210fedcba9876543210",
        label: "Alpha",
      },
      historyScope: "history-root",
      contextScope: "history-root",
      allowedOperations: ["history.summary"],
    };
    expect(validateAdvisorWorkspaceContext(valid)).toEqual(valid);

    expect(() => validateAdvisorWorkspaceContext(null)).toThrow(/object/);
    expect(() =>
      validateAdvisorWorkspaceContext({ ...valid, revision: 0 }),
    ).toThrow(/revision/);
    expect(() =>
      validateAdvisorWorkspaceContext({ ...valid, authorityKey: "bad-hex" }),
    ).toThrow(/authorityKey/);
    expect(() =>
      validateAdvisorWorkspaceContext({ ...valid, project: null }),
    ).toThrow(/object/);
    expect(() =>
      validateAdvisorWorkspaceContext({
        ...valid,
        project: { projectId: "bad", label: null },
      }),
    ).toThrow(/projectId/);
    expect(() =>
      validateAdvisorWorkspaceContext({
        ...valid,
        project: { projectId: valid.project.projectId, label: "\x00invalid" },
      }),
    ).toThrow(/characters/);
    expect(() =>
      validateAdvisorWorkspaceContext({ ...valid, historyScope: "other" }),
    ).toThrow(/historyScope/);
    expect(() =>
      validateAdvisorWorkspaceContext({ ...valid, contextScope: "other" }),
    ).toThrow(/contextScope/);
    expect(() =>
      validateAdvisorWorkspaceContext({ ...valid, extraField: true }),
    ).toThrow(/Unknown/);
  });

  it("validates frame.uiIntent message and rejects invalid intent or extra fields", () => {
    const validActivate = {
      type: "frame.uiIntent",
      ...fence,
      intent: "activate",
    };
    expect(
      validateFramePortMessage(
        validActivate,
        fence.frameSession,
        fence.activationGeneration,
        "nonce-1",
        operations,
      ),
    ).toMatchObject({ type: "frame.uiIntent", intent: "activate" });

    const validDismiss = {
      type: "frame.uiIntent",
      ...fence,
      intent: "dismiss",
    };
    expect(
      validateFramePortMessage(
        validDismiss,
        fence.frameSession,
        fence.activationGeneration,
        "nonce-1",
        operations,
      ),
    ).toMatchObject({ type: "frame.uiIntent", intent: "dismiss" });

    // Invalid intent
    expect(() =>
      validateFramePortMessage(
        { ...validActivate, intent: "unknown" },
        fence.frameSession,
        fence.activationGeneration,
        "nonce-1",
        operations,
      ),
    ).toThrow(/Invalid uiIntent value/);

    // Extra fields
    expect(() =>
      validateFramePortMessage(
        { ...validActivate, extra: "not-allowed" },
        fence.frameSession,
        fence.activationGeneration,
        "nonce-1",
        operations,
      ),
    ).toThrow(/Unknown bridge field/);
  });
});
