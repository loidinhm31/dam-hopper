import { ConfirmDialog, AlertDialog } from "@/components/ui/ConfirmDialog.js";
import { useState, useSyncExternalStore } from "react";
import {
  X,
  Plus,
  Server,
  Trash2,
  Edit2,
  Play,
  Square,
  LogIn,
  LogOut,
} from "lucide-react";
import { revokeCurrentMediaSession } from "@/api/media-session.js";
import type { ServerProfile } from "@/api/server-config.js";
import {
  getProfiles,
  getAuthToken,
  clearAuthToken,
  deleteProfile,
  updateProfile,
  subscribeToProfileChanges,
  getProfileChangeVersion,
} from "@/api/server-config.js";
import {
  connectProfile,
  disconnectProfile,
  removeProfileConnection,
  subscribeConnections,
  getConnectionSnapshot,
  getMediaClientIdForProfile,
  type ConnectionSnapshot,
} from "@/api/connections.js";

interface Props {
  open: boolean;
  onClose: () => void;
  onEditProfile: (profile: ServerProfile | null) => void;
  onLoginProfile?: (profile: ServerProfile) => void;
}

function StatusBadge({ snapshot }: { snapshot: ConnectionSnapshot | null }) {
  const status = snapshot?.status ?? "disconnected";

  if (status === "connected") {
    return (
      <span className="inline-flex items-center gap-1.5 px-2 py-0.5 rounded text-[11px] font-medium bg-[var(--color-success)]/15 text-[var(--color-success)]">
        <span className="h-1.5 w-1.5 rounded-full bg-[var(--color-success)]" />
        Connected
      </span>
    );
  }

  if (status === "connecting") {
    return (
      <span className="inline-flex items-center gap-1.5 px-2 py-0.5 rounded text-[11px] font-medium bg-amber-500/15 text-amber-400">
        <span className="h-1.5 w-1.5 rounded-full bg-amber-400 animate-pulse" />
        Connecting
      </span>
    );
  }

  if (status === "login-required") {
    return (
      <span className="inline-flex items-center gap-1.5 px-2 py-0.5 rounded text-[11px] font-medium bg-red-500/15 text-red-400">
        <span className="h-1.5 w-1.5 rounded-full bg-red-400" />
        Login required
      </span>
    );
  }

  if (status === "offline") {
    return (
      <span className="inline-flex items-center gap-1.5 px-2 py-0.5 rounded text-[11px] font-medium bg-amber-500/15 text-amber-400">
        <span className="h-1.5 w-1.5 rounded-full bg-amber-400" />
        Offline
      </span>
    );
  }
  if (status === "unsupported") {
    return (
      <span
        title={
          snapshot?.error ||
          "Remote connections are supported only on Browser and Windows desktop."
        }
        className="inline-flex items-center gap-1.5 px-2 py-0.5 rounded text-[11px] font-medium bg-red-500/15 text-red-400 cursor-help"
      >
        <span className="h-1.5 w-1.5 rounded-full bg-red-400" />
        Unsupported
      </span>
    );
  }

  return (
    <span className="inline-flex items-center gap-1.5 px-2 py-0.5 rounded text-[11px] font-medium bg-[var(--color-surface-2)] text-[var(--color-text-muted)]">
      <span className="h-1.5 w-1.5 rounded-full bg-[var(--color-border)]" />
      Disconnected
    </span>
  );
}

