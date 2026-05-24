import { FileDecorationIcon } from "@/lib/file-decoration-icon.js";
import { cn } from "@/lib/utils.js";

interface FilePathLabelProps {
  path: string;
  className?: string;
  iconClassName?: string;
  fileNameClassName?: string;
  dirClassName?: string;
  dirMaxWidthClassName?: string;
}

export function getFilePathParts(path: string) {
  const separatorIndex = Math.max(path.lastIndexOf("/"), path.lastIndexOf("\\"));
  if (separatorIndex < 0) {
    return { fileName: path, dirPath: "" };
  }
  return {
    fileName: path.slice(separatorIndex + 1),
    dirPath: path.slice(0, separatorIndex),
  };
}

export function FilePathLabel({
  path,
  className,
  iconClassName,
  fileNameClassName,
  dirClassName,
  dirMaxWidthClassName,
}: FilePathLabelProps) {
  const { fileName, dirPath } = getFilePathParts(path);

  return (
    <div className={cn("flex items-center gap-2 min-w-0 flex-1", className)}>
      <FileDecorationIcon
        pathOrName={path}
        className={cn("h-3.5 w-3.5", iconClassName)}
      />
      <div className="min-w-0 flex-1 flex items-baseline gap-1.5 overflow-hidden">
        <span
          className={cn(
            "truncate text-xs text-[var(--color-text)] font-medium",
            fileNameClassName,
          )}
        >
          {fileName}
        </span>
        {dirPath && (
          <span
            className={cn(
              "shrink truncate max-w-[45%] text-[10px] text-[var(--color-text-muted)]/70",
              dirMaxWidthClassName,
              dirClassName,
            )}
          >
            {dirPath}
          </span>
        )}
      </div>
    </div>
  );
}
