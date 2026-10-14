import {
  useCallback,
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
  type JSX,
} from "react";
import {
  Activity,
  Ban,
  Check,
  ChevronDown,
  Circle,
  CircleAlert,
  CircleHelp,
  TriangleAlert,
  Unplug,
  type LucideIcon,
} from "lucide-react";
import type { TraditionalAgentStatusLabel } from "@/lib/traditional-terminal-agents.js";
import {
  normalizeTraditionalAgentStatusFilter,
  type TraditionalAgentStatusCountKey,
  type TraditionalAgentStatusFilter,
  type TraditionalAgentStatusSelection,
  type TraditionalTerminalAgentStatusCounts,
} from "@/lib/traditional-terminal-agent-filter.js";
import { cn } from "@/lib/utils.js";

export type {
  TraditionalAgentStatusCountKey,
  TraditionalAgentStatusFilter,
  TraditionalAgentStatusSelection,
  TraditionalTerminalAgentStatusCounts,
};

export interface TraditionalTerminalAgentFilterProps {
  readonly value: TraditionalAgentStatusFilter;
  readonly onValueChange: (value: TraditionalAgentStatusSelection) => void;
  readonly counts: TraditionalTerminalAgentStatusCounts;
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
  {
    value: "Needs attention",
    label: "Needs attention",
    Icon: CircleAlert,
    indicatorClassName: "text-[var(--color-warning)]",
  },
  {
    value: "Working",
    label: "Working",
    Icon: Activity,
    indicatorClassName: "text-[var(--color-info)]",
  },
  {
    value: "Idle",
    label: "Idle",
    Icon: Circle,
    indicatorClassName: "text-[var(--color-text)]",
  },
  {
    value: "Unknown",
    label: "Unknown",
    Icon: CircleHelp,
    indicatorClassName: "text-[var(--color-text-muted)] border-dashed",
  },
  {
    value: "Unavailable",
    label: "Unavailable",
    Icon: Unplug,
    indicatorClassName: "text-[var(--color-text-muted)]",
  },
  {
    value: "Platform unqualified",
    label: "Platform unqualified",
    Icon: TriangleAlert,
    indicatorClassName: "text-[var(--color-warning)]",
  },
  {
    value: "Unsupported",
    label: "Unsupported",
    Icon: Ban,
    indicatorClassName: "text-[var(--color-text-muted)]",
  },
];

/**
 * Pure controlled accessible multi-select status filter dropdown for traditional terminal agents.
 * Renders exactly eight enabled status options with live count badges, check indicators,
 * summation badge, and full keyboard navigation.
 */
