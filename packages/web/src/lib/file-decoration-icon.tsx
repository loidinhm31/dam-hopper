import type { ComponentPropsWithoutRef } from "react";
import { getFileDecoration } from "@/lib/file-decoration.js";
import { cn } from "@/lib/utils.js";

export function FileDecorationIcon({
  pathOrName,
  mime,
  className,
  ...props
}: ComponentPropsWithoutRef<"svg"> & { pathOrName: string; mime?: string }) {
  const decoration = getFileDecoration(pathOrName, { mime });
  const Icon = decoration.icon;
  return (
    <Icon
      {...props}
      className={cn("shrink-0", decoration.colorClass, className)}
      aria-hidden="true"
    />
  );
}
