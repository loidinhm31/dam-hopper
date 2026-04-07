import { Button } from "@/components/atoms/Button.js";
import { Badge } from "@/components/atoms/Badge.js";
import { useAgentStoreContent, useRemoveFromStore } from "@/api/queries.js";
import type { AgentStoreItem } from "@/api/client.js";

interface Props {
  item: AgentStoreItem;
  onShip: () => void;
}

export function ItemDetail({ item, onShip }: Props) {
  const { data: content, isLoading } = useAgentStoreContent(item.name, item.category);
  const remove = useRemoveFromStore();

  function handleRemove() {
    if (!confirm(`Remove "${item.name}" from store? This cannot be undone.`)) return;
    remove.mutate({ name: item.name, category: item.category });
  }

  return (
    <div className="flex flex-col h-full">
      {/* Header */}
      <div className="px-4 py-3 border-b border-[var(--color-border)]">
        <div className="flex items-start justify-between gap-2 mb-2">
          <h2 className="text-sm font-semibold text-[var(--color-text)] truncate">{item.name}</h2>
          <Badge variant="neutral" className="shrink-0">{item.category}</Badge>
        </div>
        {item.description && (
          <p className="text-xs text-[var(--color-text-muted)] mb-2">{item.description}</p>
        )}
        <div className="flex flex-wrap gap-1">
          {item.compatibleAgents.map((a) => (
            <Badge key={a} variant="primary">{a}</Badge>
          ))}
          {item.sizeBytes != null && (
            <Badge variant="neutral">{(item.sizeBytes / 1024).toFixed(1)}KB</Badge>
          )}
        </div>
      </div>

      {/* Content preview */}
      <div className="flex-1 overflow-hidden flex flex-col min-h-0">
        <p className="px-4 py-2 text-[10px] font-semibold text-[var(--color-text-muted)] uppercase tracking-widest border-b border-[var(--color-border)]">
          Preview
        </p>
        <div className="flex-1 overflow-y-auto">
          {isLoading ? (
            <div className="flex items-center justify-center h-full">
              <span className="inline-block h-4 w-4 animate-spin rounded-full border-2 border-[var(--color-primary)] border-t-transparent" />
            </div>
          ) : content ? (
            <pre className="px-4 py-3 text-xs text-[var(--color-text-muted)] font-mono whitespace-pre-wrap leading-relaxed">
              {content}
            </pre>
          ) : (
            <p className="px-4 py-6 text-xs text-[var(--color-text-muted)] text-center">No preview available</p>
          )}
        </div>
      </div>

      {/* Actions */}
      <div className="px-4 py-3 border-t border-[var(--color-border)] flex gap-2">
        <Button variant="primary" size="sm" className="flex-1" onClick={onShip}>
          Ship to Project…
        </Button>
        <Button
          variant="danger"
          size="sm"
          loading={remove.isPending}
          onClick={handleRemove}
        >
          Remove
        </Button>
      </div>
    </div>
  );
}
