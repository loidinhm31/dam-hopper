import { beforeEach, describe, expect, it } from "vitest";
import type { DetectedPort } from "@/api/client.js";
import {
  acceptsDetectedPortEvent,
} from "./use-ports.js";
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
