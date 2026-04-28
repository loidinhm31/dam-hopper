import type { ReactNode } from "react";
import { TopNav } from "@/components/organisms/TopNav.js";
import { useSidebarCollapse } from "@/hooks/useSidebarCollapse.js";

interface Props {
  children: ReactNode;
  title?: string;
}

export function AppLayout({ children, title }: Props) {
  const { collapsed, toggle } = useSidebarCollapse();

  return (
    <div className="flex flex-col h-screen overflow-hidden gradient-bg">
      <TopNav collapsed={collapsed} onToggle={toggle} />
      <div className="flex-1 flex flex-col overflow-hidden">
        {/* Sub-header bar */}
        {title && (
          <header className="shrink-0 border-b border-[var(--color-border)] bg-[var(--color-surface)]/30 px-5 py-1.5 flex items-center gap-3">
            <span className="text-[var(--color-primary)]/50 text-[10px] select-none">$</span>
            <h1 className="text-[10px] font-semibold text-[var(--color-text)] tracking-widest uppercase">
              {title}
            </h1>
            <span className="text-[var(--color-text-muted)]/30 text-[10px] hidden sm:inline">~/dam-hopper/{title.toLowerCase()}</span>
          </header>
        )}
        <main className="flex-1 overflow-y-auto">
          <div className="px-5 py-5">
            {children}
          </div>
        </main>
      </div>
    </div>
  );
}
