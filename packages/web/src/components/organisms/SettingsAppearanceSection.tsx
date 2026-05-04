import { useSettingsStore, clampFont } from "@/stores/settings.js";

function FontSizeInput({
  label,
  value,
  onChange,
}: {
  label: string;
  value: number;
  onChange: (v: number) => void;
}) {
  return (
    <div className="flex items-center justify-between gap-4">
      <div className="flex-1 min-w-0">
        <p className="text-sm font-medium text-[var(--color-text)]">{label}</p>
        <p className="text-xs text-[var(--color-text-muted)] mt-0.5">
          Range: 10–32 px
        </p>
      </div>
      <div className="flex items-center gap-2">
        <button
          className="w-7 h-7 flex items-center justify-center rounded border border-[var(--color-border)] text-[var(--color-text-muted)] hover:text-[var(--color-text)] hover:border-[var(--color-primary)] transition-colors text-base leading-none"
          onClick={() => onChange(value - 1)}
          disabled={value <= 10}
          aria-label="Decrease"
        >
          −
        </button>
        <input
          type="number"
          min={10}
          max={32}
          value={value}
          onChange={(e) => {
            const n = parseInt(e.target.value, 10);
            if (!isNaN(n)) onChange(n);
          }}
          onBlur={(e) => {
            const n = parseInt(e.target.value, 10);
            onChange(isNaN(n) ? value : clampFont(n));
          }}
          className="w-14 text-center rounded border border-[var(--color-border)] bg-[var(--color-input)] text-[var(--color-text)] text-sm px-2 py-1 focus:outline-none focus:border-[var(--color-primary)] focus:ring-1 focus:ring-[var(--color-primary)]"
        />
        <button
          className="w-7 h-7 flex items-center justify-center rounded border border-[var(--color-border)] text-[var(--color-text-muted)] hover:text-[var(--color-text)] hover:border-[var(--color-primary)] transition-colors text-base leading-none"
          onClick={() => onChange(value + 1)}
          disabled={value >= 32}
          aria-label="Increase"
        >
          +
        </button>
      </div>
    </div>
  );
}

export function SettingsAppearanceSection() {
  const { 
    systemFontSize, 
    editorFontSize, 
    editorZoomWheelEnabled, 
    terminalSuggestionsEnabled,
    saveDebounced 
  } = useSettingsStore();

  return (
    <section className="rounded-lg border border-[var(--color-border)] bg-[var(--color-surface)] p-4 space-y-4">
      <h3 className="text-sm font-medium text-[var(--color-text)]">Appearance</h3>

      <FontSizeInput
        label="System font size"
        value={systemFontSize}
        onChange={(v) => saveDebounced({ systemFontSize: v })}
      />

      <div className="border-t border-[var(--color-border)]" />

      <FontSizeInput
        label="Editor font size"
        value={editorFontSize}
        onChange={(v) => saveDebounced({ editorFontSize: v })}
      />

      <div className="border-t border-[var(--color-border)]" />

      <div className="flex items-center justify-between gap-4">
        <div className="flex-1 min-w-0">
          <p className="text-sm font-medium text-[var(--color-text)]">
            Ctrl+Shift+Wheel zoom
          </p>
          <p className="text-xs text-[var(--color-text-muted)] mt-0.5">
            Zoom editor font size with mouse wheel while holding Ctrl+Shift
          </p>
        </div>
        <button
          role="switch"
          aria-checked={editorZoomWheelEnabled}
          onClick={() => saveDebounced({ editorZoomWheelEnabled: !editorZoomWheelEnabled })}
          className={`relative inline-flex h-5 w-9 shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors duration-200 focus:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-primary)] ${
            editorZoomWheelEnabled ? "bg-[var(--color-primary)]" : "bg-[var(--color-border)]"
          }`}
        >
          <span
            className={`pointer-events-none inline-block h-4 w-4 transform rounded-full bg-white shadow-sm transition duration-200 ${
              editorZoomWheelEnabled ? "translate-x-4" : "translate-x-0"
            }`}
          />
        </button>
      </div>

      <div className="border-t border-[var(--color-border)]" />

      <div className="flex items-center justify-between gap-4">
        <div className="flex-1 min-w-0">
          <p className="text-sm font-medium text-[var(--color-text)]">
            Inline Terminal Suggestions
          </p>
          <p className="text-xs text-[var(--color-text-muted)] mt-0.5">
            Show command suggestions based on history while typing in terminal
          </p>
        </div>
        <button
          role="switch"
          aria-checked={terminalSuggestionsEnabled}
          onClick={() => saveDebounced({ terminalSuggestionsEnabled: !terminalSuggestionsEnabled })}
          className={`relative inline-flex h-5 w-9 shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors duration-200 focus:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-primary)] ${
            terminalSuggestionsEnabled ? "bg-[var(--color-primary)]" : "bg-[var(--color-border)]"
          }`}
        >
          <span
            className={`pointer-events-none inline-block h-4 w-4 transform rounded-full bg-white shadow-sm transition duration-200 ${
              terminalSuggestionsEnabled ? "translate-x-4" : "translate-x-0"
            }`}
          />
        </button>
      </div>
    </section>
  );
}
