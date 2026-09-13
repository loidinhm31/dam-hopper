import { useState, useEffect, useMemo } from "react";
import { RefreshCw } from "lucide-react";
import { cn } from "@/lib/utils.js";
import { prepareHtmlPreviewContent } from "@/lib/html-preview-transform.js";

export interface HtmlPreviewProps {
  content: string;
  className?: string;
  debounceMs?: number;
}

export function HtmlPreview({
  content,
  className,
  debounceMs = 200,
}: HtmlPreviewProps) {
  const [reloadKey, setReloadKey] = useState(0);
  const [debouncedContent, setDebouncedContent] = useState(content);

  useEffect(() => {
    const timer = setTimeout(() => {
      setDebouncedContent(content);
    }, debounceMs);
    return () => clearTimeout(timer);
  }, [content, debounceMs]);

  const preparedContent = useMemo(
    () => prepareHtmlPreviewContent(debouncedContent),
    [debouncedContent],
  );

  return (
    <div
      data-testid="html-preview-container"
      className={cn(
        "flex flex-col h-full min-w-0 min-h-0 bg-[var(--color-surface)]",
        className,
      )}
    >
      <div className="shrink-0 flex items-center justify-between px-3 py-1 border-b border-[var(--color-border)] bg-[var(--color-surface-2)] text-[11px] text-[var(--color-text-muted)]">
        <span className="font-medium">Preview</span>
        <button
          type="button"
          title="Reload preview"
          aria-label="Reload preview"
          onClick={() => {
            setDebouncedContent(content);
            setReloadKey((k) => k + 1);
          }}
          className="p-1 rounded hover:text-[var(--color-text)] hover:bg-[var(--color-surface)] transition-colors focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-[var(--color-ring)]"
        >
          <RefreshCw className="h-3 w-3" />
        </button>
      </div>
      <div className="flex-1 min-h-0 w-full bg-white relative">
        <iframe
          key={reloadKey}
          title="HTML Preview"
          srcDoc={preparedContent}
          sandbox="allow-scripts allow-modals allow-forms allow-popups allow-pointer-lock"
          className="w-full h-full border-0 block"
        />
      </div>
    </div>
  );
}
