import { formatUsageNumber } from "./UsageFormatters.js";

export interface UsageBreakdownProps {
  title: string;
  entries: ReadonlyArray<{
    name: string;
    terminal: { commandCount: number; failedCount: number };
  }>;
}

export function UsageBreakdown({ title, entries }: UsageBreakdownProps) {
  return (
    <section className="rounded border border-[var(--color-border)] bg-[var(--color-surface)] p-3">
      <h2 className="text-xs font-semibold text-[var(--color-text)]">
        {title}
      </h2>
      {entries.length === 0 ? (
        <p className="mt-3 text-xs text-[var(--color-text-muted)]">
          No aggregate data in this range.
        </p>
      ) : (
        <div className="mt-3 overflow-x-auto">
          <table className="w-full text-left text-xs">
            <thead className="text-[10px] uppercase tracking-wider text-[var(--color-text-muted)]">
              <tr>
                <th scope="col" className="pb-2 font-medium">
                  Name
                </th>
                <th scope="col" className="pb-2 text-right font-medium">
                  Commands
                </th>
                <th scope="col" className="pb-2 text-right font-medium">
                  Failed
                </th>
              </tr>
            </thead>
            <tbody>
              {entries.map((entry) => (
                <tr
                  key={entry.name}
                  className="border-t border-[var(--color-border)]"
                >
                  <th
                    scope="row"
                    className="py-2 font-medium text-[var(--color-text)]"
                  >
                    {entry.name}
                  </th>
                  <td className="py-2 text-right tabular-nums">
                    {formatUsageNumber(entry.terminal.commandCount)}
                  </td>
                  <td className="py-2 text-right tabular-nums">
                    {formatUsageNumber(entry.terminal.failedCount)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}
