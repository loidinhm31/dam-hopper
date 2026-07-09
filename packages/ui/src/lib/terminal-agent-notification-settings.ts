import type {
  AgentCommandPattern,
  TerminalAgentNotificationPolicy,
} from "@/api/client.js";

export const DEFAULT_TERMINAL_AGENT_NOTIFICATION_POLICY: TerminalAgentNotificationPolicy =
  "always";
export const DEFAULT_TERMINAL_AGENT_QUIET_TIMEOUT_MS = 30_000;
export const MAX_TERMINAL_AGENT_COMMAND_PATTERNS = 32;
export const MAX_TERMINAL_AGENT_COMMAND_ID_LENGTH = 64;
export const MAX_TERMINAL_AGENT_COMMAND_LABEL_LENGTH = 64;
export const MAX_TERMINAL_AGENT_COMMAND_PATTERN_LENGTH = 128;

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

export function createCustomTerminalAgentCommandPattern(): AgentCommandPattern {
  const id =
    globalThis.crypto?.randomUUID?.() ??
    `agent-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  return {
    id,
    label: "Custom agent",
    kind: "literal",
    pattern: "",
    agent: "codex",
    enabled: true,
  };
}

export function validateTerminalAgentCommandPattern(
  pattern: AgentCommandPattern,
): string | null {
  const label = pattern.label.trim();
  const rawPattern = pattern.pattern.trim();

  if (!label) return "Label is required.";
  if (label.length > MAX_TERMINAL_AGENT_COMMAND_LABEL_LENGTH) {
    return `Label must be ${MAX_TERMINAL_AGENT_COMMAND_LABEL_LENGTH} characters or fewer.`;
  }
  if (!rawPattern) return "Pattern is required.";
  if (rawPattern.length > MAX_TERMINAL_AGENT_COMMAND_PATTERN_LENGTH) {
    return `Pattern must be ${MAX_TERMINAL_AGENT_COMMAND_PATTERN_LENGTH} characters or fewer.`;
  }
  return null;
}

export function validateTerminalAgentCommandPatternCount(
  patterns: readonly AgentCommandPattern[],
): string | null {
  if (patterns.length <= MAX_TERMINAL_AGENT_COMMAND_PATTERNS) return null;
  return `No more than ${MAX_TERMINAL_AGENT_COMMAND_PATTERNS} command patterns are allowed.`;
}

export function normalizeTerminalAgentCommandPattern(
  pattern: AgentCommandPattern,
): AgentCommandPattern {
  return {
    ...pattern,
    label: pattern.label.trim(),
    pattern: pattern.pattern.trim(),
  };
}

function createNormalizedPatternId(
  pattern: AgentCommandPattern,
  index: number,
  seen: Set<string>,
): string {
  const trimmed = pattern.id.trim();
  if (
    trimmed &&
    trimmed.length <= MAX_TERMINAL_AGENT_COMMAND_ID_LENGTH &&
    !seen.has(trimmed)
  ) {
    seen.add(trimmed);
    return trimmed;
  }

  const seed =
    pattern.label.trim() ||
    pattern.pattern.trim() ||
    pattern.agent ||
    `pattern-${index + 1}`;
  const slug =
    seed
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "") || `pattern-${index + 1}`;
  let suffix = 0;

  while (true) {
    const suffixText = suffix === 0 ? "" : `-${suffix + 1}`;
    const prefixLength = MAX_TERMINAL_AGENT_COMMAND_ID_LENGTH - suffixText.length;
    const candidate = `${slug.slice(0, Math.max(1, prefixLength))}${suffixText}`;
    if (!seen.has(candidate)) {
      seen.add(candidate);
      return candidate;
    }
    suffix++;
  }
}

export function normalizeAgentCommandPatterns(
  patterns?: readonly AgentCommandPattern[] | null,
): AgentCommandPattern[] {
  const source = patterns
    ? cloneAgentCommandPatterns(patterns)
    : getDefaultTerminalAgentCommandPatterns();
  const seen = new Set<string>();

  return source.map((pattern, index) => {
    const normalized = normalizeTerminalAgentCommandPattern(pattern);
    normalized.id = createNormalizedPatternId(normalized, index, seen);
    return normalized;
  });
}
