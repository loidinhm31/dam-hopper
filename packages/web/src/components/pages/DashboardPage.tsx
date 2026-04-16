import { FolderGit2, CheckCircle2, AlertCircle, Activity, Hammer, Play, Terminal, Wrench, Square, RotateCw } from "lucide-react";
import { Link, useNavigate } from "react-router-dom";
import { Button } from "@/components/atoms/Button.js";
import { useQueryClient } from "@tanstack/react-query";
import { AppLayout } from "@/components/templates/AppLayout.js";
import { OverviewCard } from "@/components/molecules/OverviewCard.js";
import { useProjects, useTerminalSessions } from "@/api/queries.js";
import { useIpcEvent } from "@/hooks/useSSEEvents.js";
import { useRef, useState } from "react";
import type { LucideIcon } from "lucide-react";
import type { SessionInfo } from "@/api/client.js";
import { api } from "@/api/client.js";
import { getSessionStatus, getStatusDotColor, getStatusGlowClass } from "@/lib/session-status.js";

interface ActivityEntry {
  id: number;
  message: string;
  time: Date;
}

const TYPE_ICON: Record<string, LucideIcon> = {
  build: Hammer,
  run: Play,
  terminal: Terminal,
  shell: Terminal,
  custom: Wrench,
};

function formatUptime(startedAt: number): string {
  const secs = Math.floor((Date.now() - startedAt) / 1000);
  if (secs < 60) return `${secs}s`;
  const mins = Math.floor(secs / 60);
  if (mins < 60) return `${mins}m`;
  const hours = Math.floor(mins / 60);
  const rem = mins % 60;
  return rem > 0 ? `${hours}h ${rem}m` : `${hours}h`;
}

function SessionRow({ session, onNavigate, onKill }: {
  session: SessionInfo;
  onNavigate: (id: string) => void;
  onKill: (id: string) => void;
}) {
  const Icon = TYPE_ICON[session.type] ?? Terminal;
  const status = getSessionStatus(session);
  const dotColor = getStatusDotColor(status);
  const glowClass = getStatusGlowClass(status);

  // Tooltip for status dot
  const statusTooltip = (() => {
    if (status === "alive") return "Running";
    if (status === "restarting") {
      const restartInSec = session.restartInMs ? Math.round(session.restartInMs / 1000) : 0;
      return `Restarting in ${restartInSec}s`;
    }
    if (status === "crashed") return `Crashed (exit code ${session.exitCode ?? "?"})`;
    return `Exited (code ${session.exitCode ?? 0})`;
  })();

  // Show restart badge if restartCount > 0
  const showRestartBadge = (session.restartCount ?? 0) > 0;

  return (
    <li
      role="button"
      tabIndex={0}
      className="flex items-center gap-3 px-3 py-2 rounded cursor-pointer hover:bg-[var(--color-surface-2)] transition-colors group"
      onClick={() => onNavigate(session.id)}
      onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") onNavigate(session.id); }}
    >
      <Icon className="h-3.5 w-3.5 shrink-0 text-[var(--color-primary)]/60" />
      <span className="text-xs font-medium text-[var(--color-text)] truncate shrink-0 max-w-[25%]">
        {session.project}
      </span>
      <span className="text-xs text-[var(--color-text-muted)] truncate flex-1 min-w-0">
        {session.command}
      </span>
      <span className="text-[10px] text-[var(--color-text-muted)]/60 tabular-nums shrink-0">
        {formatUptime(session.startedAt)}
      </span>
      {showRestartBadge && (
        <span
          className="inline-flex items-center gap-0.5 px-1 py-0.5 rounded text-[9px] bg-yellow-500/10 text-yellow-500 shrink-0"
          title={`Restarted ${session.restartCount} time(s)`}
        >
          <RotateCw className="h-2.5 w-2.5" />
          {session.restartCount}
        </span>
      )}
      <span
        className={`inline-block h-1.5 w-1.5 rounded-full ${dotColor} ${glowClass} shrink-0`}
        title={statusTooltip}
      />
      <button
        className="shrink-0 opacity-0 group-hover:opacity-100 transition-opacity p-0.5 rounded hover:bg-[var(--color-danger)]/20 text-[var(--color-danger)]/60 hover:text-[var(--color-danger)]"
        onClick={(e) => { e.stopPropagation(); onKill(session.id); }}
        title="Kill session"
      >
        <Square className="h-3 w-3" />
      </button>
    </li>
  );
}

export function DashboardPage() {
  const { data: projects = [] } = useProjects();
  const { data: sessions = [] } = useTerminalSessions();
  const [activity, setActivity] = useState<ActivityEntry[]>([]);
  const nextIdRef = useRef(1);
  const navigate = useNavigate();
  const qc = useQueryClient();

  const clean = projects.filter((p) => p.status?.isClean === true).length;
  const dirty = projects.filter((p) => p.status?.isClean === false).length;
  const aliveSessions = sessions.filter((s) => s.alive);

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

  function handleNavigateToSession(sessionId: string) {
    navigate(`/terminals?session=${sessionId}`);
  }

  function handleKillSession(sessionId: string) {
    api.terminal.kill(sessionId).catch((err: unknown) => {
      console.error("[DashboardPage] kill session failed", err);
    });
    void qc.invalidateQueries({ queryKey: ["terminal-sessions"] });
  }

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
            value={aliveSessions.length}
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

      {/* Active terminals */}
      <div className="mb-5 rounded glass-card p-4">
        <p className="text-[10px] text-[var(--color-primary)]/60 tracking-widest uppercase mb-3">
          // ACTIVE_TERMINALS
        </p>
        {aliveSessions.length === 0 ? (
          <p className="text-xs text-[var(--color-text-muted)]/60 italic">
            <span className="text-[var(--color-primary)]/40">$</span> no active terminals
          </p>
        ) : (
          <ul className="space-y-0.5">
            {aliveSessions.map((s) => (
              <SessionRow
                key={s.id}
                session={s}
                onNavigate={handleNavigateToSession}
                onKill={handleKillSession}
              />
            ))}
          </ul>
        )}
      </div>

      {/* Quick actions */}
      <div className="mb-5 rounded glass-card p-4">
        <p className="text-[10px] text-[var(--color-primary)]/60 tracking-widest uppercase mb-3">
          // QUICK_ACTIONS
        </p>
        <div className="flex gap-2 flex-wrap items-center">
          <Button
            variant="secondary"
            size="sm"
            onClick={() => navigate("/terminals?action=new-terminal")}
          >
            <Terminal className="h-3.5 w-3.5" />
            New Terminal
          </Button>
          <kbd className="text-[10px] text-[var(--color-text-muted)]/50 font-mono">Ctrl+`</kbd>
        </div>
      </div>

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
