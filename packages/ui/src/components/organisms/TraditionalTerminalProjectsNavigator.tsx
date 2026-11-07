import { useId, useMemo, useRef, useState } from "react";
import { ChevronDown, ChevronRight, Plus } from "lucide-react";
import { Link } from "react-router-dom";
import { TraditionalTerminalAgentGroupRow } from "@/components/molecules/traditional-terminal-agent-group-row.js";
import { TraditionalTerminalAgentFilter } from "@/components/molecules/traditional-terminal-agent-filter.js";
import { groupTraditionalTerminalAgentRows } from "@/lib/traditional-terminal-agent-groups.js";
import {
  countTraditionalTerminalAgentsByStatus,
  filterTraditionalTerminalAgentRows,
  formatTraditionalAgentStatusFilter,
  loadTraditionalTerminalAgentFilter,
  saveTraditionalTerminalAgentFilter,
  type TraditionalAgentStatusSelection,
} from "@/lib/traditional-terminal-agent-filter.js";
import type { TraditionalTerminalAgentRow as TraditionalTerminalAgentRowModel } from "@/lib/traditional-terminal-agents.js";
import type { TraditionalTerminalProjectGroup } from "@/lib/traditional-terminal-projects.js";
import { TraditionalTerminalProjectWorkspaceRow } from "@/components/organisms/TraditionalTerminalProjectWorkspaceRow.js";
import { OpenProjectWorkspacePicker } from "@/components/organisms/OpenProjectWorkspacePicker.js";
import type { AggregatedProjectItem } from "@/hooks/use-aggregated-projects.js";
import type { OpenWorkspaceRef } from "@/lib/agent-hub-open-workspaces.js";
import type { IntentPayloadMap } from "@/os/intents.js";
import { cn } from "@/lib/utils.js";
import { useSettingsStore } from "@/stores/settings.js";

interface ProfileProjectSection {
  profileId: string;
  profileName: string;
  groups: TraditionalTerminalProjectGroup[];
}

export interface TraditionalTerminalProjectsNavigatorProps {
  groups?: readonly TraditionalTerminalProjectGroup[];
  activeGroupId?: string | null;
  onSelectGroup?: (groupId: string) => void;
  onNewTerminal?: () => void;
  width?: number;
  className?: string;
  touchOptimized?: boolean;
  readonly agentRows?: readonly TraditionalTerminalAgentRowModel[];
  readonly activeSessionId?: string | null;
  readonly onSelectAgent?: (sessionId: string) => void;
  readonly agentSettingsHref?: string;
  disclosedGroupIds?: ReadonlySet<string>;
  onToggleDisclosure?: (groupId: string) => void;
  onNewTerminalInGroup?: (groupId: string) => void;
  onCloseWorkspace?: (groupId: string) => void;
  onOpenFile?: (payload: IntentPayloadMap["file:open"]) => void;
  picker?: {
    items: readonly AggregatedProjectItem[];
    openGroupIds: ReadonlySet<string>;
    isLoading: boolean;
    onOpen: (ref: OpenWorkspaceRef) => void;
  };
}

