import type { BrowserSelectionV1 } from "@dam-hopper/browser-bridge";

export function BrowserDebugSelectionPreview({
  selection,
}: {
  selection: BrowserSelectionV1;
}) {
  const attributes = Object.entries(selection.attributes)
    .map(([name, value]) => `${name}=${JSON.stringify(value)}`)
    .join(" ");

  return (
    <section
      aria-label="Selected element preview"
      className="shrink-0 border-t border-[var(--color-border)] bg-[var(--color-surface-2)]/50 px-3 py-2"
    >
      <div className="mb-1 flex items-center justify-between gap-2 text-[11px]">
        <span className="font-semibold text-[var(--color-text)]">
          Selected {selection.tag}
          {selection.role ? ` · ${selection.role}` : ""}
        </span>
        <span className="font-mono text-[var(--color-text-muted)]">
          {Math.round(selection.bounds.width)}×
          {Math.round(selection.bounds.height)}
        </span>
      </div>
      <dl className="grid gap-1 text-[11px] leading-4">
        {selection.accessibleName && (
          <div className="grid grid-cols-[5rem_1fr] gap-2">
            <dt className="text-[var(--color-text-muted)]">Accessible name</dt>
            <dd className="truncate text-[var(--color-text)]">
              {selection.accessibleName}
            </dd>
          </div>
        )}
        <div className="grid grid-cols-[5rem_1fr] gap-2">
          <dt className="text-[var(--color-text-muted)]">Locator</dt>
          <dd className="truncate font-mono text-[var(--color-text)]">
            {selection.locator}
          </dd>
        </div>
        {selection.text && (
          <div className="grid grid-cols-[5rem_1fr] gap-2">
            <dt className="text-[var(--color-text-muted)]">Text</dt>
            <dd className="line-clamp-2 whitespace-pre-wrap text-[var(--color-text)]">
              {selection.text}
            </dd>
          </div>
        )}
        {attributes.length > 0 && (
          <div className="grid grid-cols-[5rem_1fr] gap-2">
            <dt className="text-[var(--color-text-muted)]">Attributes</dt>
            <dd className="truncate font-mono text-[var(--color-text)]">
              {attributes}
            </dd>
          </div>
        )}
      </dl>
    </section>
  );
}
