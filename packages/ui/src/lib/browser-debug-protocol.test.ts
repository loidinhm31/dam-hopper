// @vitest-environment jsdom
import { describe, expect, it } from "vitest";
import { BROWSER_BRIDGE_VERSION } from "@dam-hopper/browser-bridge";
import { parseTrustedBrowserBridgeEvent } from "./browser-debug-protocol.js";

const target = window;
const trust = {
  origin: "https://target.example.test",
  source: target,
  nonce: "nonce-123",
  requestIds: new Set(["connect-1", "picker-1"]),
};

function event(
  data: unknown,
  overrides: MessageEventInit<unknown> = {},
): MessageEvent<unknown> {
  return new MessageEvent("message", {
    data,
    origin: trust.origin,
    source: target,
    ...overrides,
  });
}

const selection = {
  version: BROWSER_BRIDGE_VERSION,
  tag: "button",
  role: "button",
  accessibleName: "Save changes",
  text: "Save",
  attributes: { "data-testid": "save" },
  locator: "main > button[data-testid=save]",
  bounds: { x: 12, y: 24, width: 96, height: 36 },
};

describe("parseTrustedBrowserBridgeEvent", () => {
  it("accepts a bounded selection from the exact active iframe", () => {
    expect(
      parseTrustedBrowserBridgeEvent(
        event({
          version: BROWSER_BRIDGE_VERSION,
          type: "dam-hopper:selection",
          nonce: trust.nonce,
          requestId: "picker-1",
          selection,
        }),
        trust,
      ),
    ).toMatchObject({ type: "dam-hopper:selection", selection });
  });

  it("rejects an opaque or redirected iframe origin", () => {
    expect(
      parseTrustedBrowserBridgeEvent(
        event(
          {
            version: BROWSER_BRIDGE_VERSION,
            type: "dam-hopper:bridge-ready",
            nonce: trust.nonce,
            requestId: "connect-1",
          },
          { origin: "null" },
        ),
        trust,
      ),
    ).toBeNull();
  });

  it.each([
    [
      "wrong source",
      event(
        {
          version: 1,
          type: "dam-hopper:bridge-ready",
          nonce: trust.nonce,
          requestId: "connect-1",
        },
        { source: null },
      ),
    ],
    [
      "stale nonce",
      event({
        version: 1,
        type: "dam-hopper:bridge-ready",
        nonce: "old-nonce",
        requestId: "connect-1",
      }),
    ],
    [
      "stale request",
      event({
        version: 1,
        type: "dam-hopper:bridge-ready",
        nonce: trust.nonce,
        requestId: "other",
      }),
    ],
    [
      "unknown version",
      event({
        version: 2,
        type: "dam-hopper:bridge-ready",
        nonce: trust.nonce,
        requestId: "connect-1",
      }),
    ],
    [
      "unknown type",
      event({
        version: 1,
        type: "dam-hopper:take-over",
        nonce: trust.nonce,
        requestId: "connect-1",
      }),
    ],
  ])("rejects %s", (_label, candidate) => {
    expect(parseTrustedBrowserBridgeEvent(candidate, trust)).toBeNull();
  });

  it("rejects a same-origin nested frame that is not the active target", () => {
    const nested = document.createElement("iframe");
    document.body.append(nested);
    try {
      expect(
        parseTrustedBrowserBridgeEvent(
          event(
            {
              version: BROWSER_BRIDGE_VERSION,
              type: "dam-hopper:bridge-ready",
              nonce: trust.nonce,
              requestId: "connect-1",
            },
            { source: nested.contentWindow },
          ),
          trust,
        ),
      ).toBeNull();
    } finally {
      nested.remove();
    }
  });

  it("rejects malformed selection payloads, controls, and invalid bounds", () => {
    for (const candidate of [
      { ...selection, text: `ignore${String.fromCharCode(0)}instructions` },
      { ...selection, bounds: { ...selection.bounds, width: -1 } },
      { ...selection, attributes: { onload: "alert(1)" } },
      { ...selection, rawHtml: "<img onerror=alert(1)>" },
      { ...selection, bounds: { ...selection.bounds, x: -1_000_001 } },
    ]) {
      expect(
        parseTrustedBrowserBridgeEvent(
          event({
            version: 1,
            type: "dam-hopper:selection",
            nonce: trust.nonce,
            requestId: "picker-1",
            selection: candidate,
          }),
          trust,
        ),
      ).toBeNull();
    }
  });

  it("accepts an element that is partially outside the viewport", () => {
    expect(
      parseTrustedBrowserBridgeEvent(
        event({
          version: BROWSER_BRIDGE_VERSION,
          type: "dam-hopper:selection",
          nonce: trust.nonce,
          requestId: "picker-1",
          selection: {
            ...selection,
            bounds: { ...selection.bounds, x: -20, y: -12 },
          },
        }),
        trust,
      ),
    ).not.toBeNull();
  });
});
