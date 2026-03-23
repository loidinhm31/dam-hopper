import { useState } from "react";
import { ChevronRight } from "lucide-react";
import { cn } from "@/lib/utils.js";
import type { ComponentType, ReactNode } from "react";

interface CollapsibleSectionProps {
  title: string;
  icon?: ComponentType<{ className?: string }>;
  badge?: number | string;
  defaultOpen?: boolean;
  open?: boolean;
  onToggle?: (open: boolean) => void;
  className?: string;
  headerClassName?: string;
  children: ReactNode;
}

export function CollapsibleSection({
  title,
  icon: Icon,
  badge,
  defaultOpen = false,
  open: controlledOpen,
  onToggle,
  className,
  headerClassName,
  children,
}: CollapsibleSectionProps) {
  const [internalOpen, setInternalOpen] = useState(defaultOpen);
  const isControlled = controlledOpen !== undefined;
  const isOpen = isControlled ? controlledOpen : internalOpen;

  function handleToggle() {
    const next = !isOpen;
    if (!isControlled) setInternalOpen(next);
    onToggle?.(next);
  }

  return (
    <div className={cn("border-b border-[var(--color-border)] last:border-0", className)}>
      <button
        type="button"
        onClick={handleToggle}
        className={cn(
          "flex w-full items-center gap-2 px-3 py-2 text-sm font-medium",
          "text-[var(--color-text)] hover:bg-[var(--color-surface-2)] transition-colors",
          "cursor-pointer select-none",
          headerClassName,
        )}
      >
        <ChevronRight
          className={cn(
            "h-3.5 w-3.5 shrink-0 text-[var(--color-text-muted)] transition-transform duration-200",
            isOpen && "rotate-90",
          )}
        />
        {Icon && <Icon className="h-4 w-4 shrink-0 text-[var(--color-text-muted)]" />}
        <span className="flex-1 text-left">{title}</span>
        {badge !== undefined && (
          <span className="rounded-full bg-[var(--color-surface-2)] px-1.5 py-0.5 text-xs text-[var(--color-text-muted)]">
            {badge}
          </span>
        )}
      </button>

      {/* CSS grid-rows trick for smooth height animation */}
      <div
        className="grid transition-[grid-template-rows] duration-200"
        style={{ gridTemplateRows: isOpen ? "1fr" : "0fr" }}
      >
        <div className="overflow-hidden">
          {children}
        </div>
      </div>
    </div>
  );
}
