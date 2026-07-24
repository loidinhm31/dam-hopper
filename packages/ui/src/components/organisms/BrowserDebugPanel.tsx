import { useEffect, type RefObject } from "react";
import { Maximize2, Minimize2, MousePointer2, RefreshCw, X } from "lucide-react";
import type { BrowserSelectionV1 } from "@dam-hopper/browser-bridge";
import { Button } from "@/components/atoms/Button.js";
import { Input } from "@/components/ui/Input.js";

export type BrowserBridgeStatus =
  | "idle"
  | "loading"
  | "connecting"
  | "ready"
  | "unsupported"
  | "error";

interface BrowserDebugPanelProps {
  url: string;
  bridgeStatus: BrowserBridgeStatus;
  viewportRef?: RefObject<HTMLDivElement | null>;
  onViewportReady?: () => void;
  selection?: BrowserSelectionV1 | null;
  error?: string | null;
  loading?: boolean;
  maximized?: boolean;
  onUrlChange: (url: string) => void;
  onNavigate: () => void;
  onStartPicker?: () => void;
  onStopPicker?: () => void;
  pickerActive?: boolean;
  onToggleMaximize?: () => void;
  onClose?: () => void;
}

const STATUS_COPY: Record<BrowserBridgeStatus, string> = {
  idle: "Waiting for a target URL",
  loading: "Loading target",
  connecting: "Connecting bridge",
  ready: "Bridge connected",
  unsupported: "Bridge unavailable in target",
  error: "Bridge connection failed",
};

function statusClass(status: BrowserBridgeStatus) {
  if (status === "ready") return "bg-emerald-500";
  if (status === "error" || status === "unsupported") return "bg-amber-500";
  return "bg-[var(--color-text-muted)]";
}

function SelectionPreview({ selection }: { selection: BrowserSelectionV1 }) {
  const attributes = Object.entries(selection.attributes)
    .map(([name, value]) => `${name}=${JSON.stringify(value)}`)
    .join(" ");

  return (
    <section
      aria-label="Selected element preview"
      className="shrink-0 border-t border-[var(--color-border)] bg-[var(--color-surface-2)]/50 px-3 py-2"
    >
      <div className="mb-1 flex items-center justify-between gap-2 text-[11px]">
        <span className="font-semibold text-[var(--color-text)]">
          Selected {selection.tag}
          {selection.role ? ` · ${selection.role}` : ""}
        </span>
        <span className="font-mono text-[var(--color-text-muted)]">
          {Math.round(selection.bounds.width)}×{Math.round(selection.bounds.height)}
        </span>
      </div>
      <dl className="grid gap-1 text-[11px] leading-4">
        {selection.accessibleName && (
          <div className="grid grid-cols-[5rem_1fr] gap-2">
            <dt className="text-[var(--color-text-muted)]">Accessible name</dt>
            <dd className="truncate text-[var(--color-text)]">{selection.accessibleName}</dd>
          </div>
        )}
        <div className="grid grid-cols-[5rem_1fr] gap-2">
          <dt className="text-[var(--color-text-muted)]">Locator</dt>
          <dd className="truncate font-mono text-[var(--color-text)]">{selection.locator}</dd>
        </div>
        {selection.text && (
          <div className="grid grid-cols-[5rem_1fr] gap-2">
            <dt className="text-[var(--color-text-muted)]">Text</dt>
            <dd className="line-clamp-2 whitespace-pre-wrap text-[var(--color-text)]">{selection.text}</dd>
          </div>
        )}
        {attributes.length > 0 && (
          <div className="grid grid-cols-[5rem_1fr] gap-2">
            <dt className="text-[var(--color-text-muted)]">Attributes</dt>
            <dd className="truncate font-mono text-[var(--color-text)]">{attributes}</dd>
          </div>
        )}
      </dl>
    </section>
  );
}

export function stopBrowserPickerOnEscape(
  event: Pick<KeyboardEvent, "key" | "preventDefault" | "stopPropagation">,
  pickerActive: boolean,
  onStopPicker?: () => void,
): boolean {
  if (event.key !== "Escape" || !pickerActive || !onStopPicker) return false;
  event.preventDefault();
  event.stopPropagation();
  onStopPicker();
  return true;
}

