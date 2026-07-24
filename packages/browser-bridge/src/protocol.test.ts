import { describe, expect, it } from "vitest";
import {
  BROWSER_BRIDGE_VERSION,
  parseBrowserBridgeCommand,
  parseBrowserBridgeEvent,
} from "./protocol.js";

const selection = {
  version: BROWSER_BRIDGE_VERSION,
  tag: "button",
  role: "button",
  accessibleName: "Save",
  text: "Save changes",
  attributes: { "data-testid": "save" },
  locator: "main > button[data-testid=save]",
  bounds: { x: 1, y: 2, width: 80, height: 32 },
};

describe("browser bridge protocol", () => {
  it("parses only the versioned picker commands", () => {
    expect(
      parseBrowserBridgeCommand({
        version: BROWSER_BRIDGE_VERSION,
        type: "dam-hopper:start-picker",
        nonce: "nonce",
        requestId: "request",
      })?.type,
    ).toBe("dam-hopper:start-picker");
    expect(
      parseBrowserBridgeCommand({
        version: BROWSER_BRIDGE_VERSION,
        type: "dam-hopper:run-command",
        nonce: "nonce",
        requestId: "request",
      }),
    ).toBeNull();
  });

  it("parses a bounded semantic selection", () => {
    expect(
      parseBrowserBridgeEvent({
        version: BROWSER_BRIDGE_VERSION,
        type: "dam-hopper:selection",
        nonce: "nonce",
        requestId: "request",
        selection,
      }),
    ).toMatchObject({ type: "dam-hopper:selection", selection });
  });

  it.each([
    { ...selection, tag: undefined },
    { ...selection, text: `hostile${String.fromCharCode(0)}text` },
    {
      ...selection,
      bounds: { ...selection.bounds, x: Number.POSITIVE_INFINITY },
    },
    { ...selection, attributes: { onclick: "alert(1)" } },
    { ...selection, rawHtml: "<script>unexpected</script>" },
    { ...selection, bounds: { ...selection.bounds, extra: "unexpected" } },
  ])("rejects untrusted selection fields", (invalidSelection) => {
    expect(
      parseBrowserBridgeEvent({
        version: BROWSER_BRIDGE_VERSION,
        type: "dam-hopper:selection",
        nonce: "nonce",
        requestId: "request",
        selection: invalidSelection,
      }),
    ).toBeNull();
  });

  it("rejects unknown versions and error codes", () => {
    expect(
      parseBrowserBridgeEvent({
        version: 2,
        type: "dam-hopper:bridge-ready",
        nonce: "nonce",
        requestId: "request",
      }),
    ).toBeNull();
    expect(
      parseBrowserBridgeEvent({
        version: BROWSER_BRIDGE_VERSION,
        type: "dam-hopper:error",
        nonce: "nonce",
        requestId: "request",
        code: "execute_shell",
        message: "no",
      }),
    ).toBeNull();
  });

  it("accepts signed viewport positions but rejects oversized coordinates", () => {
    expect(
      parseBrowserBridgeEvent({
        version: BROWSER_BRIDGE_VERSION,
        type: "dam-hopper:selection",
        nonce: "nonce",
        requestId: "request",
        selection: {
          ...selection,
          bounds: { ...selection.bounds, x: -16, y: -32 },
        },
      }),
    ).not.toBeNull();
    expect(
      parseBrowserBridgeEvent({
        version: BROWSER_BRIDGE_VERSION,
        type: "dam-hopper:selection",
        nonce: "nonce",
        requestId: "request",
        selection: {
          ...selection,
          bounds: { ...selection.bounds, x: -1_000_001 },
        },
      }),
    ).toBeNull();
  });
});
