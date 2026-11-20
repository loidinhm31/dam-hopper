import { useId, useRef, type KeyboardEvent, type ReactElement, type RefObject } from "react";
import { ArrowLeft, ArrowRight, Code2, RotateCw, SlidersHorizontal, Volume2, VolumeX } from "lucide-react";
import { isTabHistoryEnabled, isTabReloadable } from "./browser-navigation.js";
import type { BrowserTabRuntime } from "./browser-tab-types.js";

export interface BrowserAddressBarProps {
  windowId: string;
  tab: BrowserTabRuntime;
  draftValue: string;
  navigationPending: boolean;
  audioMuted: boolean;
  audioBlocked: boolean;
  privacyMasked: boolean;
  ownerMismatch: boolean;
  toolsOpen: boolean;
  toolsPanelId: string;
  devToolsOpen?: boolean;
  addressInputRef?: RefObject<HTMLInputElement | null>;
  toolsButtonRef?: RefObject<HTMLButtonElement | null>;
  onDraftChange: (value: string) => void;
  onSubmitAddress: () => void;
  onEscapeDraft: () => void;
  onBack: () => void;
  onForward: () => void;
  onReload: () => void;
  onToggleAudio: () => void;
  onToggleDevTools?: () => void;
  onToggleTools: () => void;
}

const PHASE_LABELS: Record<BrowserTabRuntime["phase"], string> = {
  "new-tab": "New Tab", deferred: "Deferred", connecting: "Connecting", live: "Live",
  unavailable: "Unavailable", capacity: "Capacity", creating: "Creating",
  "create-unknown": "Recovery", closing: "Closing", "close-unknown": "Recovery",
};

export function BrowserAddressBar({
  windowId, tab, draftValue, navigationPending, audioMuted, audioBlocked, privacyMasked, ownerMismatch,
  toolsOpen, toolsPanelId, devToolsOpen = false, addressInputRef, toolsButtonRef, onDraftChange, onSubmitAddress, onEscapeDraft,
  onBack, onForward, onReload, onToggleAudio, onToggleDevTools, onToggleTools,
}: BrowserAddressBarProps): ReactElement {
  const inputId = useId();
  const isComposingRef = useRef(false);
  const masked = privacyMasked || ownerMismatch;
  const historyEnabled = !masked && !navigationPending && isTabHistoryEnabled(tab);
  const reloadEnabled = !masked && !navigationPending && isTabReloadable(tab);
  const devToolsEnabled = !masked && tab.phase === "live" && Boolean(tab.sessionId);
  const inputLocked = ownerMismatch || tab.phase === "closing" || tab.phase === "close-unknown" || tab.phase === "creating";

  const handleKeyDown = (e: KeyboardEvent<HTMLInputElement>) => {
    if (isComposingRef.current || e.nativeEvent.isComposing || e.keyCode === 229) return;
    if (e.key === "Enter") {
      if (navigationPending || masked || inputLocked) return;
      e.preventDefault();
      onSubmitAddress();
    } else if (e.key === "Escape") {
      e.preventDefault();
      e.stopPropagation();
      if (!masked) onEscapeDraft();
    }
  };

  const audioAria = audioMuted ? "Unmute audio" : audioBlocked ? "Unlock audio" : "Mute audio";
  const audioText = audioMuted ? "Muted" : audioBlocked ? "Unlock Audio" : "Audio";

  return (
    <div className="os-browser-toolbar" data-testid={`browser-toolbar-${windowId}`}>
      <div className="os-browser-nav-group">
        <button type="button" data-testid="browser-back-btn" aria-label="Back" title="Back" disabled={!historyEnabled} onClick={onBack} className="os-browser-icon-btn">
          <ArrowLeft className="w-3.5 h-3.5" aria-hidden="true" />
        </button>
        <button type="button" data-testid="browser-forward-btn" aria-label="Forward" title="Forward" disabled={!historyEnabled} onClick={onForward} className="os-browser-icon-btn">
          <ArrowRight className="w-3.5 h-3.5" aria-hidden="true" />
        </button>
        <button type="button" data-testid="browser-reload-btn" aria-label="Reload" title="Reload" disabled={!reloadEnabled} onClick={onReload} className="os-browser-icon-btn">
          <RotateCw className="w-3.5 h-3.5" aria-hidden="true" />
        </button>
      </div>

      <div className="os-browser-address-wrap">
        <label htmlFor={inputId} className="sr-only">Browser address</label>
        <input
          ref={addressInputRef} id={inputId} type="text" data-testid="browser-address-input" aria-label="Browser address"
          value={masked ? "●●●●●●" : draftValue} readOnly={masked} disabled={inputLocked} placeholder="http://localhost:5173"
          onChange={(e) => { if (!masked) onDraftChange(e.target.value); }}
          onCompositionStart={() => { isComposingRef.current = true; }}
          onCompositionEnd={() => { isComposingRef.current = false; }}
          onKeyDown={handleKeyDown} className="os-browser-address-input"
        />
      </div>

      <div className="os-browser-action-group">
        <span className="os-browser-status-wrap">
          {tab.phase === "live" && tab.sessionId ? (
            tab.isController ? (
              <span data-testid="browser-controller-badge" className="os-browser-status-badge os-browser-status-controlling">Controlling</span>
            ) : (
              <span data-testid="browser-view-only-badge" className="os-browser-status-badge os-browser-status-viewonly">View-only</span>
            )
          ) : (
            <span data-testid="browser-phase-badge" className="os-browser-status-badge os-browser-status-neutral">{PHASE_LABELS[tab.phase]}</span>
          )}
        </span>

        <button
          type="button" data-testid="browser-audio-toggle-btn" aria-label={audioAria} aria-pressed={audioMuted}
          disabled={!tab.sessionId || masked} onClick={onToggleAudio}
          title={masked ? "Audio muted in privacy mode" : audioAria}
          className={`os-browser-chip-btn ${audioMuted || audioBlocked ? "os-browser-chip-warn" : ""}`}
        >
          {audioMuted ? <VolumeX className="w-3.5 h-3.5 shrink-0" aria-hidden="true" /> : <Volume2 className="w-3.5 h-3.5 shrink-0" aria-hidden="true" />}
          <span className="os-browser-audio-text">{audioText}</span>
        </button>

        <button
          type="button" data-testid="browser-devtools-toggle-btn"
          aria-label="Developer tools" aria-pressed={devToolsOpen} title="Developer tools"
          disabled={!devToolsEnabled} onClick={onToggleDevTools}
          className={`os-browser-icon-btn ${devToolsOpen ? "workbench-selection" : ""}`}
        >
          <Code2 className="w-3.5 h-3.5" aria-hidden="true" />
        </button>

        <button
          ref={toolsButtonRef} type="button" data-testid="browser-tools-toggle-btn"
          aria-expanded={toolsOpen} aria-controls={toolsPanelId} aria-label="Browser tools" title="Browser tools & recovery"
          onClick={onToggleTools} className={`os-browser-icon-btn ${toolsOpen ? "workbench-selection" : ""}`}
        >
          <SlidersHorizontal className="w-3.5 h-3.5" aria-hidden="true" />
        </button>
      </div>
    </div>
  );
}
