import { describe, it, expect } from "vitest";
import { getSessionStatus, getStatusDotColor, getStatusGlowClass } from "./session-status.js";
import type { SessionInfo } from "@/api/client.js";

describe("getSessionStatus", () => {
  it("returns 'alive' when session is alive", () => {
    const session: SessionInfo = {
      id: "test-1",
      command: "npm run dev",
      cwd: "/test",
      type: "run",
      alive: true,
      startedAt: Date.now(),
    };
    expect(getSessionStatus(session)).toBe("alive");
  });

  it("returns 'restarting' when session is dead but willRestart is true", () => {
    const session: SessionInfo = {
      id: "test-2",
      command: "npm run dev",
      cwd: "/test",
      type: "run",
      alive: false,
      exitCode: 1,
      willRestart: true,
      restartInMs: 2000,
      startedAt: Date.now(),
    };
    expect(getSessionStatus(session)).toBe("restarting");
  });

  it("returns 'crashed' when session exited with non-zero code and won't restart", () => {
    const session: SessionInfo = {
      id: "test-3",
      command: "npm run dev",
      cwd: "/test",
      type: "run",
      alive: false,
      exitCode: 1,
      willRestart: false,
      startedAt: Date.now(),
    };
    expect(getSessionStatus(session)).toBe("crashed");
  });

  it("returns 'exited' when session exited with code 0", () => {
    const session: SessionInfo = {
      id: "test-4",
      command: "echo hello",
      cwd: "/test",
      type: "custom",
      alive: false,
      exitCode: 0,
      startedAt: Date.now(),
    };
    expect(getSessionStatus(session)).toBe("exited");
  });

  it("returns 'exited' when exitCode is null", () => {
    const session: SessionInfo = {
      id: "test-5",
      command: "test",
      cwd: "/test",
      type: "custom",
      alive: false,
      exitCode: null,
      startedAt: Date.now(),
    };
    expect(getSessionStatus(session)).toBe("exited");
  });
});

describe("getStatusDotColor", () => {
  it("returns green for alive status", () => {
    expect(getStatusDotColor("alive")).toBe("bg-green-500");
  });

  it("returns yellow for restarting status", () => {
    expect(getStatusDotColor("restarting")).toBe("bg-yellow-500");
  });

  it("returns red for crashed status", () => {
    expect(getStatusDotColor("crashed")).toBe("bg-red-500");
  });

  it("returns muted for exited status", () => {
    expect(getStatusDotColor("exited")).toBe("bg-[var(--color-text-muted)]/30");
  });
});

describe("getStatusGlowClass", () => {
  it("returns glow class for alive status", () => {
    expect(getStatusGlowClass("alive")).toBe("status-glow-green");
  });

  it("returns glow class for restarting status", () => {
    expect(getStatusGlowClass("restarting")).toBe("status-glow-orange");
  });

  it("returns empty string for crashed status", () => {
    expect(getStatusGlowClass("crashed")).toBe("");
  });

  it("returns empty string for exited status", () => {
    expect(getStatusGlowClass("exited")).toBe("");
  });
});
