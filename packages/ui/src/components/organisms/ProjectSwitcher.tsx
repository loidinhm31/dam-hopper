import { Folder } from "lucide-react";
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectLabel,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/Select.js";
import { useWorkspaceStore } from "@/stores/workspace.js";
import { useAggregatedProjects } from "@/hooks/use-aggregated-projects.js";
import { projectKey, parseProjectKey } from "@/api/ownership.js";
import { cn } from "@/lib/utils.js";

interface ProjectSwitcherProps {
  className?: string;
}

export function ProjectSwitcher({ className }: ProjectSwitcherProps) {
  const { selectedProject, setSelectedProject } = useWorkspaceStore();
  const { groups, allProjects } = useAggregatedProjects();

  const currentTupleKey = selectedProject ? projectKey(selectedProject) : "";
  const isSelectedProjectAvailable = selectedProject
    ? allProjects.some(
        (p) =>
          p.ref.profileId === selectedProject.profileId &&
          p.ref.project === selectedProject.project,
      )
    : false;

  const compactTextClass = "text-[length:calc(var(--app-font-size)*0.75)]";

  return (
    <div className={cn("flex items-center gap-1.5 min-w-0 flex-1", className)}>
      <Folder className="h-4 w-4 shrink-0 text-[var(--color-primary)] opacity-80" />
      <Select
        value={currentTupleKey || undefined}
        onValueChange={(val) => {
          const parsed = parseProjectKey(val);
          if (parsed) setSelectedProject(parsed);
        }}
      >
        <SelectTrigger
          className={cn(
            "min-w-0 h-8 font-bold px-2 glass-input font-sans tracking-tight flex-1",
            compactTextClass,
            "w-[96px] sm:w-[132px] md:w-[156px] lg:w-[180px]",
          )}
        >
          <div className="truncate text-left flex-1">
            <SelectValue placeholder="Select project" />
          </div>
        </SelectTrigger>
        <SelectContent className="min-w-[220px]">
          {groups.length === 0 || allProjects.length === 0 ? (
            <div className="p-3 text-xs text-[var(--color-text-muted)] text-center">
              No projects discovered
            </div>
          ) : (
            groups.map((group) => {
              if (group.projects.length === 0) return null;
              return (
                <SelectGroup key={group.profile.id}>
                  <SelectLabel className="text-[10px] font-semibold tracking-wider text-[var(--color-text-muted)] uppercase px-2 py-1 bg-[var(--color-surface-2)]/50 flex flex-col">
                    <span>{group.profile.name}</span>
                    <span className="text-[9px] font-mono normal-case text-[var(--color-text-muted)]/70">
                      {group.serverUrl}
                    </span>
                  </SelectLabel>
                  {group.projects.map((p) => {
                    const tupleKey = projectKey({
                      profileId: group.profile.id,
                      project: p.name,
                    });
                    return (
                      <SelectItem
                        key={tupleKey}
                        value={tupleKey}
                        className="text-xs"
                      >
                        <div className="flex flex-col min-w-0">
                          <span className="font-medium truncate">{p.name}</span>
                          {p.path && (
                            <span className="text-[10px] text-[var(--color-text-muted)] font-mono truncate">
                              {p.path}
                            </span>
                          )}
                        </div>
                      </SelectItem>
                    );
                  })}
                </SelectGroup>
              );
            })
          )}
        </SelectContent>
      </Select>
    </div>
  );
}
