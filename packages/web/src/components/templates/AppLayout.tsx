import type { ReactNode } from "react";
import { Sidebar } from "@/components/organisms/Sidebar.js";
import { useSidebarCollapse } from "@/hooks/useSidebarCollapse.js";

interface Props {
  children: ReactNode;
  title?: string;
}

export function AppLayout({ children, title }: Props) {
  const { collapsed, toggle } = useSidebarCollapse();

  return (
    <div className="flex h-screen overflow-hidden gradient-bg">
      <Sidebar collapsed={collapsed} onToggle={toggle} />
      <div className="flex-1 flex flex-col overflow-hidden">
        {/* Terminal header bar */}
        {title && (
          <header className="shrink-0 border-b border-[var(--color-border)] glass-card px-5 py-2.5 flex items-center gap-3">
            <span className="text-[var(--color-primary)]/50 text-xs select-none">$</span>
            <h1 className="text-xs font-semibold text-[var(--color-text)] tracking-widest uppercase">
              {title}
            </h1>
            <span className="text-[var(--color-text-muted)]/30 text-xs">~/dev-hub/{title.toLowerCase()}</span>
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
