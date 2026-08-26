import { Logo } from "@/components/atoms/Logo.js";

export function TopNavBrand() {
  return (
    <div className="flex flex-shrink-0 items-center gap-2">
      <Logo size="sm" />
      <span className="hidden text-[10px] font-bold tracking-widest text-[var(--color-primary)] opacity-70 xl:inline">
        DAM-HOPPER
      </span>
    </div>
  );
}
