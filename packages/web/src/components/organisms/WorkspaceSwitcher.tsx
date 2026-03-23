import { useState, useEffect, useRef } from "react";
import { ChevronDown, Check, X, Plus, Loader2 } from "lucide-react";
import {
  useWorkspace,
  useKnownWorkspaces,
  useSwitchWorkspace,
  useAddKnownWorkspace,
  useRemoveKnownWorkspace,
} from "@/api/queries.js";

function abbreviatePath(p: string) {
  return p
    .replace(/^\/(?:home|Users)\/[^/]+/, "~")
    .replace(/^\/root(\/|$)/, "~$1");
}

export function WorkspaceSwitcher() {
  const [open, setOpen] = useState(false);
  const [addPath, setAddPath] = useState("");
  const [removingPath, setRemovingPath] = useState<string | null>(null);
  const ref = useRef<HTMLDivElement>(null);

  const { data: workspace } = useWorkspace();
  const { data: known, isLoading: knownLoading } = useKnownWorkspaces();
  const switchMutation = useSwitchWorkspace();
  const addMutation = useAddKnownWorkspace();
  const removeMutation = useRemoveKnownWorkspace();

  // Click-outside to close
  useEffect(() => {
    if (!open) return;
    function handleClick(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) {
        setOpen(false);
      }
    }
    document.addEventListener("mousedown", handleClick);
    return () => document.removeEventListener("mousedown", handleClick);
  }, [open]);

  // Escape to close
  useEffect(() => {
    if (!open) return;
    function handleKey(e: KeyboardEvent) {
      if (e.key === "Escape") setOpen(false);
    }
    document.addEventListener("keydown", handleKey);
    return () => document.removeEventListener("keydown", handleKey);
  }, [open]);

  function handleSwitch(path: string) {
    if (path === workspace?.root) return;
    switchMutation.mutate(path, { onSuccess: () => setOpen(false) });
  }

  function handleAdd() {
    const trimmed = addPath.trim();
    if (!trimmed) return;
    addMutation.mutate(trimmed, {
      onSuccess: () => setAddPath(""),
    });
  }

  function handleRemove(e: React.MouseEvent, path: string) {
    e.stopPropagation();
    setRemovingPath(path);
    removeMutation.mutate(path, {
      onSettled: () => setRemovingPath(null),
    });
  }

  const isSwitching = switchMutation.isPending;
  const error =
    switchMutation.error?.message ??
    addMutation.error?.message ??
    removeMutation.error?.message;

  return (
    <div ref={ref} className="relative">
      {/* Trigger */}
      <button
        onClick={() => setOpen((v) => !v)}
        className="w-full text-left group"
      >
        <p className="text-xs font-medium text-[var(--color-text-muted)] uppercase tracking-wider">
          Workspace
        </p>
        <div className="mt-0.5 flex items-center gap-1.5">
          {isSwitching ? (
            <Loader2 className="h-3.5 w-3.5 shrink-0 animate-spin text-[var(--color-primary)]" />
          ) : null}
          <p className="flex-1 font-semibold text-[var(--color-text)] truncate">
            {workspace?.name ?? "Dev Hub"}
          </p>
          <ChevronDown
            className={`h-3.5 w-3.5 shrink-0 text-[var(--color-text-muted)] transition-transform ${open ? "rotate-180" : ""}`}
          />
        </div>
      </button>

      {/* Dropdown */}
      {open && (
        <div className="absolute left-0 right-0 top-full mt-1 z-50 rounded border border-[var(--color-border)] bg-[var(--color-surface-2)] shadow-lg overflow-hidden">
          {/* Known workspaces */}
          {knownLoading ? (
            <div className="px-3 py-2 text-xs text-[var(--color-text-muted)]">
              Loading…
            </div>
          ) : (known?.workspaces ?? []).length === 0 ? (
            <div className="px-3 py-2 text-xs text-[var(--color-text-muted)]">
              No saved workspaces
            </div>
          ) : (
            <ul>
              {(known?.workspaces ?? []).map((ws) => {
                const isCurrent = ws.path === workspace?.root;
                const isRemoving = removingPath === ws.path;
                return (
                  <li
                    key={ws.path}
                    className={`flex items-center gap-2 px-3 py-2 text-sm transition-colors ${
                      isCurrent
                        ? "text-[var(--color-primary)]"
                        : "text-[var(--color-text)] hover:bg-[var(--color-surface)]"
                    }`}
                  >
                    {/* Switch action — occupies full row except remove button */}
                    <button
                      onClick={() => handleSwitch(ws.path)}
                      disabled={isCurrent || isSwitching}
                      className="flex flex-1 min-w-0 items-center gap-2 text-left disabled:cursor-default disabled:opacity-50"
                    >
                      <span className="w-3.5 shrink-0">
                        {isCurrent && <Check className="h-3.5 w-3.5" />}
                      </span>
                      <span className="flex-1 truncate">{ws.name}</span>
                      <span
                        className="flex-shrink-0 text-xs text-[var(--color-text-muted)] truncate max-w-[100px]"
                        title={ws.path}
                      >
                        {abbreviatePath(ws.path)}
                      </span>
                    </button>
                    {/* Remove button — sibling, not nested */}
                    {!isCurrent && (
                      <button
                        onClick={(e) => handleRemove(e, ws.path)}
                        disabled={isRemoving}
                        className="ml-1 shrink-0 rounded p-0.5 text-[var(--color-text-muted)] hover:text-[var(--color-danger)] hover:bg-[var(--color-surface)] transition-colors disabled:opacity-50"
                        title="Remove from list"
                      >
                        {isRemoving ? (
                          <Loader2 className="h-3 w-3 animate-spin" />
                        ) : (
                          <X className="h-3 w-3" />
                        )}
                      </button>
                    )}
                  </li>
                );
              })}
            </ul>
          )}

          {/* Divider */}
          <div className="border-t border-[var(--color-border)]" />

          {/* Add workspace */}
          <div className="px-3 py-2 space-y-1.5">
            <p className="text-xs text-[var(--color-text-muted)]">
              Add workspace
            </p>
            <div className="flex gap-1.5">
              <input
                value={addPath}
                onChange={(e) => setAddPath(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter") handleAdd();
                }}
                placeholder="/path/to/workspace"
                className="flex-1 min-w-0 rounded border border-[var(--color-border)] bg-[var(--color-background)] text-xs text-[var(--color-text)] px-2 py-1 outline-none focus:border-[var(--color-primary)] transition-colors"
              />
              <button
                onClick={handleAdd}
                disabled={!addPath.trim() || addMutation.isPending}
                className="shrink-0 rounded border border-[var(--color-border)] bg-[var(--color-surface)] px-2 py-1 text-xs text-[var(--color-text)] hover:bg-[var(--color-border)] transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
              >
                {addMutation.isPending ? (
                  <Loader2 className="h-3 w-3 animate-spin" />
                ) : (
                  <Plus className="h-3 w-3" />
                )}
              </button>
            </div>
          </div>

          {/* Error */}
          {error && (
            <div className="px-3 pb-2 text-xs text-[var(--color-danger)]">
              {error}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