export function ServerProfilesDialog({
  open,
  onClose,
  onEditProfile,
  onLoginProfile,
}: Props) {
  const [, setRevision] = useState(0);
  const [profileToDelete, setProfileToDelete] = useState<ServerProfile | null>(
    null,
  );
  const [deleteAlertMessage, setDeleteAlertMessage] = useState<string | null>(
    null,
  );
  const [isDeleting, setIsDeleting] = useState(false);

  // Subscribe to profile list changes and cross-tab updates
  useSyncExternalStore(
    subscribeToProfileChanges,
    () => getProfileChangeVersion(),
    () => 0,
  );

  // Subscribe to connection changes across all profiles
  useSyncExternalStore(
    subscribeConnections,
    () =>
      getProfiles()
        .map((p) => getConnectionSnapshot(p.id)?.status)
        .join(","),
    () => "",
  );

  if (!open) return null;

  const profiles = getProfiles();

  const handleRefresh = () => setRevision((v) => v + 1);

  async function handleLogout(profile: ServerProfile) {
    const token = getAuthToken(profile.id);
    if (token) {
      const mediaClientId = getMediaClientIdForProfile(profile.id);
      await revokeCurrentMediaSession(profile.url, token, mediaClientId);
    }
    clearAuthToken(profile.id);
    disconnectProfile(profile.id);
    handleRefresh();
  }

  async function handleConfirmDelete() {
    if (!profileToDelete) return;
    const profile = profileToDelete;
    setIsDeleting(true);
    try {
      const token = getAuthToken(profile.id);
      if (token) {
        const mediaClientId = getMediaClientIdForProfile(profile.id);
        await revokeCurrentMediaSession(profile.url, token, mediaClientId);
      }
      removeProfileConnection(profile.id);
      if (!deleteProfile(profile.id)) {
        setDeleteAlertMessage(
          "Unable to delete the profile safely in this browser",
        );
        return;
      }
      setProfileToDelete(null);
      handleRefresh();
    } finally {
      setIsDeleting(false);
    }
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
        className="dialog-viewport-fit flex w-full max-w-lg flex-col overflow-hidden rounded-2xl border border-[var(--color-border)] shadow-2xl"
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
        <div className="min-h-0 flex-1 space-y-3 overflow-y-auto p-4">
          {profiles.length === 0 ? (
            <p className="text-[var(--color-text-muted)] text-center py-6 text-sm">
              No server connections yet. Add a connection to get started.
            </p>
          ) : (
            profiles.map((profile) => {
              const snapshot = getConnectionSnapshot(profile.id);
              const status = snapshot?.status ?? "disconnected";
              const token = getAuthToken(profile.id);
              const isLive = status === "connected" || status === "connecting";

              return (
                <div
                  key={profile.id}
                  className="flex flex-col gap-2 p-3.5 rounded-lg border border-[var(--color-border)] bg-[var(--color-surface-2)] transition-colors"
                >
                  <div className="flex items-start justify-between gap-3">
                    <div className="flex items-start gap-2.5 min-w-0 flex-1">
                      <Server
                        size={18}
                        className="text-[var(--color-text-muted)] shrink-0 mt-0.5"
                      />
                      <div className="min-w-0 flex-1">
                        <div className="flex items-center gap-2 flex-wrap">
                          <span className="font-medium text-sm text-[var(--color-text)] truncate">
                            {profile.name}
                          </span>
                          <StatusBadge snapshot={snapshot} />
                        </div>
                        <div className="text-xs text-[var(--color-text-muted)] truncate font-mono mt-0.5">
                          {profile.url.replace(/\/$/, "")}
                        </div>
                        <div className="text-xs text-[var(--color-text-muted)] mt-0.5">
                          {profile.authType === "none"
                            ? "No auth"
                            : `Basic (${profile.username || "—"})`}
                        </div>
                      </div>
                    </div>

                    <div className="flex items-center gap-1 shrink-0">
                      <button
                        onClick={() => onEditProfile(profile)}
                        className="p-1.5 hover:bg-[var(--color-surface)] rounded text-[var(--color-text-muted)] hover:text-[var(--color-text)] transition-colors"
                        title="Edit profile"
                      >
                        <Edit2 size={15} />
                      </button>
                      <button
                        onClick={() => setProfileToDelete(profile)}
                        className="p-1.5 hover:bg-[var(--color-surface)] rounded text-[var(--color-error)] transition-colors"
                        title="Remove profile"
                      >
                        <Trash2 size={15} />
                      </button>
                    </div>
                  </div>

                  {/* Actions & AutoConnect row */}
                  <div className="flex items-center justify-between pt-2 border-t border-[var(--color-border)]/60 text-xs">
                    <label className="flex items-center gap-1.5 text-[var(--color-text-muted)] cursor-pointer select-none">
                      <input
                        type="checkbox"
                        checked={profile.autoConnect}
                        onChange={(e) => {
                          updateProfile(profile.id, {
                            autoConnect: e.target.checked,
                          });
                          handleRefresh();
                        }}
                        className="rounded border-[var(--color-border)] text-[var(--color-primary)] focus:ring-0"
                      />
                      Auto-connect
                    </label>

                    <div className="flex items-center gap-2">
                      {isLive ? (
                        <button
                          onClick={() => {
                            disconnectProfile(profile.id);
                            handleRefresh();
                          }}
                          className="flex items-center gap-1 px-2.5 py-1 rounded bg-[var(--color-surface)] hover:bg-[var(--color-surface-3)] text-amber-400 font-medium transition-colors"
                          title="Disconnect without clearing credentials"
                        >
                          <Square size={12} />
                          Disconnect
                        </button>
                      ) : (
                        <button
                          onClick={() => {
                            void connectProfile(profile.id);
                            handleRefresh();
                          }}
                          className="flex items-center gap-1 px-2.5 py-1 rounded bg-[var(--color-surface)] hover:bg-[var(--color-surface-3)] text-[var(--color-success)] font-medium transition-colors"
                          title="Connect to this server"
                        >
                          <Play size={12} />
                          Connect
                        </button>
                      )}

                      {token ? (
                        <button
                          onClick={() => void handleLogout(profile)}
                          className="flex items-center gap-1 px-2.5 py-1 rounded bg-[var(--color-surface)] hover:bg-[var(--color-surface-3)] text-[var(--color-text-muted)] hover:text-red-400 font-medium transition-colors"
                          title="Logout and clear credentials"
                        >
                          <LogOut size={12} />
                          Logout
                        </button>
                      ) : profile.authType === "basic" ? (
                        <button
                          onClick={() => {
                            if (onLoginProfile) {
                              onLoginProfile(profile);
                            } else {
                              onEditProfile(profile);
                            }
                          }}
                          className="flex items-center gap-1 px-2.5 py-1 rounded bg-[var(--color-surface)] hover:bg-[var(--color-surface-3)] text-[var(--color-primary)] font-medium transition-colors"
                          title="Log in to this server"
                        >
                          <LogIn size={12} />
                          Login
                        </button>
                      ) : null}
                    </div>
                  </div>
                </div>
              );
            })
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
            Add Server Connection
          </button>
        </div>
      </div>
      <ConfirmDialog
        open={profileToDelete !== null}
        onClose={() => {
          if (!isDeleting) setProfileToDelete(null);
        }}
        onConfirm={handleConfirmDelete}
        title={`Remove server profile "${profileToDelete?.name}"?`}
        description="Local cached resources will be detached. Remote server data is not deleted."
        confirmText="Remove profile"
        variant="danger"
        loading={isDeleting}
      />
      <AlertDialog
        open={deleteAlertMessage !== null}
        onClose={() => setDeleteAlertMessage(null)}
        title="Unable to delete profile"
        description={deleteAlertMessage}
      />
    </div>
  );
}
