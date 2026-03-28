import { useState } from "react";
import { Button, inputClass } from "@/components/atoms/Button.js";
import { useScanRepo, useImportConfirm } from "@/api/queries.js";
import type { RepoScanItem, AgentItemCategory } from "@/api/client.js";

interface Props {
  onClose: () => void;
}

export function ImportFromRepoDialog({ onClose }: Props) {
  const [repoUrl, setRepoUrl] = useState("");
  const [tmpDir, setTmpDir] = useState<string | null>(null);
  const [foundItems, setFoundItems] = useState<RepoScanItem[]>([]);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [results, setResults] = useState<Array<{ name: string; success: boolean; error?: string }> | null>(null);

  const scanRepo = useScanRepo();
  const importConfirm = useImportConfirm();

  function itemKey(item: RepoScanItem) {
    return `${item.category}:${item.name}`;
  }

  async function handleScan() {
    if (!repoUrl.trim()) return;
    setFoundItems([]);
    setSelected(new Set());
    setResults(null);
    setTmpDir(null);
    const result = await scanRepo.mutateAsync(repoUrl.trim());
    setFoundItems(result.items);
    setTmpDir(result.tmpDir);
    setSelected(new Set(result.items.map(itemKey)));
  }

  function toggleItem(item: RepoScanItem) {
    const key = itemKey(item);
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  }

  function toggleAll() {
    if (selected.size === foundItems.length) {
      setSelected(new Set());
    } else {
      setSelected(new Set(foundItems.map(itemKey)));
    }
  }

  async function handleImport() {
    if (!tmpDir) return;
    const selectedItems = foundItems.filter((i) => selected.has(itemKey(i)));
    const res = await importConfirm.mutateAsync({ tmpDir, selectedItems });
    setResults(res);
  }

  const isScanning = scanRepo.isPending;
  const isImporting = importConfirm.isPending;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50">
      <div className="w-[520px] max-h-[80vh] rounded-lg border border-[var(--color-border)] bg-[var(--color-surface)] flex flex-col shadow-xl">
        {/* Header */}
        <div className="flex items-center justify-between px-4 py-3 border-b border-[var(--color-border)] shrink-0">
          <p className="text-sm font-semibold text-[var(--color-text)]">Import from Git Repository</p>
          <button
            onClick={onClose}
            className="text-[var(--color-text-muted)] hover:text-[var(--color-text)] cursor-pointer"
          >
            ✕
          </button>
        </div>

        {/* Body */}
        <div className="flex flex-col gap-3 p-4 overflow-y-auto flex-1 min-h-0">
          {/* URL input */}
          <div className="flex gap-2">
            <input
              type="url"
              className={`${inputClass} flex-1`}
              placeholder="https://github.com/org/repo"
              value={repoUrl}
              onChange={(e) => setRepoUrl(e.target.value)}
              onKeyDown={(e) => { if (e.key === "Enter") void handleScan(); }}
              disabled={isScanning || isImporting}
            />
            <Button
              variant="secondary"
              size="sm"
              loading={isScanning}
              disabled={!repoUrl.trim() || isImporting}
              onClick={handleScan}
            >
              Scan
            </Button>
          </div>

          {scanRepo.isError && (
            <div className="rounded border border-[var(--color-danger)]/30 bg-[var(--color-danger)]/10 px-3 py-2 text-xs text-[var(--color-danger)]">
              {(scanRepo.error as Error).message}
            </div>
          )}

          {/* Results */}
          {foundItems.length > 0 && !results && (
            <>
              <div className="flex items-center justify-between">
                <p className="text-xs text-[var(--color-text-muted)]">
                  Found {foundItems.length} item{foundItems.length !== 1 ? "s" : ""}
                </p>
                <button
                  onClick={toggleAll}
                  className="text-xs text-[var(--color-primary)] hover:underline cursor-pointer"
                >
                  {selected.size === foundItems.length ? "Deselect All" : "Select All"}
                </button>
              </div>

              <div className="flex flex-col gap-1 max-h-60 overflow-y-auto">
                {foundItems.map((item) => {
                  const key = itemKey(item);
                  return (
                    <label
                      key={key}
                      className="flex items-start gap-2 rounded px-2 py-1.5 hover:bg-[var(--color-surface-2)] cursor-pointer"
                    >
                      <input
                        type="checkbox"
                        className="mt-0.5"
                        checked={selected.has(key)}
                        onChange={() => toggleItem(item)}
                      />
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-1.5">
                          <span className="text-xs font-medium text-[var(--color-text)]">{item.name}</span>
                          <CategoryBadge category={item.category} />
                        </div>
                        {item.description && (
                          <p className="text-[10px] text-[var(--color-text-muted)] mt-0.5 truncate">
                            {item.description}
                          </p>
                        )}
                      </div>
                    </label>
                  );
                })}
              </div>
            </>
          )}

          {foundItems.length === 0 && !isScanning && scanRepo.isSuccess && (
            <p className="text-xs text-[var(--color-text-muted)] text-center py-4">
              No importable skills or commands found in this repository.
            </p>
          )}

          {/* Import results */}
          {results && (
            <div className="flex flex-col gap-1">
              <p className="text-xs font-semibold text-[var(--color-text)]">Import results</p>
              {results.map((r) => (
                <div
                  key={r.name}
                  className={[
                    "flex items-center gap-2 rounded px-2 py-1 text-xs",
                    r.success
                      ? "text-[var(--color-success)]"
                      : "text-[var(--color-danger)]",
                  ].join(" ")}
                >
                  <span>{r.success ? "✓" : "✗"}</span>
                  <span className="font-medium">{r.name}</span>
                  {r.error && <span className="text-[10px] opacity-70">— {r.error}</span>}
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="flex items-center justify-end gap-2 px-4 py-3 border-t border-[var(--color-border)] shrink-0">
          {results ? (
            <Button variant="primary" size="sm" onClick={onClose}>
              Done
            </Button>
          ) : (
            <>
              <Button variant="ghost" size="sm" onClick={onClose} disabled={isImporting}>
                Cancel
              </Button>
              <Button
                variant="primary"
                size="sm"
                loading={isImporting}
                disabled={selected.size === 0 || !tmpDir}
                onClick={handleImport}
              >
                Import {selected.size > 0 ? `(${selected.size})` : ""}
              </Button>
            </>
          )}
        </div>
      </div>
    </div>
  );
}

function CategoryBadge({ category }: { category: AgentItemCategory }) {
  const colors: Record<string, string> = {
    skill: "bg-[var(--color-primary)]/15 text-[var(--color-primary)]",
    command: "bg-[var(--color-success)]/15 text-[var(--color-success)]",
  };
  return (
    <span className={`rounded px-1 py-0.5 text-[9px] font-medium uppercase tracking-wide ${colors[category] ?? "bg-[var(--color-surface-2)] text-[var(--color-text-muted)]"}`}>
      {category}
    </span>
  );
}
