import { cn } from "@/lib/utils.js";
import type { OpenTerminalTitle } from "@/lib/terminal-title.js";

interface TerminalTitleTextProps {
  title: OpenTerminalTitle;
  className?: string;
  baseClassName?: string;
  suffixClassName?: string;
}

/** Renders an open terminal title without allowing its ordinal to be truncated. */
export function TerminalTitleText({
  title,
  className,
  baseClassName,
  suffixClassName,
}: TerminalTitleTextProps) {
  return (
    <span className={cn("flex min-w-0", className)}>
      <span className="sr-only">{title.fullText}</span>
      <span
        aria-hidden="true"
        className={cn("min-w-0 truncate", baseClassName)}
      >
        {title.baseLabel}
      </span>
      <span aria-hidden="true" className={cn("shrink-0", suffixClassName)}>
        {` #${title.ordinal}`}
      </span>
    </span>
  );
}
