import { useState } from "react";
import { cn } from "@/lib/utils.js";
import { Badge } from "@/components/atoms/Badge.js";
import type { AgentItemCategory, AgentStoreItem } from "@/api/client.js";

const CATEGORY_META: Record<AgentItemCategory, { label: string; color: string }> = {
  skill:            { label: "Skills",           color: "text-blue-400" },
  command:          { label: "Commands",          color: "text-green-400" },
  hook:             { label: "Hooks",             color: "text-orange-400" },
  "mcp-server":     { label: "MCP Servers",       color: "text-purple-400" },
  subagent:         { label: "Subagents",         color: "text-yellow-400" },
  "memory-template":{ label: "Memory Templates",  color: "text-teal-400" },
};

const ALL_CATEGORIES = Object.keys(CATEGORY_META) as AgentItemCategory[];

interface Props {
  items: AgentStoreItem[];
  selectedItem: AgentStoreItem | null;
  shipCounts: Record<string, number>;
  onSelect: (item: AgentStoreItem) => void;
}

export function StoreInventory({ items, selectedItem, shipCounts, onSelect }: Props) {
  const [filter, setFilter] = useState<AgentItemCategory | "all">("all");

  const visibleCategories = filter === "all" ? ALL_CATEGORIES : [filter as AgentItemCategory];

  const grouped = ALL_CATEGORIES.reduce<Record<AgentItemCategory, AgentStoreItem[]>>(
    (acc, cat) => {
      acc[cat] = items.filter((i) => i.category === cat);
      return acc;
    },
    {} as Record<AgentItemCategory, AgentStoreItem[]>,
  );

  return (
    <div className="flex flex-col h-full">
      {/* Filter */}
      <div className="px-3 py-2 border-b border-[var(--color-border)]">
        <select
          value={filter}
          onChange={(e) => setFilter(e.target.value as AgentItemCategory | "all")}
          className="w-full text-xs bg-[var(--color-surface-2)] border border-[var(--color-border)] rounded px-2 py-1 text-[var(--color-text)] outline-none"
        >
          <option value="all">All categories</option>
          {ALL_CATEGORIES.map((c) => (
            <option key={c} value={c}>{CATEGORY_META[c].label}</option>
          ))}
        </select>
      </div>

      {/* Tree */}
      <div className="flex-1 overflow-y-auto py-1">
        {items.length === 0 ? (
          <p className="px-4 py-6 text-xs text-[var(--color-text-muted)] text-center">
            No items in store
          </p>
        ) : (
          visibleCategories.map((cat) => {
            const catItems = grouped[cat];
            if (catItems.length === 0) return null;
            const meta = CATEGORY_META[cat];
            return (
              <div key={cat} className="mb-1">
                <div className="flex items-center gap-1.5 px-3 py-1">
                  <span className={cn("text-[10px] font-bold tracking-widest uppercase", meta.color)}>
                    {meta.label}
                  </span>
                  <span className="text-[10px] text-[var(--color-text-muted)]">({catItems.length})</span>
                </div>
                {catItems.map((item) => {
                  const key = `${item.category}:${item.name}`;
                  const count = shipCounts[key] ?? 0;
                  const isSelected = selectedItem?.name === item.name && selectedItem?.category === item.category;
                  return (
                    <button
                      key={item.name}
                      onClick={() => onSelect(item)}
                      className={cn(
                        "w-full flex items-center justify-between px-4 py-1.5 text-xs transition-colors text-left",
                        isSelected
                          ? "bg-[var(--color-primary)]/15 text-[var(--color-primary)] border-l-2 border-[var(--color-primary)]"
                          : "text-[var(--color-text)] hover:bg-[var(--color-surface-2)] border-l-2 border-transparent",
                      )}
                    >
                      <span className="truncate">{item.name}</span>
                      {count > 0 ? (
                        <span className="shrink-0 flex items-center gap-0.5 text-[var(--color-primary)] opacity-70">
                          <span>🔗</span>
                          <span className="text-[10px]">{count}</span>
                        </span>
                      ) : (
                        <span className="shrink-0 text-[var(--color-text-muted)] opacity-40 text-[10px]">○</span>
                      )}
                    </button>
                  );
                })}
              </div>
            );
          })
        )}
      </div>
    </div>
  );
}
