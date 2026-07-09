import { describe, expect, it, vi } from "vitest";
import type { AgentCommandPattern } from "@/api/client.js";
import { AgentActivityTracker } from "./agent-activity-tracker.js";

const patterns: AgentCommandPattern[] = [
  {
    id: "codex",
    label: "Codex",
    kind: "literal",
    pattern: "codex",
    agent: "codex",
    enabled: true,
  },
  {
    id: "claude",
    label: "Claude",
    kind: "literal",
    pattern: "claude",
    agent: "claude",
    enabled: true,
  },
];

function createTracker() {
  const notify = vi.fn();
  const tracker = new AgentActivityTracker(
    { sessionId: "s1", project: "web" },
    {
      terminalAgentNotificationsEnabled: true,
      terminalAgentQuietTrackingEnabled: true,
      terminalAgentQuietTimeoutMs: 30_000,
      terminalAgentCommandPatterns: patterns,
    },
    { notify, now: () => 123 },
  );

  return { tracker, notify };
}

describe("AgentActivityTracker", () => {
  it("emits one quiet notification per quiet window and rearms after output", () => {
    vi.useFakeTimers();
    const { tracker, notify } = createTracker();

    tracker.onSubmittedCommand("claude");
    vi.advanceTimersByTime(30_000);
    expect(notify).toHaveBeenCalledTimes(1);
    expect(notify.mock.calls[0]?.[0]).toMatchObject({
      source: "quiet",
      title: "Claude may need attention",
      body: "No terminal output for 30s in web.",
      status: "needs-attention",
    });

    vi.advanceTimersByTime(60_000);
    expect(notify).toHaveBeenCalledTimes(1);

    tracker.onOutput();
    vi.advanceTimersByTime(30_000);
    expect(notify).toHaveBeenCalledTimes(2);
    vi.useRealTimers();
  });

  it("rearms quiet tracking when user input acknowledges the notification", () => {
    vi.useFakeTimers();
    const { tracker, notify } = createTracker();

    tracker.onSubmittedCommand("claude");
    vi.advanceTimersByTime(30_000);
    tracker.onUserInput();
    tracker.onOutput();
    vi.advanceTimersByTime(30_000);

    expect(tracker.state).toBe("attention_notified");
    expect(notify).toHaveBeenCalledTimes(2);
    vi.useRealTimers();
  });

  it("emits one ready notification when a tracked Codex TUI title stops spinning", () => {
    const { tracker, notify } = createTracker();

    tracker.onSubmittedCommand("codex");
    tracker.onTitleChange("⠋ dam-hopper");
    tracker.onTitleChange("dam-hopper");
    tracker.onTitleChange("dam-hopper");

    expect(notify).toHaveBeenCalledTimes(1);
    expect(notify).toHaveBeenLastCalledWith(
      expect.objectContaining({
        source: "tui-ready",
        title: "Codex is ready",
        body: "Codex is waiting in web.",
        status: "needs-attention",
      }),
    );
  });

  it("keeps tracking a Codex TUI across follow-up prompts", () => {
    const { tracker, notify } = createTracker();

    tracker.onSubmittedCommand("codex");
    tracker.onTitleChange("⠋ dam-hopper");
    tracker.onTitleChange("dam-hopper");
    tracker.onUserInput();
    tracker.onTitleChange("⠙ dam-hopper");
    tracker.onTitleChange("dam-hopper");

    expect(tracker.state).toBe("attention_notified");
    expect(notify).toHaveBeenCalledTimes(2);
  });

  it("falls back to quiet tracking for Codex sessions without TUI title activity", () => {
    vi.useFakeTimers();
    const { tracker, notify } = createTracker();

    tracker.onSubmittedCommand("codex");
    vi.advanceTimersByTime(30_000);

    expect(notify).toHaveBeenCalledTimes(1);
    expect(notify).toHaveBeenLastCalledWith(
      expect.objectContaining({
        source: "quiet",
        title: "Codex may need attention",
      }),
    );
    vi.useRealTimers();
  });

  it("ignores unrelated ready titles after a Codex working title", () => {
    const { tracker, notify } = createTracker();

    tracker.onSubmittedCommand("codex");
    tracker.onTitleChange("⠋ dam-hopper");
    tracker.onTitleChange("workspace");
    tracker.onTitleChange("dam-hopper");

    expect(notify).toHaveBeenCalledTimes(1);
    expect(notify).toHaveBeenLastCalledWith(
      expect.objectContaining({
        source: "tui-ready",
      }),
    );
  });

  it("requires a fresh Codex working title before notifying again", () => {
    const { tracker, notify } = createTracker();

    tracker.onSubmittedCommand("codex");
    tracker.onTitleChange("⠋ dam-hopper");
    tracker.onTitleChange("dam-hopper");
    tracker.onUserInput();
    tracker.onTitleChange("dam-hopper");

    expect(notify).toHaveBeenCalledTimes(1);
    expect(tracker.state).toBe("tracked_running");
  });

  it("emits finished notification on terminal exit without restart", () => {
    const { tracker, notify } = createTracker();

    tracker.onSubmittedCommand("codex");
    tracker.onTerminalExit({ willRestart: false });

    expect(tracker.state).toBe("finished");
    expect(notify).toHaveBeenLastCalledWith(
      expect.objectContaining({
        source: "terminal-exit",
        title: "Codex finished",
        status: "finished",
      }),
    );
  });

  it("does not emit terminal exit notification when the session will restart", () => {
    const { tracker, notify } = createTracker();

    tracker.onSubmittedCommand("codex");
    tracker.onTerminalExit({ willRestart: true });

    expect(notify).not.toHaveBeenCalled();
    expect(tracker.state).toBe("tracked_running");
  });

  it("clears stale tracking when a later submitted command is not an agent", () => {
    vi.useFakeTimers();
    const { tracker, notify } = createTracker();

    tracker.onSubmittedCommand("codex");
    tracker.onSubmittedCommand("npm run build");
    vi.advanceTimersByTime(30_000);

    expect(tracker.state).toBe("idle");
    expect(notify).not.toHaveBeenCalled();
    vi.useRealTimers();
  });

  it("does not track unrecognized commands or emit when disabled", () => {
    vi.useFakeTimers();
    const notify = vi.fn();
    const tracker = new AgentActivityTracker(
      { sessionId: "s1" },
      {
        terminalAgentNotificationsEnabled: false,
        terminalAgentQuietTrackingEnabled: true,
        terminalAgentQuietTimeoutMs: 30_000,
        terminalAgentCommandPatterns: patterns,
      },
      { notify },
    );

    tracker.onSubmittedCommand("npm run codex");
    vi.advanceTimersByTime(30_000);
    tracker.onSubmittedCommand("codex");
    vi.advanceTimersByTime(30_000);
    tracker.onTerminalExit();

    expect(notify).not.toHaveBeenCalled();
    vi.useRealTimers();
  });

  it("skips already-armed quiet timer when notifications are disabled before expiry", () => {
    vi.useFakeTimers();
    const notify = vi.fn();
    let notificationsEnabled = true;
    const tracker = new AgentActivityTracker(
      { sessionId: "s1", project: "web" },
      {
        get terminalAgentNotificationsEnabled() {
          return notificationsEnabled;
        },
        terminalAgentQuietTrackingEnabled: true,
        terminalAgentQuietTimeoutMs: 30_000,
        terminalAgentCommandPatterns: patterns,
      },
      { notify },
    );

    tracker.onSubmittedCommand("claude");
    notificationsEnabled = false;
    vi.advanceTimersByTime(30_000);

    expect(notify).not.toHaveBeenCalled();
    vi.useRealTimers();
  });

  it("skips already-armed quiet timer when quiet tracking is disabled before expiry", () => {
    vi.useFakeTimers();
    const notify = vi.fn();
    let quietTrackingEnabled = true;
    const tracker = new AgentActivityTracker(
      { sessionId: "s1", project: "web" },
      {
        terminalAgentNotificationsEnabled: true,
        get terminalAgentQuietTrackingEnabled() {
          return quietTrackingEnabled;
        },
        terminalAgentQuietTimeoutMs: 30_000,
        terminalAgentCommandPatterns: patterns,
      },
      { notify },
    );

    tracker.onSubmittedCommand("claude");
    quietTrackingEnabled = false;
    vi.advanceTimersByTime(30_000);

    expect(notify).not.toHaveBeenCalled();
    vi.useRealTimers();
  });

  it("stops quiet notifications after Codex TUI activity is confirmed", () => {
    vi.useFakeTimers();
    const { tracker, notify } = createTracker();

    tracker.onSubmittedCommand("codex");
    tracker.onTitleChange("⠋ dam-hopper");
    vi.advanceTimersByTime(30_000);

    expect(notify).not.toHaveBeenCalled();
    expect(tracker.state).toBe("tracked_running");
    vi.useRealTimers();
  });
});
