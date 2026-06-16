import { useRef, useState, type KeyboardEvent } from "react";
import { RotateCcw } from "lucide-react";
import { SettingRow } from "@/components/molecules/SettingRow.js";
import { useSettingsStore } from "@/stores/settings.js";
import {
  DEFAULT_REVEAL_ACTIVE_FILE_SHORTCUT,
  DEFAULT_SEARCH_FILENAME_SHORTCUT,
  DEFAULT_SEARCH_TEXT_SHORTCUT,
  DEFAULT_TERMINAL_FILE_PANEL_SHORTCUT,
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
  onChange: (value: string) => void;
}

function ShortcutCapture({
  value,
  defaultValue,
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
          onClick={() => commit(defaultValue)}
          className="p-1.5 rounded text-[var(--color-text-muted)] hover:text-[var(--color-text)] hover:bg-[var(--color-surface-2)] transition-colors"
        >
          <RotateCcw className="h-3.5 w-3.5" />
        </button>
      </div>
      {error && (
        <span className="text-[10px] text-[var(--color-danger)]">{error}</span>
      )}
    </div>
  );
}

export function SettingsKeyboardShortcutsSection() {
  const {
    searchTextShortcut,
    searchFilenameShortcut,
    terminalWorkspaceShortcut,
    terminalFilePanelShortcut,
    revealActiveFileShortcut,
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
          onChange={(shortcut) =>
            saveDebounced({ terminalWorkspaceShortcut: shortcut })
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
    </section>
  );
}
