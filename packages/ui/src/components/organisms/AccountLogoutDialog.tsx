import { useState, useEffect, useRef } from "react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/Dialog.js";
import { Button } from "@/components/atoms/Button.js";
import { AlertTriangle } from "lucide-react";
import { revokeCurrentMediaSession } from "@/api/media-session.js";
import { logoutAccount, type LogoutOutcome } from "@/api/auth-client.js";
import {
  preflightBrowserCapabilitiesForOrigin,
  type BrowserResetPreflightResult,
} from "@/api/browser-host-client.js";
import { generateUUID } from "@/lib/utils.js";
import type { ServerProfile } from "@/api/server-config.js";

export interface AccountLogoutTarget {
  profileId?: string;
  generation?: number;
  profileName: string;
  serverUrl: string;
  token: string | null;
  mediaClientId?: string | null;
  sourceProfile?: ServerProfile;
}

interface AccountLogoutDialogProps {
  target: AccountLogoutTarget | null;
  onCancel: () => void;
  onCompleteLogout: (
    target: AccountLogoutTarget,
    outcome: LogoutOutcome,
  ) => boolean;
  onDone: () => void;
  onReauthenticate?: (
    target: AccountLogoutTarget,
    outcome: LogoutOutcome,
  ) => void;
}

function describeLogoutOutcome(
  mode: "keep" | "clear",
  outcome: LogoutOutcome,
): { title: string; body: string; tone: "ok" | "warn" } {
  if (!outcome.reachable || !outcome.ok) {
    return {
      title: "Signed out locally — server status unknown",
      body: `Local credentials were cleared from this browser, but the server could not be reached or did not confirm logout (${outcome.reason ?? "status unknown"}). Remote session and shared Browser credentials are NOT cleared.`,
      tone: "warn",
    };
  }
  if (outcome.revocationUncertain || outcome.sessionRevoked === false) {
    return {
      title: "Signed out locally — server login revocation uncertain",
      body: `Local credentials were cleared from this browser, but server session revocation failed or could not be verified (${outcome.reason ?? "revocation status unconfirmed"}). Shared Browser data status: ${outcome.browserResetState}.`,
      tone: "warn",
    };
  }
  if (outcome.browserResetState === "unknown") {
    return {
      title: "Logged out — Browser status unknown",
      body: `Your server login was revoked, but shared Browser status could not be confirmed (${outcome.reason ?? "status unknown"}). Shared Browser credentials are NOT guaranteed cleared.`,
      tone: "warn",
    };
  }
  if (outcome.browserResetState === "cleanupPending") {
    return {
      title: "Logged out — Browser cleanup pending",
      body: `Your server login was revoked. Shared Browser reset (${outcome.operationId ?? "pending"}, profile epoch ${outcome.profileEpoch ?? "—"}) is continuing in the background${outcome.reason ? `: ${outcome.reason}` : ""}. Dirty Browser relaunch is blocked until cleanup finishes; reauthenticate to check status or retry reset.`,
      tone: "warn",
    };
  }
  if (outcome.browserResetState === "retained") {
    if (mode === "clear") {
      return {
        title: "Logged out — Browser data was NOT cleared",
        body: "Your server login was revoked, but shared Browser credentials were retained because confirmation or profile epoch was stale (reset required). Reauthenticate as an Admin to run a confirmed Browser reset.",
        tone: "warn",
      };
    }
    return {
      title: "Logged out — Browser data kept",
      body: `Your server login was revoked. Shared server Browser credentials were retained${outcome.profileEpoch ? ` (profile epoch ${outcome.profileEpoch})` : ""} and reset remains available later.`,
      tone: "ok",
    };
  }
  return {
    title:
      mode === "clear"
        ? "Logged out and cleared shared Browser data"
        : "Logged out",
    body:
      mode === "clear"
        ? `Your server login was revoked, active shared Browser sessions were closed, and shared Browser credentials were deleted${outcome.profileEpoch ? ` (profile epoch ${outcome.profileEpoch})` : ""}.`
        : "Your server login was revoked. No saved shared Browser profile remained on the server.",
    tone: "ok",
  };
}

