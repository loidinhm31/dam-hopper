import type { AgentCommandPattern, TerminalAgentType } from "@/api/client.js";
import {
  recognizeAgentCommand,
  type RecognizedAgentCommand,
} from "./agent-command-recognizer.js";
import {
  createTerminalAgentNotification,
  type TerminalAgentNotification,
} from "./terminal-notification-signal-parser.js";

export type AgentActivityTrackerState =
  | "idle"
  | "tracked_running"
  | "quiet_notified"
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
    if (this.currentState !== "quiet_notified") return;
    this.reset();
  }

  onTerminalExit({ willRestart = false }: { willRestart?: boolean } = {}): void {
    if (!this.tracked) {
      this.clearQuietTimer();
      return;
    }

    this.clearQuietTimer();
    if (willRestart) return;

    this.currentState = "finished";
    if (this.settings.terminalAgentNotificationsEnabled === false) return;

    this.notify(
      createTerminalAgentNotification("terminal-exit", {
        ...this.session,
        agent: this.tracked.agent,
        now: this.now,
      }, {
        title: `${formatAgentName(this.tracked.agent, this.tracked.label)} finished`,
        status: "finished",
      }),
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

    const timeoutMs = this.settings.terminalAgentQuietTimeoutMs ?? 30_000;
    this.timer = this.timers.setTimeout(() => {
      if (!this.tracked || this.currentState !== "tracked_running") return;

      this.currentState = "quiet_notified";
      const target = this.session.project ?? this.session.sessionId;
      this.notify(
        createTerminalAgentNotification("quiet", {
          ...this.session,
          agent: this.tracked.agent,
          now: this.now,
        }, {
          title: `${formatAgentName(this.tracked.agent, this.tracked.label)} may need attention`,
          body: `No terminal output for ${Math.round(timeoutMs / 1000)}s in ${target}.`,
          status: "needs-attention",
        }),
      );
    }, timeoutMs);
  }

  private reset(): void {
    this.clearQuietTimer();
    this.tracked = null;
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
