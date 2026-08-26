import { useRef } from "react";
import { AlertTriangle, ShieldAlert, X } from "lucide-react";
import { Button } from "@/components/atoms/Button.js";
import { SshHostKeyChangedPanel } from "@/components/organisms/SshHostKeyChangedPanel.js";
import { SshHostKeyUnknownPanel } from "@/components/organisms/SshHostKeyUnknownPanel.js";
import { useDialogFocusTrap } from "@/hooks/use-dialog-focus-trap.js";
import { getSshForwardErrorPresentation } from "@/lib/ssh-forward-error-copy.js";
import type {
  HostKeyChallenge,
  SshConnectionProfile,
  SshForwardError,
  SshForwardProfile,
  SshForwardTrustRepairMetadata,
} from "@/lib/ssh-forward-host.js";

interface Props {
  open: boolean;
  /** v2 connection identity. `profile` remains for old embedded callers. */
  connection?: SshConnectionProfile;
  profile?: SshForwardProfile;
  challenge?: HostKeyChallenge;
  errorCode?: SshForwardError["code"];
  metadata?: SshForwardTrustRepairMetadata;
  pending: boolean;
  approved?: boolean;
  onApprove: () => void;
  onClose: () => void;
}

export function SshHostKeyApprovalDialog({
  open,
  connection,
  profile,
  challenge,
  errorCode,
  metadata,
  pending,
  approved = false,
  onApprove,
  onClose,
}: Props) {
  const endpoint = connection ?? profile;
  const firstAction = useRef<HTMLButtonElement>(null);
  const closeButton = useRef<HTMLButtonElement>(null);
  const changed =
    errorCode === "HOST_KEY_CHANGED" ||
    errorCode === "HOST_KEY_ALGORITHM_CHANGED";
  const dialogRef = useDialogFocusTrap(
    open,
    pending,
    onClose,
    challenge && !changed ? firstAction : closeButton,
  );
  if (!open || !endpoint) return null;
  const fixedError = errorCode
    ? getSshForwardErrorPresentation({
        code: errorCode,
        message: "",
        retryable: false,
      }).message
    : undefined;
  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-3"
      onMouseDown={(event) =>
        event.target === event.currentTarget && !pending && onClose()
      }
    >
      <div
        ref={dialogRef}
        className="dialog-viewport-fit relative max-h-[calc(var(--app-viewport-height)_-_1.5rem)] w-full max-w-xl overflow-y-auto rounded-lg border border-[var(--color-border)] bg-[var(--color-surface)] p-5 shadow-xl"
        role="dialog"
        aria-modal="true"
        aria-labelledby="ssh-trust-title"
        aria-describedby="ssh-trust-description"
      >
        <div className="mb-4 flex items-start gap-2">
          {changed ? (
            <AlertTriangle className="mt-0.5 h-4 w-4 text-[var(--color-danger)]" />
          ) : (
            <ShieldAlert className="mt-0.5 h-4 w-4 text-[var(--color-warning)]" />
          )}
          <div className="min-w-0 flex-1">
            <h2
              id="ssh-trust-title"
              className="text-sm font-semibold text-[var(--color-text)]"
            >
              {changed
                ? "SSH host identity changed"
                : "Verify SSH host fingerprint"}
            </h2>
            <p
              id="ssh-trust-description"
              className="mt-1 text-xs text-[var(--color-text-muted)]"
            >
              {endpoint.sshHost}:{endpoint.sshPort}
            </p>
          </div>
          <button
            ref={closeButton}
            type="button"
            onClick={onClose}
            disabled={pending}
            className="rounded p-1 text-[var(--color-text-muted)] hover:bg-[var(--color-surface-2)]"
            aria-label="Close host trust dialog"
          >
            <X className="h-4 w-4" />
          </button>
        </div>
        {changed ? (
          <SshHostKeyChangedPanel
            profile={endpoint}
            metadata={metadata}
            fixedError={fixedError}
          />
        ) : challenge ? (
          <SshHostKeyUnknownPanel
            challenge={challenge}
            approved={approved}
            pending={pending}
            firstAction={firstAction}
            onApprove={onApprove}
          />
        ) : (
          <p
            role="alert"
            className="rounded border border-[var(--color-danger)]/30 bg-[var(--color-danger)]/10 p-3 text-xs text-[var(--color-danger)]"
          >
            No current host-key challenge is available. Start again to request a
            new fingerprint.
          </p>
        )}
        <div className="mt-4 flex justify-end gap-2">
          <Button
            type="button"
            variant="ghost"
            size="sm"
            onClick={onClose}
            disabled={pending}
          >
            Close
          </Button>
        </div>
      </div>
    </div>
  );
}
