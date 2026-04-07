import { useState } from "react";
import { Button, inputClass } from "@/components/atoms/Button.js";
import { useScanRepo, useScanLocalDir, useImportConfirm } from "@/api/queries.js";
import type { RepoScanItem, AgentItemCategory } from "@/api/client.js";

type ImportSource = "repo" | "local";

interface Props {
  onClose: () => void;
}

export function ImportDialog({ onClose }: Props) {
  const [source, setSource] = useState<ImportSource>("repo");
  const [repoUrl, setRepoUrl] = useState("");
  const [dirPath, setDirPath] = useState("");
  const [tmpDir, setTmpDir] = useState<string | null>(null);
  const [foundItems, setFoundItems] = useState<RepoScanItem[]>([]);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [results, setResults] = useState<Array<{ name: string; success: boolean; error?: string }> | null>(null);

  const scanRepo = useScanRepo();
  const scanLocalDir = useScanLocalDir();
  const importConfirm = useImportConfirm();

  const activeScan = source === "repo" ? scanRepo : scanLocalDir;

  function itemKey(item: RepoScanItem) {
    return `${item.category}:${item.name}`;
  }

  function resetScanState() {
    setFoundItems([]);
    setSelected(new Set());
    setResults(null);
    setTmpDir(null);
  }

  function handleSourceChange(next: ImportSource) {
    setSource(next);
    resetScanState();
    scanRepo.reset();
    scanLocalDir.reset();
  }

  async function handleScan() {
    const input = source === "repo" ? repoUrl.trim() : dirPath.trim();
    if (!input) return;
    resetScanState();

    if (source === "repo") {
      const result = await scanRepo.mutateAsync(input);
      setFoundItems(result.items);
      setTmpDir(result.tmpDir);
      setSelected(new Set(result.items.map(itemKey)));
    } else {
      const result = await scanLocalDir.mutateAsync(input);
      setFoundItems(result.items);
      setTmpDir(result.dirPath);
      setSelected(new Set(result.items.map(itemKey)));
    }
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
    const res = await importConfirm.mutateAsync({
      tmpDir,
      selectedItems,
      skipCleanup: source === "local",
    });
    setResults(res);
  }

  const isScanning = activeScan.isPending;
  const isImporting = importConfirm.isPending;
  const scanError = activeScan.isError ? (activeScan.error as Error).message : null;
  const scanSuccess = activeScan.isSuccess;

  const headerText = source === "repo" ? "Import from Git Repository" : "Import from Local Directory";
  const inputPlaceholder = source === "repo" ? "https://github.com/org/repo" : "/home/user/devkit";

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50">
      <div className="w-[520px] max-h-[80vh] rounded-lg border border-[var(--color-border)] bg-[var(--color-surface)] flex flex-col shadow-xl">
        {/* Header */}
        <div className="flex items-center justify-between px-4 py-3 border-b border-[var(--color-border)] shrink-0">
          <p className="text-sm font-semibold text-[var(--color-text)]">{headerText}</p>
          <button
            onClick={onClose}
            className="text-[var(--color-text-muted)] hover:text-[var(--color-text)] cursor-pointer"
          >
            ✕
          </button>
        </div>

        {/* Body */}
        <div className="flex flex-col gap-3 p-4 overflow-y-auto flex-1 min-h-0">
          {/* Source toggle */}
          <div className="flex gap-1 p-0.5 rounded bg-[var(--color-surface-2)]">
            {(["repo", "local"] as ImportSource[]).map((s) => (
              <button
                key={s}
                onClick={() => handleSourceChange(s)}
                disabled={isScanning || isImporting}
                className={[
                  "flex-1 rounded px-3 py-1.5 text-xs font-medium transition-colors cursor-pointer",
                  source === s
                    ? "bg-[var(--color-surface)] text-[var(--color-text)] shadow-sm"
                    : "text-[var(--color-text-muted)] hover:text-[var(--color-text)]",
                ].join(" ")}
              >
                {s === "repo" ? "Git Repository" : "Local Directory"}
              </button>
            ))}
          </div>

          {/* Input */}
          <div className="flex gap-2">
            <input
              type={source === "repo" ? "url" : "text"}
              className={`${inputClass} flex-1`}
              placeholder={inputPlaceholder}
              value={source === "repo" ? repoUrl : dirPath}
              onChange={(e) =>
                source === "repo" ? setRepoUrl(e.target.value) : setDirPath(e.target.value)
              }
              onKeyDown={(e) => { if (e.key === "Enter") void handleScan(); }}
              disabled={isScanning || isImporting}
            />
            <Button
              variant="secondary"
              size="sm"
              loading={isScanning}
              disabled={!(source === "repo" ? repoUrl.trim() : dirPath.trim()) || isImporting}
              onClick={handleScan}
            >
              Scan
            </Button>
          </div>

          {scanError && (
            <div className="rounded border border-[var(--color-danger)]/30 bg-[var(--color-danger)]/10 px-3 py-2 text-xs text-[var(--color-danger)]">
              {scanError}
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

          {foundItems.length === 0 && !isScanning && scanSuccess && (
            <p className="text-xs text-[var(--color-text-muted)] text-center py-4">
              No importable skills or commands found.
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
