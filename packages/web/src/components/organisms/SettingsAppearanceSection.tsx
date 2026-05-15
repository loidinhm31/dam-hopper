import { useSettingsStore } from "@/stores/settings.js";
import { Switch } from "@/components/atoms/Switch.js";
import { NumberStepper } from "@/components/atoms/NumberStepper.js";
import { SettingRow } from "@/components/molecules/SettingRow.js";

export function SettingsAppearanceSection() {
  const {
    systemFontSize,
    editorFontSize,
    editorZoomWheelEnabled,
    terminalSuggestionsEnabled,
    explorerShowHidden,
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
        title="Ctrl+Shift+Wheel zoom"
        description="Zoom editor font size with mouse wheel while holding Ctrl+Shift"
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
        description="Show command suggestions based on history while typing in terminal"
      >
        <Switch
          checked={terminalSuggestionsEnabled}
          onCheckedChange={(checked) =>
            saveDebounced({ terminalSuggestionsEnabled: checked })
          }
        />
      </SettingRow>
    </section>
  );
}
