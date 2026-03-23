import { useState } from "react";
import { CheckCircle2, XCircle, Loader2 } from "lucide-react";
import { useIpcEvent } from "@/hooks/useSSEEvents.js";
import { cn } from "@/lib/utils.js";

interface ProgressEntry {
  projectName: string;
  message: string;
  status: "pending" | "running" | "done" | "error";
  progress: number;
}

interface Props {
  initialProjects?: string[];
}

export function ProgressList({ initialProjects = [] }: Props) {
  const [entries, setEntries] = useState<Map<string, ProgressEntry>>(
    new Map(
      initialProjects.map((name) => [
        name,
        {
          projectName: name,
          message: "Waiting…",
          status: "pending",
          progress: 0,
        },
      ]),
    ),
  );

  useIpcEvent("git:progress", (e) => {
    const data = e.data as {
      projectName?: string;
      message?: string;
      progress?: number;
      done?: boolean;
      error?: string;
    };
    if (!data.projectName) return;

    setEntries((prev) => {
      const next = new Map(prev);
      const existing = next.get(data.projectName!) ?? {
        projectName: data.projectName!,
        message: "",
        status: "running" as const,
        progress: 0,
      };
      next.set(data.projectName!, {
        ...existing,
        message: data.message ?? existing.message,
        progress: data.progress ?? existing.progress,
        status: data.error ? "error" : data.done ? "done" : "running",
      });
      return next;
    });
  });

  const list = [...entries.values()];

  if (list.length === 0) return null;

  return (
    <div className="space-y-2">
      {list.map((entry) => (
        <div
          key={entry.projectName}
          className="flex items-center gap-3 rounded-lg bg-[var(--color-surface)] border border-[var(--color-border)] px-3 py-2.5"
        >
          {/* Icon */}
          <span className="shrink-0">
            {entry.status === "done" && (
              <CheckCircle2 className="h-4 w-4 text-[var(--color-success)]" />
            )}
            {entry.status === "error" && (
              <XCircle className="h-4 w-4 text-[var(--color-danger)]" />
            )}
            {(entry.status === "running" || entry.status === "pending") && (
              <Loader2
                className={cn(
                  "h-4 w-4",
                  entry.status === "running"
                    ? "animate-spin text-[var(--color-primary)]"
                    : "text-[var(--color-text-muted)]",
                )}
              />
            )}
          </span>

          {/* Name + progress */}
          <div className="flex-1 min-w-0">
            <div className="flex items-center justify-between gap-2">
              <span className="text-sm font-medium text-[var(--color-text)] truncate">
                {entry.projectName}
              </span>
              <span className="text-xs text-[var(--color-text-muted)] shrink-0">
                {entry.message}
              </span>
            </div>
            {entry.status === "running" && (
              <div className="mt-1 h-1 w-full overflow-hidden rounded-full bg-[var(--color-surface-2)]">
                <div
                  className="h-full bg-[var(--color-primary)] transition-all"
                  style={{ width: `${entry.progress}%` }}
                />
              </div>
            )}
          </div>
        </div>
      ))}
    </div>
  );
}
