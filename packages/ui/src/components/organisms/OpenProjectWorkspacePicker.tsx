import {
  useCallback,
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
} from "react";
import { ChevronDown, FolderPlus, Loader2 } from "lucide-react";
import type { AggregatedProjectItem } from "@/hooks/use-aggregated-projects.js";
import { projectKey } from "@/api/ownership.js";
import type { OpenWorkspaceRef } from "@/lib/agent-hub-open-workspaces.js";
import { cn } from "@/lib/utils.js";

export interface OpenProjectWorkspacePickerProps {
  items: readonly AggregatedProjectItem[];
  openGroupIds: ReadonlySet<string>;
  isLoading?: boolean;
  onOpen: (ref: OpenWorkspaceRef) => void;
  className?: string;
  touchOptimized?: boolean;
}

interface ProfileGroup {
  profileId: string;
  profileName: string;
  items: AggregatedProjectItem[];
}

export function OpenProjectWorkspacePicker({
  items,
  openGroupIds,
  isLoading = false,
  onOpen,
  className,
  touchOptimized = false,
}: OpenProjectWorkspacePickerProps) {
  const [isOpen, setIsOpen] = useState(false);
  const [focusedIndex, setFocusedIndex] = useState(-1);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const popoverRef = useRef<HTMLDivElement>(null);
  const listboxId = useId();

  // Group items by profileId
  const profileGroups = useMemo<ProfileGroup[]>(() => {
    const map = new Map<string, ProfileGroup>();
    for (const item of items) {
      const groupKey = item.profileId || "default";
      let group = map.get(groupKey);
      if (!group) {
        group = {
          profileId: item.profileId,
          profileName: item.profileName || item.profileId || "Projects",
          items: [],
        };
        map.set(groupKey, group);
      }
      group.items.push(item);
    }
    return Array.from(map.values());
  }, [items]);

  // Flattened enabled items for keyboard navigation
  const flatSelectableItems = useMemo(() => {
    return items.filter((item) => {
      const key = projectKey(item.ref ?? { profileId: item.profileId, project: item.project.name });
      return !openGroupIds.has(key);
    });
  }, [items, openGroupIds]);

  const handleSelect = useCallback(
    (item: AggregatedProjectItem) => {
      const ref: OpenWorkspaceRef = {
        profileId: item.profileId,
        project: item.project.name,
      };
      onOpen(ref);
      setIsOpen(false);
      triggerRef.current?.focus();
    },
    [onOpen],
  );

  const closeAndFocusTrigger = useCallback(() => {
    setIsOpen(false);
    triggerRef.current?.focus();
  }, []);

  // Keyboard navigation inside popup
  const handleKeyDown = useCallback(
    (event: React.KeyboardEvent) => {
      if (!isOpen) {
        if (event.key === "ArrowDown" || event.key === "Enter" || event.key === " ") {
          event.preventDefault();
          setIsOpen(true);
          setFocusedIndex(0);
        }
        return;
      }

      if (event.key === "Escape") {
        event.preventDefault();
        closeAndFocusTrigger();
        return;
      }

      if (event.key === "ArrowDown") {
        event.preventDefault();
        if (flatSelectableItems.length === 0) return;
        setFocusedIndex((prev) => (prev + 1) % flatSelectableItems.length);
        return;
      }

      if (event.key === "ArrowUp") {
        event.preventDefault();
        if (flatSelectableItems.length === 0) return;
        setFocusedIndex((prev) =>
          prev <= 0 ? flatSelectableItems.length - 1 : prev - 1,
        );
        return;
      }

      if (event.key === "Home") {
        event.preventDefault();
        setFocusedIndex(0);
        return;
      }

      if (event.key === "End") {
        event.preventDefault();
        setFocusedIndex(flatSelectableItems.length - 1);
        return;
      }

      if (event.key === "Enter" || event.key === " ") {
        event.preventDefault();
        if (focusedIndex >= 0 && focusedIndex < flatSelectableItems.length) {
          handleSelect(flatSelectableItems[focusedIndex]);
        }
      }
    },
    [closeAndFocusTrigger, flatSelectableItems, focusedIndex, handleSelect, isOpen],
  );

  // Click outside listener
  useEffect(() => {
    if (!isOpen) return;
    function handleClickOutside(event: MouseEvent) {
      if (
        popoverRef.current &&
        !popoverRef.current.contains(event.target as Node) &&
        triggerRef.current &&
        !triggerRef.current.contains(event.target as Node)
      ) {
        setIsOpen(false);
      }
    }
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, [isOpen]);

  return (
    <div className={cn("relative inline-block", className)} onKeyDown={handleKeyDown}>
      <button
        ref={triggerRef}
        type="button"
        aria-haspopup="listbox"
        aria-expanded={isOpen}
        aria-controls={isOpen ? listboxId : undefined}
        aria-label="Open project workspace"
        title="Open project workspace"
        onClick={() => {
          setIsOpen((prev) => !prev);
          setFocusedIndex(0);
        }}
        className={cn(
          "flex items-center gap-1 rounded px-2 py-1 text-2xs font-medium text-[var(--color-text-muted)] hover:bg-[var(--color-surface-2)] hover:text-[var(--color-text)] focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-[var(--color-primary)]",
          touchOptimized && "min-h-11 min-w-11 px-2.5",
        )}
      >
        <FolderPlus className="h-3.5 w-3.5" aria-hidden="true" />
        <span>Open</span>
        <ChevronDown className="h-3 w-3 opacity-60" aria-hidden="true" />
      </button>

      {isOpen && (
        <div
          ref={popoverRef}
          id={listboxId}
          role="listbox"
          aria-label="Available project workspaces"
          className="absolute left-0 top-full z-50 mt-1 max-h-64 w-60 overflow-y-auto rounded border border-[var(--color-border)] bg-[var(--color-surface)] py-1 shadow-lg"
        >
          {isLoading ? (
            <div className="flex items-center justify-center gap-2 px-3 py-4 text-xs text-[var(--color-text-muted)]">
              <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden="true" />
              <span>Loading projects...</span>
            </div>
          ) : items.length === 0 ? (
            <p className="px-3 py-4 text-center text-xs text-[var(--color-text-muted)]">
              No projects available
            </p>
          ) : (
            profileGroups.map((group) => (
              <div key={group.profileId} role="group" aria-label={group.profileName}>
                <div
                  role="presentation"
                  className="px-2.5 py-1 text-2xs font-semibold uppercase tracking-wider text-[var(--color-text-muted)]"
                >
                  {group.profileName}
                </div>
                {group.items.map((item) => {
                  const key = projectKey(
                    item.ref ?? {
                      profileId: item.profileId,
                      project: item.project.name,
                    },
                  );
                  const isAlreadyOpen = openGroupIds.has(key);
                  const isKeyboardFocused =
                    !isAlreadyOpen &&
                    flatSelectableItems[focusedIndex] === item;

                  return (
                    <button
                      key={key}
                      type="button"
                      role="option"
                      aria-selected={isKeyboardFocused}
                      aria-disabled={isAlreadyOpen}
                      disabled={isAlreadyOpen}
                      onClick={() => handleSelect(item)}
                      className={cn(
                        "flex w-full items-center justify-between px-3 py-1.5 text-left text-xs transition-colors",
                        isAlreadyOpen
                          ? "cursor-not-allowed opacity-40 text-[var(--color-text-muted)]"
                          : isKeyboardFocused
                            ? "bg-[var(--color-surface-2)] text-[var(--color-text)] font-medium"
                            : "text-[var(--color-text)] hover:bg-[var(--color-surface-2)]/60",
                        touchOptimized && "min-h-11",
                      )}
                    >
                      <span className="truncate">{item.project.name}</span>
                      {isAlreadyOpen && (
                        <span className="shrink-0 text-2xs italic text-[var(--color-text-muted)]">
                          open
                        </span>
                      )}
                    </button>
                  );
                })}
              </div>
            ))
          )}
        </div>
      )}
    </div>
  );
}
