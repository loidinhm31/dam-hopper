import { useEffect, useState } from "react";
import { Plus, RotateCcw } from "lucide-react";
import { Button } from "@/components/atoms/Button.js";
import type { AgentCommandPattern } from "@/api/client.js";
import { AgentCommandPatternEditorRow } from "@/components/molecules/AgentCommandPatternEditorRow.js";
import {
  createCustomTerminalAgentCommandPattern,
  getDefaultTerminalAgentCommandPatterns,
  MAX_TERMINAL_AGENT_COMMAND_PATTERNS,
  normalizeAgentCommandPatterns,
  validateTerminalAgentCommandPatternCount,
  validateTerminalAgentCommandPattern,
} from "@/lib/terminal-agent-notification-settings.js";

interface AgentCommandPatternEditorProps {
  patterns: AgentCommandPattern[];
  onCommit: (patterns: AgentCommandPattern[]) => void;
}

export function AgentCommandPatternEditor({
  patterns,
  onCommit,
}: AgentCommandPatternEditorProps) {
  const [draft, setDraft] = useState(patterns);
  useEffect(() => {
    setDraft(patterns);
  }, [patterns]);

  function applyDraft(next: AgentCommandPattern[]) {
    setDraft(next);
    const normalized = normalizeAgentCommandPatterns(next);
    if (validateTerminalAgentCommandPatternCount(normalized)) return;
    if (
      normalized.some((pattern) => validateTerminalAgentCommandPattern(pattern))
    ) {
      return;
    }
    onCommit(normalized);
  }
  const countError = validateTerminalAgentCommandPatternCount(draft);
  const maxPatternsReached =
    draft.length >= MAX_TERMINAL_AGENT_COMMAND_PATTERNS;

  function updatePattern(
    id: string,
    patch: Partial<AgentCommandPattern>,
  ): void {
    applyDraft(
      draft.map((pattern) =>
        pattern.id === id ? { ...pattern, ...patch } : pattern,
      ),
    );
  }

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="text-xs text-[var(--color-text-muted)]">
          Match executable tokens only. Literal aliases are the simplest path for
          wrappers like `CODEXNSB`. Regex syntax is finalized by the server on
          save.
        </div>
        <div className="flex items-center gap-2">
          <Button
            type="button"
            size="sm"
            disabled={maxPatternsReached}
            onClick={() =>
              applyDraft([...draft, createCustomTerminalAgentCommandPattern()])
            }
          >
            <Plus className="h-3.5 w-3.5" />
            Add pattern
          </Button>
          <Button
            type="button"
            size="sm"
            variant="ghost"
            onClick={() => applyDraft(getDefaultTerminalAgentCommandPatterns())}
          >
            <RotateCcw className="h-3.5 w-3.5" />
            Reset defaults
          </Button>
        </div>
      </div>
      {countError ? (
        <p className="text-xs text-[var(--color-danger)]">{countError}</p>
      ) : null}
      <div className="space-y-2">
        {draft.map((pattern) => (
          <AgentCommandPatternEditorRow
            key={pattern.id}
            pattern={pattern}
            onChange={(patch) => updatePattern(pattern.id, patch)}
            onRemove={() =>
              applyDraft(draft.filter((item) => item.id !== pattern.id))
            }
          />
        ))}
      </div>
    </div>
  );
}
