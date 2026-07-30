import { describe, expect, it, vi } from "vitest";
import { BROWSER_BRIDGE_VERSION } from "@dam-hopper/browser-bridge";

vi.mock("@tauri-apps/api/core", () => ({ invoke: vi.fn() }));
vi.mock("@tauri-apps/api/event", () => ({ listen: vi.fn() }));

import {
  bridgeEventToHostEvent,
  errorMessage,
  getNativeBrowserDebugEnvironment,
} from "./native-browser-debug-host";

const target = {
  url: "http://localhost:3000/",
  origin: "http://localhost:3000",
  source: "loopback" as const,
};
const profileId = "profile-1";
const sessionId = "session-1";

describe("native browser debug host adapter", () => {
  it("normalizes a Rust-validated bridge-ready relay", () => {
    const event = bridgeEventToHostEvent(
      {
        label: "browser-debug",
        profileId,
        sessionId,
        generation: 2,
        origin: target.origin,
        data: {
          version: BROWSER_BRIDGE_VERSION,
          type: "dam-hopper:bridge-ready",
          nonce: "nonce",
          requestId: "request",
          capabilities: ["navigation", "console"],
        },
      },
      target,
      7,
      profileId,
      sessionId,
    );

    expect(event).toEqual({
      type: "ready",
      capabilities: ["picker", "navigation", "console"],
      generation: 7,
    });
  });

  it("fails closed for a wrong label, origin, or malformed payload", () => {
    const base = {
      label: "browser-debug",
      profileId,
      sessionId,
      generation: 2,
      origin: target.origin,
      data: {
        version: BROWSER_BRIDGE_VERSION,
        type: "dam-hopper:navigation",
        nonce: "nonce",
        requestId: "request",
        url: target.url,
      },
    };

    expect(
      bridgeEventToHostEvent(
        { ...base, label: "other" },
        target,
        1,
        profileId,
        sessionId,
      ),
    ).toBeNull();
    expect(
      bridgeEventToHostEvent(
        { ...base, origin: "https://other.example" },
        target,
        1,
        profileId,
        sessionId,
      ),
    ).toBeNull();
    expect(
      bridgeEventToHostEvent(
        { ...base, data: { ...base.data, url: "" } },
        target,
        1,
        profileId,
        sessionId,
      ),
    ).toBeNull();
  });

  it("normalizes selection and console events without exposing the envelope", () => {
    const selection = {
      version: 1,
      tag: "button",
      role: "button",
      accessibleName: "Save",
      text: "Save",
      attributes: {},
      locator: "button",
      bounds: { x: 1, y: 2, width: 3, height: 4 },
    } as const;
    const selectionEvent = bridgeEventToHostEvent(
      {
        label: "browser-debug",
        profileId,
        sessionId,
        generation: 0,
        origin: target.origin,
        data: {
          version: 1,
          type: "dam-hopper:selection",
          nonce: "nonce",
          requestId: "request",
          selection,
        },
      },
      target,
      1,
      profileId,
      sessionId,
    );
    const consoleEvent = bridgeEventToHostEvent(
      {
        label: "browser-debug",
        profileId,
        sessionId,
        generation: 0,
        origin: target.origin,
        data: {
          version: 1,
          type: "dam-hopper:console",
          nonce: "nonce",
          requestId: "request",
          level: "warn",
          message: "slow",
        },
      },
      target,
      1,
      profileId,
      sessionId,
    );

    expect(selectionEvent).toMatchObject({ type: "selection", selection });
    expect(consoleEvent).toEqual({
      type: "console",
      level: "warn",
      message: "slow",
      generation: 1,
    });
  });

  it("rejects relays from another profile or child session", () => {
    const relay = {
      label: "browser-debug",
      profileId,
      sessionId,
      generation: 0,
      origin: target.origin,
      data: {
        version: 1,
        type: "dam-hopper:navigation",
        nonce: "nonce",
        requestId: "request",
        url: target.url,
      },
    };

    expect(
      bridgeEventToHostEvent(
        { ...relay, profileId: "profile-2" },
        target,
        1,
        profileId,
        sessionId,
      ),
    ).toBeNull();
    expect(
      bridgeEventToHostEvent(
        { ...relay, sessionId: "session-2" },
        target,
        1,
        profileId,
        sessionId,
      ),
    ).toBeNull();
  });

  it("labels non-Windows builds as experimental", () => {
    expect(getNativeBrowserDebugEnvironment("linux")).toMatchObject({
      kind: "native",
      platform: "linux",
      experimental: true,
    });
    expect(getNativeBrowserDebugEnvironment("windows").experimental).toBe(
      false,
    );
  });

  it("uses safe fallback text for non-Error invoke failures", () => {
    expect(errorMessage("invoke failed", "fallback")).toBe("fallback");
    expect(errorMessage(new Error("invoke failed"), "fallback")).toBe(
      "invoke failed",
    );
  });
});
