import { Trash2 } from "lucide-react";
import { Button } from "@/components/atoms/Button.js";
import { Switch } from "@/components/atoms/Switch.js";
import { Input } from "@/components/ui/Input.js";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/Select.js";
import type {
  AgentCommandPattern,
  AgentCommandPatternKind,
  TerminalAgentType,
} from "@/api/client.js";
import { validateTerminalAgentCommandPattern } from "@/lib/terminal-agent-notification-settings.js";

const AGENT_OPTIONS: Array<{ value: TerminalAgentType; label: string }> = [
  { value: "codex", label: "Codex" },
  { value: "claude", label: "Claude" },
  { value: "antigravity", label: "Antigravity" },
  { value: "unknown", label: "Unknown" },
];

interface AgentCommandPatternEditorRowProps {
  pattern: AgentCommandPattern;
  onChange: (patch: Partial<AgentCommandPattern>) => void;
  onRemove: () => void;
}

export function AgentCommandPatternEditorRow({
  pattern,
  onChange,
  onRemove,
}: AgentCommandPatternEditorRowProps) {
  const error = validateTerminalAgentCommandPattern(pattern);

  return (
    <div className="rounded border border-[var(--color-border)] bg-[var(--color-surface-2)] p-3">
      <div className="mb-3 flex items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          <Switch
            checked={pattern.enabled}
            onCheckedChange={(enabled) => onChange({ enabled })}
          />
          <span className="text-xs text-[var(--color-text-muted)]">
            {pattern.enabled ? "Enabled" : "Disabled"}
          </span>
        </div>
        <Button
          type="button"
          size="sm"
          variant="ghost"
          aria-label={`Remove ${pattern.label || "pattern"}`}
          onClick={onRemove}
        >
          <Trash2 className="h-3.5 w-3.5" />
        </Button>
      </div>

      <div className="grid gap-3 md:grid-cols-2">
        <label className="space-y-1">
          <span className="text-xs text-[var(--color-text-muted)]">Label</span>
          <Input
            value={pattern.label}
            onChange={(event) => onChange({ label: event.target.value })}
          />
        </label>
        <label className="space-y-1">
          <span className="text-xs text-[var(--color-text-muted)]">Pattern</span>
          <Input
            value={pattern.pattern}
            onChange={(event) => onChange({ pattern: event.target.value })}
          />
        </label>
        <label className="space-y-1">
          <span className="text-xs text-[var(--color-text-muted)]">
            Match type
          </span>
          <Select
            value={pattern.kind}
            onValueChange={(value) =>
              onChange({ kind: value as AgentCommandPatternKind })
            }
          >
            <SelectTrigger>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="literal">Literal</SelectItem>
              <SelectItem value="regex">Regex</SelectItem>
            </SelectContent>
          </Select>
        </label>
        <label className="space-y-1">
          <span className="text-xs text-[var(--color-text-muted)]">Agent</span>
          <Select
            value={pattern.agent}
            onValueChange={(value) =>
              onChange({ agent: value as TerminalAgentType })
            }
          >
            <SelectTrigger>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {AGENT_OPTIONS.map((option) => (
                <SelectItem key={option.value} value={option.value}>
                  {option.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </label>
      </div>

      {error ? (
        <p className="mt-2 text-xs text-[var(--color-danger)]">{error}</p>
      ) : null}
    </div>
  );
}
