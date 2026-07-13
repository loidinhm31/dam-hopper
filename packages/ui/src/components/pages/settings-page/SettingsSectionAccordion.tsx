import { useId, useState } from "react";
import { ChevronDown } from "lucide-react";
import { cn } from "@/lib/utils.js";
import type { ReactNode } from "react";

interface SettingsSectionAccordionProps {
  title: string;
  description: string;
  defaultOpen?: boolean;
  children: ReactNode;
}

export function SettingsSectionAccordion({
  title,
  description,
  defaultOpen = false,
  children,
}: SettingsSectionAccordionProps) {
  const [isOpen, setIsOpen] = useState(defaultOpen);
  const buttonId = useId();
  const panelId = useId();

  return (
    <section className="overflow-hidden rounded-xl border border-[var(--color-border)] bg-[var(--color-surface)]/70">
      <h2>
        <button
          id={buttonId}
          type="button"
          className={cn(
            "flex w-full cursor-pointer items-start justify-between gap-4 px-4 py-4 text-left transition-colors",
            "hover:bg-[var(--color-surface-2)]/50 focus:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-primary)]/60",
          )}
          aria-expanded={isOpen}
          aria-controls={panelId}
          onClick={() => setIsOpen((current) => !current)}
        >
          <span className="min-w-0">
            <span className="block text-sm font-semibold text-[var(--color-text)]">
              {title}
            </span>
            <span className="mt-1 block text-xs font-normal leading-5 text-[var(--color-text-muted)]">
              {description}
            </span>
          </span>
          <ChevronDown
            className={cn(
              "mt-0.5 h-4 w-4 shrink-0 text-[var(--color-text-muted)] transition-transform duration-200",
              isOpen && "rotate-180 text-[var(--color-primary)]",
            )}
            aria-hidden="true"
          />
        </button>
      </h2>

      <div
        id={panelId}
        hidden={!isOpen}
        aria-labelledby={buttonId}
        className="border-t border-[var(--color-border)]"
      >
        <div className="p-4">{children}</div>
      </div>
    </section>
  );
}
