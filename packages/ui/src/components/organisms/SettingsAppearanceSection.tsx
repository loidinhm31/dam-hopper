import { useState } from "react";
import { NumberStepper } from "@/components/atoms/NumberStepper.js";
import { Switch } from "@/components/atoms/Switch.js";
import { SettingRow } from "@/components/molecules/SettingRow.js";
import { TerminalAgentNotificationSettings } from "@/components/molecules/TerminalAgentNotificationSettings.js";
import { useSettingsStore } from "@/stores/settings.js";
import {
  clearHistory,
  isHistoryEnabled,
  setHistoryEnabled,
} from "@/lib/command-history.js";

export function SettingsAppearanceSection() {
  const [historyEnabled, setHistoryEnabledState] = useState(isHistoryEnabled);
  const {
    systemFontSize,
    editorFontSize,
    editorZoomWheelEnabled,
    terminalSuggestionsEnabled,
    terminalCodexNotificationsEnabled,
    terminalScrollButtonsEnabled,
    terminalScrollStep,
    explorerShowHidden,
    mobileCustomKeyboardEnabled,
    mobileCustomKeyboardFontSize,
    mobileCustomKeyboardPadding,
    mobileCustomKeyboardRowGap,
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
        title="Ctrl+Wheel zoom"
        description="Zoom editor font size with mouse wheel while holding Ctrl"
      >
        <Switch
          checked={editorZoomWheelEnabled}
          onCheckedChange={(checked) =>
            saveDebounced({ editorZoomWheelEnabled: checked })
          }
        />
      </SettingRow>

      <div className="border-t border-[var(--color-border)]" />

      <SettingRow
        title="Show hidden files"
        description="Show dotfiles and hidden entries in the project explorer"
      >
        <Switch
          checked={explorerShowHidden}
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
          onCheckedChange={(checked) =>
            saveDebounced({ terminalSuggestionsEnabled: checked })
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

      <TerminalAgentNotificationSettings
        enabled={terminalCodexNotificationsEnabled}
        onSave={saveDebounced}
      />

      <div className="border-t border-[var(--color-border)]" />

      <SettingRow
        title="Show terminal scroll buttons"
        description="Show floating terminal buttons for step scroll and jump-to-edge navigation"
      >
        <Switch
          checked={terminalScrollButtonsEnabled}
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
        title="Custom mobile terminal keyboard"
        description="Use the compact in-app keyboard instead of opening the device keyboard"
      >
        <Switch
          checked={mobileCustomKeyboardEnabled}
          onCheckedChange={(checked) =>
            saveDebounced({ mobileCustomKeyboardEnabled: checked })
          }
        />
      </SettingRow>

      <div className="border-t border-[var(--color-border)]" />

      <SettingRow
        title="Mobile keyboard font size"
        description="Range: 9-18 px"
      >
        <NumberStepper
          value={mobileCustomKeyboardFontSize}
          min={9}
          max={18}
          onChange={(value) =>
            saveDebounced({ mobileCustomKeyboardFontSize: value })
          }
        />
      </SettingRow>

      <div className="border-t border-[var(--color-border)]" />

      <SettingRow
        title="Mobile keyboard padding"
        description="Range: 2-14 px"
      >
        <NumberStepper
          value={mobileCustomKeyboardPadding}
          min={2}
          max={14}
          onChange={(value) =>
            saveDebounced({ mobileCustomKeyboardPadding: value })
          }
        />
      </SettingRow>

      <div className="border-t border-[var(--color-border)]" />

      <SettingRow
        title="Mobile keyboard row gap"
        description="Range: 2-12 px"
      >
        <NumberStepper
          value={mobileCustomKeyboardRowGap}
          min={2}
          max={12}
          onChange={(value) =>
            saveDebounced({ mobileCustomKeyboardRowGap: value })
          }
        />
      </SettingRow>
    </section>
  );
}
