import { useEffect, useRef, useState } from "react";
import { SshForwardProfileDialogHeader } from "@/components/organisms/SshForwardProfileDialogHeader.js";
import { SshForwardProfileFields } from "@/components/organisms/SshForwardProfileFields.js";
import { SshForwardProfileReview } from "@/components/organisms/SshForwardProfileReview.js";
import { useDialogFocusTrap } from "@/hooks/use-dialog-focus-trap.js";
import {
  buildSshForwardProfile,
  draftFromSshForwardProfile,
  newSshForwardDraft,
  validateSshForwardDraft,
  type SshForwardProfileDraft,
  type SshForwardProfileErrors,
} from "@/lib/ssh-forward-form.js";
import { getSshForwardErrorPresentation } from "@/lib/ssh-forward-error-copy.js";
import type { ServerProfile } from "@/api/server-config.js";
import type {
  KeyInventory,
  SshForwardError,
  SshForwardProfile,
} from "@/lib/ssh-forward-host.js";

interface Props {
  open: boolean;
  scopeId: string;
  existing: SshForwardProfile | null;
  sourceProfile: ServerProfile | null;
  pending: boolean;
  error: SshForwardError | null;
  onClose: () => void;
  onSubmit: (profile: SshForwardProfile) => void;
  onListKeys: () => Promise<KeyInventory>;
}

export function SshForwardProfileDialog({
  open,
  scopeId,
  existing,
  sourceProfile,
  pending,
  error,
  onClose,
  onSubmit,
  onListKeys,
}: Props) {
  const [draft, setDraft] = useState<SshForwardProfileDraft>(() =>
    existing
      ? draftFromSshForwardProfile(existing)
      : newSshForwardDraft(sourceProfile),
  );
  const [errors, setErrors] = useState<SshForwardProfileErrors>({});
  const [keys, setKeys] = useState<KeyInventory["keys"] | null>(null);
  const [keyError, setKeyError] = useState<SshForwardError | null>(null);
  const keyRequestStarted = useRef(false);
  const submitInFlight = useRef(false);
  const firstInput = useRef<HTMLInputElement>(null);
  const dialogRef = useDialogFocusTrap(open, pending, onClose, firstInput);

  useEffect(() => {
    if (!pending) submitInFlight.current = false;
  }, [pending]);

  useEffect(() => {
    if (!open || draft.authMode !== "key" || keys || keyRequestStarted.current)
      return;
    keyRequestStarted.current = true;
    void onListKeys()
      .then((inventory) => setKeys(inventory.keys))
      .catch((nextError) =>
        setKeyError(
          getSshForwardErrorPresentation(nextError) as SshForwardError,
        ),
      );
  }, [draft.authMode, keys, onListKeys, open]);

  if (!open) return null;
  const update = (
    field: keyof SshForwardProfileDraft,
    value: string | boolean,
  ) => {
    setDraft((current) => ({
      ...current,
      [field]: value,
      ...(field === "sshHost" || field === "sshPort"
        ? { reviewed: false }
        : {}),
    }));
    if (field === "authMode" && value === "agent") {
      keyRequestStarted.current = false;
      setKeys(null);
      setKeyError(null);
    }
    setErrors((current) => ({
      ...current,
      [field]: undefined,
      form: undefined,
      reviewed: undefined,
    }));
  };
  const submit = (event: React.FormEvent) => {
    event.preventDefault();
    if (pending || submitInFlight.current) return;
    const nextErrors = validateSshForwardDraft(draft);
    setErrors(nextErrors);
    if (Object.keys(nextErrors).length) return;
    const profile = buildSshForwardProfile(
      draft,
      scopeId,
      existing ?? undefined,
    );
    if (profile) {
      submitInFlight.current = true;
      onSubmit(profile);
    }
  };
  const errorPresentation = error
    ? getSshForwardErrorPresentation(error)
    : null;
  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-3"
      onMouseDown={(event) =>
        event.target === event.currentTarget && !pending && onClose()
      }
    >
      <div
        ref={dialogRef}
        className="dialog-viewport-fit relative max-h-[calc(100vh-1.5rem)] w-full max-w-2xl overflow-y-auto rounded-lg border border-[var(--color-border)] bg-[var(--color-surface)] p-5 shadow-xl"
        role="dialog"
        aria-modal="true"
        aria-labelledby="ssh-forward-profile-title"
        aria-describedby="ssh-forward-profile-description"
      >
        <SshForwardProfileDialogHeader
          existing={existing}
          onClose={onClose}
          pending={pending}
        />
        {!existing && sourceProfile ? (
          <p className="mb-3 rounded border border-[var(--color-primary)]/30 bg-[var(--color-primary)]/10 px-3 py-2 text-xs text-[var(--color-text-muted)]">
            Defaulted from{" "}
            <strong className="text-[var(--color-text)]">
              {sourceProfile.name}
            </strong>
            ; review before saving.
          </p>
        ) : null}
        {errorPresentation ? (
          <p
            role="alert"
            className="mb-3 rounded border border-[var(--color-danger)]/30 bg-[var(--color-danger)]/10 px-3 py-2 text-xs text-[var(--color-danger)]"
          >
            {errorPresentation.message}
          </p>
        ) : null}
        <form onSubmit={submit} className="space-y-4" aria-live="polite">
          <SshForwardProfileFields
            draft={draft}
            errors={errors}
            keys={keys}
            keyError={keyError}
            onUpdate={update}
            firstInput={firstInput}
          />
          <SshForwardProfileReview
            reviewed={draft.reviewed}
            errors={errors}
            pending={pending}
            onReviewed={(value) => update("reviewed", value)}
            onClose={onClose}
          />
        </form>
      </div>
    </div>
  );
}