export function TraditionalTerminalAgentFilter({
  value,
  onValueChange,
  counts,
  touchOptimized = false,
  className,
}: TraditionalTerminalAgentFilterProps): JSX.Element {
  const [isOpen, setIsOpen] = useState(false);
  const [activeIndex, setActiveIndex] = useState(0);
  const [placement, setPlacement] = useState<"bottom" | "top">("bottom");
  const [maxListboxHeight, setMaxListboxHeight] = useState<number>(240);
  const wrapperRef = useRef<HTMLDivElement | null>(null);
  const triggerRef = useRef<HTMLButtonElement | null>(null);
  const listboxRef = useRef<HTMLDivElement | null>(null);

  const baseId = useId();
  const listboxId = `${baseId}-listbox`;
  const descriptionId = `${baseId}-desc`;

  const optionIds = useMemo(
    () => FILTER_OPTIONS.map((_, index) => `${baseId}-opt-${index}`),
    [baseId],
  );

  const normalizedSelection = normalizeTraditionalAgentStatusFilter(value);
  const isAll = normalizedSelection === "all";

  // Derive trigger presentation
  let triggerLabel: string;
  let TriggerIcon: LucideIcon | null = null;
  let triggerIndicatorClassName: string | undefined;
  let triggerCount: number;

  if (isAll) {
    triggerLabel = "All statuses";
    TriggerIcon = null;
    triggerCount = counts.all ?? 0;
  } else if (normalizedSelection.length === 1) {
    const singleStatus = normalizedSelection[0]!;
    triggerLabel = singleStatus;
    const optionDef = FILTER_OPTIONS.find((opt) => opt.value === singleStatus);
    TriggerIcon = optionDef?.Icon ?? null;
    triggerIndicatorClassName = optionDef?.indicatorClassName;
    triggerCount = counts[singleStatus] ?? 0;
  } else {
    triggerLabel = normalizedSelection.join(", ");
    TriggerIcon = null;
    triggerCount = normalizedSelection.reduce(
      (sum, label) => sum + (counts[label] ?? 0),
      0,
    );
  }

  const totalCount = counts.all ?? 0;
  const agentPlural = totalCount === 1 ? "agent" : "agents";
  const descriptionText = `${triggerLabel}: ${triggerCount} of ${totalCount} observed ${agentPlural}.`;

  // Multi-select option toggle handler via single-source-of-truth normalization
  const handleSelectOption = useCallback(
    (optionValue: "all" | TraditionalAgentStatusLabel) => {
      if (optionValue === "all") {
        onValueChange("all");
        return;
      }

      const current = normalizeTraditionalAgentStatusFilter(value);
      if (current === "all") {
        // Isolate to single status
        onValueChange(normalizeTraditionalAgentStatusFilter([optionValue]));
        return;
      }

      const isCurrentlySelected = current.includes(optionValue);
      if (isCurrentlySelected) {
        const next = current.filter((s) => s !== optionValue);
        onValueChange(normalizeTraditionalAgentStatusFilter(next));
      } else {
        const next = [...current, optionValue];
        onValueChange(normalizeTraditionalAgentStatusFilter(next));
      }
    },
    [value, onValueChange],
  );
  const updatePlacement = useCallback(() => {
    if (!triggerRef.current || typeof window === "undefined") return;
    const rect = triggerRef.current.getBoundingClientRect();
    const spaceBelow = window.innerHeight - rect.bottom;
    const spaceAbove = rect.top;
    if (spaceBelow < 260 && spaceAbove > spaceBelow) {
      setPlacement("top");
      setMaxListboxHeight(Math.min(240, Math.max(0, spaceAbove - 8)));
    } else {
      setPlacement("bottom");
      setMaxListboxHeight(Math.min(240, Math.max(0, spaceBelow - 8)));
    }
  }, []);

  useEffect(() => {
    if (!isOpen) return;
    function handleResize() {
      updatePlacement();
    }
    window.addEventListener("resize", handleResize);
    return () => {
      window.removeEventListener("resize", handleResize);
    };
  }, [isOpen, updatePlacement]);

  const openDropdown = useCallback(() => {
    updatePlacement();
    setIsOpen(true);
  }, [updatePlacement]);
  // Outside click / pointerdown handling to close dropdown without stealing focus
  useEffect(() => {
    if (!isOpen) return;

    function handlePointerDown(event: PointerEvent) {
      if (
        wrapperRef.current &&
        !wrapperRef.current.contains(event.target as Node)
      ) {
        setIsOpen(false);
      }
    }

    document.addEventListener("pointerdown", handlePointerDown);
    return () => {
      document.removeEventListener("pointerdown", handlePointerDown);
    };
  }, [isOpen]);

  // Capture-phase keydown handling on window to protect parent dialogs from Escape dismissal
  useEffect(() => {
    if (!isOpen) return;

    function handleWindowKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") {
        const isOwned = Boolean(
          wrapperRef.current &&
            (wrapperRef.current.contains(event.target as Node) ||
              wrapperRef.current.contains(document.activeElement)),
        );
        if (!isOwned) {
          setIsOpen(false);
          return;
        }
        event.preventDefault();
        event.stopPropagation();
        event.stopImmediatePropagation();
        setIsOpen(false);
        triggerRef.current?.focus();
        return;
      }
      if (event.key === "Tab") {
        setIsOpen(false);
      }
    }

    window.addEventListener("keydown", handleWindowKeyDown, true);
    return () => {
      window.removeEventListener("keydown", handleWindowKeyDown, true);
    };
  }, [isOpen]);
  // Scroll active option into view within the listbox without scrolling ancestors
  useEffect(() => {
    if (!isOpen || activeIndex < 0) return;
    const listbox = listboxRef.current;
    if (!listbox) return;
    const activeOptionId = optionIds[activeIndex];
    if (!activeOptionId) return;
    const optionEl = document.getElementById(activeOptionId);
    if (!optionEl) return;

    const listboxTop = listbox.scrollTop;
    const listboxBottom = listboxTop + listbox.clientHeight;
    const optionTop = optionEl.offsetTop;
    const optionBottom = optionTop + optionEl.offsetHeight;

    if (optionTop < listboxTop) {
      listbox.scrollTop = optionTop;
    } else if (optionBottom > listboxBottom) {
      listbox.scrollTop = optionBottom - listbox.clientHeight;
    }
  }, [isOpen, activeIndex, optionIds]);

  // Keyboard navigation on the combobox trigger
  const handleKeyDown = useCallback(
    (event: React.KeyboardEvent<HTMLButtonElement>) => {
      switch (event.key) {
        case "ArrowDown": {
          event.preventDefault();
          if (!isOpen) {
            openDropdown();
            setActiveIndex(0);
          } else {
            setActiveIndex((prev) => (prev + 1) % FILTER_OPTIONS.length);
          }
          break;
        }
        case "ArrowUp": {
          event.preventDefault();
          if (!isOpen) {
            openDropdown();
            setActiveIndex(FILTER_OPTIONS.length - 1);
          } else {
            setActiveIndex(
              (prev) => (prev - 1 + FILTER_OPTIONS.length) % FILTER_OPTIONS.length,
            );
          }
          break;
        }
        case "Home": {
          if (isOpen) {
            event.preventDefault();
            setActiveIndex(0);
          }
          break;
        }
        case "End": {
          if (isOpen) {
            event.preventDefault();
            setActiveIndex(FILTER_OPTIONS.length - 1);
          }
          break;
        }
        case "Enter":
        case " ": {
          event.preventDefault();
          if (!isOpen) {
            openDropdown();
            setActiveIndex(0);
          } else {
            const activeOption = FILTER_OPTIONS[activeIndex];
            if (activeOption) {
              handleSelectOption(activeOption.value);
            }
          }
          break;
        }
        case "Escape": {
          if (isOpen) {
            event.stopPropagation();
            event.preventDefault();
            setIsOpen(false);
            triggerRef.current?.focus();
          }
          break;
        }
        case "Tab": {
          if (isOpen) {
            setIsOpen(false);
            // Allow natural focus traversal without preventDefault
          }
          break;
        }
        default: {
          if (
            event.key.length === 1 &&
            !event.ctrlKey &&
            !event.metaKey &&
            !event.altKey
          ) {
            const char = event.key.toLowerCase();
            const startIdx = activeIndex >= 0 ? (activeIndex + 1) % FILTER_OPTIONS.length : 0;
            for (let i = 0; i < FILTER_OPTIONS.length; i++) {
              const idx = (startIdx + i) % FILTER_OPTIONS.length;
              if (FILTER_OPTIONS[idx]!.label.toLowerCase().startsWith(char)) {
                setActiveIndex(idx);
                break;
              }
            }
          }
          break;
        }
      }
    },
    [isOpen, activeIndex, handleSelectOption, openDropdown],
  );

  return (
    <div ref={wrapperRef} className={cn("relative w-full", className)}>
      <span id={descriptionId} className="sr-only">
        {descriptionText}
      </span>

      <button
        ref={triggerRef}
        type="button"
        role="combobox"
        aria-haspopup="listbox"
        aria-expanded={isOpen}
        aria-controls={listboxId}
        aria-label="Filter agents by status"
        aria-describedby={descriptionId}
        aria-activedescendant={isOpen ? optionIds[activeIndex] : undefined}
        onClick={() => {
          if (!isOpen) {
            openDropdown();
          } else {
            setIsOpen(false);
          }
        }}
        onKeyDown={handleKeyDown}
        className={cn(
          "flex w-full min-w-0 items-center justify-between gap-2 rounded glass-input px-2.5 py-1.5 text-sm outline-none transition-colors",
          "min-h-11",
          touchOptimized && "min-h-12",
          "focus-visible:ring-1 focus-visible:ring-[var(--color-primary)]",
        )}
      >
        <span className="flex min-w-0 flex-1 items-center justify-between gap-2">
          <span className="flex min-w-0 items-center gap-1.5 truncate">
            {TriggerIcon ? (
              <TriggerIcon
                className={cn(
                  "h-3.5 w-3.5 shrink-0",
                  triggerIndicatorClassName,
                )}
                aria-hidden="true"
              />
            ) : null}
            <span className="min-w-0 truncate">{triggerLabel}</span>
          </span>
          <span
            data-testid="agent-filter-count-badge"
            className="inline-flex min-w-5 shrink-0 items-center justify-center rounded-full bg-[var(--color-surface-2)] px-1.5 py-0.5 text-[11px] font-semibold tabular-nums text-[var(--color-text)]"
          >
            {triggerCount}
          </span>
        </span>
        <ChevronDown
          className={cn(
            "h-3.5 w-3.5 shrink-0 opacity-50 transition-transform duration-150",
            isOpen && "rotate-180",
          )}
          aria-hidden="true"
        />
      </button>

      {isOpen ? (
        <div
          ref={listboxRef}
          id={listboxId}
          role="listbox"
          aria-multiselectable="true"
          aria-label="Filter agents by status"
          tabIndex={-1}
          className={cn(
            "absolute left-0 z-[80] w-full min-w-[200px] overflow-y-auto rounded-md border border-[var(--color-border)] bg-[var(--color-surface)] text-[var(--color-text)] p-1 shadow-2xl",
            placement === "top" ? "bottom-full mb-1" : "top-full mt-1",
          )}
          style={{ maxHeight: `${maxListboxHeight}px` }}
        >
          {FILTER_OPTIONS.map((option, index) => {
            const optionId = optionIds[index]!;
            const isSelected =
              option.value === "all"
                ? isAll
                : !isAll && normalizedSelection.includes(option.value);
            const isActive = index === activeIndex;
            const count = counts[option.value] ?? 0;
            const optionPlural = count === 1 ? "agent" : "agents";
            const accessibleOptionLabel = `${option.label}, ${count} ${optionPlural}`;
            const Icon = option.Icon;

            return (
              <div
                key={option.value}
                id={optionId}
                role="option"
                tabIndex={-1}
                aria-selected={isSelected}
                aria-label={accessibleOptionLabel}
                onMouseDown={(e) => {
                  // Prevent focus from shifting away from combobox trigger
                  e.preventDefault();
                }}
                onClick={() => {
                  handleSelectOption(option.value);
                }}
                onMouseEnter={() => {
                  setActiveIndex(index);
                }}
                onKeyDown={(e) => {
                  if (e.key === "Enter" || e.key === " ") {
                    e.preventDefault();
                    e.stopPropagation();
                    handleSelectOption(option.value);
                  }
                }}
                className={cn(
                  "relative flex w-full min-w-0 cursor-pointer select-none items-center justify-between gap-2 rounded px-2.5 py-1.5 text-sm outline-none transition-colors",
                  "min-h-11",
                  touchOptimized && "min-h-12",
                  isActive
                    ? "bg-[var(--color-surface-2)] text-[var(--color-text)]"
                    : "text-[var(--color-text)] hover:bg-[var(--color-surface-2)]",
                )}
              >
                <span className="flex min-w-0 flex-1 items-center gap-2 truncate">
                  <span
                    className={cn(
                      "flex h-4 w-4 shrink-0 items-center justify-center rounded border transition-colors",
                      isSelected
                        ? "border-[var(--color-primary)] bg-[var(--color-primary)] text-[var(--color-primary-foreground)]"
                        : "border-[var(--color-border)] bg-[var(--color-surface-2)]",
                    )}
                    aria-hidden="true"
                  >
                    {isSelected ? (
                      <Check
                        className="h-3 w-3 stroke-[3]"
                        aria-hidden="true"
                      />
                    ) : null}
                  </span>
                  {Icon ? (
                    <Icon
                      className={cn(
                        "h-3.5 w-3.5 shrink-0",
                        option.indicatorClassName,
                      )}
                      aria-hidden="true"
                    />
                  ) : null}
                  <span className="truncate">{option.label}</span>
                </span>
                <span
                  data-testid="agent-filter-count-badge"
                  className="inline-flex min-w-5 shrink-0 items-center justify-center rounded-full bg-[var(--color-surface-2)] px-1.5 py-0.5 text-[11px] font-semibold tabular-nums text-[var(--color-text)]"
                >
                  {count}
                </span>
              </div>
            );
          })}
        </div>
      ) : null}
    </div>
  );
}
