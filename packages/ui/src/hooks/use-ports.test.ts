import { beforeEach, describe, expect, it } from "vitest";
import type { DetectedPort } from "@/api/client.js";
import { acceptsDetectedPortEvent, portEntryKey, type PortEntry } from "./use-ports.js";
import {
  rememberTerminalSessionIncarnation,
  confirmTerminalPortIncarnation,
  retireTerminalPortIncarnation,
  resetTerminalSessionIncarnations,
} from "@/lib/terminal-incarnation-state.js";

function detectedPort(incarnation: number): DetectedPort {
  return {
    port: 5173,
    session_id: "reused",
    incarnation,
    project: "web",
    detected_via: "stdout_regex",
    state: "provisional",
  };
}

describe("acceptsDetectedPortEvent", () => {
  beforeEach(() => resetTerminalSessionIncarnations());

  it("rejects an old discovery even when the ports cache is empty", () => {
    rememberTerminalSessionIncarnation("reused", 11);

    expect(acceptsDetectedPortEvent(detectedPort(10))).toBe(false);
    expect(acceptsDetectedPortEvent(detectedPort(11))).toBe(true);
  });

  it("remembers the first discovery for later stale-event checks", () => {
    expect(acceptsDetectedPortEvent(detectedPort(11))).toBe(true);
    expect(acceptsDetectedPortEvent(detectedPort(10))).toBe(false);
  });

  it("rejects an equal-incarnation discovery delayed after port loss", () => {
    expect(acceptsDetectedPortEvent(detectedPort(11))).toBe(true);
    retireTerminalPortIncarnation("reused", 5173, 11);

    expect(acceptsDetectedPortEvent(detectedPort(11))).toBe(false);
    confirmTerminalPortIncarnation("reused", 5173, 11);
    expect(acceptsDetectedPortEvent(detectedPort(11))).toBe(true);
  });
});

describe("portEntryKey and multi-profile isolation", () => {
  it("generates distinct keys for equal numeric ports on different profiles", () => {
    const entryA: PortEntry = {
      profileId: "profile-alpha",
      port: 3000,
      project: "web-a",
      state: "listening",
      sessionId: "term-1",
      incarnation: 1,
      tunnel: null,
    };
    const entryB: PortEntry = {
      profileId: "profile-beta",
      port: 3000,
      project: "web-b",
      state: "listening",
      sessionId: "term-1",
      incarnation: 1,
      tunnel: null,
    };

    const keyA = portEntryKey(entryA);
    const keyB = portEntryKey(entryB);

    expect(keyA).toBe("profile-alpha:3000:term-1:1");
    expect(keyB).toBe("profile-beta:3000:term-1:1");
    expect(keyA).not.toBe(keyB);
  });

  it("generates distinct keys for replaced terminal incarnations on same profile and port", () => {
    const entryInc1: PortEntry = {
      profileId: "profile-alpha",
      port: 3000,
      project: "web",
      state: "listening",
      sessionId: "term-1",
      incarnation: 1,
      tunnel: null,
    };
    const entryInc2: PortEntry = {
      profileId: "profile-alpha",
      port: 3000,
      project: "web",
      state: "listening",
      sessionId: "term-1",
      incarnation: 2,
      tunnel: null,
    };

    expect(portEntryKey(entryInc1)).toBe("profile-alpha:3000:term-1:1");
    expect(portEntryKey(entryInc2)).toBe("profile-alpha:3000:term-1:2");
    expect(portEntryKey(entryInc1)).not.toBe(portEntryKey(entryInc2));
  });
});
