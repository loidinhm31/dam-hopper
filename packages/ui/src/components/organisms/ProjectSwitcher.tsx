import { Folder } from "lucide-react";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/Select.js";
import { useWorkspaceStore } from "@/stores/workspace.js";
import { useQuery } from "@tanstack/react-query";
import { api } from "@/api/client.js";
import { cn } from "@/lib/utils.js";

interface ProjectSwitcherProps {
  className?: string;
}

export function ProjectSwitcher({ className }: ProjectSwitcherProps) {
  const { activeProject, setActiveProject } = useWorkspaceStore();
  const { data: projects = [] } = useQuery({
    queryKey: ["projects"],
    queryFn: () => api.projects.list(),
  });

  const value = activeProject ?? (projects.length > 0 ? projects[0].name : "");
  const compactTextClass = "text-[length:calc(var(--app-font-size)*0.75)]";

  if (projects.length === 0) return null;

  return (
    <div className={cn("flex items-center gap-1.5 min-w-0 flex-1", className)}>
      <Folder className="h-4 w-4 shrink-0 text-[var(--color-primary)] opacity-80" />
      <Select
        value={value}
        onValueChange={(val) => setActiveProject(val)}
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
        <SelectContent className="min-w-[180px]">
          {projects.map((p) => (
            <SelectItem key={p.name} value={p.name}>
              {p.name}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </div>
  );
}
