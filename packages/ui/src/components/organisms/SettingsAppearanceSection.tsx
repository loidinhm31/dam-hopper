import { useState } from "react";
import { NumberStepper } from "@/components/atoms/NumberStepper.js";
import { Switch } from "@/components/atoms/Switch.js";
import { SettingRow } from "@/components/molecules/SettingRow.js";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/Select.js";
import { useSettingsStore } from "@/stores/settings.js";
import {
  clearHistory,
  isHistoryEnabled,
  setHistoryEnabled,
} from "@/lib/command-history.js";
import { isCognitoModeStyle } from "@/lib/ui-config.js";
export function SettingsAppearanceSection() {
  const [historyEnabled, setHistoryEnabledState] = useState(isHistoryEnabled);
  const {
    systemFontSize,
    editorFontSize,
    terminalFontSize,
    editorZoomWheelEnabled,
    terminalSuggestionsEnabled,
    terminalScrollButtonsEnabled,
    terminalCommitStatusEnabled,
    terminalAutoSwitchProjectEnabled,
    terminalScrollStep,
    explorerShowHidden,
    cognitoModeStyle,
    defaultWindowPlacement,
    dockPadding,
    dockItemSpacing,
    dockOuterSpacing,
    dockRadius,
    cursorTheme,
    sourceUnset,
    saveDebounced,
  } = useSettingsStore();

  return (
    <section className="rounded-lg border border-[var(--color-border)] bg-[var(--color-surface)] p-4 space-y-4">
      <h3 className="text-sm font-medium text-[var(--color-text)]">
        Appearance
      </h3>

      <SettingRow title="System font size" description="Range: 10–32 px">
        <NumberStepper
          value={systemFontSize}
          onChange={(v) => saveDebounced({ systemFontSize: v })}
        />
      </SettingRow>

      <div className="border-t border-[var(--color-border)]" />

      <SettingRow title="Editor font size" description="Range: 10–32 px">
        <NumberStepper
          value={editorFontSize}
          onChange={(v) => saveDebounced({ editorFontSize: v })}
        />
      </SettingRow>

      <div className="border-t border-[var(--color-border)]" />

      <SettingRow
        title="Terminal font size"
        description="Range: 10–32 px; applies to terminal text"
      >
        <NumberStepper
          value={terminalFontSize}
          label="terminal font size"
          onChange={(value) => saveDebounced({ terminalFontSize: value })}
        />
      </SettingRow>

      <div className="border-t border-[var(--color-border)]" />

      <SettingRow
        title="Ctrl+Wheel zoom"
        description="Zoom editor font size with mouse wheel while holding Ctrl"
      >
        <Switch
          checked={editorZoomWheelEnabled}
          ariaLabel="Enable Ctrl+Wheel zoom"
          onCheckedChange={(checked) =>
            saveDebounced({ editorZoomWheelEnabled: checked })
          }
        />
      </SettingRow>

      <div className="border-t border-[var(--color-border)]" />

      <SettingRow
        title="Default window placement"
        description="Choose whether new windows open as floating panels or tiled grid panes"
      >
        <Select
          value={defaultWindowPlacement ?? "float"}
          onValueChange={(val: "float" | "tile") =>
            saveDebounced({ defaultWindowPlacement: val })
          }
        >
          <SelectTrigger className="w-32" data-testid="default-window-placement-select">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="float">Float</SelectItem>
            <SelectItem value="tile">Tile</SelectItem>
          </SelectContent>
        </Select>
      </SettingRow>

      <div className="border-t border-[var(--color-border)]" />
      <SettingRow
        title="Show hidden files"
        description="Show dotfiles and hidden entries in the project explorer"
      >
        <Switch
          checked={explorerShowHidden}
          ariaLabel="Show hidden files"
          onCheckedChange={(checked) =>
            saveDebounced({ explorerShowHidden: checked })
          }
        />
      </SettingRow>

      <div className="border-t border-[var(--color-border)]" />

      <SettingRow
        title="Inline Terminal Suggestions"
        description="Saved preference; automatic suggestions stay unavailable until verified shell lifecycle support is ready"
      >
        <Switch
          checked={terminalSuggestionsEnabled}
          ariaLabel="Enable inline terminal suggestions"
          onCheckedChange={(checked) =>
            saveDebounced({ terminalSuggestionsEnabled: checked })
          }
        />
      </SettingRow>

      <div className="border-t border-[var(--color-border)]" />

      <SettingRow
        title="Show latest commit in terminal"
        description="Show the active terminal project's branch and latest commit in the terminal header or project list"
      >
        <Switch
          checked={terminalCommitStatusEnabled}
          ariaLabel="Show latest commit in terminal"
          onCheckedChange={(checked) =>
            saveDebounced({ terminalCommitStatusEnabled: checked })
          }
        />
      </SettingRow>

      <div className="border-t border-[var(--color-border)]" />

      <SettingRow
        title="Switch project on terminal selection"
        description="Selecting a terminal assigned to a project activates that project; free terminals leave the current project unchanged."
      >
        <Switch
          checked={terminalAutoSwitchProjectEnabled}
          ariaLabel="Enable project switching on terminal selection"
          onCheckedChange={(checked) =>
            saveDebounced({ terminalAutoSwitchProjectEnabled: checked })
          }
        />
      </SettingRow>

      <div className="border-t border-[var(--color-border)]" />

      <SettingRow
        title="Local command history"
        description="Stored only in this browser. Disabling stops future command saving."
      >
        <Switch
          checked={historyEnabled}
          ariaLabel="Enable local command history"
          onCheckedChange={(enabled) => {
            setHistoryEnabled(enabled);
            setHistoryEnabledState(isHistoryEnabled());
          }}
        />
      </SettingRow>

      <div className="border-t border-[var(--color-border)]" />

      <SettingRow
        title="Clear local command history"
        description="Remove commands previously stored in this browser"
      >
        <button
          type="button"
          onClick={clearHistory}
          className="rounded border border-[var(--color-border)] px-2 py-1 text-xs text-[var(--color-text)] hover:bg-[var(--color-surface-2)]"
        >
          Clear history
        </button>
      </SettingRow>

      <div className="border-t border-[var(--color-border)]" />

      <SettingRow
        title="Show terminal scroll buttons"
        description="Show floating terminal buttons for step scroll and jump-to-edge navigation"
      >
        <Switch
          checked={terminalScrollButtonsEnabled}
          ariaLabel="Show terminal scroll buttons"
          onCheckedChange={(checked) =>
            saveDebounced({ terminalScrollButtonsEnabled: checked })
          }
        />
      </SettingRow>

      <div className="border-t border-[var(--color-border)]" />

      <SettingRow
        title="Terminal scroll step"
        description="Number of lines to scroll for the step up/down buttons (1–50)"
      >
        <NumberStepper
          value={terminalScrollStep}
          min={1}
          max={50}
          onChange={(v) => saveDebounced({ terminalScrollStep: v })}
        />
      </SettingRow>

      <div className="border-t border-[var(--color-border)]" />

      <SettingRow
        title="Cognito Mode style"
        description="Choose the visual privacy mask appearance. Background work, notifications, and audio continue while masked."
      >
        <Select
          value={cognitoModeStyle}
          onValueChange={(value) => {
            if (isCognitoModeStyle(value)) {
              saveDebounced({ cognitoModeStyle: value });
            }
          }}
        >
          <SelectTrigger aria-label="Cognito Mode style" className="w-44">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="heavy-blur">Heavy Blur</SelectItem>
            <SelectItem value="black-screen">Black Screen</SelectItem>
          </SelectContent>
        </Select>
      </SettingRow>

      {sourceUnset && (
        <div
          role="status"
          className="rounded border border-[var(--color-warning)] bg-[var(--color-warning)]/10 p-2 text-xs text-[var(--color-warning)]"
        >
          No preference source connected. Preferences are kept in local snapshot until a profile connects.
        </div>
      )}

      <div className="border-t border-[var(--color-border)]" />

      <SettingRow
        title="Dock padding"
        description="Internal padding of the floating dock (0–16 px)"
      >
        <NumberStepper
          value={dockPadding ?? 8}
          min={0}
          max={16}
          label="dock padding"
          onChange={(v) => saveDebounced({ dockPadding: v })}
        />
      </SettingRow>

      <div className="border-t border-[var(--color-border)]" />

      <SettingRow
        title="Dock item spacing"
        description="Vertical spacing between dock app icons (0–12 px)"
      >
        <NumberStepper
          value={dockItemSpacing ?? 6}
          min={0}
          max={12}
          label="dock item spacing"
          onChange={(v) => saveDebounced({ dockItemSpacing: v })}
        />
      </SettingRow>

      <div className="border-t border-[var(--color-border)]" />

      <SettingRow
        title="Dock outer spacing"
        description="Outer gutter margin around the floating dock (0–24 px)"
      >
        <NumberStepper
          value={dockOuterSpacing ?? 12}
          min={0}
          max={24}
          label="dock outer spacing"
          onChange={(v) => saveDebounced({ dockOuterSpacing: v })}
        />
      </SettingRow>

      <div className="border-t border-[var(--color-border)]" />

      <SettingRow
        title="Dock corner radius"
        description="Corner curvature radius of the floating dock container (0–28 px)"
      >
        <NumberStepper
          value={dockRadius ?? 18}
          min={0}
          max={28}
          label="dock radius"
          onChange={(v) => saveDebounced({ dockRadius: v })}
        />
      </SettingRow>

      <div className="border-t border-[var(--color-border)]" />

      <SettingRow
        title="Cursor theme"
        description="Use system default pointer or custom themed OS desktop cursor"
      >
        <Select
          value={cursorTheme ?? "system"}
          onValueChange={(val: "system" | "theme") =>
            saveDebounced({ cursorTheme: val })
          }
        >
          <SelectTrigger aria-label="Cursor theme" className="w-44">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="system">System</SelectItem>
            <SelectItem value="theme">Theme</SelectItem>
          </SelectContent>
        </Select>
      </SettingRow>

      <div className="border-t border-[var(--color-border)]" />

      <SettingRow
        title="Reset appearance"
        description="Reset dock layout and cursor style to defaults. Dock pins remain stored locally."
      >
        <button
          type="button"
          onClick={() =>
            saveDebounced({
              dockPadding: 8,
              dockItemSpacing: 6,
              dockOuterSpacing: 12,
              dockRadius: 18,
              cursorTheme: "system",
            })
          }
          className="rounded border border-[var(--color-border)] px-3 py-1.5 text-xs text-[var(--color-text)] hover:bg-[var(--color-surface-2)] transition-colors"
        >
          Reset appearance defaults
        </button>
      </SettingRow>

      <p className="text-xs text-[var(--color-text-muted)] mt-2">
        Note: Dock layout and cursor style are workbench preferences saved to the server configuration. Dock app pins are stored locally in this browser.
      </p>
    </section>
  );
}
