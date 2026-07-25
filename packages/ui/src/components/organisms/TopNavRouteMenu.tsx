import { BASE_NAV } from "@/lib/navigation.js";
import { cn } from "@/lib/utils.js";
import { TopNavRouteLink } from "@/components/molecules/TopNavRouteLink.js";

interface TopNavRouteMenuProps {
  collapsed: boolean;
  compactLabelClass: string;
  compactTextClass: string;
  isCompactWorkspace: boolean;
}

export function TopNavRouteMenu({
  collapsed,
  compactLabelClass,
  compactTextClass,
  isCompactWorkspace,
}: TopNavRouteMenuProps) {
  return (
    <>
      <nav
        aria-label="Primary"
        className={cn(
          "items-center gap-1 overflow-x-auto transition-all duration-300 ease-in-out",
          isCompactWorkspace ? "hidden sm:flex" : "flex",
          collapsed
            ? "max-w-0 pointer-events-none opacity-0"
            : "ml-1 max-w-[120px] opacity-100 sm:ml-2 sm:max-w-[180px] lg:max-w-[500px] xl:max-w-[1000px]",
        )}
      >
        {BASE_NAV.map((entry) => (
          <TopNavRouteLink
            key={entry.to}
            entry={entry}
            compactTextClass={compactTextClass}
            compactLabelClass={compactLabelClass}
            isCompactWorkspace={isCompactWorkspace}
          />
        ))}
      </nav>

      {isCompactWorkspace && !collapsed && (
        <nav
          aria-label="Primary"
          className="grid grid-cols-2 gap-2 rounded-lg border border-[var(--color-border)] bg-[var(--color-surface)]/70 p-2 sm:hidden"
        >
          {BASE_NAV.map((entry, index) => (
            <TopNavRouteLink
              key={entry.to}
              entry={entry}
              compactTextClass={compactTextClass}
              compactLabelClass={compactLabelClass}
              isCompactWorkspace={isCompactWorkspace}
              mobileGrid
              fullWidth={
                BASE_NAV.length % 2 === 1 && index === BASE_NAV.length - 1
              }
            />
          ))}
        </nav>
      )}
    </>
  );
}
