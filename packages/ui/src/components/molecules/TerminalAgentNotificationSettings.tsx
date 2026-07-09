import { useEffect, useState } from "react";
import { BellRing } from "lucide-react";
import { Badge } from "@/components/atoms/Badge.js";
import { Button } from "@/components/atoms/Button.js";
import { NumberStepper } from "@/components/atoms/NumberStepper.js";
import { Switch } from "@/components/atoms/Switch.js";
import { AgentCommandPatternEditor } from "@/components/molecules/AgentCommandPatternEditor.js";
import { SettingRow } from "@/components/molecules/SettingRow.js";
import type { AgentCommandPattern } from "@/api/client.js";
import {
  getBrowserNotificationPermissionState,
  requestBrowserNotificationPermission,
  type BrowserNotificationPermissionState,
} from "@/lib/browser-notification-service.js";
import { recordClientDiagnostic } from "@/lib/diagnostics-client.js";

type TerminalAgentNotificationSettingsPatch = Partial<{
  terminalAgentNotificationsEnabled: boolean;
  terminalAgentSignalsEnabled: boolean;
  terminalAgentQuietTrackingEnabled: boolean;
  terminalAgentQuietTimeoutMs: number;
  terminalAgentCommandPatterns: AgentCommandPattern[];
}>;

interface TerminalAgentNotificationSettingsProps {
  enabled: boolean;
  signalsEnabled: boolean;
  quietTrackingEnabled: boolean;
  quietTimeoutMs: number;
  commandPatterns: AgentCommandPattern[];
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
  signalsEnabled,
  quietTrackingEnabled,
  quietTimeoutMs,
  commandPatterns,
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
            Terminal agent notifications
          </h4>
          <p className="mt-0.5 text-xs text-[var(--color-text-muted)]">
            Browser notifications for DamHopper xterm sessions only. External
            terminals stay out of scope.
          </p>
        </div>
      </div>
      <SettingRow
        title="Enable agent notifications"
        description="Allow tracked terminal agents to raise browser notifications"
      >
        <Switch
          checked={enabled}
          onCheckedChange={(checked) =>
            onSave({ terminalAgentNotificationsEnabled: checked })
          }
        />
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
      <div className="border-t border-[var(--color-border)]" />
      <SettingRow
        title="Terminal notification signals"
        description="Honor BEL and OSC 9/777/99 notifications emitted inside xterm"
      >
        <Switch
          checked={signalsEnabled}
          onCheckedChange={(checked) =>
            onSave({ terminalAgentSignalsEnabled: checked })
          }
        />
      </SettingRow>
      <div className="border-t border-[var(--color-border)]" />
      <SettingRow
        title="Quiet tracking"
        description="Notify when a tracked agent goes quiet and may need attention"
      >
        <Switch
          checked={quietTrackingEnabled}
          onCheckedChange={(checked) =>
            onSave({ terminalAgentQuietTrackingEnabled: checked })
          }
        />
      </SettingRow>
      <div className="border-t border-[var(--color-border)]" />
      <SettingRow
        title="Quiet timeout"
        description="Seconds of inactivity before a quiet notification fires (5–600)"
      >
        <NumberStepper
          value={Math.round(quietTimeoutMs / 1000)}
          min={5}
          max={600}
          onChange={(value) =>
            onSave({ terminalAgentQuietTimeoutMs: value * 1000 })
          }
        />
      </SettingRow>
      <div className="border-t border-[var(--color-border)]" />
      <div className="space-y-2">
        <div>
          <p className="text-sm font-medium text-[var(--color-text)]">
            Command patterns
          </p>
          <p className="mt-0.5 text-xs text-[var(--color-text-muted)]">
            Match agent launch commands by executable token.
          </p>
        </div>
        <AgentCommandPatternEditor
          patterns={commandPatterns}
          onCommit={(patterns) =>
            onSave({ terminalAgentCommandPatterns: patterns })
          }
        />
      </div>
    </div>
  );
}
