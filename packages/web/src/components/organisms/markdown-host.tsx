/**
 * MarkdownHost — split-view markdown editor with Edit | Split | Preview toggle.
 *
 * Lazily imports MonacoHost (same pattern as EditorTabs) to keep the initial
 * bundle clean. MarkdownPreview is a lightweight component imported directly.
 */
import { lazy, Suspense, useState } from "react";
import { Loader2 } from "lucide-react";
import { cn } from "@/lib/utils.js";
import type { FileTier } from "@/lib/file-tier.js";
import { MarkdownPreview } from "./markdown-preview.js";

const MonacoHost = lazy(() =>
  import("@/components/organisms/MonacoHost.js").then((m) => ({ default: m.MonacoHost })),
);

type MarkdownMode = "edit" | "split" | "preview";

interface MarkdownHostProps {
  tabKey: string;
  content: string;
  tier: FileTier;
  mime?: string;
  viewState?: unknown;
  onChange: (value: string) => void;
  onSave: () => void;
  onViewStateChange: (vs: unknown) => void;
}

const MODES: { id: MarkdownMode; label: string }[] = [
  { id: "edit", label: "Edit" },
  { id: "split", label: "Split" },
  { id: "preview", label: "Preview" },
];

const editorFallback = (
  <div className="h-full flex items-center justify-center gap-2 text-xs text-[var(--color-text-muted)]">
    <Loader2 className="h-4 w-4 animate-spin" />
    Loading editor…
  </div>
);

export function MarkdownHost({
  tabKey,
  content,
  tier,
  mime,
  viewState,
  onChange,
  onSave,
  onViewStateChange,
}: MarkdownHostProps) {
  const [mode, setMode] = useState<MarkdownMode>("split");

  return (
    <div className="h-full flex flex-col">
      {/* Mode toggle bar */}
      <div className="shrink-0 flex items-center gap-1 px-3 py-1 border-b border-[var(--color-border)] bg-[var(--color-surface-2)]">
        {MODES.map(({ id, label }) => (
          <button
            key={id}
            onClick={() => setMode(id)}
            className={cn(
              "px-2.5 py-0.5 text-[11px] font-medium rounded-sm transition-colors",
              mode === id
                ? "bg-[var(--color-primary)]/15 text-[var(--color-primary)]"
                : "text-[var(--color-text-muted)] hover:text-[var(--color-text)] hover:bg-[var(--color-surface-2)]",
            )}
          >
            {label}
          </button>
        ))}
      </div>

      {/* Editor body */}
      <div className="flex-1 overflow-hidden flex">
        {/* Monaco pane */}
        {(mode === "edit" || mode === "split") && (
          <div className={cn("overflow-hidden", mode === "split" ? "w-1/2 border-r border-[var(--color-border)]" : "w-full")}>
            <Suspense fallback={editorFallback}>
              <MonacoHost
                tabKey={tabKey}
                content={content}
                tier={tier}
                mime={mime}
                viewState={viewState}
                onChange={onChange}
                onSave={onSave}
                onViewStateChange={onViewStateChange}
              />
            </Suspense>
          </div>
        )}

        {/* Preview pane */}
        {(mode === "preview" || mode === "split") && (
          <MarkdownPreview
            content={content}
            className={mode === "split" ? "w-1/2" : "w-full"}
          />
        )}
      </div>
    </div>
  );
}
