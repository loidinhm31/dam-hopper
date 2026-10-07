import { beforeEach, describe, expect, it } from "vitest";
import type { DetectedPort } from "@/api/client.js";
import { acceptsDetectedPortEvent } from "./use-ports.js";
import {
  rememberTerminalSessionIncarnation,
  confirmTerminalPortIncarnation,
  retireTerminalPortIncarnation,
  resetTerminalSessionIncarnations,
} from "@/lib/terminal-incarnation-state.js";

function detectedPort(incarnation: number): DetectedPort {
  return { port: 5173, session_id: "reused", incarnation, project: "web", detected_via: "stdout_regex", state: "provisional" };
}

describe("detected port incarnation boundaries", () => {
  beforeEach(() => resetTerminalSessionIncarnations());
  it("rejects discovery older than its own concrete PTY", () => {
    rememberTerminalSessionIncarnation({ profileId: "a", id: "reused" }, 11);
    expect(acceptsDetectedPortEvent(detectedPort(10), "a")).toBe(false);
    expect(acceptsDetectedPortEvent(detectedPort(11), "a")).toBe(true);
  });
  it("rejects delayed rediscovery after loss until authoritative list confirms it", () => {
    const target = { profileId: "a", id: "reused" };
    expect(acceptsDetectedPortEvent(detectedPort(11), "a")).toBe(true);
    retireTerminalPortIncarnation(target, 5173, 11);
    expect(acceptsDetectedPortEvent(detectedPort(11), "a")).toBe(false);
    confirmTerminalPortIncarnation(target, 5173, 11);
    expect(acceptsDetectedPortEvent(detectedPort(11), "a")).toBe(true);
  });
  it("isolates identical session IDs and ports with different incarnations across profiles", () => {
    expect(acceptsDetectedPortEvent(detectedPort(11), "a")).toBe(true);
    expect(acceptsDetectedPortEvent(detectedPort(1), "b")).toBe(true);
    retireTerminalPortIncarnation({ profileId: "a", id: "reused" }, 5173, 11);
    expect(acceptsDetectedPortEvent(detectedPort(11), "a")).toBe(false);
    expect(acceptsDetectedPortEvent(detectedPort(1), "b")).toBe(true);
  });
});
