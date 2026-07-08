import { describe, expect, it } from "vitest";
import {
  parseBelNotification,
  parseOsc777Notification,
  parseOsc99Notification,
  parseOsc9Notification,
  sanitizeTerminalNotificationText,
} from "./terminal-notification-signal-parser.js";

const context = {
  sessionId: "s1",
  project: "web",
  agent: "codex" as const,
  now: () => 123,
};

describe("terminal notification signal parser", () => {
  it("creates generic BEL notifications", () => {
    expect(parseBelNotification(context)).toEqual({
      source: "bel",
      sessionId: "s1",
      project: "web",
      agent: "codex",
      title: "Terminal needs attention",
      body: undefined,
      status: "needs-attention",
      receivedAt: 123,
    });
  });

  it("parses OSC 9 title and body payloads", () => {
    expect(parseOsc9Notification("9;Build done;Review terminal", context)).toMatchObject({
      source: "osc9",
      title: "Build done",
      body: "Review terminal",
      status: "needs-attention",
    });
  });

  it("parses OSC 777 notify payloads and ignores unsupported commands", () => {
    expect(
      parseOsc777Notification("777;notify;Codex;Needs input", context),
    ).toMatchObject({
      source: "osc777",
      title: "Codex",
      body: "Needs input",
    });
    expect(parseOsc777Notification("777;progress;50", context)).toBeNull();
  });

  it("normalizes OSC 99 malformed payloads to a safe generic notification", () => {
    expect(parseOsc99Notification("99;\x1b[31m", context)).toMatchObject({
      source: "osc99",
      title: "Terminal needs attention",
    });
  });

  it("strips controls and truncates untrusted text", () => {
    const text = `hello\x1b[31m red\x07 ${"x".repeat(200)}`;
    const sanitized = sanitizeTerminalNotificationText(text, 20);
    expect(sanitized).toBe("hello red xxxxxxxxxx");
    expect(sanitized).toHaveLength(20);
  });
});
