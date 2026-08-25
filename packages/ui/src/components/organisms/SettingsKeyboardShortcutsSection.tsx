import { useRef, useState, type KeyboardEvent } from "react";
import { RotateCcw } from "lucide-react";
import { SettingRow } from "@/components/molecules/SettingRow.js";
import { useSettingsStore } from "@/stores/settings.js";
import {
  DEFAULT_REVEAL_ACTIVE_FILE_SHORTCUT,
  DEFAULT_FLEET_TERMINAL_SHORTCUT,
  DEFAULT_GIT_PANEL_SHORTCUT,
  DEFAULT_PORTS_PANEL_SHORTCUT,
  DEFAULT_PROJECT_PANEL_SHORTCUT,
  DEFAULT_SEARCH_FILENAME_SHORTCUT,
  DEFAULT_SEARCH_TEXT_SHORTCUT,
  DEFAULT_TERMINAL_FILE_PANEL_SHORTCUT,
  DEFAULT_TERMINAL_FONT_SIZE_DECREASE_SHORTCUT,
  DEFAULT_TERMINAL_FONT_SIZE_INCREASE_SHORTCUT,
  DEFAULT_TERMINAL_WORKSPACE_SHORTCUT,
  DoubleShiftDetector,
  displayShortcut,
  shortcutFromKeyboardEvent,
  validateShortcut,
  type ShortcutKeyEvent,
} from "@/lib/shortcuts.js";
import { cn } from "@/lib/utils.js";

interface ShortcutCaptureProps {
  value: string;
  defaultValue: string;
  label?: string;
  onChange: (value: string) => void;
}

