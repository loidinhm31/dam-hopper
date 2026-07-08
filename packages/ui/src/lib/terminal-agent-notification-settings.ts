import type {
  AgentCommandPattern,
  TerminalAgentNotificationPolicy,
} from "@/api/client.js";

export const DEFAULT_TERMINAL_AGENT_NOTIFICATION_POLICY: TerminalAgentNotificationPolicy =
  "always";
export const DEFAULT_TERMINAL_AGENT_QUIET_TIMEOUT_MS = 30_000;

const DEFAULT_TERMINAL_AGENT_COMMAND_PATTERNS: readonly AgentCommandPattern[] = [
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
  {
    id: "claude-code",
    label: "Claude Code",
    kind: "literal",
    pattern: "claude-code",
    agent: "claude",
    enabled: true,
  },
  {
    id: "antigravity",
    label: "Antigravity",
    kind: "literal",
    pattern: "antigravity",
    agent: "antigravity",
    enabled: true,
  },
];

export function cloneAgentCommandPatterns(
  patterns: readonly AgentCommandPattern[],
): AgentCommandPattern[] {
  return patterns.map((pattern) => ({ ...pattern }));
}

export function getDefaultTerminalAgentCommandPatterns(): AgentCommandPattern[] {
  return cloneAgentCommandPatterns(DEFAULT_TERMINAL_AGENT_COMMAND_PATTERNS);
}

export function normalizeAgentCommandPatterns(
  patterns?: readonly AgentCommandPattern[] | null,
): AgentCommandPattern[] {
  return patterns
    ? cloneAgentCommandPatterns(patterns)
    : getDefaultTerminalAgentCommandPatterns();
}
