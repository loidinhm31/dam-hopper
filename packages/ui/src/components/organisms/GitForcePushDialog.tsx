import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/Dialog.js";
import { Button } from "@/components/atoms/Button.js";
import type { PublishPreview, PublishResult } from "@/api/client.js";
import type { LeasedPushState } from "@/hooks/use-leased-git-push.js";
import { cn } from "@/lib/utils.js";

export function buildForcePushDialogDescription(
  project: string,
  rootLabel: string,
) {
  return `Overwrite the upstream history for ${project} on ${rootLabel}.`;
}

export function buildForcePushDialogWarning() {
  return "This is destructive. Remote commits that are not in your current local branch will be replaced upstream.";
}

export interface GitForcePushDialogProps {
  open: boolean;
  project: string;
  rootLabel: string;
  state?: LeasedPushState;
  preview?: PublishPreview | null;
  result?: PublishResult | null;
  error?: string | null;
  loading?: boolean;
  onPrepare?: () => void;
  onPublish?: () => void;
  onClose: () => void;
  onConfirm?: () => void;
  scopeLabel?: string;
  onRestoreFocus?: () => void;
}

export function GitForcePushDialog({
  open,
  project,
  rootLabel,
  state: stateProp,
  preview,
  result,
  error,
  loading = false,
  onPrepare,
  onPublish,
  onClose,
  onConfirm,
  scopeLabel,
  onRestoreFocus,
}: GitForcePushDialogProps) {
  // Derive effective state for backward compatibility
  const effectiveState: LeasedPushState =
    stateProp ?? (loading ? "publishing" : "confirming");

  const snapshot =
    preview && preview.status === "ready" ? preview.snapshot : null;

  const handleConfirm = onPublish ?? onConfirm ?? (() => {});

  let title = "Force Push (Leased)";
  if (effectiveState === "preparing") title = "Preparing Leased Push";
  else if (effectiveState === "blocked") title = "Publication Blocked";
  else if (effectiveState === "confirming")
    title = "Confirm Leased Publication";
  else if (effectiveState === "publishing") title = "Publishing...";
  else if (effectiveState === "published") title = "Publication Succeeded";
  else if (effectiveState === "already-current") title = "Already Up to Date";
  else if (effectiveState === "stale") title = "Publication Outdated";
  else if (effectiveState === "rejected") title = "Publication Rejected";
  else if (effectiveState === "unknown") title = "Publication Status Uncertain";

  return (
    <Dialog
      open={open}
      onOpenChange={(nextOpen) => {
        if (!nextOpen && effectiveState !== "publishing") onClose();
      }}
    >
      <DialogContent
        className={cn(
          "sm:max-w-[520px] overflow-y-auto",
          scopeLabel &&
            "[&_button]:min-h-11 [&>button]:size-11 [&>button]:flex [&>button]:items-center [&>button]:justify-center [&>button]:right-2 [&>button]:top-2 [&>button]:focus-visible:outline-2 [&>button]:focus-visible:outline-[var(--color-primary)]",
        )}
        closeDisabled={effectiveState === "publishing"}
        onEscapeKeyDown={(event) => {
          if (effectiveState === "publishing") event.preventDefault();
        }}
        onInteractOutside={(event) => {
          if (effectiveState === "publishing") event.preventDefault();
        }}
        onCloseAutoFocus={
          onRestoreFocus
            ? (event) => {
                event.preventDefault();
                onRestoreFocus();
              }
            : undefined
        }
      >
        <DialogHeader className={scopeLabel ? "pr-10" : undefined}>
          <DialogTitle>{title}</DialogTitle>
          <DialogDescription>
            {buildForcePushDialogDescription(project, rootLabel)}
            {scopeLabel && (
              <span className="mt-2 block break-words">{scopeLabel}</span>
            )}
          </DialogDescription>
        </DialogHeader>

        {effectiveState === "preparing" && (
          <div className="flex items-center gap-3 py-4 text-xs text-[var(--color-text-muted)]">
            <div className="h-4 w-4 animate-spin motion-reduce:animate-none rounded-full border-2 border-[var(--color-primary)] border-t-transparent" />
            <span>
              Checking remote branch advertisement and preparing lease...
            </span>
          </div>
        )}

        {effectiveState === "blocked" && (
          <div className="space-y-2">
            <div className="rounded border border-[var(--color-danger)]/30 bg-[var(--color-danger)]/10 px-3 py-2 text-xs text-[var(--color-danger)]">
              {error ||
                (preview && preview.status === "blocked"
                  ? preview.message
                  : "Publication is currently blocked.")}
            </div>
            {preview && preview.status === "blocked" && (
              <div className="text-xs text-[var(--color-text-muted)]">
                Reason:{" "}
                <span className="font-mono text-[var(--color-text)]">
                  {preview.reason}
                </span>
              </div>
            )}
          </div>
        )}

        {effectiveState === "confirming" && (
          <div className="space-y-3">
            <div className="rounded border border-[var(--color-danger)]/30 bg-[var(--color-danger)]/10 px-3 py-2 text-xs text-[var(--color-danger)]">
              {buildForcePushDialogWarning()}
            </div>
            {snapshot && (
              <div className="flex flex-col gap-1.5 break-all rounded border border-[var(--color-border)] bg-[var(--color-background-subtle)] p-3 font-mono text-xs">
                <div>
                  Remote:{" "}
                  <span className="text-[var(--color-text)]">
                    {snapshot.remoteName}
                  </span>
                </div>
                <div>
                  Destination:{" "}
                  <span className="text-[var(--color-text)]">
                    {snapshot.destinationRef}
                  </span>
                </div>
                <div>
                  Expected remote commit:{" "}
                  <span
                    className="text-[var(--color-text)]"
                    title={snapshot.expectedRemoteOid}
                  >
                    {scopeLabel
                      ? snapshot.expectedRemoteOid
                      : snapshot.expectedRemoteOid.slice(0, 7)}
                  </span>
                </div>
                <div>
                  Local branch source:{" "}
                  <span
                    className="text-[var(--color-text)]"
                    title={snapshot.sourceOid}
                  >
                    {scopeLabel
                      ? snapshot.sourceOid
                      : snapshot.sourceOid.slice(0, 7)}
                  </span>
                </div>
              </div>
            )}
            <div className="text-xs text-[var(--color-text-muted)]">
              Warning: The entire local branch{" "}
              <strong>{snapshot?.branch ?? "HEAD"}</strong> will replace the
              upstream destination history.
            </div>
          </div>
        )}

        {effectiveState === "publishing" && (
          <div className="flex items-center gap-3 py-4 text-xs text-[var(--color-text-muted)]">
            <div className="h-4 w-4 animate-spin motion-reduce:animate-none rounded-full border-2 border-[var(--color-primary)] border-t-transparent" />
            <span>Publishing branch to remote with exact-OID lease...</span>
          </div>
        )}

        {effectiveState === "published" && (
          <div className="rounded border border-emerald-500/30 bg-emerald-500/10 px-3 py-2 text-xs text-emerald-300">
            {result?.message ?? "Successfully published."}
          </div>
        )}

        {effectiveState === "already-current" && (
          <div className="rounded border border-blue-500/30 bg-blue-500/10 px-3 py-2 text-xs text-blue-300">
            The remote branch is already up to date with your local branch. No
            push was necessary.
          </div>
        )}

        {effectiveState === "stale" && (
          <div className="space-y-2">
            <div className="rounded border border-amber-500/30 bg-amber-500/10 px-3 py-2 text-xs text-amber-300">
              {result?.message ??
                "Publication lease is outdated. The remote or local history has changed."}
            </div>
            <div className="text-xs text-[var(--color-text-muted)]">
              Cannot publish with an outdated lease. Click Refresh to prepare a
              new publication lease.
            </div>
          </div>
        )}

        {effectiveState === "rejected" && (
          <div className="rounded border border-[var(--color-danger)]/30 bg-[var(--color-danger)]/10 px-3 py-2 text-xs text-[var(--color-danger)]">
            {result?.message ?? "The remote repository rejected publication."}
          </div>
        )}

        {effectiveState === "unknown" && (
          <div className="space-y-2">
            <div className="rounded border border-amber-500/30 bg-amber-500/10 px-3 py-2 text-xs text-amber-300">
              {result?.message ??
                "Network transport completed with uncertain status."}
            </div>
            <div className="text-xs text-[var(--color-text-muted)]">
              Do not retry blindly. Check remote state manually or refresh to
              inspect the advertised remote.
            </div>
          </div>
        )}

        <DialogFooter>
          {effectiveState === "confirming" ? (
            <>
              <Button type="button" variant="ghost" onClick={onClose}>
                Cancel
              </Button>
              <Button
                type="button"
                variant="danger"
                loading={loading}
                onClick={handleConfirm}
              >
                Publish Branch
              </Button>
            </>
          ) : effectiveState === "stale" || effectiveState === "unknown" ? (
            <>
              <Button type="button" variant="ghost" onClick={onClose}>
                Close
              </Button>
              {onPrepare && (
                <Button type="button" variant="secondary" onClick={onPrepare}>
                  Refresh Lease
                </Button>
              )}
            </>
          ) : (
            <Button
              type="button"
              variant="ghost"
              disabled={effectiveState === "publishing"}
              onClick={onClose}
            >
              {effectiveState === "published" ||
              effectiveState === "already-current"
                ? "Close"
                : "Cancel"}
            </Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
