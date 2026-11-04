import {
  useState,
  useMemo,
  type ReactElement,
} from "react";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/Select.js";
import type { OsWindow, WindowContext } from "../types.js";
import { useWindowStore } from "../window-store.js";
import { dispatchIntent, createIntent } from "../intents.js";
import {
  useAggregatedTerminalSessions,
  type AggregatedSessionInfo,
} from "@/hooks/use-aggregated-terminal-sessions.js";
import { useAggregatedProjects } from "@/hooks/use-aggregated-projects.js";
import { useAgentStatusStore } from "@/stores/agent-status.js";
import {
  getAllConnectionSnapshots,
  getConnectionSnapshot,
  type ConnectionSnapshot,
} from "@/api/connections.js";
import { useCognitoModeStore } from "@/stores/cognito-mode.js";
import {
  buildAgentHubItems,
  computeAgentHubSummary,
  filterAgentHubItems,
  validateAgentHubJump,
  type AgentHubItem,
  type AgentHubUrgency,
  AGENT_HUB_URGENCY_ORDER,
  AGENT_HUB_URGENCY_LABELS,
} from "../agent-hub.js";
import { terminalKey, parseTerminalKey, type TerminalRef } from "@/api/ownership.js";
import { buildTraditionalTerminalProjectGroups } from "@/lib/traditional-terminal-projects.js";
import type { DisplayTabEntry } from "@/components/organisms/TerminalTabBar.js";
import type { MountedSession } from "@/components/organisms/MultiTerminalDisplay.js";
import { generateUUID } from "@/lib/utils.js";

export interface AgentHubAppProps {
  window: OsWindow;
}

