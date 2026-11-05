import { useEffect, useRef, useState, type KeyboardEvent } from "react";
import { RotateCcw } from "lucide-react";
import { SettingRow } from "@/components/molecules/SettingRow.js";
import { useSettingsStore } from "@/stores/settings.js";
import {
  DEFAULT_COGNITO_MODE_SHORTCUT,
  DEFAULT_REVEAL_ACTIVE_FILE_SHORTCUT,
  DEFAULT_GIT_PANEL_SHORTCUT,
  DEFAULT_PORTS_PANEL_SHORTCUT,
  DEFAULT_PROJECT_PANEL_SHORTCUT,
  DEFAULT_SEARCH_FILENAME_SHORTCUT,
  DEFAULT_SEARCH_TEXT_SHORTCUT,
  DEFAULT_TERMINAL_FILE_PANEL_SHORTCUT,
  DEFAULT_TERMINAL_FONT_SIZE_DECREASE_SHORTCUT,
  DEFAULT_TERMINAL_FONT_SIZE_INCREASE_SHORTCUT,
  DEFAULT_TERMINAL_WORKSPACE_SHORTCUT,
  DEFAULT_OS_PALETTE_SHORTCUT,
  DEFAULT_OS_CYCLE_FOCUS_SHORTCUT,
  DoubleShiftDetector,
  displayShortcut,
  formatShortcut,
  shortcutFromKeyboardEvent,
  validateShortcut,
  validateCognitoModeShortcut,
  type ShortcutKeyEvent,
} from "@/lib/shortcuts.js";
import { cn } from "@/lib/utils.js";

interface ShortcutCaptureProps {
  value: string | null;
  defaultValue: string | null;
  label?: string;
  onChange: (value: string | null) => void;
  validate?: (value: string | null) => string | null;
}

