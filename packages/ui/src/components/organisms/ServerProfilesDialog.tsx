import { useState } from "react";
import { X, Plus, Server, Check, Trash2, Edit2 } from "lucide-react";
import type { ServerProfile } from "@/api/server-config.js";
import {
  getProfiles,
  getActiveProfileId,
  setActiveProfile,
  deleteProfile,
} from "@/api/server-config.js";

interface Props {
  open: boolean;
  onClose: () => void;
  onEditProfile: (profile: ServerProfile | null) => void;
  onSwitchProfile?: (profile: ServerProfile) => void;
}

export function ServerProfilesDialog({
  open,
  onClose,
  onEditProfile,
  onSwitchProfile,
}: Props) {
  const [, refreshProfiles] = useState(0);

  if (!open) return null;

  const profiles = getProfiles();
  const activeId = getActiveProfileId();

  function handleSwitch(profile: ServerProfile) {
    if (!setActiveProfile(profile.id)) {
      alert("Unable to switch server profiles in this browser");
      return;
    }
    onSwitchProfile?.(profile);
    onClose();
  }

  function handleDelete(id: string) {
    if (!confirm("Delete this server profile?")) return;
    if (!deleteProfile(id)) {
      alert("Unable to delete the profile safely in this browser");
      return;
    }
    refreshProfiles((version) => version + 1);
  }

  return (
    <div
      className="safe-area-inline safe-area-bottom fixed inset-0 z-50 flex items-center justify-center p-3"
      style={{ background: "rgba(0,0,0,0.6)", backdropFilter: "blur(4px)" }}
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div
        className="dialog-viewport-fit flex w-full max-w-md flex-col overflow-hidden rounded-2xl border border-[var(--color-border)] shadow-2xl"
        style={{ background: "var(--color-surface)" }}
      >
        {/* Header */}
        <div className="flex items-center justify-between border-b border-[var(--color-border)] px-5 py-4">
          <div className="flex items-center gap-2">
            <Server size={16} className="text-[var(--color-primary)]" />
            <span className="text-sm font-semibold text-[var(--color-text)] tracking-wide">
              Server Connections
            </span>
          </div>
          <button
            onClick={onClose}
            className="rounded p-1 text-[var(--color-text-muted)] hover:text-[var(--color-text)] hover:bg-[var(--color-surface-2)] transition-colors"
          >
            <X size={14} />
          </button>
        </div>

        {/* Profile List */}
        <div className="min-h-0 flex-1 space-y-2 overflow-y-auto p-4">
          {profiles.length === 0 ? (
            <p className="text-[var(--color-text-muted)] text-center py-4 text-sm">
              No server profiles yet
            </p>
          ) : (
            profiles.map((profile) => (
              <div
                key={profile.id}
                className={`flex items-center gap-3 p-3 rounded-lg border transition-colors ${
                  profile.id === activeId
                    ? "border-[var(--color-success)] bg-[var(--color-success)]/10"
                    : "border-[var(--color-border)] hover:border-[var(--color-primary)]"
                }`}
                style={{
                  background:
                    profile.id === activeId
                      ? undefined
                      : "var(--color-surface-2)",
                }}
              >
                <Server size={18} className="text-[var(--color-text-muted)]" />
                <div className="flex-1 min-w-0">
                  <div className="font-medium text-sm text-[var(--color-text)] truncate">
                    {profile.name}
                  </div>
                  <div className="text-xs text-[var(--color-text-muted)] truncate font-mono">
                    {profile.url}
                  </div>
                  <div className="text-xs text-[var(--color-text-muted)] mt-0.5">
                    {profile.authType === "none"
                      ? "No auth"
                      : `Basic (${profile.username || "—"})`}
                  </div>
                </div>
                <div className="flex gap-1">
                  {profile.id !== activeId && (
                    <button
                      onClick={() => handleSwitch(profile)}
                      className="p-1.5 hover:bg-[var(--color-surface)] rounded text-[var(--color-success)] transition-colors"
                      title="Switch to this server"
                    >
                      <Check size={15} />
                    </button>
                  )}
                  <button
                    onClick={() => onEditProfile(profile)}
                    className="p-1.5 hover:bg-[var(--color-surface)] rounded text-[var(--color-text-muted)] hover:text-[var(--color-text)] transition-colors"
                    title="Edit"
                  >
                    <Edit2 size={15} />
                  </button>
                  <button
                    onClick={() => handleDelete(profile.id)}
                    className="p-1.5 hover:bg-[var(--color-surface)] rounded text-[var(--color-error)] transition-colors"
                    title="Delete"
                  >
                    <Trash2 size={15} />
                  </button>
                </div>
              </div>
            ))
          )}
        </div>

        {/* Footer */}
        <div className="px-4 py-3 border-t border-[var(--color-border)]">
          <button
            onClick={() => onEditProfile(null)}
            className="w-full flex items-center justify-center gap-2 px-4 py-2 rounded-lg text-sm font-semibold text-white transition-colors"
            style={{ background: "var(--color-primary)" }}
          >
            <Plus size={16} />
            Add Server
          </button>
        </div>
      </div>
    </div>
  );
}
