import { useEffect, type RefObject } from "react";
import {
  ArrowLeft,
  ArrowRight,
  ChevronDown,
  Download,
  Maximize2,
  Minimize2,
  MousePointer2,
  RefreshCw,
  X,
} from "lucide-react";
import type { BrowserSelectionV1 } from "@dam-hopper/browser-bridge";
import { Button } from "@/components/atoms/Button.js";
import { Input } from "@/components/ui/Input.js";
import {
  BrowserDebugCaptureControls,
  type BrowserCaptureStatus,
} from "./BrowserDebugCaptureControls.js";
import { BrowserDebugSelectionPreview } from "./BrowserDebugSelectionPreview.js";
import { BrowserDebugTerminalHandoff } from "./BrowserDebugTerminalHandoff.js";
import { BrowserDebugConsole } from "./BrowserDebugConsole.js";
import type {
  BrowserTerminalTarget,
  PreparedBrowserTerminalArtifact,
} from "@/lib/browser-terminal-handoff.js";
import type { BrowserExtensionPresence } from "@/hooks/use-browser-extension-presence.js";
import type { BrowserConsoleEntry } from "@/hooks/use-browser-debug.js";

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
  addressHistory?: string[];
  onUrlChange: (url: string) => void;
  onNavigate: () => void;
  onBack?: () => void;
  onForward?: () => void;
  onReload?: () => void;
  navigationAvailable?: boolean;
  consoleEntries?: BrowserConsoleEntry[];
  consoleAvailable?: boolean;
  onClearConsole?: () => void;
  extensionPresence?: BrowserExtensionPresence;
  onReloadPage?: () => void;
  onStartPicker?: () => void;
  onStopPicker?: () => void;
  pickerActive?: boolean;
  captureStatus?: BrowserCaptureStatus;
  captureMessage?: string | null;
  manualImageName?: string | null;
  onStartCapture?: () => void;
  onManualImage?: (file: File) => void;
  onStopCapture?: () => void;
  terminalHandoff?: {
    mode?: "active" | "select";
    target?: BrowserTerminalTarget;
    targets?: BrowserTerminalTarget[];
    onPrepare: (sessionId: string) => Promise<PreparedBrowserTerminalArtifact>;
    onDiscard: (artifactId: string) => Promise<void>;
    onInsert: (
      target: BrowserTerminalTarget,
      artifact: PreparedBrowserTerminalArtifact,
    ) => Promise<void>;
  };
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

const BROWSER_DEBUG_EXTENSION_DOWNLOAD =
  "./browser-debug-extension/dam-hopper-browser-debug.zip";

function statusClass(status: BrowserBridgeStatus) {
  if (status === "ready") return "bg-emerald-500";
  if (status === "error" || status === "unsupported") return "bg-amber-500";
  return "bg-[var(--color-text-muted)]";
}

