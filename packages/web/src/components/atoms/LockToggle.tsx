/**
 * LockToggle — button to enable/disable encrypted write mode (Lock mode).
 *
 * Shows a shield icon. Click → toggles encrypted mode per project. When
 * enabling, if no passphrase is cached, triggers the PassphrasePrompt dialog.
 *
 * Usage in FileTree toolbar or editor toolbar.
 */
import { useCallback } from "react";
import { Shield, ShieldOff } from "lucide-react";
import { useEncryptMode } from "@/contexts/EncryptContext.js";

interface LockToggleProps {
  project: string;
  className?: string;
}

export function LockToggle({ project, className = "" }: LockToggleProps) {
  const { isEncryptEnabled, setEncryptEnabled, getPassphrase, promptPassphrase, setPassphrase } =
    useEncryptMode();

  const enabled = isEncryptEnabled(project);

  const handleToggle = useCallback(async () => {
    if (enabled) {
      setEncryptEnabled(project, false);
      return;
    }

    // Enabling: need a passphrase
    const cached = getPassphrase(project);
    if (cached) {
      setEncryptEnabled(project, true);
      return;
    }

    try {
      const passphrase = await promptPassphrase(project);
      setPassphrase(project, passphrase);
      setEncryptEnabled(project, true);
    } catch {
      // User cancelled prompt — don't enable
    }
  }, [enabled, project, setEncryptEnabled, getPassphrase, promptPassphrase, setPassphrase]);

  return (
    <button
      id={`lock-toggle-${project}`}
      type="button"
      onClick={handleToggle}
      title={enabled ? "Encrypted mode ON — click to disable" : "Enable encrypted uploads (Lock mode)"}
      aria-pressed={enabled}
      aria-label={enabled ? "Disable encrypted mode" : "Enable encrypted mode"}
      className={`lock-toggle ${enabled ? "lock-toggle--active" : ""} ${className}`}
    >
      {enabled ? (
        <Shield size={16} className="lock-toggle__icon lock-toggle__icon--active" />
      ) : (
        <ShieldOff size={16} className="lock-toggle__icon" />
      )}
      <span className="lock-toggle__label">{enabled ? "Locked" : "Lock"}</span>

      <style>{`
        .lock-toggle {
          display: inline-flex;
          align-items: center;
          gap: 5px;
          padding: 4px 10px;
          border-radius: 6px;
          border: 1px solid var(--color-border, rgba(255,255,255,0.12));
          background: transparent;
          color: var(--color-text-muted, rgba(255,255,255,0.5));
          font-size: 12px;
          font-weight: 500;
          cursor: pointer;
          transition: all 0.15s ease;
          letter-spacing: 0.02em;
        }
        .lock-toggle:hover {
          border-color: var(--color-accent, #7c6aff);
          color: var(--color-accent, #7c6aff);
          background: rgba(124, 106, 255, 0.08);
        }
        .lock-toggle--active {
          border-color: var(--color-accent, #7c6aff);
          color: var(--color-accent, #7c6aff);
          background: rgba(124, 106, 255, 0.15);
          box-shadow: 0 0 8px rgba(124, 106, 255, 0.2);
        }
        .lock-toggle--active:hover {
          background: rgba(124, 106, 255, 0.08);
        }
        .lock-toggle__icon--active {
          filter: drop-shadow(0 0 4px rgba(124, 106, 255, 0.6));
        }
        .lock-toggle__label {
          font-size: 11px;
        }
      `}</style>
    </button>
  );
}
