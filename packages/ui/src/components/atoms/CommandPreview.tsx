interface Props {
  label: string;
  command: string;
}

export function CommandPreview({ label, command }: Props) {
  if (!command) return null;
  return (
    <div className="flex items-center gap-2 rounded border border-[var(--color-border)] bg-[var(--color-surface)] px-3 py-2 text-sm">
      <span className="text-[var(--color-text-muted)]">{label}:</span>
      <code className="flex-1 font-mono text-xs text-[var(--color-text)]">
        {command}
      </code>
    </div>
  );
}
