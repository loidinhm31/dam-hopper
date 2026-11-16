import { useEffect, useRef, useState } from "react";
import { Button } from "@/components/atoms/Button.js";
import { Switch } from "@/components/atoms/Switch.js";
import { Input } from "@/components/ui/Input.js";
import { Textarea } from "@/components/ui/Textarea.js";
import type { DamHopperConfig } from "@/api/client.js";
import type { ConnectionRef } from "@/api/ownership.js";
import { useBrowserHostLiveStatus } from "@/api/browser-host-live-status.js";
import {
  applyDraftToConfig,
  describeLiveStatus,
  draftFromConfig,
  isDraftDirty,
  type HostBrowserDraft,
} from "./settings-host-browser-config.js";

export interface SettingsHostBrowserSectionProps {
  config?: DamHopperConfig;
  isLoading: boolean;
  owner?: ConnectionRef;
  /** False while the target server is not connected. */
  targetReady: boolean;
  updateConfig: (config: DamHopperConfig) => Promise<unknown>;
  isSaving: boolean;
  targetLabel?: string;
}

const NOTICE_CLASS =
  "rounded border border-[var(--color-warning)]/40 bg-[var(--color-warning)]/10 px-3 py-2 text-xs text-[var(--color-warning)]";
const ERROR_CLASS =
  "rounded border border-[var(--color-danger)]/40 bg-[var(--color-danger)]/10 px-3 py-2 text-xs text-[var(--color-danger)]";
const LABEL_CLASS = "text-xs font-semibold text-[var(--color-text)]";
const HINT_CLASS = "text-xs text-[var(--color-text-muted)]";

export function SettingsHostBrowserSection({
  config,
  isLoading,
  owner,
  targetReady,
  updateConfig,
  isSaving,
  targetLabel,
}: SettingsHostBrowserSectionProps) {
  const saved = draftFromConfig(config);
  const savedKey = JSON.stringify(saved);
  const ownerKey = `${owner?.profileId ?? ""}@${owner?.generation ?? 0}`;
  const ownerKeyRef = useRef(ownerKey);
  ownerKeyRef.current = ownerKey;

  const [draft, setDraft] = useState<HostBrowserDraft>(saved);
  const [notice, setNotice] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [mutating, setMutating] = useState(false);

  // Re-seed the form when the target server or its saved values change.
  useEffect(() => {
    setDraft(JSON.parse(savedKey) as HostBrowserDraft);
  }, [ownerKey, savedKey]);
  useEffect(() => {
    setNotice(null);
    setError(null);
  }, [ownerKey]);

  const live = useBrowserHostLiveStatus(owner, Boolean(config) && targetReady);

  const needsExecutable = draft.enabled && draft.executablePath.trim() === "";
  const dirty = isDraftDirty(draft, saved);
  const busy = isLoading || !config || !targetReady || mutating || isSaving;
  const canSave = !busy && dirty && !needsExecutable;

  async function handleSave() {
    if (!config || !canSave) return;
    const actionOwnerKey = ownerKey;
    setMutating(true);
    setNotice(null);
    setError(null);
    try {
      await updateConfig(applyDraftToConfig(config, draft));
      if (ownerKeyRef.current === actionOwnerKey) {
        setNotice("Saved. Restart the server to apply.");
        void live.refetch();
      }
    } catch (err) {
      if (ownerKeyRef.current === actionOwnerKey) {
        setError(err instanceof Error ? err.message : String(err));
      }
    } finally {
      setMutating(false);
    }
  }

  const patch = (next: Partial<HostBrowserDraft>) =>
    setDraft((prev) => ({ ...prev, ...next }));

  return (
    <div data-testid="settings-host-browser-section" className="space-y-3 p-1">
      <div className="space-y-0.5">
        <div className="text-sm font-semibold text-[var(--color-text)]">
          Host Browser
        </div>
        <p className={HINT_CLASS}>
          Runs a Chromium on the server for the Browser app. Changes are saved
          to config.toml and take effect after a server restart, including a
          new executable or profile directory on an already-running host. The
          status below only detects a saved enable the running host lacks.
        </p>
        <div className="pt-1 text-xs font-mono text-[var(--color-text-muted)]">
          Target Server: {targetLabel ?? "(Current / Default Server)"}
        </div>
      </div>

      <div className="flex items-center justify-between gap-4">
        <span className={LABEL_CLASS}>Enable Host Browser</span>
        <Switch
          checked={draft.enabled}
          onCheckedChange={(enabled) => patch({ enabled })}
          ariaLabel="Enable Host Browser"
          disabled={busy}
        />
      </div>

      <div className="space-y-1">
        <label htmlFor="host-browser-executable" className={LABEL_CLASS}>
          Browser executable path
        </label>
        <Input
          id="host-browser-executable"
          value={draft.executablePath}
          onChange={(e) => patch({ executablePath: e.target.value })}
          placeholder="/usr/bin/chromium or /usr/bin/google-chrome"
          disabled={busy}
          spellCheck={false}
          aria-invalid={needsExecutable}
        />
        <p className={HINT_CLASS}>
          Absolute path to Chromium/Chrome. It is not auto-detected from PATH.
          {needsExecutable && " Required to enable."}
        </p>
      </div>

      <div className="space-y-1">
        <label htmlFor="host-browser-profile-root" className={LABEL_CLASS}>
          Profile directory (optional)
        </label>
        <Input
          id="host-browser-profile-root"
          value={draft.profileRoot}
          onChange={(e) => patch({ profileRoot: e.target.value })}
          placeholder="~/.config/dam-hopper/browser-profiles"
          disabled={busy}
          spellCheck={false}
        />
        <p className={HINT_CLASS}>
          Where browser profiles are stored. Leave empty for the default. If it
          exists it must be a private (mode 0700) directory.
        </p>
      </div>

      <div className="space-y-1">
        <label htmlFor="host-browser-origins" className={LABEL_CLASS}>
          Allowed local/private origins (optional)
        </label>
        <Textarea
          id="host-browser-origins"
          value={draft.originsText}
          onChange={(e) => patch({ originsText: e.target.value })}
          placeholder="http://127.0.0.1:5173"
          rows={3}
          disabled={busy}
          spellCheck={false}
        />
        <p className={HINT_CLASS}>
          One origin per line. Public http(s) sites are allowed by default;
          list local or private addresses here, e.g. http://127.0.0.1:5173.
        </p>
      </div>

      <div className="flex items-center gap-3">
        <Button
          variant="primary"
          size="sm"
          onClick={() => void handleSave()}
          disabled={!canSave}
          loading={mutating || isSaving}
          data-testid="host-browser-save"
        >
          Save
        </Button>
        <span
          data-testid="host-browser-live-status"
          role="status"
          className={HINT_CLASS}
        >
          Status:{" "}
          {live.isError
            ? `unavailable (${live.error instanceof Error ? live.error.message : "request failed"})`
            : !targetReady
              ? "unavailable (target server not connected)"
              : live.data
                ? describeLiveStatus(saved.enabled, live.data)
                : live.isFetching
                  ? "checking…"
                  : "unknown"}
        </span>
      </div>

      {notice && (
        <div data-testid="host-browser-restart-notice" role="status" className={NOTICE_CLASS}>
          {notice}
        </div>
      )}
      {error && (
        <div data-testid="host-browser-error" role="alert" className={ERROR_CLASS}>
          {error}
        </div>
      )}
    </div>
  );
}