function BrowserDebugExtensionSetup({
  onReloadPage,
}: {
  onReloadPage?: () => void;
}) {
  return (
    <aside
      aria-label="Browser Debug extension setup"
      className="shrink-0 border-b border-amber-500/30 bg-amber-500/10 px-3 py-3 text-xs text-[var(--color-text)]"
    >
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="font-medium">Browser Debug extension required</p>
        <a
          href={BROWSER_DEBUG_EXTENSION_DOWNLOAD}
          download="dam-hopper-browser-debug.zip"
          className="inline-flex h-7 items-center gap-1.5 rounded bg-[var(--color-primary)] px-2.5 font-medium text-white transition-colors hover:bg-[var(--color-primary-hover)]"
        >
          <Download className="h-3.5 w-3.5" aria-hidden="true" />
          Download extension ZIP
        </a>
      </div>
      <ol className="mt-2 list-decimal space-y-1 pl-4 text-[var(--color-text-muted)]">
        <li>Extract the downloaded ZIP.</li>
        <li>
          Open{" "}
          <code className="font-mono text-[var(--color-text)]">
            chrome://extensions
          </code>{" "}
          in this browser.
        </li>
        <li>
          Enable Developer mode, select Load unpacked, then choose the extracted{" "}
          <code className="font-mono text-[var(--color-text)]">
            dam-hopper-browser-debug
          </code>{" "}
          folder.
        </li>
        <li>Reload this DamHopper page after loading the extension.</li>
      </ol>
      {onReloadPage && (
        <Button type="button" size="sm" className="mt-2" onClick={onReloadPage}>
          Reload DamHopper page
        </Button>
      )}
      <p className="mt-2 text-[11px] text-[var(--color-text-muted)]">
        This is a one-time client-browser setup. The target app does not need
        any package or code change.
      </p>
    </aside>
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
  addressHistory = [],
  onUrlChange,
  onNavigate,
  onBack,
  onForward,
  onReload,
  navigationAvailable = false,
  consoleEntries = [],
  consoleAvailable = false,
  onClearConsole,
  extensionPresence = "detected",
  onReloadPage,
  onStartPicker,
  onStopPicker,
  pickerActive = false,
  captureStatus,
  captureMessage,
  manualImageName,
  onStartCapture,
  onManualImage,
  onStopCapture,
  terminalHandoff,
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

  useEffect(() => onStopCapture, [onStopCapture]);

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
        <Button
          type="button"
          size="sm"
          variant="ghost"
          onClick={onBack}
          disabled={!onBack || !navigationAvailable}
          aria-label="Go back"
          title="Go back"
          className="h-8 w-8 px-0"
        >
          <ArrowLeft className="h-3.5 w-3.5" aria-hidden="true" />
        </Button>
        <Button
          type="button"
          size="sm"
          variant="ghost"
          onClick={onForward}
          disabled={!onForward || !navigationAvailable}
          aria-label="Go forward"
          title="Go forward"
          className="h-8 w-8 px-0"
        >
          <ArrowRight className="h-3.5 w-3.5" aria-hidden="true" />
        </Button>
        <label className="sr-only" htmlFor="browser-debug-url">
          Target URL
        </label>
        <Input
          id="browser-debug-url"
          value={url}
          onChange={(event) => onUrlChange(event.target.value)}
          placeholder="http://localhost:3000"
          inputMode="url"
          list="browser-debug-address-history"
          autoComplete="off"
          spellCheck={false}
          className="h-8 min-w-0 flex-1 font-mono text-xs"
        />
        <datalist id="browser-debug-address-history">
          {addressHistory.map((address) => (
            <option key={address} value={address} />
          ))}
        </datalist>
        <Button
          type="button"
          size="sm"
          variant="ghost"
          onClick={onReload}
          disabled={!onReload || !navigationAvailable}
          aria-label="Reload current page"
          title="Reload current page"
          className="h-8 w-8 px-0"
        >
          <RefreshCw className="h-3.5 w-3.5" aria-hidden="true" />
        </Button>
        <Button
          type="submit"
          size="sm"
          loading={loading}
          aria-label="Load address"
          title="Load address"
        >
          <span>Go</span>
        </Button>
        {onToggleMaximize && (
          <button
            type="button"
            onClick={onToggleMaximize}
            className="rounded p-1.5 text-[var(--color-text-muted)] transition-colors hover:bg-[var(--color-surface-2)] hover:text-[var(--color-text)] focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-[var(--color-ring)]"
            aria-label={
              maximized ? "Restore browser panel" : "Maximize browser panel"
            }
            title={
              maximized ? "Restore browser panel" : "Maximize browser panel"
            }
          >
            {maximized ? (
              <Minimize2 className="h-4 w-4" />
            ) : (
              <Maximize2 className="h-4 w-4" />
            )}
          </button>
        )}
        {onClose && (
          <button
            type="button"
            onClick={() => {
              onStopCapture?.();
              onClose();
            }}
            className="rounded p-1.5 text-[var(--color-text-muted)] transition-colors hover:bg-[var(--color-surface-2)] hover:text-[var(--color-text)] focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-[var(--color-ring)]"
            aria-label="Close browser panel"
            title="Close browser panel"
          >
            <X className="h-4 w-4" />
          </button>
        )}
      </form>

      <div className="flex shrink-0 items-center justify-between gap-3 border-b border-[var(--color-border)] px-3 py-1.5 text-xs">
        <p
          className="flex min-w-0 items-center gap-2 text-[var(--color-text-muted)]"
          role="status"
          aria-live="polite"
        >
          <span
            className={`h-2 w-2 shrink-0 rounded-full ${statusClass(bridgeStatus)}`}
            aria-hidden="true"
          />
          <span className="truncate">{STATUS_COPY[bridgeStatus]}</span>
        </p>
        {onStartPicker && bridgeStatus === "ready" && (
          <Button
            type="button"
            size="sm"
            variant={pickerActive ? "secondary" : "ghost"}
            onClick={pickerActive ? onStopPicker : onStartPicker}
          >
            <MousePointer2 className="h-3.5 w-3.5" aria-hidden="true" />
            {pickerActive ? "Cancel selection" : "Select element"}
          </Button>
        )}
      </div>

      {error && (
        <p
          role="alert"
          className="shrink-0 border-b border-red-500/30 bg-red-500/10 px-3 py-2 text-xs text-red-600 dark:text-red-400"
        >
          {error}
        </p>
      )}
      {bridgeStatus === "unsupported" && extensionPresence === "missing" && (
        <BrowserDebugExtensionSetup onReloadPage={onReloadPage} />
      )}
      {bridgeStatus === "unsupported" && extensionPresence === "detected" && (
        <p className="shrink-0 border-b border-amber-500/30 bg-amber-500/10 px-3 py-2 text-xs text-[var(--color-text-muted)]">
          Extension detected in this browser, but the target frame did not
          respond. Check the target URL, reachability, and frame permissions.
        </p>
      )}
      <div
        ref={viewportRef}
        className="min-h-0 flex-1 bg-[var(--color-surface-2)]"
        data-testid="browser-debug-viewport"
      />
      <BrowserDebugConsole
        entries={consoleEntries}
        onClear={onClearConsole ?? (() => {})}
        available={consoleAvailable}
      />
      {selection && <BrowserDebugSelectionPreview selection={selection} />}
      {(onStartCapture || onManualImage) && (
        <details
          aria-label="Optional browser image capture"
          className="group shrink-0 border-t border-[var(--color-border)] bg-[var(--color-surface-2)]/50"
        >
          <summary className="flex cursor-pointer items-center justify-between gap-3 px-3 py-2 text-xs text-[var(--color-text-muted)] focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-[var(--color-ring)]">
            <span className="font-medium text-[var(--color-text)]">
              Optional screenshot capture
            </span>
            <span className="flex items-center gap-1.5">
              Capture or add an image
              <ChevronDown
                className="h-3.5 w-3.5 transition-transform group-open:rotate-180"
                aria-hidden="true"
              />
            </span>
          </summary>
          <BrowserDebugCaptureControls
            hasSelection={Boolean(selection)}
            captureStatus={captureStatus}
            captureMessage={captureMessage}
            manualImageName={manualImageName}
            onStartCapture={onStartCapture}
            onManualImage={onManualImage}
          />
        </details>
      )}
      {terminalHandoff && (
        <BrowserDebugTerminalHandoff
          selection={selection ?? null}
          mode={terminalHandoff.mode}
          target={terminalHandoff.target}
          targets={terminalHandoff.targets}
          onPrepare={terminalHandoff.onPrepare}
          onDiscard={terminalHandoff.onDiscard}
          onInsert={terminalHandoff.onInsert}
        />
      )}
    </section>
  );
}
