import { FolderGit2, CheckCircle2, AlertCircle, Activity } from "lucide-react";
import { Link } from "react-router-dom";
import { AppLayout } from "@/components/templates/AppLayout.js";
import { OverviewCard } from "@/components/molecules/OverviewCard.js";
import { useProjects } from "@/api/queries.js";
import { useIpcEvent } from "@/hooks/useSSEEvents.js";
import { useRef, useState, useEffect } from "react";

interface ActivityEntry {
  id: number;
  message: string;
  time: Date;
}

export function DashboardPage() {
  const { data: projects = [] } = useProjects();
  const [activeSessions, setActiveSessions] = useState(0);
  const [activity, setActivity] = useState<ActivityEntry[]>([]);
  const nextIdRef = useRef(1);

  const clean = projects.filter((p) => p.status?.isClean === true).length;
  const dirty = projects.filter((p) => p.status?.isClean === false).length;

  useEffect(() => {
    let cancelled = false;
    async function refresh() {
      try {
        const ids = await window.devhub.terminal.list();
        if (!cancelled) setActiveSessions(ids.length);
      } catch {
        /* ignore */
      }
    }
    void refresh();
    const t = setInterval(() => void refresh(), 5_000);
    return () => {
      cancelled = true;
      clearInterval(t);
    };
  }, []);

  useIpcEvent("*", (e) => {
    const msg =
      typeof e.data === "object" && e.data !== null
        ? (((e.data as Record<string, unknown>).message as
            | string
            | undefined) ??
          ((e.data as Record<string, unknown>).projectName as
            | string
            | undefined) ??
          e.type)
        : String(e.data ?? e.type);

    setActivity((prev) => [
      {
        id: nextIdRef.current++,
        message: `[${e.type}] ${msg}`,
        time: new Date(e.timestamp),
      },
      ...prev.slice(0, 19),
    ]);
  });

  return (
    <AppLayout title="Dashboard">
      {/* Overview cards */}
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4 mb-5">
        <Link to="/terminals" className="block hover:opacity-90 transition-opacity">
          <OverviewCard
            icon={FolderGit2}
            label="Total Projects"
            value={projects.length}
            color="var(--color-primary)"
          />
        </Link>
        <OverviewCard
          icon={CheckCircle2}
          label="Clean Repos"
          value={clean}
          color="var(--color-success)"
        />
        <OverviewCard
          icon={AlertCircle}
          label="Dirty Repos"
          value={dirty}
          color="var(--color-warning)"
        />
        <Link to="/terminals" className="block hover:opacity-90 transition-opacity">
          <OverviewCard
            icon={Activity}
            label="Active Terminals"
            value={activeSessions}
            color="var(--color-danger)"
          />
        </Link>
      </div>

      {/* Status bar */}
      {projects.length > 0 && (
        <div className="mb-5 rounded glass-card p-4">
          <p className="text-[10px] text-[var(--color-primary)]/60 tracking-widest uppercase mb-3">
            // REPO_STATUS
          </p>
          <div className="flex h-1.5 overflow-hidden rounded-full bg-[var(--color-surface-2)]">
            {clean > 0 && (
              <div
                className="bg-[var(--color-success)] transition-all"
                style={{ width: `${(clean / projects.length) * 100}%` }}
                title={`${clean} clean`}
              />
            )}
            {dirty > 0 && (
              <div
                className="bg-[var(--color-warning)] transition-all"
                style={{ width: `${(dirty / projects.length) * 100}%` }}
                title={`${dirty} dirty`}
              />
            )}
          </div>
          <div className="flex gap-5 mt-2.5 text-[11px] text-[var(--color-text-muted)]">
            <span className="flex items-center gap-1.5">
              <span className="inline-block h-1.5 w-1.5 rounded-full bg-[var(--color-success)] status-glow-green" />
              <span className="text-[var(--color-success)]">{clean}</span> clean
            </span>
            <span className="flex items-center gap-1.5">
              <span className="inline-block h-1.5 w-1.5 rounded-full bg-[var(--color-warning)] status-glow-orange" />
              <span className="text-[var(--color-warning)]">{dirty}</span> dirty
            </span>
            <span className="flex items-center gap-1.5">
              <span className="inline-block h-1.5 w-1.5 rounded-full bg-[var(--color-border)]" />
              <span className="text-[var(--color-text-muted)]">{projects.length - clean - dirty}</span> unknown
            </span>
          </div>
        </div>
      )}

      {/* Recent activity */}
      <div className="rounded glass-card p-4">
        <p className="text-[10px] text-[var(--color-primary)]/60 tracking-widest uppercase mb-3">
          // RECENT_ACTIVITY
        </p>
        {activity.length === 0 ? (
          <p className="text-xs text-[var(--color-text-muted)]/60 italic">
            <span className="text-[var(--color-primary)]/40">$</span> waiting for events...
          </p>
        ) : (
          <ul className="space-y-1">
            {activity.map((a) => (
              <li key={a.id} className="flex items-start gap-3 text-xs group">
                <span className="shrink-0 text-[var(--color-text-muted)]/40 tabular-nums text-[10px] mt-0.5">
                  {a.time.toLocaleTimeString()}
                </span>
                <span className="text-[var(--color-primary)]/40 shrink-0">›</span>
                <span className="text-[var(--color-text)]/80 group-hover:text-[var(--color-text)] transition-colors">
                  {a.message}
                </span>
              </li>
            ))}
          </ul>
        )}
      </div>
    </AppLayout>
  );
}
