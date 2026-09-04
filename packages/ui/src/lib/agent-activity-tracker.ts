import type { AgentCommandPattern, TerminalAgentType } from "@/api/client.js";
import {
  recognizeAgentCommand,
  type RecognizedAgentCommand,
} from "./agent-command-recognizer.js";
import { detectTerminalAgentTitleActivity } from "./terminal-agent-title-activity.js";
import {
  createTerminalAgentNotification,
  type TerminalAgentNotification,
} from "./terminal-notification-signal-parser.js";

export type AgentActivityTrackerState =
  | "idle"
  | "tracked_running"
  | "attention_notified"
  | "finished";

export interface AgentActivityTrackerSettings {
  terminalAgentNotificationsEnabled?: boolean;
  terminalAgentQuietTrackingEnabled?: boolean;
  terminalAgentQuietTimeoutMs?: number;
  terminalAgentCommandPatterns?: AgentCommandPattern[];
}

export interface AgentActivityTrackerSession {
  sessionId: string;
  project?: string;
}

export interface AgentActivityTrackerTimers {
  setTimeout: (callback: () => void, delayMs: number) => unknown;
  clearTimeout: (handle: unknown) => void;
}

export interface AgentActivityTrackerDependencies {
  recognizer?: (
    commandLine: string,
    patterns: readonly AgentCommandPattern[] | undefined | null,
  ) => RecognizedAgentCommand | null;
  notify: (event: TerminalAgentNotification) => void;
  timers?: AgentActivityTrackerTimers;
  now?: () => number;
}

export class AgentActivityTracker {
  private readonly session: AgentActivityTrackerSession;
  private readonly settings: AgentActivityTrackerSettings;
  private readonly recognizer: NonNullable<
    AgentActivityTrackerDependencies["recognizer"]
  >;
  private readonly notify: (event: TerminalAgentNotification) => void;
  private readonly timers: AgentActivityTrackerTimers;
  private readonly now: () => number;
  private timer: unknown = null;
  private tracked: RecognizedAgentCommand | null = null;
  private currentState: AgentActivityTrackerState = "idle";
  private hasSeenWorkingTitle = false;
  private expectedReadyTitle: string | null = null;

  constructor(
    session: AgentActivityTrackerSession,
    settings: AgentActivityTrackerSettings,
    dependencies: AgentActivityTrackerDependencies,
  ) {
    this.session = session;
    this.settings = settings;
    this.recognizer = dependencies.recognizer ?? recognizeAgentCommand;
    this.notify = dependencies.notify;
    this.timers = dependencies.timers ?? defaultTimers;
    this.now = dependencies.now ?? (() => Date.now());
  }

  onSubmittedCommand(commandLine: string): void {
    const match = this.recognizer(
      commandLine,
      this.settings.terminalAgentCommandPatterns,
    );
    if (!match) {
      this.reset();
      return;
    }

    this.tracked = match;
    this.hasSeenWorkingTitle = false;
    this.expectedReadyTitle = null;
    this.currentState = "tracked_running";
    this.armQuietTimer();
  }

  onOutput(): void {
    if (!this.tracked || this.currentState === "idle") return;
    if (this.currentState === "finished") return;

    this.currentState = "tracked_running";
    this.armQuietTimer();
  }

  onUserInput(): void {
    if (this.currentState !== "attention_notified" || !this.tracked) return;
    this.currentState = "tracked_running";
    this.hasSeenWorkingTitle = false;
    this.expectedReadyTitle = null;
    this.armQuietTimer();
  }