export function AccountLogoutDialog({
  target,
  onCancel,
  onCompleteLogout,
  onDone,
  onReauthenticate,
}: AccountLogoutDialogProps) {
  const [preflight, setPreflight] =
    useState<BrowserResetPreflightResult | null>(null);
  const [preflightLoading, setPreflightLoading] = useState(false);
  const [submittingMode, setSubmittingMode] = useState<"keep" | "clear" | null>(
    null,
  );
  const [completed, setCompleted] = useState<{
    mode: "keep" | "clear";
    outcome: LogoutOutcome;
    storageError?: string;
  } | null>(null);

  const cancelButtonRef = useRef<HTMLButtonElement | null>(null);
  const doneButtonRef = useRef<HTMLButtonElement | null>(null);
  const preflightAbortRef = useRef<AbortController | null>(null);
  const sessionCounterRef = useRef(0);

  const open = target !== null;

  useEffect(() => {
    preflightAbortRef.current?.abort();
    preflightAbortRef.current = null;
    sessionCounterRef.current += 1;
    const sessionId = sessionCounterRef.current;

    if (!target) {
      setPreflight(null);
      setPreflightLoading(false);
      setSubmittingMode(null);
      setCompleted(null);
      return;
    }

    setCompleted(null);
    setSubmittingMode(null);
    setPreflight(null);
    setPreflightLoading(true);

    const controller = new AbortController();
    preflightAbortRef.current = controller;
    const timeout = setTimeout(() => controller.abort(), 4000);

    void preflightBrowserCapabilitiesForOrigin(
      target.serverUrl,
      target.token,
      controller.signal,
    )
      .then((result) => {
        if (sessionCounterRef.current !== sessionId) return;
        setPreflight(result);
      })
      .catch(() => {
        if (sessionCounterRef.current !== sessionId) return;
        setPreflight({
          kind: "unreachable",
          status: null,
          reason: "Unable to verify Browser admission",
        });
      })
      .finally(() => {
        clearTimeout(timeout);
        if (sessionCounterRef.current === sessionId) {
          setPreflightLoading(false);
        }
      });

    const focusTimer = setTimeout(() => {
      cancelButtonRef.current?.focus();
    }, 0);

    return () => {
      clearTimeout(timeout);
      clearTimeout(focusTimer);
      controller.abort();
    };
  }, [target]);

  useEffect(() => {
    if (completed) {
      doneButtonRef.current?.focus();
    }
  }, [completed]);

  const canClearSharedBrowserData =
    submittingMode === null &&
    !preflightLoading &&
    preflight?.kind === "admitted" &&
    (preflight.available ||
      preflight.managedProfilePresent ||
      /cleanup pending/i.test(preflight.unavailableReason ?? ""));

  async function executeLogout(mode: "keep" | "clear") {
    if (!target || submittingMode !== null) return;
    if (mode === "clear" && (!canClearSharedBrowserData || preflight?.kind !== "admitted")) {
      return;
    }

    const capturedTarget = { ...target };
    const sessionId = sessionCounterRef.current;
    preflightAbortRef.current?.abort();
    setSubmittingMode(mode);

    if (capturedTarget.token) {
      await revokeCurrentMediaSession(
        capturedTarget.serverUrl,
        capturedTarget.token,
        capturedTarget.mediaClientId ?? null,
      );
    }

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 10000);
    let outcome: LogoutOutcome;
    try {
      const payload =
        mode === "clear" && preflight?.kind === "admitted"
          ? {
              browserReset: true,
              confirmed: true,
              expectedProfileEpoch: preflight.profileEpoch,
              operationId: generateUUID(),
            }
          : { browserReset: false };
      outcome = await logoutAccount(
        capturedTarget.serverUrl,
        capturedTarget.token,
        payload,
        {
          signal: controller.signal,
          credentials: "include",
          includeBearerOnlyIfSecureOrLoopback: true,
        },
      );
    } finally {
      clearTimeout(timeout);
    }

    const clearedLocally = onCompleteLogout(capturedTarget, outcome);
    if (sessionCounterRef.current !== sessionId) return;
    setSubmittingMode(null);
    setCompleted({
      mode,
      outcome,
      storageError: clearedLocally
        ? undefined
        : "Unable to clear the saved login token in this browser.",
    });
  }

  const outcomeSummary = completed
    ? describeLogoutOutcome(completed.mode, completed.outcome)
    : null;

  return (
    <Dialog
      open={open}
      onOpenChange={(nextOpen) => {
        if (!nextOpen) {
          if (submittingMode !== null) return;
          if (completed) {
            onDone();
          } else {
            onCancel();
          }
        }
      }}
    >
      <DialogContent
        data-testid="account-logout-dialog"
        className="sm:max-w-lg"
        closeDisabled={submittingMode !== null}
        onOpenAutoFocus={(e) => {
          e.preventDefault();
          if (completed) {
            doneButtonRef.current?.focus();
          } else {
            cancelButtonRef.current?.focus();
          }
        }}
        onEscapeKeyDown={(e) => {
          if (submittingMode !== null) {
            e.preventDefault();
          }
        }}
        onPointerDownOutside={(e) => {
          if (submittingMode !== null) {
            e.preventDefault();
          }
        }}
      >
        {!completed ? (
          <>
            <DialogHeader>
              <DialogTitle>
                Log out from &ldquo;{target?.profileName}&rdquo;?
              </DialogTitle>
              <DialogDescription className="text-xs text-[var(--color-text-muted)] space-y-2">
                <span className="block">
                  Your shared server Browser profile keeps site logins across all
                  sibling DamHopper login sessions on{" "}
                  <span className="font-mono">{target?.serverUrl}</span>.
                </span>
                <span className="block">
                  Choose whether to keep shared Browser data on the server or
                  clear it for all sibling sessions. Neither logout action is
                  preselected.
                </span>
              </DialogDescription>
            </DialogHeader>

            <div
              data-testid="logout-preflight-status"
              className="rounded-lg border border-[var(--color-border)] bg-[var(--color-surface-2)] p-3 text-xs space-y-1.5"
            >
              {preflightLoading ? (
                <p className="text-[var(--color-text-muted)]">
                  Checking server Browser profile status…
                </p>
              ) : preflight?.kind === "admitted" ? (
                <>
                  <div className="flex items-start gap-2 text-amber-300">
                    <AlertTriangle size={14} className="shrink-0 mt-0.5" />
                    <span>
                      Clearing shared Browser data closes all active Browser
                      targets, revokes active Browser attachments, and deletes
                      saved site cookies across sibling sessions (profile epoch{" "}
                      {preflight.profileEpoch}).
                    </span>
                  </div>
                  <p className="text-[var(--color-text-muted)]">
                    {preflight.managedProfilePresent
                      ? "Saved shared Browser profile detected on server."
                      : preflight.unavailableReason
                        ? `Browser status: ${preflight.unavailableReason}`
                        : "No saved shared Browser profile directory detected on server."}
                  </p>
                </>
              ) : (
                <p className="text-[var(--color-text-muted)]">
                  Clear shared Browser data is unavailable (
                  {preflight?.reason ??
                    "requires live admitted Admin connection"}
                  ). You can still log out and keep Browser data, or
                  reauthenticate first.
                </p>
              )}
            </div>

            <DialogFooter className="flex flex-col-reverse gap-2 sm:flex-row sm:flex-wrap sm:justify-end">
              <Button
                ref={cancelButtonRef}
                type="button"
                variant="ghost"
                size="sm"
                data-testid="logout-cancel-btn"
                disabled={submittingMode !== null}
                onClick={onCancel}
              >
                Cancel
              </Button>
              <Button
                type="button"
                variant="secondary"
                size="sm"
                data-testid="logout-keep-btn"
                loading={submittingMode === "keep"}
                disabled={submittingMode !== null}
                onClick={() => void executeLogout("keep")}
              >
                Log out, keep Browser data
              </Button>
              <Button
                type="button"
                variant="danger"
                size="sm"
                data-testid="logout-clear-btn"
                loading={submittingMode === "clear"}
                disabled={!canClearSharedBrowserData}
                onClick={() => void executeLogout("clear")}
              >
                Log out and clear shared Browser data
              </Button>
            </DialogFooter>
          </>
        ) : (
          <>
            <DialogHeader>
              <DialogTitle>{outcomeSummary?.title}</DialogTitle>
              <DialogDescription
                data-testid="logout-outcome-panel"
                className="text-xs text-[var(--color-text-muted)] space-y-2"
              >
                <span className="block">{outcomeSummary?.body}</span>
                {completed.storageError && (
                  <span className="block text-red-400">
                    {completed.storageError}
                  </span>
                )}
              </DialogDescription>
            </DialogHeader>
            <DialogFooter className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
              {completed.outcome.resetRequired &&
                onReauthenticate &&
                target && (
                  <Button
                    type="button"
                    variant="secondary"
                    size="sm"
                    data-testid="logout-outcome-reauth-btn"
                    onClick={() => onReauthenticate(target, completed.outcome)}
                  >
                    Reauthenticate
                  </Button>
                )}
              <Button
                ref={doneButtonRef}
                type="button"
                variant="primary"
                size="sm"
                data-testid="logout-outcome-done-btn"
                onClick={onDone}
              >
                Done
              </Button>
            </DialogFooter>
          </>
        )}
      </DialogContent>
    </Dialog>
  );
}
