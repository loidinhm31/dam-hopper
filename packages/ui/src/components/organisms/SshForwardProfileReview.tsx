import { Button } from "@/components/atoms/Button.js";
import type { SshForwardProfileErrors } from "@/lib/ssh-forward-form.js";

export function SshForwardProfileReview({
  reviewed,
  errors,
  pending,
  onReviewed,
  onClose,
}: {
  reviewed: boolean;
  errors: SshForwardProfileErrors;
  pending: boolean;
  onReviewed: (value: boolean) => void;
  onClose: () => void;
}) {
  return (
    <>
      <label className="flex items-start gap-2 rounded border border-[var(--color-border)] bg-[var(--color-surface-2)]/50 p-3 text-xs text-[var(--color-text-muted)]">
        <input
          type="checkbox"
          checked={reviewed}
          onChange={(event) => onReviewed(event.target.checked)}
          className="mt-0.5"
        />{" "}
        <span>
          I reviewed the SSH endpoint. I verified the host, port, user, and
          loopback target policy before saving.
        </span>
      </label>
      {errors.reviewed ? (
        <p className="text-xs text-[var(--color-danger)]">{errors.reviewed}</p>
      ) : null}
      {errors.form ? (
        <p role="alert" className="text-xs text-[var(--color-danger)]">
          {errors.form}
        </p>
      ) : null}
      <div className="flex flex-wrap justify-end gap-2">
        <Button
          type="button"
          variant="ghost"
          size="sm"
          onClick={onClose}
          disabled={pending}
        >
          Cancel
        </Button>
        <Button type="submit" variant="primary" size="sm" loading={pending}>
          Save forward
        </Button>
      </div>
    </>
  );
}