export function TraditionalTerminalProjectsNavigator({
  groups = [],
  activeGroupId = null,
  onSelectGroup = () => {},
  onNewTerminal,
  width,
  className,
  touchOptimized = false,
  agentRows = [],
  activeSessionId,
  onSelectAgent,
  agentSettingsHref,
  disclosedGroupIds,
  onToggleDisclosure,
  onNewTerminalInGroup,
  onCloseWorkspace,
  onOpenFile,
  picker,
}: TraditionalTerminalProjectsNavigatorProps) {
  const projectsHeadingId = useId();
  const agentsHeadingId = useId();
  const [selectedFilter, setSelectedFilter] =
    useState<TraditionalAgentStatusSelection>(() =>
      loadTraditionalTerminalAgentFilter(),
    );
  const agentCounts = useMemo(
    () => countTraditionalTerminalAgentsByStatus(agentRows),
    [agentRows],
  );
  const filteredAgentRows = useMemo(
    () => filterTraditionalTerminalAgentRows(agentRows, selectedFilter),
    [agentRows, selectedFilter],
  );
  const agentGroups = useMemo(
    () => groupTraditionalTerminalAgentRows(filteredAgentRows),
    [filteredAgentRows],
  );

  function handleFilterChange(next: TraditionalAgentStatusSelection) {
    setSelectedFilter(next);
    saveTraditionalTerminalAgentFilter(next);
  }
  const buttonRefs = useRef(new Map<string, HTMLButtonElement>());
  const showCommitStatus = useSettingsStore(
    (state) => state.terminalCommitStatusEnabled,
  );

  const profileSections = useMemo<ProfileProjectSection[]>(() => {
    const sectionsMap = new Map<string, ProfileProjectSection>();
    for (const group of groups) {
      const pid = group.profileId ?? "default";
      let section = sectionsMap.get(pid);
      if (!section) {
        const pName =
          group.profileName ||
          (pid === "default" ? "Local" : pid);
        section = {
          profileId: pid,
          profileName: pName,
          groups: [],
        };
        sectionsMap.set(pid, section);
      }
      section.groups.push(group);
    }
    return Array.from(sectionsMap.values());
  }, [groups]);

  const [collapsedProfiles, setCollapsedProfiles] = useState<Set<string>>(
    () => new Set(),
  );

  const toggleProfileCollapse = (profileId: string) => {
    setCollapsedProfiles((prev) => {
      const next = new Set(prev);
      if (next.has(profileId)) {
        next.delete(profileId);
      } else {
        next.add(profileId);
      }
      return next;
    });
  };

  const visibleGroups = useMemo(() => {
    return profileSections.flatMap((section) =>
      collapsedProfiles.has(section.profileId) ? [] : section.groups,
    );
  }, [profileSections, collapsedProfiles]);

  function focusGroup(index: number) {
    const group = visibleGroups[index];
    if (!group) return;
    onSelectGroup(group.id);
    buttonRefs.current.get(group.id)?.focus();
  }

  function handleKeyDown(
    event: React.KeyboardEvent<HTMLButtonElement>,
    visibleIndex: number,
  ) {
    let nextIndex: number | null = null;
    if (event.key === "ArrowDown") nextIndex = (visibleIndex + 1) % visibleGroups.length;
    if (event.key === "ArrowUp")
      nextIndex = (visibleIndex - 1 + visibleGroups.length) % visibleGroups.length;
    if (event.key === "Home") nextIndex = 0;
    if (event.key === "End") nextIndex = visibleGroups.length - 1;
    if (nextIndex === null || visibleGroups.length === 0) return;
    event.preventDefault();
    focusGroup(nextIndex);
  }

  return (
    <nav
      aria-label="Terminal projects and agents"
      style={width ? { width } : undefined}
      className={cn(
        "flex min-h-0 w-56 shrink-0 flex-col border-r border-[var(--color-border)] bg-[var(--color-surface)]",
        touchOptimized && "w-full border-r-0",
        className,
      )}
    >
      <section aria-labelledby={projectsHeadingId} className="flex min-h-0 flex-1 flex-col">
        <div className="flex shrink-0 items-center justify-between border-b border-[var(--color-border)] px-4 py-3">
          <h2
            id={projectsHeadingId}
            className="text-2xs font-semibold lowercase tracking-wide text-[var(--color-text-muted)]"
          >
            {groups.length > 0 ? `projects (${groups.length})` : "projects"}
          </h2>
          <div className="flex items-center gap-1">
            {picker ? (
              <OpenProjectWorkspacePicker
                items={picker.items}
                openGroupIds={picker.openGroupIds}
                isLoading={picker.isLoading}
                onOpen={picker.onOpen}
                touchOptimized={touchOptimized}
              />
            ) : null}
            {onNewTerminal ? (
              <button
                type="button"
                aria-label="New terminal in selected project"
                title="New terminal in selected project"
                onClick={onNewTerminal}
                className={cn(
                  "flex h-8 w-8 items-center justify-center rounded text-[var(--color-text-muted)] hover:bg-[var(--color-surface-2)] hover:text-[var(--color-text)] focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-[var(--color-primary)]",
                  touchOptimized && "min-h-11 min-w-11",
                )}
              >
                <Plus className="h-4 w-4" aria-hidden="true" />
              </button>
            ) : null}
          </div>
        </div>
        <div
          role="tablist"
          aria-label="Open terminal projects"
          aria-orientation="vertical"
          className="min-h-0 flex-1 overflow-y-auto py-1"
        >
          {profileSections.map((section) => {
            const isExpanded = !collapsedProfiles.has(section.profileId);
            const sectionId = `profile-section-${section.profileId}`;
            const headerId = `profile-header-${section.profileId}`;

            return (
              <div key={section.profileId} className="flex flex-col">
                <button
                  id={headerId}
                  type="button"
                  aria-expanded={isExpanded}
                  aria-controls={sectionId}
                  aria-label={`Server profile: ${section.profileName}`}
                  onClick={() => toggleProfileCollapse(section.profileId)}
                  className={cn(
                    "flex w-full items-center gap-1.5 px-3 py-1.5 text-left text-xs font-semibold text-[var(--color-text-muted)] hover:bg-[var(--color-surface-2)]/50 hover:text-[var(--color-text)] transition-colors select-none",
                    touchOptimized && "min-h-11",
                  )}
                >
                  {isExpanded ? (
                    <ChevronDown className="h-3.5 w-3.5 shrink-0 opacity-70" aria-hidden="true" />
                  ) : (
                    <ChevronRight className="h-3.5 w-3.5 shrink-0 opacity-70" aria-hidden="true" />
                  )}
                  <span className="min-w-0 truncate font-mono text-xs">{section.profileName}</span>
                  <span className="ml-auto shrink-0 rounded-full px-1.5 py-0.5 text-[10px] font-mono text-[var(--color-text-muted)] bg-[var(--color-surface-2)]">
                    {section.groups.length}
                  </span>
                </button>
                {isExpanded ? (
                  <div id={sectionId} role="group" aria-labelledby={headerId} className="flex flex-col">
                    {section.groups.map((group) => {
                      const visibleIndex = visibleGroups.findIndex((g) => g.id === group.id);
                      return (
                        <TraditionalTerminalProjectWorkspaceRow
                          key={group.id}
                          group={group}
                          index={visibleIndex >= 0 ? visibleIndex : 0}
                          isActive={group.id === activeGroupId}
                          activeGroupId={activeGroupId}
                          onSelectGroup={onSelectGroup}
                          onKeyDown={handleKeyDown}
                          setButtonRef={(groupId, element) => {
                            if (element) buttonRefs.current.set(groupId, element);
                            else buttonRefs.current.delete(groupId);
                          }}
                          showCommitStatus={showCommitStatus}
                          touchOptimized={touchOptimized}
                          isDisclosed={disclosedGroupIds?.has(group.id) ?? false}
                          onToggleDisclosure={onToggleDisclosure}
                          onNewTerminalInGroup={onNewTerminalInGroup}
                          onCloseWorkspace={onCloseWorkspace}
                          onOpenFile={onOpenFile}
                        />
                      );
                    })}
                  </div>
                ) : null}
              </div>
            );
          })}
        </div>
      </section>
      <section aria-labelledby={agentsHeadingId} className="flex min-h-0 flex-1 flex-col border-t border-[var(--color-border)]">
        <div className="flex shrink-0 flex-wrap items-center justify-between gap-x-2 border-b border-[var(--color-border)] px-4 py-2">
          <h2 id={agentsHeadingId} className="text-2xs font-semibold lowercase tracking-wide text-[var(--color-text-muted)]">
            agents
          </h2>
          {agentSettingsHref ? (
            <Link
              to={agentSettingsHref}
              className="inline-flex min-h-11 min-w-11 items-center rounded px-2 text-xs text-[var(--color-text-muted)] hover:bg-[var(--color-surface-2)] hover:text-[var(--color-text)] focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-[var(--color-primary)]"
            >
              Agent Settings
            </Link>
          ) : null}
        </div>
        <div className="w-full shrink-0 border-b border-[var(--color-border)] p-2">
          <TraditionalTerminalAgentFilter
            value={selectedFilter}
            onValueChange={handleFilterChange}
            counts={agentCounts}
            touchOptimized={touchOptimized}
          />
        </div>
        <fieldset disabled={!onSelectAgent} className="m-0 min-h-0 min-w-0 flex-1 overflow-y-auto border-0 p-0">
          {agentGroups.length ? (
            <ul aria-label="Observed agents in open terminals" className="py-1">
              {agentGroups.map((group) => (
                <li key={group.key}>
                  <TraditionalTerminalAgentGroupRow
                    group={group}
                    activeSessionId={activeSessionId}
                    onSelectAgent={(sessionId) => onSelectAgent?.(sessionId)}
                    touchOptimized={touchOptimized}
                  />
                </li>
              ))}
            </ul>
          ) : agentRows.length === 0 ? (
            <p className="px-4 py-3 text-xs leading-relaxed text-[var(--color-text-muted)]">
              No observed agents in open terminals. OMP, Codex and Claude appear after supported integrations report status.
            </p>
          ) : (
            <p role="status" className="px-4 py-3 text-xs leading-relaxed text-[var(--color-text-muted)]">
              No observed agents match {formatTraditionalAgentStatusFilter(selectedFilter)}.
            </p>
          )}
        </fieldset>
      </section>
    </nav>
  );
}
