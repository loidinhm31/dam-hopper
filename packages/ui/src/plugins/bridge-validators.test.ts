import { describe, expect, it } from "vitest";
import {
  MAX_BRIDGE_PAYLOAD_BYTES,
  UI_BRIDGE_VERSION,
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
});
