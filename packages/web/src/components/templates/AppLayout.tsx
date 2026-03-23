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
    <div className="flex h-screen overflow-hidden bg-[var(--color-background)]">
      <Sidebar collapsed={collapsed} onToggle={toggle} />
      <main className="flex-1 overflow-y-auto">
        <div className="px-6 py-6">
          {title && (
            <h1 className="text-xl font-semibold text-[var(--color-text)] mb-6">
              {title}
            </h1>
          )}
          {children}
        </div>
      </main>
    </div>
  );
}
