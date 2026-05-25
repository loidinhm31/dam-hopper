interface Props {
  message?: string;
}

export function SshRetryStatusMessage({ message }: Props) {
  if (!message) return null;

  return (
    <p className="rounded border border-[var(--color-border)] bg-[var(--color-surface-2)]/60 px-2.5 py-2 text-xs text-[var(--color-text-muted)]">
      {message}
    </p>
  );
}
