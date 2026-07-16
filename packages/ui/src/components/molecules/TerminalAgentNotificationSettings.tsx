import { useEffect, useState } from "react";
import { BellRing } from "lucide-react";
import { Badge } from "@/components/atoms/Badge.js";
import { Button } from "@/components/atoms/Button.js";
import { Switch } from "@/components/atoms/Switch.js";
import { SettingRow } from "@/components/molecules/SettingRow.js";
import {
  getBrowserNotificationPermissionState,
  requestBrowserNotificationPermission,
  type BrowserNotificationPermissionState,
} from "@/lib/browser-notification-service.js";
import { recordClientDiagnostic } from "@/lib/diagnostics-client.js";
import { playTerminalNotificationSound } from "@/lib/terminal-notification-sound.js";

type TerminalAgentNotificationSettingsPatch = Partial<{
  terminalCodexNotificationsEnabled: boolean;
  terminalCodexNotificationSoundEnabled: boolean;
  terminalCodexNotificationSoundVolume: number;
}>;

interface TerminalAgentNotificationSettingsProps {
  enabled: boolean;
  soundEnabled: boolean;
  soundVolume: number;
  onSave: (partial: TerminalAgentNotificationSettingsPatch) => void;
}

const PERMISSION_VARIANT: Record<
  BrowserNotificationPermissionState,
  "success" | "danger" | "warning" | "neutral"
> = {
  granted: "success",
  denied: "danger",
  default: "warning",
  unsupported: "neutral",
};

const PERMISSION_LABEL: Record<BrowserNotificationPermissionState, string> = {
  granted: "Granted",
  denied: "Denied",
  default: "Not requested",
  unsupported: "Unsupported",
};

export function TerminalAgentNotificationSettings({
  enabled,
  soundEnabled,
  soundVolume,
  onSave,
}: TerminalAgentNotificationSettingsProps) {
  const [permission, setPermission] = useState<BrowserNotificationPermissionState>(() =>
    getBrowserNotificationPermissionState(),
  );
  const [permissionPending, setPermissionPending] = useState(false);
  useEffect(() => {
    const syncPermission = () =>
      setPermission(getBrowserNotificationPermissionState());
    syncPermission();
    globalThis.window?.addEventListener("focus", syncPermission);
    return () => globalThis.window?.removeEventListener("focus", syncPermission);
  }, []);

  async function handleRequestPermission() {
    setPermissionPending(true);
    const next = await requestBrowserNotificationPermission();
    setPermission(next);
    setPermissionPending(false);
    recordClientDiagnostic(
      "custom",
      "terminal-agent-notifications",
      "browser notification permission requested",
      { permission: next },
    );
  }

  return (
    <div className="space-y-4 rounded border border-[var(--color-border)] bg-[var(--color-surface-2)] p-4">
      <div className="flex items-start gap-3">
        <div className="mt-0.5 rounded border border-[var(--color-border)] p-2 text-[var(--color-text-muted)]">
          <BellRing className="h-4 w-4" />
        </div>
        <div className="min-w-0">
          <h4 className="text-sm font-medium text-[var(--color-text)]">
            Codex terminal notifications
          </h4>
          <p className="mt-0.5 text-xs text-[var(--color-text-muted)]">
            Browser notifications for Codex running inside DamHopper terminals.
            DamHopper syncs your home
            {" "}
            <code>~/.codex/config.toml</code>
            {" "}
            TUI notification block for you.
          </p>
        </div>
      </div>
      <SettingRow
        title="Enable Codex notifications"
        description='Writes `tui.notifications`, `tui.notification_method = "osc9"`, and `tui.notification_condition = "always"` to `~/.codex/config.toml`'
      >
        <Switch
          checked={enabled}
          ariaLabel="Enable Codex notifications"
          onCheckedChange={(checked) =>
            onSave({ terminalCodexNotificationsEnabled: checked })
          }
        />
      </SettingRow>
      <div className="border-t border-[var(--color-border)]" />
      <SettingRow
        title="Notification sound"
        description="Play an in-app chime when Codex needs attention"
      >
        <Switch
          checked={soundEnabled}
          ariaLabel="Enable notification sound"
          disabled={!enabled}
          onCheckedChange={(checked) =>
            onSave({ terminalCodexNotificationSoundEnabled: checked })
          }
        />
      </SettingRow>
      <div className="border-t border-[var(--color-border)]" />
      <SettingRow
        title="Notification sound volume"
        description={`${soundVolume}% of the notification chime level`}
      >
        <label className="flex items-center gap-2 text-xs text-[var(--color-text-muted)]">
          <input
            aria-label="Notification sound volume"
            type="range"
            min={0}
            max={100}
            step={1}
            value={soundVolume}
            disabled={!enabled || !soundEnabled}
            onChange={(event) =>
              onSave({
                terminalCodexNotificationSoundVolume: Number(event.target.value),
              })
            }
            className="w-28 accent-[var(--color-primary)] disabled:cursor-not-allowed disabled:opacity-50"
          />
          <span className="w-9 text-right">{soundVolume}%</span>
        </label>
      </SettingRow>
      <div className="border-t border-[var(--color-border)]" />
      <SettingRow
        title="Test notification sound"
        description="Plays the selected volume and enables audio for future notification chimes"
      >
        <Button
          type="button"
          size="sm"
          disabled={!enabled || !soundEnabled}
          onClick={() => playTerminalNotificationSound(soundVolume)}
        >
          Play sound
        </Button>
      </SettingRow>
      <div className="border-t border-[var(--color-border)]" />
      <SettingRow
        title="Browser permission"
        description="Permission must be requested from an explicit click"
      >
        <div className="flex flex-wrap items-center justify-end gap-2">
          <Badge variant={PERMISSION_VARIANT[permission]}>
            {PERMISSION_LABEL[permission]}
          </Badge>
          <Button
            type="button"
            size="sm"
            loading={permissionPending}
            disabled={permission === "unsupported"}
            onClick={() => void handleRequestPermission()}
          >
            Request permission
          </Button>
        </div>
      </SettingRow>
      {permission === "denied" ? (
        <p className="text-xs text-[var(--color-text-muted)]">
          Notifications are blocked by the browser. Update this site&apos;s
          notification setting in the browser, then request permission again.
        </p>
      ) : null}
    </div>
  );
}
