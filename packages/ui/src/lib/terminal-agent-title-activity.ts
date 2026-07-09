import type { TerminalAgentType } from "@/api/client.js";

export interface TerminalAgentTitleActivity {
  kind: "working" | "ready";
  readyTitle: string;
}

const CODEX_WORKING_TITLE_RE = /^[\u2800-\u28ff]\s+/u;

export function detectTerminalAgentTitleActivity(
  agent: TerminalAgentType,
  title: string,
): TerminalAgentTitleActivity | null {
  const normalizedTitle = title.trim();
  if (!normalizedTitle) return null;
  if (agent !== "codex") return null;

  if (CODEX_WORKING_TITLE_RE.test(normalizedTitle)) {
    const readyTitle = normalizedTitle.replace(CODEX_WORKING_TITLE_RE, "").trim();
    return readyTitle ? { kind: "working", readyTitle } : null;
  }

  return { kind: "ready", readyTitle: normalizedTitle };
}
