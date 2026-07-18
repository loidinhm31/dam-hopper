import type { TerminalCodexNotificationSoundPattern } from "@/api/client.js";
import { Button } from "@/components/atoms/Button.js";
import { Switch } from "@/components/atoms/Switch.js";
import { SettingRow } from "@/components/molecules/SettingRow.js";
import { playTerminalNotificationSound } from "@/lib/terminal-notification-sound.js";

interface TerminalNotificationSoundControlsProps {
  masterEnabled: boolean;
  soundEnabled: boolean;
  soundPattern: TerminalCodexNotificationSoundPattern;
  soundVolume: number;
  onSoundEnabledChange: (enabled: boolean) => void;
  onSoundPatternChange: (
    pattern: TerminalCodexNotificationSoundPattern,
  ) => void;
  onSoundVolumeChange: (volume: number) => void;
}

const SOUND_PATTERNS: ReadonlyArray<{
  value: TerminalCodexNotificationSoundPattern;
  label: string;
}> = [
  { value: "default", label: "Default" },
  { value: "soft", label: "Soft" },
  { value: "two-tone", label: "Two-tone" },
  { value: "urgent", label: "Urgent" },
];

export function TerminalNotificationSoundControls({
  masterEnabled,
  soundEnabled,
  soundPattern,
  soundVolume,
  onSoundEnabledChange,
  onSoundPatternChange,
  onSoundVolumeChange,
}: TerminalNotificationSoundControlsProps) {
  const controlsDisabled = !masterEnabled || !soundEnabled;

  return (
    <>
      <SettingRow
        title="Notification sound"
        description="Play an in-app chime when Codex needs attention"
      >
        <Switch
          checked={soundEnabled}
          ariaLabel="Enable notification sound"
          disabled={!masterEnabled}
          onCheckedChange={onSoundEnabledChange}
        />
      </SettingRow>
      <div className="border-t border-[var(--color-border)]" />
      <SettingRow
        title="Sound style"
        description="Choose the in-app chime style; browser and OS popup sounds are not customizable here"
      >
        <select
          aria-label="Sound style"
          value={soundPattern}
          disabled={controlsDisabled}
          onChange={(event) =>
            onSoundPatternChange(
              event.target.value as TerminalCodexNotificationSoundPattern,
            )
          }
          className="h-7 rounded border border-[var(--color-border)] bg-[var(--color-surface)] px-2 text-xs text-[var(--color-text)] outline-none disabled:cursor-not-allowed disabled:opacity-50"
        >
          {SOUND_PATTERNS.map((pattern) => (
            <option key={pattern.value} value={pattern.value}>
              {pattern.label}
            </option>
          ))}
        </select>
      </SettingRow>
      <div className="border-t border-[var(--color-border)]" />
      <SettingRow
        title="Volume"
        description={`${soundVolume}% of the in-app chime level`}
      >
        <label className="flex items-center gap-2 text-xs text-[var(--color-text-muted)]">
          <input
            aria-label="Notification sound volume"
            type="range"
            min={0}
            max={100}
            step={1}
            value={soundVolume}
            disabled={controlsDisabled}
            onChange={(event) =>
              onSoundVolumeChange(Number(event.target.value))
            }
            className="w-28 accent-[var(--color-primary)] disabled:cursor-not-allowed disabled:opacity-50"
          />
          <span className="w-9 text-right">{soundVolume}%</span>
        </label>
      </SettingRow>
      <div className="border-t border-[var(--color-border)]" />
      <SettingRow
        title="Play sound"
        description="Preview the current in-app style and volume from an explicit click"
      >
        <Button
          type="button"
          size="sm"
          disabled={controlsDisabled}
          onClick={() =>
            playTerminalNotificationSound(soundPattern, soundVolume)
          }
        >
          Play sound
        </Button>
      </SettingRow>
    </>
  );
}
