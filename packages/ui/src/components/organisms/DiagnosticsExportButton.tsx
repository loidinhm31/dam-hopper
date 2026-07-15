import { useMemo, useState } from "react";
import { Download } from "lucide-react";
import { Button } from "@/components/atoms/Button.js";
import { DiagnosticsTimeWindowSelect } from "@/components/molecules/DiagnosticsTimeWindowSelect.js";
import { useExportDiagnostics } from "@/api/queries.js";
import {
  exportDiagnosticsBundle,
  type DiagnosticsExportScopeContext,
  type DiagnosticsTimeWindowMinutes,
} from "@/lib/diagnostics-export.js";
import { cn } from "@/lib/utils.js";

interface DiagnosticsExportButtonProps {
  scope: DiagnosticsExportScopeContext;
  terminalIds?: string[];
  terminalOptions?: TerminalExportOption[];
  defaultTerminalLabel?: string;
  showTerminalSelector?: boolean;
  includeTerminalOutput?: boolean;
  className?: string;
  compact?: boolean;
}

export interface TerminalExportOption {
  id: string;
  label: string;
  description?: string;
}

export function DiagnosticsExportButton({
  scope,
  terminalIds,
  terminalOptions = [],
  defaultTerminalLabel = "Default terminals",
  showTerminalSelector = false,
  includeTerminalOutput,
  className,
  compact = false,
}: DiagnosticsExportButtonProps) {
  const exportDiagnostics = useExportDiagnostics();
  const [windowMinutes, setWindowMinutes] =
    useState<DiagnosticsTimeWindowMinutes>(10);
  const [terminalSelection, setTerminalSelection] = useState("default");
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const terminalOptionIds = useMemo(
    () => new Set(terminalOptions.map((option) => option.id)),
    [terminalOptions],
  );
  const effectiveTerminalSelection =
    terminalSelection === "default" ||
    terminalSelection === "none" ||
    terminalSelection === "all" ||
    terminalOptionIds.has(terminalSelection)
      ? terminalSelection
      : "default";
  const shouldShowTerminalSelector =
    showTerminalSelector || terminalOptions.length > 0;

  function resolveTerminalIds(): string[] | undefined {
    if (effectiveTerminalSelection === "none") return [];
    if (effectiveTerminalSelection === "all") {
      return terminalOptions.map((option) => option.id);
    }
    if (effectiveTerminalSelection !== "default") {
      return [effectiveTerminalSelection];
    }
    return terminalIds ?? scope.terminalIds;
  }

  async function handleExport() {
    setMessage(null);
    setError(null);
    try {
      const selectedTerminalIds = resolveTerminalIds();
      const resolvedIncludeTerminalOutput =
        includeTerminalOutput ?? (selectedTerminalIds?.length ?? 0) > 0;
      const resolvedTerminalIds =
        selectedTerminalIds ?? (resolvedIncludeTerminalOutput ? undefined : []);
      const fileName = await exportDiagnosticsBundle(
        (request) => exportDiagnostics.mutateAsync(request),
        {
          windowMinutes,
          includeTerminalOutput: resolvedIncludeTerminalOutput,
          terminalIds: resolvedTerminalIds,
          scope: {
            ...scope,
            terminalIds: resolvedTerminalIds,
          },
        },
      );
      setMessage(fileName);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
    window.setTimeout(() => {
      setMessage(null);
      setError(null);
    }, 5000);
  }

  return (
    <div
      className={cn(
        "flex flex-wrap items-center gap-2 text-xs",
        compact && "justify-end",
        className,
      )}
    >
      <DiagnosticsTimeWindowSelect
        value={windowMinutes}
        onChange={setWindowMinutes}
      />
      {shouldShowTerminalSelector && (
        <select
          aria-label="Diagnostics terminal scope"
          value={effectiveTerminalSelection}
          onChange={(event) => setTerminalSelection(event.target.value)}
          className="h-7 max-w-56 rounded border border-[var(--color-border)] bg-[var(--color-surface)] px-2 text-xs text-[var(--color-text)] outline-none"
        >
          <option value="default">{defaultTerminalLabel}</option>
          <option value="none">No terminals</option>
          {terminalOptions.length > 0 && (
            <option value="all">All listed terminals</option>
          )}
          {terminalOptions.map((option) => (
            <option key={option.id} value={option.id}>
              {option.label}
            </option>
          ))}
        </select>
      )}
      <Button
        type="button"
        size="sm"
        variant="secondary"
        loading={exportDiagnostics.isPending}
        onClick={() => void handleExport()}
      >
        <Download className="h-3.5 w-3.5" />
        {exportDiagnostics.isPending ? "Exporting" : "Export Diagnostics"}
      </Button>
      {message && !compact && (
        <span className="text-[var(--color-success)]">
          Downloaded {message}
        </span>
      )}
      {error && !compact && (
        <span className="text-[var(--color-danger)]">{error}</span>
      )}
    </div>
  );
}
