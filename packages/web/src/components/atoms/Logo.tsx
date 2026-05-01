import { cn } from "@/lib/utils.js";

interface LogoProps {
  className?: string;
  size?: "xs" | "sm" | "md" | "lg";
}

export function Logo({ className, size = "md" }: LogoProps) {
  const sizeMap = {
    xs: "h-3 w-3",
    sm: "h-4 w-4",
    md: "h-5 w-5",
    lg: "h-8 w-8",
  };

  return (
    <img
      src={`${(import.meta as any).env.BASE_URL}favicon.svg`}
      className={cn(sizeMap[size], "object-contain shrink-0", className)}
      style={{
        filter:
          "brightness(0) saturate(100%) invert(53%) sepia(92%) saturate(2334%) hue-rotate(196deg) brightness(101%) contrast(94%)",
      }}
      alt="Logo"
    />
  );
}
