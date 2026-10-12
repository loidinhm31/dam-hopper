import { useCallback, useId, type JSX } from "react";
import {
  Activity,
  Ban,
  Circle,
  CircleAlert,
  CircleHelp,
  TriangleAlert,
  Unplug,
  type LucideIcon,
} from "lucide-react";
import type { TraditionalAgentStatusLabel } from "@/lib/traditional-terminal-agents.js";
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/Select.js";
import { cn } from "@/lib/utils.js";

export interface TraditionalTerminalAgentFilterProps {
  readonly value: "all" | TraditionalAgentStatusLabel;
  readonly onValueChange: (value: "all" | TraditionalAgentStatusLabel) => void;
  readonly counts: Readonly<Record<"all" | TraditionalAgentStatusLabel, number>>;
  readonly touchOptimized?: boolean;
  readonly className?: string;
}

interface FilterOptionDefinition {
  readonly value: "all" | TraditionalAgentStatusLabel;
  readonly label: string;
  readonly Icon: LucideIcon | null;
  readonly indicatorClassName?: string;
}

const FILTER_OPTIONS: readonly FilterOptionDefinition[] = [
  { value: "all", label: "All statuses", Icon: null },
  { value: "Needs attention", label: "Needs attention", Icon: CircleAlert, indicatorClassName: "text-[var(--color-warning)]" },
  { value: "Working", label: "Working", Icon: Activity, indicatorClassName: "text-[var(--color-info)]" },
  { value: "Idle", label: "Idle", Icon: Circle, indicatorClassName: "text-[var(--color-text)]" },
  { value: "Unknown", label: "Unknown", Icon: CircleHelp, indicatorClassName: "text-[var(--color-text-muted)] border-dashed" },
  { value: "Unavailable", label: "Unavailable", Icon: Unplug, indicatorClassName: "text-[var(--color-text-muted)]" },
  { value: "Platform unqualified", label: "Platform unqualified", Icon: TriangleAlert, indicatorClassName: "text-[var(--color-warning)]" },
  { value: "Unsupported", label: "Unsupported", Icon: Ban, indicatorClassName: "text-[var(--color-text-muted)]" },
];

const VALID_FILTER_VALUES: Readonly<Record<"all" | TraditionalAgentStatusLabel, true>> = {
  all: true,
  "Needs attention": true,
  Working: true,
  Idle: true,
  Unknown: true,
  Unavailable: true,
  "Platform unqualified": true,
  Unsupported: true,
};

function isValidFilterValue(
  value: string,
): value is "all" | TraditionalAgentStatusLabel {
  return Object.hasOwn(VALID_FILTER_VALUES, value);
}

/**
 * Pure controlled status filter dropdown for traditional terminal agents.
 * Renders exactly eight enabled status options with live count badges.
 */
export function TraditionalTerminalAgentFilter({
  value,
  onValueChange,
  counts,
  touchOptimized = false,
  className,
}: TraditionalTerminalAgentFilterProps): JSX.Element {
  const descriptionId = useId();

  const safeValue: "all" | TraditionalAgentStatusLabel = isValidFilterValue(value)
    ? value
    : "all";

  const selectedOption =
    FILTER_OPTIONS.find((opt) => opt.value === safeValue) ?? FILTER_OPTIONS[0]!;
  const selectedCount = counts[safeValue] ?? 0;
  const totalCount = counts.all ?? 0;

  const agentPlural = totalCount === 1 ? "agent" : "agents";
  const descriptionText = `${selectedOption.label}: ${selectedCount} of ${totalCount} observed ${agentPlural}.`;

  const handleValueChange = useCallback(
    (next: string) => {
      if (isValidFilterValue(next)) {
        onValueChange(next);
      }
    },
    [onValueChange],
  );

  const SelectedIcon = selectedOption.Icon;

  return (
    <div className={cn("w-full", className)}>
      <span id={descriptionId} className="sr-only">
        {descriptionText}
      </span>
      <Select value={safeValue} onValueChange={handleValueChange}>
        <SelectTrigger
          aria-label="Filter agents by status"
          aria-describedby={descriptionId}
          className={cn(
            "w-full min-h-11 min-w-0 [&>span]:flex [&>span]:flex-1 [&>span]:min-w-0 [&>span]:items-center [&>span]:justify-between [&>span]:gap-2 [&>span]:line-clamp-none",
            touchOptimized && "min-h-12",
          )}
        >
          <SelectValue>
            <span className="flex w-full min-w-0 items-center justify-between gap-2">
              <span className="flex min-w-0 items-center gap-1.5 truncate">
                {SelectedIcon ? (
                  <SelectedIcon
                    className={cn(
                      "h-3.5 w-3.5 shrink-0",
                      selectedOption.indicatorClassName,
                    )}
                    aria-hidden="true"
                  />
                ) : null}
                <span className="min-w-0 truncate">{selectedOption.label}</span>
              </span>
              <span
                data-testid="agent-filter-count-badge"
                className="inline-flex min-w-5 shrink-0 items-center justify-center rounded-full bg-[var(--color-surface-2)] px-1.5 py-0.5 text-[11px] font-semibold tabular-nums text-[var(--color-text)]"
              >
                {selectedCount}
              </span>
            </span>
          </SelectValue>
        </SelectTrigger>
        <SelectContent
          position="popper"
          className="w-[var(--radix-select-trigger-width)] min-w-[200px]"
        >
          <SelectGroup>
            {FILTER_OPTIONS.map((option) => {
              const count = counts[option.value] ?? 0;
              const Icon = option.Icon;
              const optionPlural = count === 1 ? "agent" : "agents";
              const accessibleOptionLabel = `${option.label}, ${count} ${optionPlural}`;

              return (
                <SelectItem
                  key={option.value}
                  value={option.value}
                  textValue={option.label}
                  aria-label={accessibleOptionLabel}
                  className={cn(
                    "min-h-11 min-w-0 [&>span:last-child]:w-full [&>span:last-child]:min-w-0",
                    touchOptimized && "min-h-12",
                  )}
                >
                  <span className="flex w-full min-w-0 items-center justify-between gap-2">
                    <span className="flex min-w-0 items-center gap-1.5 truncate">
                      {Icon ? (
                        <Icon
                          className={cn(
                            "h-3.5 w-3.5 shrink-0",
                            option.indicatorClassName,
                          )}
                          aria-hidden="true"
                        />
                      ) : null}
                      <span className="min-w-0 truncate">{option.label}</span>
                    </span>
                    <span
                      data-testid="agent-filter-count-badge"
                      className="inline-flex min-w-5 shrink-0 items-center justify-center rounded-full bg-[var(--color-surface-2)] px-1.5 py-0.5 text-[11px] font-semibold tabular-nums text-[var(--color-text)]"
                    >
                      {count}
                    </span>
                  </span>
                </SelectItem>
              );
            })}
          </SelectGroup>
        </SelectContent>
      </Select>
    </div>
  );
}
