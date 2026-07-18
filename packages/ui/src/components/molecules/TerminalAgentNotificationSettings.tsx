import { useEffect, useState } from "react";
import { BellRing } from "lucide-react";
import { Badge } from "@/components/atoms/Badge.js";
import { Button } from "@/components/atoms/Button.js";
import { Switch } from "@/components/atoms/Switch.js";
import { SettingRow } from "@/components/molecules/SettingRow.js";
import { TerminalNotificationSoundControls } from "@/components/molecules/TerminalNotificationSoundControls.js";
import type { TerminalCodexNotificationSoundPattern } from "@/api/client.js";
import {
  getBrowserNotificationPermissionState,
  requestBrowserNotificationPermission,
  type BrowserNotificationPermissionState,
} from "@/lib/browser-notification-service.js";
import { recordClientDiagnostic } from "@/lib/diagnostics-client.js";

export type TerminalAgentNotificationSettingsPatch = Partial<{
  terminalCodexNotificationsEnabled: boolean;
  terminalCodexNotificationToastEnabled: boolean;
  terminalCodexBrowserNotificationsEnabled: boolean;
  terminalCodexNotificationSoundEnabled: boolean;
  terminalCodexNotificationSoundVolume: number;
  terminalCodexNotificationSoundPattern: TerminalCodexNotificationSoundPattern;
}>;

interface TerminalAgentNotificationSettingsProps {
  enabled: boolean;
  toastEnabled: boolean;
  browserEnabled: boolean;
  soundEnabled: boolean;
  soundVolume: number;
  soundPattern: TerminalCodexNotificationSoundPattern;
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
  toastEnabled,
  browserEnabled,
  soundEnabled,
  soundVolume,
  soundPattern,
  onSave,
}: TerminalAgentNotificationSettingsProps) {
  const [permission, setPermission] =
    useState<BrowserNotificationPermissionState>(() =>
      getBrowserNotificationPermissionState(),
    );
  const [permissionPending, setPermissionPending] = useState(false);
  useEffect(() => {
    const syncPermission = () =>
      setPermission(getBrowserNotificationPermissionState());
    syncPermission();
    globalThis.window?.addEventListener("focus", syncPermission);
    return () =>
      globalThis.window?.removeEventListener("focus", syncPermission);
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
            Delivery controls for Codex running inside DamHopper terminals.
            DamHopper syncs your home <code>~/.codex/config.toml</code> TUI
            notification block for you.
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
        title="In-app toast"
        description="Show a transient app alert. Turning this off still keeps the bell and notification history."
      >
        <Switch
          checked={toastEnabled}
          ariaLabel="Enable in-app toast"
          disabled={!enabled}
          onCheckedChange={(checked) =>
            onSave({ terminalCodexNotificationToastEnabled: checked })
          }
        />
      </SettingRow>
      <div className="border-t border-[var(--color-border)]" />
      <SettingRow
        title="Browser popup"
        description="Show a native browser notification when permission is granted. Browser or OS popup sound is controlled by the browser."
      >
        <Switch
          checked={browserEnabled}
          ariaLabel="Enable browser popup"
          disabled={!enabled}
          onCheckedChange={(checked) =>
            onSave({ terminalCodexBrowserNotificationsEnabled: checked })
          }
        />
      </SettingRow>
      <div className="border-t border-[var(--color-border)]" />
      <TerminalNotificationSoundControls
        masterEnabled={enabled}
        soundEnabled={soundEnabled}
        soundPattern={soundPattern}
        soundVolume={soundVolume}
        onSoundEnabledChange={(checked) =>
          onSave({ terminalCodexNotificationSoundEnabled: checked })
        }
        onSoundPatternChange={(pattern) =>
          onSave({ terminalCodexNotificationSoundPattern: pattern })
        }
        onSoundVolumeChange={(volume) =>
          onSave({ terminalCodexNotificationSoundVolume: volume })
        }
      />
      <div className="border-t border-[var(--color-border)]" />
      <SettingRow
        title="Browser permission"
        description="Permission must be requested from an explicit click"
      >
        <div className="flex flex-wrap items-center justify-end gap-2">
          <span aria-live="polite" role="status">
            <Badge variant={PERMISSION_VARIANT[permission]}>
              {PERMISSION_LABEL[permission]}
            </Badge>
          </span>
          <Button
            type="button"
            size="sm"
            loading={permissionPending}
            disabled={!enabled || permission === "unsupported"}
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
