import { cn } from "@/lib/utils.js";
import { useShipItem, useUnshipItem } from "@/api/queries.js";
import type {
  AgentStoreItem,
  AgentType,
  DistributionMatrix as MatrixData,
  ProjectConfig,
} from "@/api/client.js";

interface Props {
  items: AgentStoreItem[];
  projects: ProjectConfig[];
  matrix: MatrixData;
}

const AGENTS: AgentType[] = ["claude", "gemini"];

function CellStatus({
  itemKey,
  projectKey,
  matrix,
  onShip,
  onUnship,
  isPending,
}: {
  itemKey: string;
  projectKey: string;
  matrix: MatrixData;
  onShip: () => void;
  onUnship: () => void;
  isPending: boolean;
}) {
  const cell = matrix[itemKey]?.[projectKey];
  const shipped = cell?.shipped ?? false;
  const method = cell?.method;

  if (isPending) {
    return (
      <span className="inline-block h-3 w-3 animate-spin rounded-full border-2 border-[var(--color-primary)] border-t-transparent" />
    );
  }

  if (!shipped) {
    return (
      <button
        onClick={onShip}
        title="Ship"
        className="text-[var(--color-text-muted)] opacity-30 hover:opacity-70 transition-opacity text-sm leading-none"
      >
        ○
      </button>
    );
  }

  return (
    <button
      onClick={onUnship}
      title={`Unship (${method})`}
      className="text-[var(--color-primary)] hover:text-[var(--color-danger)] transition-colors text-sm leading-none"
    >
      {method === "copy" ? "📄" : "🔗"}
    </button>
  );
}

export function DistributionMatrix({ items, projects, matrix }: Props) {
  const ship = useShipItem();
  const unship = useUnshipItem();

  if (items.length === 0 || projects.length === 0) {
    return (
      <p className="text-xs text-[var(--color-text-muted)] text-center py-4">
        No data to display
      </p>
    );
  }

  return (
    <div className="overflow-auto">
      <table className="min-w-full text-xs border-collapse">
        <thead>
          <tr>
            <th className="sticky left-0 bg-[var(--color-surface)] text-left px-3 py-2 text-[var(--color-text-muted)] font-semibold whitespace-nowrap border-b border-[var(--color-border)] min-w-[160px]">
              Item
            </th>
            {projects.flatMap((p) =>
              AGENTS.map((a) => (
                <th
                  key={`${p.name}:${a}`}
                  className="px-2 py-2 text-center whitespace-nowrap border-b border-[var(--color-border)] font-medium"
                >
                  <div className="text-[var(--color-text)]">{p.name}</div>
                  <div className="text-[var(--color-text-muted)] opacity-60 text-[10px]">{a}</div>
                </th>
              )),
            )}
          </tr>
        </thead>
        <tbody>
          {items.map((item) => {
            const itemKey = `${item.category}:${item.name}`;
            return (
              <tr
                key={itemKey}
                className="border-b border-[var(--color-border)] hover:bg-[var(--color-surface-2)]/30 transition-colors"
              >
                <td className="sticky left-0 bg-[var(--color-surface)] px-3 py-2 whitespace-nowrap">
                  <span className="text-[var(--color-text)]">{item.name}</span>
                  <span className="ml-1.5 text-[var(--color-text-muted)] opacity-50 text-[10px]">
                    {item.category}
                  </span>
                </td>
                {projects.flatMap((p) =>
                  AGENTS.map((a) => {
                    const projectKey = `${p.name}:${a}`;
                    const mutKey = `${itemKey}__${projectKey}`;
                    const isPending =
                      (ship.isPending && ship.variables?.itemName === item.name && ship.variables?.projectName === p.name && ship.variables?.agent === a) ||
                      (unship.isPending && unship.variables?.itemName === item.name && unship.variables?.projectName === p.name && unship.variables?.agent === a);

                    return (
                      <td key={mutKey} className="px-2 py-2 text-center">
                        <CellStatus
                          itemKey={itemKey}
                          projectKey={projectKey}
                          matrix={matrix}
                          isPending={isPending}
                          onShip={() =>
                            ship.mutate({
                              itemName: item.name,
                              category: item.category,
                              projectName: p.name,
                              agent: a,
                            })
                          }
                          onUnship={() =>
                            unship.mutate({
                              itemName: item.name,
                              category: item.category,
                              projectName: p.name,
                              agent: a,
                            })
                          }
                        />
                      </td>
                    );
                  }),
                )}
              </tr>
            );
          })}
        </tbody>
      </table>

      <div className="flex gap-4 mt-3 text-[10px] text-[var(--color-text-muted)]">
        <span>🔗 symlinked</span>
        <span>📄 copied</span>
        <span>○ not shipped</span>
      </div>
    </div>
  );
}