export function AgentHubApp({ window }: AgentHubAppProps): ReactElement {
  const isCognitoActive = useCognitoModeStore((state) => state.active);
  const session = useWindowStore((state) => state.session);
  const openWindow = useWindowStore((state) => state.openWindow);
  const focusWindow = useWindowStore((state) => state.focusWindow);
  const restoreWindow = useWindowStore((state) => state.restoreWindow);
  const switchDesktop = useWindowStore((state) => state.switchDesktop);

  const [urgencyFilter, setUrgencyFilter] = useState<AgentHubUrgency | "all">("all");
  const [profileFilter, setProfileFilter] = useState<string | "all">("all");
  const [harnessFilter, setHarnessFilter] = useState<"OMP" | "Codex" | "Claude" | "all">("all");
  const [searchQuery, setSearchQuery] = useState("");
  const [feedbackNotice, setFeedbackNotice] = useState<string | null>(null);

  const { sessions: rawSessions = [], isLoading: sessionsLoading } =
    useAggregatedTerminalSessions();
  const { allProjects = [], isLoading: projectsLoading } =
    useAggregatedProjects();
  const statusProfiles = useAgentStatusStore((state) => state.profiles);
  // Map all connections
  const connectionsMap = useMemo(() => {
    const map = new Map<string, ConnectionSnapshot>();
    for (const snap of getAllConnectionSnapshots()) {
      map.set(snap.owner.profileId, snap);
    }
    return map;
  }, [rawSessions]);

  // Profile labels
  const profileLabels = useMemo(() => {
    const map = new Map<string, string>();
    for (const item of allProjects) {
      if (!map.has(item.profileId)) {
        map.set(item.profileId, item.profileName || item.profileId);
      }
    }
    for (const s of rawSessions) {
      if (!map.has(s.profileId)) {
        map.set(s.profileId, s.profileId);
      }
    }
    return map;
  }, [allProjects, rawSessions]);

  // Map mounted sessions & display tabs for traditional groups
  const groups = useMemo(() => {
    const mounted: MountedSession[] = [];
    const tabs: DisplayTabEntry[] = [];

    for (const s of rawSessions) {
      const termRef: TerminalRef = { profileId: s.profileId, id: s.id };
      const qSessionId = terminalKey(termRef);
      mounted.push({
        sessionId: qSessionId,
        terminalRef: termRef,
        profileId: s.profileId,
        project: s.project || "default",
        command: s.command || "bash",
      });
      tabs.push({
        sessionId: qSessionId,
        terminalRef: termRef,
        profileId: s.profileId,
        label: s.name || s.id,
        title: {
          baseLabel: s.name || s.id,
          ordinal: 1,
          fullText: s.name ? `${s.name} (${s.id})` : s.id,
        },
        session: {
          id: s.id,
          incarnation: s.incarnation ?? 0,
          alive: s.alive,
          command: s.command,
          cwd: s.cwd,
          type: s.type,
          startedAt: s.startedAt,
          project: s.project,
          worktreePath: s.worktreePath,
        },
      });
    }

    return buildTraditionalTerminalProjectGroups(mounted, tabs);
  }, [rawSessions]);

  // Build aggregated Agent Hub items
  const items = useMemo(() => {
    return buildAgentHubItems({
      groups,
      profiles: statusProfiles,
      connections: connectionsMap,
      profileLabels,
    });
  }, [groups, statusProfiles, connectionsMap, profileLabels]);

  // Summary counts
  const summary = useMemo(() => {
    return computeAgentHubSummary(items, connectionsMap);
  }, [items, connectionsMap]);

  // Filtered items
  const filteredItems = useMemo(() => {
    return filterAgentHubItems(items, {
      urgency: urgencyFilter,
      profileId: profileFilter,
      harness: harnessFilter,
      searchQuery,
    });
  }, [items, urgencyFilter, profileFilter, harnessFilter, searchQuery]);

  // Group filtered items by urgency
  const groupedItems = useMemo(() => {
    const groupsMap: Record<AgentHubUrgency, AgentHubItem[]> = {
      "needs-attention": [],
      working: [],
      idle: [],
      unavailable: [],
    };
    for (const item of filteredItems) {
      groupsMap[item.urgency].push(item);
    }
    return groupsMap;
  }, [filteredItems]);

  // Alive terminal IDs by profile map for jump validation
  const aliveTerminalIdsByProfile = useMemo(() => {
    const map = new Map<string, Set<string>>();
    for (const s of rawSessions) {
      if (s.alive) {
        let set = map.get(s.profileId);
        if (!set) {
          set = new Set<string>();
          map.set(s.profileId, set);
        }
        set.add(s.id);
      }
    }
    return map;
  }, [rawSessions]);

  // Handle jump
  const handleJump = (item: AgentHubItem) => {
    setFeedbackNotice(null);
    const validation = validateAgentHubJump(
      item,
      connectionsMap,
      session.windows,
      aliveTerminalIdsByProfile,
    );

    if (!validation.valid) {
      setFeedbackNotice(`Jump blocked: ${validation.reason ?? "Invalid target"}`);
      return;
    }

    // Existing window found
    if (validation.existingWindowId) {
      const win = session.windows[validation.existingWindowId];
      if (win) {
        if (win.desktopId !== session.activeDesktopId) {
          switchDesktop(win.desktopId);
        }
        if (win.minimized) {
          restoreWindow(win.id);
        }
        focusWindow(win.id);
        return;
      }
    }

    // No window displaying it yet, but session is live on host. Open in terminals app on active desktop.
    const newWinId = `terminals-${generateUUID().slice(0, 8)}`;
    openWindow(
      {
        id: newWinId,
        appId: "terminals",
        title: item.terminalTitle,
        ctx: validation.targetContext ?? { profileId: item.profileId },
        mode: "tile",
        appState: {
          sessionId: item.terminalRef.id,
          terminalId: item.terminalRef.id,
        },
      },
      session.activeDesktopId,
    );
    focusWindow(newWinId);
  };

  // Handle Review affordance
  const handleReview = (item: AgentHubItem) => {
    dispatchIntent(
      createIntent("session-changes:open", {
        profileId: item.profileId,
        terminalId: item.terminalRef.id,
        terminalIncarnation: String(item.incarnation),
        ompSessionId: item.status.agentSessionId ?? "",
      }),
    );
  };

  // Handle Open Recipes affordance
  const handleOpenRecipes = () => {
    dispatchIntent(createIntent("recipes:open", {}));
  };

  return (
    <div
      data-os-agent-hub={window.id}
      data-testid={`agent-hub-app-${window.id}`}
      className="w-full h-full overflow-hidden flex flex-col bg-[var(--color-surface)] text-[var(--color-text)] select-none text-xs"
    >
      {/* App Header & Urgency KPI Badges */}
      <div className="flex flex-col gap-2 p-3 border-b border-[var(--color-border)] bg-[var(--color-bg)]">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <span className="text-base font-bold flex items-center gap-1.5 text-[var(--color-primary)]">
              🤖 Agent Hub
            </span>
            <span className="text-[10px] px-1.5 py-0.5 rounded bg-[var(--color-surface-hover)] text-[var(--color-text-muted)] border border-[var(--color-border)]">
              {summary.total} agents ({summary.connectedProfiles}/{summary.totalProfiles} connected hosts)
            </span>
          </div>

          <div className="flex items-center gap-2">
            <button
              type="button"
              data-testid="agent-hub-open-recipes-btn"
              onClick={handleOpenRecipes}
              className="px-2.5 py-1 rounded bg-[var(--color-primary)] text-white hover:opacity-90 font-medium transition-opacity text-xs flex items-center gap-1"
            >
              📜 Launch Recipes
            </button>
          </div>
        </div>

        {/* Urgency Pill Summary Bar */}
        <div className="flex items-center gap-1.5 overflow-x-auto pb-1">
          <button
            type="button"
            data-testid="agent-hub-filter-all"
            onClick={() => setUrgencyFilter("all")}
            className={`px-2 py-0.5 rounded-full text-xs transition-colors flex items-center gap-1 border ${
              urgencyFilter === "all"
                ? "bg-[var(--color-primary)] text-white border-[var(--color-primary)]"
                : "bg-[var(--color-surface)] text-[var(--color-text)] border-[var(--color-border)] hover:bg-[var(--color-surface-hover)]"
            }`}
          >
            All <span className="opacity-80">({summary.total})</span>
          </button>

          <button
            type="button"
            data-testid="agent-hub-filter-needs-attention"
            onClick={() => setUrgencyFilter("needs-attention")}
            className={`px-2 py-0.5 rounded-full text-xs transition-colors flex items-center gap-1 border ${
              urgencyFilter === "needs-attention"
                ? "bg-amber-600 text-white border-amber-600"
                : "bg-amber-500/10 text-amber-500 border-amber-500/30 hover:bg-amber-500/20"
            }`}
          >
            ⚠ Needs Attention{" "}
            <span className="font-semibold">({summary.needsAttention})</span>
          </button>

          <button
            type="button"
            data-testid="agent-hub-filter-working"
            onClick={() => setUrgencyFilter("working")}
            className={`px-2 py-0.5 rounded-full text-xs transition-colors flex items-center gap-1 border ${
              urgencyFilter === "working"
                ? "bg-blue-600 text-white border-blue-600"
                : "bg-blue-500/10 text-blue-500 border-blue-500/30 hover:bg-blue-500/20"
            }`}
          >
            ⚡ Working <span>({summary.working})</span>
          </button>

          <button
            type="button"
            data-testid="agent-hub-filter-idle"
            onClick={() => setUrgencyFilter("idle")}
            className={`px-2 py-0.5 rounded-full text-xs transition-colors flex items-center gap-1 border ${
              urgencyFilter === "idle"
                ? "bg-emerald-600 text-white border-emerald-600"
                : "bg-emerald-500/10 text-emerald-500 border-emerald-500/30 hover:bg-emerald-500/20"
            }`}
          >
            💤 Idle <span>({summary.idle})</span>
          </button>

          <button
            type="button"
            data-testid="agent-hub-filter-unavailable"
            onClick={() => setUrgencyFilter("unavailable")}
            className={`px-2 py-0.5 rounded-full text-xs transition-colors flex items-center gap-1 border ${
              urgencyFilter === "unavailable"
                ? "bg-gray-600 text-white border-gray-600"
                : "bg-gray-500/10 text-gray-400 border-gray-500/30 hover:bg-gray-500/20"
            }`}
          >
            Offline / Unknown <span>({summary.unavailable})</span>
          </button>
        </div>

        {/* Filter & Search Bar */}
        <div className="flex items-center gap-2 pt-1 text-xs">
          <input
            type="text"
            data-testid="agent-hub-search-input"
            placeholder="Search agents by title, project, host, reason..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="flex-1 px-2.5 py-1 rounded bg-[var(--color-surface)] border border-[var(--color-border)] text-[var(--color-text)] placeholder-[var(--color-text-muted)] focus:outline-none focus:border-[var(--color-primary)]"
          />

          {/* Profile Filter Dropdown */}
          <Select
            value={profileFilter}
            onValueChange={(val) => setProfileFilter(val)}
          >
            <SelectTrigger
              data-testid="agent-hub-profile-filter"
              aria-label="Filter by host profile"
              className="h-7 w-auto min-w-[130px] rounded border border-[var(--color-border)] bg-[var(--color-surface)] px-2 py-1 text-xs text-[var(--color-text)]"
            >
              <SelectValue placeholder="All Hosts" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All Hosts ({profileLabels.size})</SelectItem>
              {Array.from(profileLabels.entries()).map(([pId, label]) => (
                <SelectItem key={pId} value={pId}>
                  {label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>

          {/* Harness Filter Dropdown */}
          <Select
            value={harnessFilter}
            onValueChange={(val) =>
              setHarnessFilter(val as "OMP" | "Codex" | "Claude" | "all")
            }
          >
            <SelectTrigger
              data-testid="agent-hub-harness-filter"
              aria-label="Filter by agent harness"
              className="h-7 w-auto min-w-[120px] rounded border border-[var(--color-border)] bg-[var(--color-surface)] px-2 py-1 text-xs text-[var(--color-text)]"
            >
              <SelectValue placeholder="All Harnesses" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All Harnesses</SelectItem>
              <SelectItem value="OMP">OMP</SelectItem>
              <SelectItem value="Codex">Codex</SelectItem>
              <SelectItem value="Claude">Claude</SelectItem>
            </SelectContent>
          </Select>
        </div>

        {/* Blocked Jump / Warning Notice */}
        {feedbackNotice && (
          <div
            data-testid="agent-hub-feedback-notice"
            className="p-2 rounded bg-amber-500/10 border border-amber-500/30 text-amber-500 flex items-center justify-between text-xs"
          >
            <span>{feedbackNotice}</span>
            <button
              type="button"
              onClick={() => setFeedbackNotice(null)}
              className="text-amber-500 hover:text-white px-1"
            >
              ✕
            </button>
          </div>
        )}
      </div>

      {/* Agents Roster Body */}
      <div className="flex-1 overflow-y-auto p-3 flex flex-col gap-4">
        {filteredItems.length === 0 ? (
          <div
            data-testid="agent-hub-empty-state"
            className="flex-1 flex flex-col items-center justify-center p-8 text-center text-[var(--color-text-muted)] gap-2"
          >
            <span className="text-2xl">🤖</span>
            <span className="font-medium text-sm">No agent sessions found</span>
            <span className="text-xs max-w-sm">
              {searchQuery || urgencyFilter !== "all" || profileFilter !== "all"
                ? "Try adjusting your search filters or urgency selection."
                : "Launch an agent in a terminal or run a recipe to see active agents."}
            </span>
          </div>
        ) : (
          AGENT_HUB_URGENCY_ORDER.map((urgencyKey) => {
            const list = groupedItems[urgencyKey];
            if (list.length === 0) return null;

            return (
              <div
                key={urgencyKey}
                data-testid={`agent-hub-group-${urgencyKey}`}
                className="flex flex-col gap-2"
              >
                {/* Group Section Header */}
                <div className="flex items-center gap-2 pb-1 border-b border-[var(--color-border)]">
                  <span className="font-semibold text-xs tracking-wide uppercase text-[var(--color-text-muted)]">
                    {AGENT_HUB_URGENCY_LABELS[urgencyKey]}
                  </span>
                  <span className="px-1.5 py-0.2 rounded-full text-[10px] bg-[var(--color-surface-hover)] text-[var(--color-text-muted)] border border-[var(--color-border)] font-mono">
                    {list.length}
                  </span>
                </div>

                {/* Group Item Cards */}
                <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-2.5">
                  {list.map((item) => {
                    const isUrgent = item.urgency === "needs-attention";
                    return (
                      <div
                        key={item.key}
                        data-testid={`agent-hub-card-${item.key}`}
                        data-agent-key={item.key}
                        className={`p-3 rounded-lg border flex flex-col justify-between gap-2.5 transition-all bg-[var(--color-bg)] ${
                          isUrgent
                            ? "border-amber-500/50 shadow-sm shadow-amber-500/5"
                            : "border-[var(--color-border)] hover:border-[var(--color-border-hover)]"
                        }`}
                      >
                        {/* Card Top: Harness & Status Badges */}
                        <div className="flex items-start justify-between gap-2">
                          <div className="flex items-center gap-1.5 flex-wrap">
                            <span className="px-1.5 py-0.5 rounded font-mono font-bold text-[10px] bg-[var(--color-surface-hover)] border border-[var(--color-border)] text-[var(--color-primary)]">
                              {item.harnessLabel}
                            </span>
                            <span
                              className={`px-1.5 py-0.5 rounded text-[10px] font-medium border ${
                                item.urgency === "needs-attention"
                                  ? "bg-amber-500/20 text-amber-500 border-amber-500/40"
                                  : item.urgency === "working"
                                    ? "bg-blue-500/20 text-blue-400 border-blue-500/40"
                                    : item.urgency === "idle"
                                      ? "bg-emerald-500/20 text-emerald-400 border-emerald-500/40"
                                      : "bg-gray-500/20 text-gray-400 border-gray-500/40"
                              }`}
                            >
                              {item.presentation.label}
                              {item.presentation.reasonLabel &&
                                ` (${item.presentation.reasonLabel})`}
                            </span>
                            {item.presentation.outcomeHint && (
                              <span className="text-[10px] text-emerald-400/80">
                                {item.presentation.outcomeHint}
                              </span>
                            )}
                          </div>

                          <span className="text-[10px] text-[var(--color-text-muted)] truncate max-w-[120px] font-mono">
                            {item.profileLabel}
                          </span>
                        </div>

                        {/* Card Body: Title & Context */}
                        <div className="flex flex-col gap-0.5">
                          <span
                            className={`font-semibold text-xs truncate ${
                              isCognitoActive ? "blur-sm select-none" : ""
                            }`}
                            title={isCognitoActive ? undefined : item.terminalTitle}
                          >
                            {isCognitoActive ? "[Protected Agent]" : item.terminalTitle}
                          </span>
                          <span
                            className={`text-[11px] text-[var(--color-text-muted)] truncate ${
                              isCognitoActive ? "blur-sm select-none" : ""
                            }`}
                          >
                            {isCognitoActive ? "[Protected Project]" : item.projectLabel}
                          </span>
                        </div>

                        {/* Card Footer: Action Buttons */}
                        <div className="flex items-center justify-end gap-1.5 pt-1 border-t border-[var(--color-border)]/50">
                          <button
                            type="button"
                            data-testid={`agent-hub-review-${item.key}`}
                            onClick={() => handleReview(item)}
                            className="px-2 py-1 rounded bg-[var(--color-surface)] hover:bg-[var(--color-surface-hover)] text-[var(--color-text)] border border-[var(--color-border)] text-[11px] transition-colors"
                          >
                            Review
                          </button>

                          <button
                            type="button"
                            data-testid={`agent-hub-jump-${item.key}`}
                            onClick={() => handleJump(item)}
                            className="px-2.5 py-1 rounded bg-[var(--color-primary)] text-white hover:opacity-90 font-medium text-[11px] transition-opacity flex items-center gap-1"
                          >
                            Jump ➔
                          </button>
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>
            );
          })
        )}
      </div>
    </div>
  );
}
