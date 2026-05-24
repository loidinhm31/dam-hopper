import type { ReactNode } from "react";

interface SettingRowProps {
  title: string;
  description?: string;
  children: ReactNode;
}

export function SettingRow({ title, description, children }: SettingRowProps) {
  return (
    <div className="flex items-center justify-between gap-4">
      <div className="flex-1 min-w-0">
        <p className="text-sm font-medium text-[var(--color-text)]">{title}</p>
        {description && (
          <p className="text-xs text-[var(--color-text-muted)] mt-0.5">
            {description}
          </p>
        )}
      </div>
      {children}
    </div>
  );
}
