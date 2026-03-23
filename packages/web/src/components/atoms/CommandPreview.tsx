interface Props {
  label: string;
  command: string;
  source: "service" | "preset";
}

export function CommandPreview({ label, command, source }: Props) {
  if (!command) return null;
  return (
    <div className="flex items-center gap-2 rounded border border-[var(--color-border)] bg-[var(--color-surface)] px-3 py-2 text-sm">
      <span className="text-[var(--color-text-muted)]">{label}:</span>
      <code className="flex-1 font-mono text-xs text-[var(--color-text)]">
        {command}
      </code>
      <span
        className={
          source === "service"
            ? "text-xs text-[var(--color-primary)]"
            : "text-xs text-[var(--color-text-muted)]"
        }
      >
        {source === "service" ? "custom" : "preset"}
      </span>
    </div>
  );
}
