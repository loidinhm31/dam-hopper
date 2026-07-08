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

    tracker.onSubmittedCommand("codex");
    vi.advanceTimersByTime(30_000);
    expect(notify).toHaveBeenCalledTimes(1);
    expect(notify.mock.calls[0]?.[0]).toMatchObject({
      source: "quiet",
      title: "Codex may need attention",
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

  it("clears quiet state when user input acknowledges the notification", () => {
    vi.useFakeTimers();
    const { tracker, notify } = createTracker();

    tracker.onSubmittedCommand("codex");
    vi.advanceTimersByTime(30_000);
    tracker.onUserInput();
    tracker.onOutput();
    vi.advanceTimersByTime(30_000);

    expect(tracker.state).toBe("idle");
    expect(notify).toHaveBeenCalledTimes(1);
    vi.useRealTimers();
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
});