  onTitleChange(title: string): void {
    if (!this.tracked || this.currentState === "finished") return;

    const activity = detectTerminalAgentTitleActivity(
      this.tracked.agent,
      title,
    );
    if (activity === null) return;
    if (activity.kind === "working") {
      this.hasSeenWorkingTitle = true;
      this.expectedReadyTitle = activity.readyTitle;
      this.currentState = "tracked_running";
      this.clearQuietTimer();
      return;
    }
    if (
      !this.hasSeenWorkingTitle ||
      this.currentState === "attention_notified"
    ) {
      return;
    }
    if (
      !this.expectedReadyTitle ||
      activity.readyTitle !== this.expectedReadyTitle
    ) {
      return;
    }
    if (this.settings.terminalAgentNotificationsEnabled === false) return;

    const agentName = formatAgentName(this.tracked.agent, this.tracked.label);
    this.currentState = "attention_notified";
    this.hasSeenWorkingTitle = false;
    this.expectedReadyTitle = null;
    this.notify(
      createTerminalAgentNotification(
        "tui-ready",
        {
          ...this.session,
          agent: this.tracked.agent,
          now: this.now,
        },
        {
          title: `${agentName} is ready`,
          body: `${agentName} is waiting in ${this.session.project ?? this.session.sessionId}.`,
          status: "needs-attention",
        },
      ),
    );
  }

  onTerminalExit({
    willRestart = false,
  }: {
    willRestart?: boolean;
  } = {}): void {
    if (!this.tracked) {
      this.clearQuietTimer();
      return;
    }

    this.clearQuietTimer();
    if (willRestart) return;

    this.currentState = "finished";
    if (this.settings.terminalAgentNotificationsEnabled === false) return;

    this.notify(
      createTerminalAgentNotification(
        "terminal-exit",
        {
          ...this.session,
          agent: this.tracked.agent,
          now: this.now,
        },
        {
          title: `${formatAgentName(this.tracked.agent, this.tracked.label)} finished`,
          status: "finished",
        },
      ),
    );
  }

  dispose(): void {
    this.clearQuietTimer();
  }

  get state(): AgentActivityTrackerState {
    return this.currentState;
  }

  private armQuietTimer(): void {
    this.clearQuietTimer();
    if (this.settings.terminalAgentNotificationsEnabled === false) return;
    if (this.settings.terminalAgentQuietTrackingEnabled === false) return;
    if (this.tracked?.agent === "codex" && this.hasSeenWorkingTitle) return;

    const timeoutMs = this.settings.terminalAgentQuietTimeoutMs ?? 30_000;
    this.timer = this.timers.setTimeout(() => {
      this.timer = null;
      if (!this.tracked || this.currentState !== "tracked_running") return;
      if (this.settings.terminalAgentNotificationsEnabled === false) return;
      if (this.settings.terminalAgentQuietTrackingEnabled === false) return;

      this.currentState = "attention_notified";
      const target = this.session.project ?? this.session.sessionId;
      this.notify(
        createTerminalAgentNotification(
          "quiet",
          {
            ...this.session,
            agent: this.tracked.agent,
            now: this.now,
          },
          {
            title: `${formatAgentName(this.tracked.agent, this.tracked.label)} may need attention`,
            body: `No terminal output for ${Math.round(timeoutMs / 1000)}s in ${target}.`,
            status: "needs-attention",
          },
        ),
      );
    }, timeoutMs);
  }

  private reset(): void {
    this.clearQuietTimer();
    this.tracked = null;
    this.hasSeenWorkingTitle = false;
    this.expectedReadyTitle = null;
    this.currentState = "idle";
  }

  private clearQuietTimer(): void {
    if (this.timer === null) return;
    this.timers.clearTimeout(this.timer);
    this.timer = null;
  }
}

function formatAgentName(agent: TerminalAgentType, label: string): string {
  if (label.trim().length > 0) return label.trim();
  if (agent === "unknown") return "Agent";
  return agent[0]!.toUpperCase() + agent.slice(1);
}

const defaultTimers: AgentActivityTrackerTimers = {
  setTimeout: (callback, delayMs) => setTimeout(callback, delayMs),
  clearTimeout: (handle) =>
    clearTimeout(handle as ReturnType<typeof setTimeout>),
};
