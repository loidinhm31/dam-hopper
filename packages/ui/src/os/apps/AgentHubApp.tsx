import {
  useState,
  useMemo,
  useCallback,
  type ReactElement,
} from "react";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/Select.js";
import type { OsWindow } from "../types.js";
import { useWindowStore } from "../window-store.js";
import { dispatchIntent, createIntent } from "../intents.js";
import { useAggregatedTerminalSessions } from "@/hooks/use-aggregated-terminal-sessions.js";
import { useAggregatedProjects } from "@/hooks/use-aggregated-projects.js";
import { useAgentStatusStore } from "@/stores/agent-status.js";
import {
  getAllConnectionSnapshots,
  getConnectionSnapshot,
  getApi,
  type ConnectionSnapshot,
} from "@/api/connections.js";
import { useCognitoModeStore } from "@/stores/cognito-mode.js";
import {
  buildAgentHubItems,
  computeAgentHubSummary,
  filterAgentHubItems,
  findMatchingTerminalWindow,
  createTerminalPlacementIntent,
  type AgentHubItem,
  type AgentHubUrgency,
  type AgentHubFilterScope,
  AGENT_HUB_URGENCY_ORDER,
  AGENT_HUB_URGENCY_LABELS,
} from "../agent-hub.js";
import { terminalKey, type TerminalRef } from "@/api/ownership.js";
import { buildTraditionalTerminalProjectGroups } from "@/lib/traditional-terminal-projects.js";
import type { DisplayTabEntry } from "@/components/organisms/TerminalTabBar.js";
import type { MountedSession } from "@/components/organisms/MultiTerminalDisplay.js";
import { SessionChangesClient } from "@/api/session-changes-client.js";
import type { ReviewTarget } from "@/api/terminal-session-contract.js";

export interface AgentHubAppProps {
  window: OsWindow;
}