export function BrowserDebugPanel({
  url,
  bridgeStatus,
  viewportRef,
  onViewportReady,
  selection,
  error,
  loading = false,
  maximized = false,
  onUrlChange,
  onNavigate,
  onStartPicker,
  onStopPicker,
  pickerActive = false,
  onToggleMaximize,
  onClose,
}: BrowserDebugPanelProps) {
  useEffect(() => {
    onViewportReady?.();
    return () => onViewportReady?.();
  }, [onViewportReady]);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      stopBrowserPickerOnEscape(event, pickerActive, onStopPicker);
    };
    window.addEventListener("keydown", onKeyDown, true);
    return () => window.removeEventListener("keydown", onKeyDown, true);
  }, [onStopPicker, pickerActive]);

  return (
    <section
      aria-label="Browser debug tool"
      className="flex h-full min-h-0 flex-col overflow-hidden bg-[var(--color-surface)]"
      data-testid="browser-debug-panel"
    >
      <form
        className="flex shrink-0 items-center gap-2 border-b border-[var(--color-border)] px-3 py-2"
        onSubmit={(event) => {
          event.preventDefault();
          onNavigate();
        }}
      >
        <label className="sr-only" htmlFor="browser-debug-url">Target URL</label>
        <Input
          id="browser-debug-url"
          value={url}
          onChange={(event) => onUrlChange(event.target.value)}
          placeholder="http://localhost:3000"
          inputMode="url"
          autoComplete="off"
          spellCheck={false}
          className="h-8 min-w-0 flex-1 font-mono text-xs"
        />
        <Button type="submit" size="sm" loading={loading} aria-label="Load target URL" title="Load target URL">
          <RefreshCw className="h-3.5 w-3.5" aria-hidden="true" />
          <span className="hidden sm:inline">Load</span>
        </Button>
        {onToggleMaximize && (
          <button type="button" onClick={onToggleMaximize} className="rounded p-1.5 text-[var(--color-text-muted)] transition-colors hover:bg-[var(--color-surface-2)] hover:text-[var(--color-text)] focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-[var(--color-ring)]" aria-label={maximized ? "Restore browser panel" : "Maximize browser panel"} title={maximized ? "Restore browser panel" : "Maximize browser panel"}>
            {maximized ? <Minimize2 className="h-4 w-4" /> : <Maximize2 className="h-4 w-4" />}
          </button>
        )}
        {onClose && (
          <button type="button" onClick={onClose} className="rounded p-1.5 text-[var(--color-text-muted)] transition-colors hover:bg-[var(--color-surface-2)] hover:text-[var(--color-text)] focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-[var(--color-ring)]" aria-label="Close browser panel" title="Close browser panel">
            <X className="h-4 w-4" />
          </button>
        )}
      </form>

      <div className="flex shrink-0 items-center justify-between gap-3 border-b border-[var(--color-border)] px-3 py-1.5 text-xs">
        <p className="flex min-w-0 items-center gap-2 text-[var(--color-text-muted)]" role="status" aria-live="polite">
          <span className={`h-2 w-2 shrink-0 rounded-full ${statusClass(bridgeStatus)}`} aria-hidden="true" />
          <span className="truncate">{STATUS_COPY[bridgeStatus]}</span>
        </p>
        {onStartPicker && bridgeStatus === "ready" && (
          <Button type="button" size="sm" variant={pickerActive ? "secondary" : "ghost"} onClick={pickerActive ? onStopPicker : onStartPicker}>
            <MousePointer2 className="h-3.5 w-3.5" aria-hidden="true" />
            {pickerActive ? "Cancel selection" : "Select element"}
          </Button>
        )}
      </div>

      {error && <p role="alert" className="shrink-0 border-b border-red-500/30 bg-red-500/10 px-3 py-2 text-xs text-red-600 dark:text-red-400">{error}</p>}
      <div ref={viewportRef} className="min-h-0 flex-1 bg-[var(--color-surface-2)]" data-testid="browser-debug-viewport" />
      {selection && <SelectionPreview selection={selection} />}
    </section>
  );
}