function ShortcutCapture({
  value,
  defaultValue,
  label,
  onChange,
}: ShortcutCaptureProps) {
  const [capturing, setCapturing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const detectorRef = useRef(new DoubleShiftDetector());

  function commit(next: string) {
    const validation = validateShortcut(next);
    setError(validation);
    if (!validation) {
      onChange(next);
      setCapturing(false);
    }
  }

  function handleKeyDown(event: KeyboardEvent<HTMLButtonElement>) {
    if (!capturing) return;
    event.preventDefault();
    event.stopPropagation();

    if (event.key === "Escape") {
      setCapturing(false);
      setError(null);
      detectorRef.current.reset();
      return;
    }

    if (detectorRef.current.match(event.nativeEvent as ShortcutKeyEvent)) {
      commit("DoubleShift");
      return;
    }

    if (["Shift", "Control", "Meta", "Alt"].includes(event.key)) return;
    commit(shortcutFromKeyboardEvent(event.nativeEvent as ShortcutKeyEvent));
  }

  return (
    <div className="flex flex-col items-end gap-1">
      <div className="flex items-center gap-2">
        <button
          type="button"
          onClick={() => {
            setCapturing(true);
            setError(null);
            detectorRef.current.reset();
          }}
          onKeyDown={handleKeyDown}
          aria-label={
            label ? `Set shortcut for ${label}` : "Set keyboard shortcut"
          }
          aria-pressed={capturing}
          className={cn(
            "min-w-36 rounded border px-3 py-1.5 text-xs font-mono transition-colors",
            capturing
              ? "border-[var(--color-primary)] text-[var(--color-primary)] bg-[var(--color-primary)]/10"
              : "border-[var(--color-border)] text-[var(--color-text)] bg-[var(--color-surface-2)] hover:border-[var(--color-primary)]",
          )}
        >
          {capturing ? "Press shortcut" : displayShortcut(value)}
        </button>
        <button
          type="button"
          title="Reset shortcut"
          aria-label={
            label
              ? `Reset ${label} shortcut to default`
              : "Reset shortcut to default"
          }
          onClick={() => commit(defaultValue)}
          className="p-1.5 rounded text-[var(--color-text-muted)] hover:text-[var(--color-text)] hover:bg-[var(--color-surface-2)] transition-colors"
        >
          <RotateCcw className="h-3.5 w-3.5" />
        </button>
      </div>
      {error && (
        <span role="alert" className="text-[10px] text-[var(--color-danger)]">
          {error}
        </span>
      )}
    </div>
  );
}

export function SettingsKeyboardShortcutsSection() {
  const {
    searchTextShortcut,
    searchFilenameShortcut,
    terminalWorkspaceShortcut,
    terminalFontSizeIncreaseShortcut,
    terminalFontSizeDecreaseShortcut,
    terminalFilePanelShortcut,
    revealActiveFileShortcut,
    gitPanelShortcut,
    portsPanelShortcut,
    projectPanelShortcut,
    fleetTerminalShortcut,
    saveDebounced,
  } = useSettingsStore();

  return (
    <section className="rounded-lg border border-[var(--color-border)] bg-[var(--color-surface)] p-4 space-y-4">
      <h3 className="text-sm font-medium text-[var(--color-text)]">
        Keyboard Shortcuts
      </h3>

      <SettingRow title="Text search" description="Open content search">
        <ShortcutCapture
          value={searchTextShortcut}
          defaultValue={DEFAULT_SEARCH_TEXT_SHORTCUT}
          onChange={(shortcut) =>
            saveDebounced({ searchTextShortcut: shortcut })
          }
        />
      </SettingRow>

      <div className="border-t border-[var(--color-border)]" />

      <SettingRow title="Filename search" description="Open file finder">
        <ShortcutCapture
          value={searchFilenameShortcut}
          defaultValue={DEFAULT_SEARCH_FILENAME_SHORTCUT}
          onChange={(shortcut) =>
            saveDebounced({ searchFilenameShortcut: shortcut })
          }
        />
      </SettingRow>

      <div className="border-t border-[var(--color-border)]" />

      <SettingRow
        title="Terminal workspace"
        description="Switch IDE and terminal modes"
      >
        <ShortcutCapture
          value={terminalWorkspaceShortcut}
          defaultValue={DEFAULT_TERMINAL_WORKSPACE_SHORTCUT}
          label="Terminal workspace"
          onChange={(shortcut) =>
            saveDebounced({ terminalWorkspaceShortcut: shortcut })
          }
        />
      </SettingRow>

      <div className="border-t border-[var(--color-border)]" />

      <SettingRow
        title="Increase terminal font size"
        description="Increase terminal text by 1 px. Default: Ctrl+Alt+Shift+Equal (the + key)."
      >
        <ShortcutCapture
          value={terminalFontSizeIncreaseShortcut}
          defaultValue={DEFAULT_TERMINAL_FONT_SIZE_INCREASE_SHORTCUT}
          label="Increase terminal font size"
          onChange={(shortcut) =>
            saveDebounced({ terminalFontSizeIncreaseShortcut: shortcut })
          }
        />
      </SettingRow>

      <div className="border-t border-[var(--color-border)]" />

      <SettingRow
        title="Decrease terminal font size"
        description="Decrease terminal text by 1 px. Default: Ctrl+Alt+Minus."
      >
        <ShortcutCapture
          value={terminalFontSizeDecreaseShortcut}
          defaultValue={DEFAULT_TERMINAL_FONT_SIZE_DECREASE_SHORTCUT}
          label="Decrease terminal font size"
          onChange={(shortcut) =>
            saveDebounced({ terminalFontSizeDecreaseShortcut: shortcut })
          }
        />
      </SettingRow>

      <div className="border-t border-[var(--color-border)]" />

      <SettingRow
        title="File panel"
        description="Open or close the floating file explorer"
      >
        <ShortcutCapture
          value={terminalFilePanelShortcut}
          defaultValue={DEFAULT_TERMINAL_FILE_PANEL_SHORTCUT}
          onChange={(shortcut) =>
            saveDebounced({ terminalFilePanelShortcut: shortcut })
          }
        />
      </SettingRow>

      <div className="border-t border-[var(--color-border)]" />

      <SettingRow
        title="Reveal active file"
        description="Reveal the active editor file in Explorer"
      >
        <ShortcutCapture
          value={revealActiveFileShortcut}
          defaultValue={DEFAULT_REVEAL_ACTIVE_FILE_SHORTCUT}
          onChange={(shortcut) =>
            saveDebounced({ revealActiveFileShortcut: shortcut })
          }
        />
      </SettingRow>

      <div className="border-t border-[var(--color-border)]" />

      <SettingRow title="Git panel" description="Open or close the Git panel">
        <ShortcutCapture
          value={gitPanelShortcut}
          defaultValue={DEFAULT_GIT_PANEL_SHORTCUT}
          onChange={(shortcut) => saveDebounced({ gitPanelShortcut: shortcut })}
        />
      </SettingRow>

      <div className="border-t border-[var(--color-border)]" />

      <SettingRow
        title="Ports panel"
        description="Open or close the Ports panel"
      >
        <ShortcutCapture
          value={portsPanelShortcut}
          defaultValue={DEFAULT_PORTS_PANEL_SHORTCUT}
          onChange={(shortcut) =>
            saveDebounced({ portsPanelShortcut: shortcut })
          }
        />
      </SettingRow>

      <div className="border-t border-[var(--color-border)]" />

      <SettingRow
        title="Project panel"
        description="Open or close the floating Project panel"
      >
        <ShortcutCapture
          value={projectPanelShortcut}
          defaultValue={DEFAULT_PROJECT_PANEL_SHORTCUT}
          label="Project panel"
          onChange={(shortcut) =>
            saveDebounced({ projectPanelShortcut: shortcut })
          }
        />
      </SettingRow>

      <div className="border-t border-[var(--color-border)]" />

      <SettingRow
        title="Fleet Terminal"
        description="Open or close the Fleet Terminal panel"
      >
        <ShortcutCapture
          value={fleetTerminalShortcut}
          defaultValue={DEFAULT_FLEET_TERMINAL_SHORTCUT}
          onChange={(shortcut) =>
            saveDebounced({ fleetTerminalShortcut: shortcut })
          }
        />
      </SettingRow>
    </section>
  );
}
