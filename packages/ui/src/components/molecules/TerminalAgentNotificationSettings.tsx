import { useEffect, useState } from "react";
import { BellRing } from "lucide-react";
import { Badge } from "@/components/atoms/Badge.js";
import { Button } from "@/components/atoms/Button.js";
import { Switch } from "@/components/atoms/Switch.js";
import { SettingRow } from "@/components/molecules/SettingRow.js";
import { TerminalNotificationSoundControls } from "@/components/molecules/TerminalNotificationSoundControls.js";
import type {
  TerminalAgentNotificationPolicy,
  TerminalAgentNotifications,
} from "@/api/client.js";
import {
  getBrowserNotificationPermissionState,
  requestBrowserNotificationPermission,
  type BrowserNotificationPermissionState,
} from "@/lib/browser-notification-service.js";
import { recordClientDiagnostic } from "@/lib/diagnostics-client.js";

type AgentKind = keyof TerminalAgentNotifications["agents"];

interface TerminalAgentNotificationSettingsProps {
  notifications: TerminalAgentNotifications;
  onSave: (
    agent: AgentKind,
    patch: Partial<TerminalAgentNotificationPolicy>,
  ) => void;
}

function AgentChannelSettings({
  agent,
  policy,
  onSave,
}: {
  agent: AgentKind;
  policy: TerminalAgentNotificationPolicy;
  onSave: TerminalAgentNotificationSettingsProps["onSave"];
}) {
  const codex = agent === "codex";
  const name = codex ? "Codex" : "OMP";
  const label = (control: string) => (codex ? control : `${name} ${control}`);

  return (
    <div className="space-y-4 rounded border border-[var(--color-border)] p-4">
      <div>
        <h5 className="text-sm font-medium text-[var(--color-text)]">{name}</h5>
        <p className="mt-0.5 text-xs text-[var(--color-text-muted)]">
          {codex ? (
            <>
              DamHopper syncs the home <code>~/.codex/config.toml</code> TUI
              notification block.
            </>
          ) : (
            "Notifications for OMP running inside DamHopper terminals. Off until you enable them."
          )}
        </p>
      </div>
      <SettingRow
        title={`Enable ${name} notifications`}
        description={
          codex
            ? 'Writes `tui.notifications`, `tui.notification_method = "osc9"`, and `tui.notification_condition = "always"` to `~/.codex/config.toml`'
            : "Turn on semantic OMP alerts for this browser."
        }
      >
        <Switch
          checked={policy.enabled}
          ariaLabel={`Enable ${name} notifications`}
          onCheckedChange={(enabled) => onSave(agent, { enabled })}
        />
      </SettingRow>
      <SettingRow
        title="In-app toast"
        description="Show a transient app alert. Turning this off still keeps the bell and notification history."
      >
        <Switch
          checked={policy.toast}
          ariaLabel={label("Enable in-app toast")}
          disabled={!policy.enabled}
          onCheckedChange={(toast) => onSave(agent, { toast })}
        />
      </SettingRow>
      <SettingRow
        title="Browser popup"
        description="Show a native browser notification when permission is granted. Browser or OS popup sound is controlled by the browser."
      >
        <Switch
          checked={policy.browser}
          ariaLabel={label("Enable browser popup")}
          disabled={!policy.enabled}
          onCheckedChange={(browser) => onSave(agent, { browser })}
        />
      </SettingRow>
      <TerminalNotificationSoundControls
        masterEnabled={policy.enabled}
        soundEnabled={policy.sound}
        soundPattern={policy.pattern}
        soundVolume={policy.volume}
        agentName={name}
        onSoundEnabledChange={(sound) => onSave(agent, { sound })}
        onSoundPatternChange={(pattern) => onSave(agent, { pattern })}
        onSoundVolumeChange={(volume) => onSave(agent, { volume })}
      />
    </div>
  );
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
  notifications,
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
            Agent notifications
          </h4>
          <p className="mt-0.5 text-xs text-[var(--color-text-muted)]">
            Choose which terminal agents can alert you. Status badges remain
            visible even when notifications are off.
          </p>
        </div>
      </div>
      {notifications.version !== 1 ? (
        <div className="rounded border border-[var(--color-border)] p-4 text-xs text-[var(--color-text-muted)]">
          Unsupported notification preferences version ({notifications.version}
          ). Editing is disabled until migrated.
        </div>
      ) : (
        <>
          <AgentChannelSettings
            agent="codex"
            policy={notifications.agents.codex}
            onSave={onSave}
          />
          <AgentChannelSettings
            agent="omp"
            policy={notifications.agents.omp}
            onSave={onSave}
          />
        </>
      )}
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
            disabled={
              (!notifications.agents.codex.enabled &&
                !notifications.agents.omp.enabled) ||
              permission === "unsupported"
            }
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
