import { ChevronDown, ChevronUp, Check } from "lucide-react";
import { cn } from "@/lib/utils.js";
import type { RegionDecisionState } from "@/lib/conflict-merge-types.js";

export interface ConflictNavRegion {
  id: string;
  startLine: number;
  endLine: number;
}

interface ConflictRegionNavProps {
  regions: ConflictNavRegion[];
  decisions?: Record<string, RegionDecisionState>;
  selectedIndex: number;
  onSelectIndex: (index: number) => void;
  onAcceptSide: (regionId: string, side: "ours" | "theirs") => void;
  onAcceptBoth?: (
    regionId: string,
    order: "ours-then-theirs" | "theirs-then-ours",
  ) => void;
  onIgnoreSide?: (regionId: string, side: "ours" | "theirs") => void;
  onMarkReviewed?: (regionId: string) => void;
  disabled: boolean;
}

export function ConflictRegionNav({
  regions,
  decisions,
  selectedIndex,
  onSelectIndex,
  onAcceptSide,
  onAcceptBoth,
  onIgnoreSide,
  onMarkReviewed,
  disabled,
}: ConflictRegionNavProps) {
  if (regions.length === 0) return null;

  return (
    <div className="shrink-0 border-t border-[var(--color-border)] bg-[var(--color-surface-2)]">
      <div className="flex items-center gap-1.5 px-3 py-1.5 overflow-x-auto">
        <span className="text-[10px] font-semibold text-[var(--color-text-muted)] shrink-0 mr-1">
          Conflicts ({regions.length}):
        </span>

        {regions.map((region, i) => {
          const isSelected = selectedIndex === i;
          const decision = decisions?.[region.id];
          const isResolved =
            decision &&
            (decision.manualReview === "reviewed" ||
              decision.oursDecision === "accepted" ||
              decision.theirsDecision === "accepted" ||
              (decision.oursDecision === "ignored" &&
                decision.theirsDecision === "ignored"));

          return (
            <div
              key={region.id}
              className={cn(
                "shrink-0 flex items-center gap-1 rounded px-1.5 py-0.5 border text-[10px] cursor-pointer transition-colors",
                isSelected
                  ? "border-amber-400/60 bg-amber-400/15 text-amber-300 shadow-sm"
                  : isResolved
                    ? "border-green-500/40 bg-green-500/10 text-green-300"
                    : "border-[var(--color-border)] text-[var(--color-text-muted)] hover:border-[var(--color-primary)]/40 hover:text-[var(--color-text)]",
              )}
              onClick={() => onSelectIndex(i)}
              title={`Jump to conflict ${i + 1} (${region.id}, lines ${region.startLine}-${region.endLine})`}
            >
              <span className="font-mono font-semibold w-3.5 text-center">
                {i + 1}
              </span>

              {/* Accept Theirs */}
              <button
                type="button"
                onClick={(e) => {
                  e.stopPropagation();
                  onAcceptSide(region.id, "theirs");
                }}
                disabled={disabled}
                title={disabled ? "Editing disabled" : "Accept incoming (theirs)"}
                className="px-1 rounded text-blue-400 hover:bg-blue-400/20 font-medium transition-colors disabled:cursor-not-allowed disabled:opacity-30"
              >
                ←T
              </button>

              {/* Accept Ours */}
              <button
                type="button"
                onClick={(e) => {
                  e.stopPropagation();
                  onAcceptSide(region.id, "ours");
                }}
                disabled={disabled}
                title={disabled ? "Editing disabled" : "Accept current (ours)"}
                className="px-1 rounded text-green-400 hover:bg-green-400/20 font-medium transition-colors disabled:cursor-not-allowed disabled:opacity-30"
              >
                O→
              </button>

              {/* Accept Both */}
              {onAcceptBoth && (
                <button
                  type="button"
                  onClick={(e) => {
                    e.stopPropagation();
                    onAcceptBoth(region.id, "ours-then-theirs");
                  }}
                  disabled={disabled}
                  title={disabled ? "Editing disabled" : "Accept both (ours then theirs)"}
                  className="px-1 rounded text-purple-400 hover:bg-purple-400/20 font-medium transition-colors disabled:cursor-not-allowed disabled:opacity-30"
                >
                  Both
                </button>
              )}

              {/* Mark Reviewed */}
              {onMarkReviewed && (
                <button
                  type="button"
                  onClick={(e) => {
                    e.stopPropagation();
                    onMarkReviewed(region.id);
                  }}
                  disabled={disabled}
                  title={disabled ? "Editing disabled" : "Mark as reviewed"}
                  className="px-0.5 rounded text-amber-400 hover:bg-amber-400/20 transition-colors disabled:cursor-not-allowed disabled:opacity-30"
                >
                  <Check className="h-3 w-3" />
                </button>
              )}
            </div>
          );
        })}

        <div className="ml-auto shrink-0 flex items-center gap-1 pl-2">
          <button
            type="button"
            aria-label="Previous conflict"
            onClick={() => onSelectIndex(Math.max(0, selectedIndex - 1))}
            disabled={selectedIndex === 0}
            className="p-1 rounded text-[var(--color-text-muted)] hover:text-[var(--color-text)] hover:bg-[var(--color-surface)] disabled:opacity-30 transition-colors"
          >
            <ChevronUp className="h-3.5 w-3.5" />
          </button>
          <button
            type="button"
            aria-label="Next conflict"
            onClick={() => onSelectIndex(Math.min(regions.length - 1, selectedIndex + 1))}
            disabled={selectedIndex >= regions.length - 1}
            className="p-1 rounded text-[var(--color-text-muted)] hover:text-[var(--color-text)] hover:bg-[var(--color-surface)] disabled:opacity-30 transition-colors"
          >
            <ChevronDown className="h-3.5 w-3.5" />
          </button>
        </div>
      </div>
    </div>
  );
}