export function AgentHubApp({ window }: AgentHubAppProps): ReactElement {
  const isCognitoActive = useCognitoModeStore((state) => state.active);
  const session = useWindowStore((state) => state.session);
  const focusWindow = useWindowStore((state) => state.focusWindow);
  const restoreWindow = useWindowStore((state) => state.restoreWindow);
  const switchDesktop = useWindowStore((state) => state.switchDesktop);

  const [scopeFilter, setScopeFilter] = useState<AgentHubFilterScope>("all");
  const [urgencyFilter, setUrgencyFilter] = useState<AgentHubUrgency | "all">("all");
  const [profileFilter, setProfileFilter] = useState<string | "all">("all");
  const [harnessFilter, setHarnessFilter] = useState<"OMP" | "Codex" | "Claude" | "all">("all");
  const [searchQuery, setSearchQuery] = useState("");
  const [feedbackNotice, setFeedbackNotice] = useState<string | null>(null);

  const { sessions: rawSessions = [] } = useAggregatedTerminalSessions();
  const { allProjects = [] } = useAggregatedProjects();
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
          startedAt: s.startedAt ?? 0,
        },
      });
    }

    return buildTraditionalTerminalProjectGroups(mounted, tabs);
  }, [rawSessions]);

  // Build inventory-first Agent Hub items
  const items = useMemo(() => {
    return buildAgentHubItems({
      groups,
      profiles: statusProfiles,
      connections: connectionsMap,
      profileLabels,
      sessions: rawSessions,
      windows: session.windows,
    });
  }, [groups, statusProfiles, connectionsMap, profileLabels, rawSessions, session.windows]);

  // Summary counts
  const summary = useMemo(() => {
    return computeAgentHubSummary(items, connectionsMap);
  }, [items, connectionsMap]);

  // Filtered items
  const filteredItems = useMemo(() => {
    return filterAgentHubItems(items, {
      scope: scopeFilter,
      urgency: urgencyFilter,
      profileId: profileFilter,
      harness: harnessFilter,
      searchQuery,
    });
  }, [items, scopeFilter, urgencyFilter, profileFilter, harnessFilter, searchQuery]);

  // Group filtered items by urgency
  const groupedItems = useMemo(() => {
    const groupsMap: Record<AgentHubUrgency, AgentHubItem[]> = {
      "needs-attention": [],
      working: [],
      idle: [],
      unavailable: [],
      unobserved: [],
    };
    for (const item of filteredItems) {
      groupsMap[item.urgency].push(item);
    }
    return groupsMap;
  }, [filteredItems]);

  // Handle jump / placement intent
  const handleJump = useCallback(
    (item: AgentHubItem) => {
      setFeedbackNotice(null);

      // Check if target is valid
      if (!item.terminationTarget) {
        setFeedbackNotice("Jump blocked: Terminal target is unavailable or invalid.");
        return;
      }

      const conn = connectionsMap.get(item.profileId);
      if (!conn || conn.status !== "connected") {
        setFeedbackNotice(
          `Jump blocked: Target profile "${item.profileLabel}" is disconnected or unavailable.`,
        );
        return;
      }

      if (conn.owner.generation !== item.terminationTarget.generation) {
        setFeedbackNotice(
          `Jump blocked: Target profile "${item.profileLabel}" generation changed.`,
        );
        return;
      }

      const matchingWin =
        item.matchingWindow ??
        findMatchingTerminalWindow(item.terminationTarget, session.windows);

      if (matchingWin) {
        // Window already exists
        if (matchingWin.desktopId === session.activeDesktopId) {
          // Same desktop: restore if minimized, then focus
          if (matchingWin.minimized) {
            restoreWindow(matchingWin.windowId);
          }
          focusWindow(matchingWin.windowId);
          dispatchIntent(
            createIntent(
              "terminal:place-existing",
              createTerminalPlacementIntent(
                window.id,
                item.terminationTarget,
                "focus-existing",
              ),
              window.id,
            ),
          );
        } else {
          // Other desktop: switch desktop and focus, or emit move-beside
          switchDesktop(matchingWin.desktopId);
          if (matchingWin.minimized) {
            restoreWindow(matchingWin.windowId);
          }
          focusWindow(matchingWin.windowId);
          dispatchIntent(
            createIntent(
              "terminal:place-existing",
              createTerminalPlacementIntent(
                window.id,
                item.terminationTarget,
                "focus-existing",
              ),
              window.id,
            ),
          );
        }
      } else {
        // Background session: no open window anywhere on any desktop
        // Emit frozen placement intent with action "open-beside"
        dispatchIntent(
          createIntent(
            "terminal:place-existing",
            createTerminalPlacementIntent(
              window.id,
              item.terminationTarget,
              "open-beside",
            ),
            window.id,
          ),
        );
      }
    },
    [
      connectionsMap,
      focusWindow,
      restoreWindow,
      session.activeDesktopId,
      session.windows,
      switchDesktop,
      window.id,
    ],
  );

  // Handle Review affordance (Architecture Contract C3 & Task 2)
  const handleReview = useCallback(
    async (item: AgentHubItem) => {
      setFeedbackNotice(null);

      // Verify exact agent evidence join
      if (!item.isAgent || !item.status || !item.terminationTarget) {
        setFeedbackNotice(
          "Review unavailable: Agent evidence proof missing or unsafe numeric incarnation.",
        );
        return;
      }

      const snap = getConnectionSnapshot(item.profileId);
      if (!snap || snap.status !== "connected") {
        setFeedbackNotice(
          `Review unavailable: Target profile "${item.profileLabel}" is disconnected.`,
        );
        return;
      }

      if (snap.owner.generation !== item.terminationTarget.generation) {
        setFeedbackNotice(
          `Review unavailable: Target profile generation changed (expected ${item.terminationTarget.generation}, live ${snap.owner.generation}).`,
        );
        return;
      }

      const client = getApi(snap.owner);

      try {
        const config = await client.config.get();
        if (!config?.server?.sessionChangesEnabled) {
          setFeedbackNotice(
            "Review unavailable: Session changes tracking is disabled on server. Enable it in Server Settings.",
          );
          return;
        }

        const scClient = new SessionChangesClient({ apiClient: client });
        const status = await scClient.getStatus({
          terminalId: item.terminationTarget.terminalId,
          terminalIncarnation: item.terminationTarget.incarnation,
          ompSessionId: item.status.agentSessionId ?? "",
        });

        // Recheck currency post-await
        const postSnap = getConnectionSnapshot(item.profileId);
        if (
          !postSnap ||
          postSnap.status !== "connected" ||
          postSnap.owner.generation !== item.terminationTarget.generation
        ) {
          setFeedbackNotice(
            "Review unavailable: Connection retired or changed during status resolution.",
          );
          return;
        }

        // Exact terminal incarnation comparison
        if (status.terminalIncarnation !== item.terminationTarget.incarnation) {
          setFeedbackNotice(
            `Review unavailable: Incarnation mismatch (status ${status.terminalIncarnation}, target ${item.terminationTarget.incarnation}).`,
          );
          return;
        }

        if (status.state === "initializing") {
          setFeedbackNotice(
            "Review unavailable: Session changes is currently initializing for this session.",
          );
          return;
        }

        if (!status.rootId || !status.baselineId) {
          setFeedbackNotice(
            "Review unavailable: No session changes baseline has been established yet.",
          );
          return;
        }

        if (!status.serverEpoch) {
          setFeedbackNotice(
            "Review unavailable: Missing server epoch in session changes status.",
          );
          return;
        }

        const reviewTarget: ReviewTarget = Object.freeze({
          profileId: item.terminationTarget.profileId,
          generation: item.terminationTarget.generation,
          terminalId: item.terminationTarget.terminalId,
          terminalIncarnation: item.terminationTarget.incarnation,
          ompSessionId: item.status.agentSessionId ?? "",
          serverEpoch: status.serverEpoch,
          rootId: status.rootId,
          baselineId: status.baselineId,
        });

        dispatchIntent(
          createIntent("session-changes:open", reviewTarget, window.id),
        );
      } catch (err: unknown) {
        const msg = err instanceof Error ? err.message : String(err);
        setFeedbackNotice(`Review unavailable: ${msg}`);
      }
    },
    [window.id],
  );

  // Handle Open Recipes affordance
  const handleOpenRecipes = () => {
    dispatchIntent(createIntent("recipes:open", {}, window.id));
  };

  return (
    <div
      data-os-agent-hub={window.id}
      data-testid={`agent-hub-app-${window.id}`}
      className="w-full h-full overflow-hidden flex flex-col bg-[var(--color-surface)] text-[var(--color-text)] select-none text-xs"
    >
      {/* App Header & KPI Badges */}
      <div className="flex flex-col gap-2 p-3 border-b border-[var(--color-border)] bg-[var(--color-bg)]">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <span className="text-base font-bold flex items-center gap-1.5 text-[var(--color-primary)]">
              🤖 Agent Hub
            </span>
            <span className="text-[10px] px-1.5 py-0.5 rounded bg-[var(--color-surface-hover)] text-[var(--color-text-muted)] border border-[var(--color-border)]">
              {summary.total} sessions ({summary.agentsCount} agents,{" "}
              {summary.backgroundCount} background, {summary.connectedProfiles}/
              {summary.totalProfiles} connected hosts)
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

        {/* Scope and Urgency Pill Filter Bar */}
        <div className="flex items-center gap-1.5 overflow-x-auto pb-1">
          {/* Primary Scope Filters (All / Agents / Background) */}
          <button
            type="button"
            data-testid="agent-hub-filter-all"
            onClick={() => {
              setScopeFilter("all");
              setUrgencyFilter("all");
            }}
            className={`px-2 py-0.5 rounded-full text-xs transition-colors flex items-center gap-1 border ${
              scopeFilter === "all" && urgencyFilter === "all"
                ? "bg-[var(--color-primary)] text-white border-[var(--color-primary)]"
                : "bg-[var(--color-surface)] text-[var(--color-text)] border-[var(--color-border)] hover:bg-[var(--color-surface-hover)]"
            }`}
          >
            All <span className="opacity-80">({summary.total})</span>
          </button>

          <button
            type="button"
            data-testid="agent-hub-filter-agents"
            onClick={() => setScopeFilter("agents")}
            className={`px-2 py-0.5 rounded-full text-xs transition-colors flex items-center gap-1 border ${
              scopeFilter === "agents"
                ? "bg-[var(--color-primary)] text-white border-[var(--color-primary)]"
                : "bg-[var(--color-surface)] text-[var(--color-text)] border-[var(--color-border)] hover:bg-[var(--color-surface-hover)]"
            }`}
          >
            Agents <span className="opacity-80">({summary.agentsCount})</span>
          </button>

          <button
            type="button"
            data-testid="agent-hub-filter-background"
            onClick={() => setScopeFilter("background")}
            className={`px-2 py-0.5 rounded-full text-xs transition-colors flex items-center gap-1 border ${
              scopeFilter === "background"
                ? "bg-[var(--color-primary)] text-white border-[var(--color-primary)]"
                : "bg-[var(--color-surface)] text-[var(--color-text)] border-[var(--color-border)] hover:bg-[var(--color-surface-hover)]"
            }`}
          >
            Background{" "}
            <span className="opacity-80">({summary.backgroundCount})</span>
          </button>

          <span className="h-4 w-px bg-[var(--color-border)] mx-1" />

          {/* Urgency Filters */}
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

        {/* Search and Filters Bar */}
        <div className="flex items-center gap-2 pt-1 text-xs">
          <input
            type="text"
            data-testid="agent-hub-search-input"
            placeholder="Search sessions by title, project, host, reason..."
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

        {/* Feedback / Blocked Notice */}
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

      {/* Sessions Roster Body */}
      <div className="flex-1 overflow-y-auto p-3 flex flex-col gap-4">
        {filteredItems.length === 0 ? (
          <div
            data-testid="agent-hub-empty-state"
            className="flex-1 flex flex-col items-center justify-center p-8 text-center text-[var(--color-text-muted)] gap-2"
          >
            <span className="text-2xl">🤖</span>
            <span className="font-medium text-sm">No sessions found</span>
            <span className="text-xs max-w-sm">
              {searchQuery ||
              urgencyFilter !== "all" ||
              profileFilter !== "all" ||
              scopeFilter !== "all"
                ? "Try adjusting your search filters or scope selection."
                : "No terminal sessions found in aggregate inventory."}
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
                        {/* Card Top: Badges & Tags */}
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
                                      : item.urgency === "unobserved"
                                        ? "bg-purple-500/10 text-purple-400 border-purple-500/30"
                                        : "bg-gray-500/20 text-gray-400 border-gray-500/40"
                              }`}
                            >
                              {item.presentation.label}
                              {item.presentation.reasonLabel &&
                                ` (${item.presentation.reasonLabel})`}
                            </span>

                            {item.isBackground && (
                              <span
                                data-testid="agent-hub-background-badge"
                                className="px-1.5 py-0.5 rounded text-[10px] bg-sky-500/10 text-sky-400 border border-sky-500/30"
                              >
                                Background
                              </span>
                            )}

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
                            {isCognitoActive ? "[Protected Session]" : item.terminalTitle}
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
                          {/* Review Button */}
                          <button
                            type="button"
                            data-testid={`agent-hub-review-${item.key}`}
                            onClick={() => void handleReview(item)}
                            className="px-2 py-1 rounded bg-[var(--color-surface)] hover:bg-[var(--color-surface-hover)] text-[var(--color-text)] border border-[var(--color-border)] text-[11px] transition-colors"
                          >
                            Review
                          </button>

                          {/* Jump / Placement Button */}
                          <button
                            type="button"
                            data-testid={`agent-hub-jump-${item.key}`}
                            onClick={() => handleJump(item)}
                            className="px-2.5 py-1 rounded bg-[var(--color-primary)] text-white hover:opacity-90 font-medium text-[11px] transition-opacity flex items-center gap-1"
                          >
                            {item.isBackground ? "Open Beside ➔" : "Jump ➔"}
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