function ShortcutCapture({
  value,
  defaultValue,
  label,
  onChange,
  validate = validateShortcut,
}: ShortcutCaptureProps) {
  const [capturing, setCapturing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const detectorRef = useRef(new DoubleShiftDetector());

  useEffect(() => {
    return () => {
      detectorRef.current.reset();
    };
  }, []);

  function cancelCapture() {
    setCapturing(false);
    setError(null);
    detectorRef.current.reset();
  }

  function handleBlur() {
    if (capturing) {
      cancelCapture();
    }
  }

  function commit(next: string | null) {
    const validation = validate ? validate(next) : null;
    setError(validation);
    detectorRef.current.reset();
    setCapturing(false);
    if (!validation) {
      onChange(next);
    }
  }

  function handleKeyDown(event: KeyboardEvent<HTMLButtonElement>) {
    if (!capturing) return;
    event.preventDefault();
    event.stopPropagation();

    if (event.key === "Escape") {
      cancelCapture();
      return;
    }

    if (event.key === "Backspace" || event.key === "Delete") {
      commit(null);
      return;
    }
    if (
      event.repeat ||
      event.nativeEvent.isComposing ||
      event.keyCode === 229 ||
      event.which === 229 ||
      event.key === "Process"
    ) {
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
          data-shortcut-capture={capturing ? "true" : undefined}
          onClick={() => {
            setCapturing(true);
            setError(null);
            detectorRef.current.reset();
          }}
          onKeyDown={handleKeyDown}
          onBlur={handleBlur}
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

const SHORTCUT_LABELS: Record<string, string> = {
  searchTextShortcut: "Text search",
  searchFilenameShortcut: "Filename search",
  terminalWorkspaceShortcut: "Terminal workspace",
  terminalFontSizeIncreaseShortcut: "Increase terminal font size",
  terminalFontSizeDecreaseShortcut: "Decrease terminal font size",
  terminalFilePanelShortcut: "File panel",
  revealActiveFileShortcut: "Reveal active file",
  gitPanelShortcut: "Git panel",
  portsPanelShortcut: "Ports panel",
  projectPanelShortcut: "Project panel",
  cognitoModeShortcut: "Cognito Mode",
  osPaletteShortcut: "OS Command Palette",
  osCycleFocusShortcut: "OS Focus Cycle",
};

function createShortcutValidator(
  currentKey: string,
  customValidator?: (value: string | null) => string | null,
) {
  return (next: string | null): string | null => {
    if (customValidator) {
      const err = customValidator(next);
      if (err) return err;
    } else {
      const err = validateShortcut(next);
      if (err) return err;
    }
    if (!next) return null;

    const formatted = formatShortcut(next);
    if (formatted === "Ctrl+Shift+KeyC" || formatted === "Cmd+Shift+KeyC") {
      return "Conflicts with terminal copy";
    }

    const state = useSettingsStore.getState();
    for (const [key, label] of Object.entries(SHORTCUT_LABELS)) {
      if (key === currentKey) continue;
      const existing = (state as unknown as Record<string, unknown>)[key];
      if (typeof existing === "string" && existing.length > 0) {
        if (formatShortcut(existing) === formatted) {
          return `Conflicts with ${label}`;
        }
      }
    }
    return null;
  };
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
    cognitoModeShortcut,
    osPaletteShortcut,
    osCycleFocusShortcut,
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
          label="Text search"
          validate={createShortcutValidator("searchTextShortcut")}
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
          label="Filename search"
          validate={createShortcutValidator("searchFilenameShortcut")}
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
          validate={createShortcutValidator("terminalWorkspaceShortcut")}
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
          validate={createShortcutValidator("terminalFontSizeIncreaseShortcut")}
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
          validate={createShortcutValidator("terminalFontSizeDecreaseShortcut")}
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
          label="File panel"
          validate={createShortcutValidator("terminalFilePanelShortcut")}
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
          label="Reveal active file"
          validate={createShortcutValidator("revealActiveFileShortcut")}
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
          label="Git panel"
          validate={createShortcutValidator("gitPanelShortcut")}
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
          label="Ports panel"
          validate={createShortcutValidator("portsPanelShortcut")}
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
          validate={createShortcutValidator("projectPanelShortcut")}
          onChange={(shortcut) =>
            saveDebounced({ projectPanelShortcut: shortcut })
          }
        />
      </SettingRow>

      <div className="border-t border-[var(--color-border)]" />

      <SettingRow
        title="Cognito Mode"
        description="Toggle privacy screen mask on or off. Requires the same keyboard shortcut to dismiss."
      >
        <ShortcutCapture
          value={cognitoModeShortcut}
          defaultValue={DEFAULT_COGNITO_MODE_SHORTCUT}
          label="Cognito Mode"
          validate={createShortcutValidator("cognitoModeShortcut", validateCognitoModeShortcut)}
          onChange={(shortcut) =>
            saveDebounced({ cognitoModeShortcut: shortcut ?? DEFAULT_COGNITO_MODE_SHORTCUT })
          }
        />
      </SettingRow>

      <div className="border-t border-[var(--color-border)]" />

      <SettingRow
        title="OS Command Palette"
        description="Open the DamHopper OS command palette"
      >
        <ShortcutCapture
          value={osPaletteShortcut}
          defaultValue={DEFAULT_OS_PALETTE_SHORTCUT}
          label="OS Command Palette"
          validate={createShortcutValidator("osPaletteShortcut")}
          onChange={(shortcut) =>
            saveDebounced({ osPaletteShortcut: shortcut })
          }
        />
      </SettingRow>

      <div className="border-t border-[var(--color-border)]" />

      <SettingRow
        title="OS Focus Cycle"
        description="Cycle focus between OS windows without emitting terminal escape bytes"
      >
        <ShortcutCapture
          value={osCycleFocusShortcut}
          defaultValue={DEFAULT_OS_CYCLE_FOCUS_SHORTCUT}
          label="OS Focus Cycle"
          validate={createShortcutValidator("osCycleFocusShortcut")}
          onChange={(shortcut) =>
            saveDebounced({ osCycleFocusShortcut: shortcut })
          }
        />
      </SettingRow>
    </section>
  );
}
