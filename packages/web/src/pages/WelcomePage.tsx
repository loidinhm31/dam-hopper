import { useState } from "react";
import { FolderOpen, Loader2, ChevronRight } from "lucide-react";
import { Button } from "@/components/atoms/Button.js";
import { useKnownWorkspaces, useInitWorkspace } from "@/api/queries.js";

function abbreviatePath(p: string) {
  return p
    .replace(/^\/(?:home|Users)\/[^/]+/, "~")
    .replace(/^\/root(\/|$)/, "~$1");
}

interface Props {
  onReady: () => void;
}

export function WelcomePage({ onReady }: Props) {
  const [error, setError] = useState<string | null>(null);

  const { data: known, isLoading: knownLoading } = useKnownWorkspaces();
  const initMutation = useInitWorkspace();

  const isLoading = initMutation.isPending;

  const [webPath, setWebPath] = useState("");

  async function openWebPath() {
    if (!webPath.trim()) return;
    setError(null);
    try {
      await initMutation.mutateAsync(webPath.trim());
      onReady();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  }

  async function initFromKnown(path: string) {
    setError(null);
    try {
      await initMutation.mutateAsync(path);
      onReady();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  }

  const workspaces = known?.workspaces ?? [];

  return (
    <div className="relative flex min-h-screen items-center justify-center bg-[var(--color-background)]">
      {/* Loading overlay */}
      {isLoading && (
        <div className="absolute inset-0 z-10 flex items-center justify-center bg-[var(--color-background)]/80 backdrop-blur-sm">
          <div className="flex flex-col items-center gap-3">
            <Loader2 className="h-8 w-8 animate-spin text-[var(--color-primary)]" />
            <p className="text-sm text-[var(--color-text-muted)]">Loading workspace…</p>
          </div>
        </div>
      )}

      <div className="flex w-full max-w-sm flex-col gap-8 px-6 animate-in fade-in duration-300">
        {/* Header */}
        <div className="flex flex-col items-center gap-2 text-center">
          <div className="mb-2 flex h-14 w-14 items-center justify-center rounded-2xl bg-[var(--color-primary)]/10 text-[var(--color-primary)]">
            <FolderOpen className="h-7 w-7" />
          </div>
          <h1 className="text-2xl font-bold tracking-tight text-[var(--color-text)]">Dev Hub</h1>
          <p className="text-sm text-[var(--color-text-muted)]">
            Open a workspace folder to get started
          </p>
        </div>

        {/* Open workspace by path */}
        <div className="flex flex-col gap-3">
          <div className="flex gap-2">
            <input
              type="text"
              value={webPath}
              onChange={(e) => setWebPath(e.target.value)}
              placeholder="/home/user/my-project"
              className="flex-1 rounded-lg border px-3 py-2 text-sm focus:outline-none focus:ring-2"
              style={{
                background: "var(--color-background)",
                borderColor: "var(--color-border)",
                color: "var(--color-text)",
              }}
              onKeyDown={(e) => e.key === "Enter" && void openWebPath()}
              disabled={isLoading}
            />
            <Button
              variant="primary"
              size="md"
              onClick={() => void openWebPath()}
              disabled={isLoading || !webPath.trim()}
            >
              Open
            </Button>
          </div>
        </div>

        {/* Recent workspaces */}
        <div className="flex flex-col gap-2">
          <p className="text-xs font-medium uppercase tracking-wider text-[var(--color-text-muted)]">
            Recent
          </p>

          {knownLoading ? (
            <div className="flex items-center gap-2 rounded border border-[var(--color-border)] bg-[var(--color-surface)] px-3 py-2 text-xs text-[var(--color-text-muted)]">
              <Loader2 className="h-3 w-3 animate-spin" />
              Loading…
            </div>
          ) : workspaces.length === 0 ? (
            <div className="rounded border border-[var(--color-border)] bg-[var(--color-surface)] px-3 py-3 text-center text-xs text-[var(--color-text-muted)]">
              No recent workspaces
            </div>
          ) : (
            <ul className="overflow-hidden rounded border border-[var(--color-border)] bg-[var(--color-surface)]">
              {workspaces.map((ws, i) => (
                <li
                  key={ws.path}
                  className={i > 0 ? "border-t border-[var(--color-border)]" : ""}
                >
                  <button
                    onClick={() => void initFromKnown(ws.path)}
                    disabled={isLoading}
                    className="group flex w-full items-center gap-3 px-3 py-2.5 text-left transition-colors hover:bg-[var(--color-surface-2)] disabled:cursor-not-allowed disabled:opacity-50"
                    onKeyDown={(e) => {
                      if (e.key === "Enter") void initFromKnown(ws.path);
                    }}
                  >
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-sm font-medium text-[var(--color-text)]">
                        {ws.name}
                      </p>
                      <p
                        className="truncate text-xs text-[var(--color-text-muted)]"
                        title={ws.path}
                      >
                        {abbreviatePath(ws.path)}
                      </p>
                    </div>
                    <ChevronRight className="h-4 w-4 shrink-0 text-[var(--color-text-muted)] opacity-0 transition-opacity group-hover:opacity-100" />
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>

        {/* Error display */}
        {error && (
          <p className="rounded border border-[var(--color-danger)]/30 bg-[var(--color-danger)]/10 px-3 py-2 text-xs text-[var(--color-danger)]">
            {error}
          </p>
        )}
      </div>
    </div>
  );
}
