import type {
  AgentCommandPattern,
  TerminalAgentType,
} from "@/api/client.js";

export interface RecognizedAgentCommand {
  agent: TerminalAgentType;
  label: string;
  patternId: string;
  executable: string;
}

const ASSIGNMENT_RE = /^[A-Za-z_][A-Za-z0-9_]*=/;

export function recognizeAgentCommand(
  commandLine: string,
  patterns: readonly AgentCommandPattern[] | undefined | null,
): RecognizedAgentCommand | null {
  const executable = extractExecutableToken(commandLine);
  if (!executable) return null;

  for (const pattern of patterns ?? []) {
    if (!pattern.enabled) continue;

    if (pattern.kind === "literal" && executable === pattern.pattern) {
      return toRecognizedCommand(pattern, executable);
    }

    if (pattern.kind === "regex" && matchesRegex(pattern.pattern, executable)) {
      return toRecognizedCommand(pattern, executable);
    }
  }

  return null;
}

export function extractExecutableToken(commandLine: string): string | null {
  const tokens = tokenizeCommandLine(commandLine.trim());
  if (tokens.length === 0) return null;

  let index = 0;
  if (tokens[index] === "env") {
    index++;
    const envOptions = skipEnvOptions(tokens, index);
    if (envOptions.executable !== undefined) {
      return envOptions.executable;
    }
    index = envOptions.index;
  }

  while (index < tokens.length && ASSIGNMENT_RE.test(tokens[index]!)) {
    index++;
  }

  return tokens[index] ?? null;
}

function toRecognizedCommand(
  pattern: AgentCommandPattern,
  executable: string,
): RecognizedAgentCommand {
  return {
    agent: pattern.agent,
    label: pattern.label,
    patternId: pattern.id,
    executable,
  };
}

function matchesRegex(pattern: string, executable: string): boolean {
  try {
    return new RegExp(pattern).test(executable);
  } catch {
    return false;
  }
}

function skipEnvOptions(
  tokens: string[],
  start: number,
): { index: number; executable?: string | null } {
  let index = start;

  while (index < tokens.length) {
    const token = tokens[index]!;
    if (!token.startsWith("-") || token === "-") break;

    if (token.startsWith("--unset=") || token.startsWith("--chdir=")) {
      index++;
      continue;
    }

    index++;
    if (
      token === "-u" ||
      token === "--unset" ||
      token === "-C" ||
      token === "--chdir"
    ) {
      index++;
      continue;
    }

    if (token === "-S" || token === "--split-string") {
      const splitString = tokens[index];
      return {
        index: tokens.length,
        executable: splitString ? extractExecutableToken(splitString) : null,
      };
    }
  }

  return { index };
}

function tokenizeCommandLine(commandLine: string): string[] {
  const tokens: string[] = [];
  let token = "";
  let quote: "'" | '"' | null = null;
  let escaping = false;

  for (const char of commandLine) {
    if (escaping) {
      token += char;
      escaping = false;
      continue;
    }

    if (char === "\\" && quote !== "'") {
      escaping = true;
      continue;
    }

    if ((char === "'" || char === '"') && quote === null) {
      quote = char;
      continue;
    }

    if (char === quote) {
      quote = null;
      continue;
    }

    if (/\s/.test(char) && quote === null) {
      if (token.length > 0) {
        tokens.push(token);
        token = "";
      }
      continue;
    }

    token += char;
  }

  if (escaping) token += "\\";
  if (token.length > 0) tokens.push(token);

  return tokens;
}
