import {
  forwardRef,
  type ComponentPropsWithoutRef,
  type MouseEventHandler,
} from "react";
import { AlertTriangle, X } from "lucide-react";
import { cn } from "@/lib/utils.js";
import { FileDecorationIcon } from "@/lib/file-decoration-icon.js";
import type { GitFileState } from "@/lib/git-file-state.js";
import {
  gitStateTitle,
  gitStatusClassName,
  gitStatusShortLabel,
} from "@/lib/git-file-state.js";

interface EditorTabProps extends Omit<
  ComponentPropsWithoutRef<"div">,
  "onClick" | "onContextMenu"
> {
  name: string;
  path?: string;
  active: boolean;
  dirty: boolean;
  onClick: () => void;
  onClose: () => void;
  onContextMenu?: MouseEventHandler<HTMLDivElement>;
  gitState?: GitFileState;
  onGitIndicatorClick?: () => void;
  targetAvailable?: boolean;
}

export const EditorTab = forwardRef<HTMLDivElement, EditorTabProps>(
  function EditorTab(
    {
      name,
      path,
      active,
      dirty,
      onClick,
      onClose,
      onContextMenu,
      gitState,
      onGitIndicatorClick,
      targetAvailable = true,
      ...props
    },
    ref,
  ) {
    return (
      <div
        {...props}
        ref={ref}
        role="tab"
        aria-selected={active}
        tabIndex={active ? 0 : -1}
        className={cn(
          "flex items-center gap-1.5 px-3 py-1 text-xs cursor-pointer select-none shrink-0",
          "border-r border-[var(--color-border)] transition-colors",
          active
            ? "bg-[var(--color-surface)] text-[var(--color-text)] border-b-2 border-b-[var(--color-primary)]"
            : "bg-[var(--color-surface-2)] text-[var(--color-text-muted)] hover:bg-[var(--color-surface)] hover:text-[var(--color-text)]",
        )}
        onClick={onClick}
        onContextMenu={onContextMenu}
      >
        <FileDecorationIcon pathOrName={path ?? name} className="h-3.5 w-3.5" />
        <span className="max-w-[140px] truncate">{name}</span>
        {dirty && (
          <span
            className="h-1.5 w-1.5 rounded-full bg-[var(--color-primary)] shrink-0"
            title="Unsaved changes"
          />
        )}
        {!targetAvailable && (
          <AlertTriangle
            className="h-3 w-3 shrink-0 text-amber-400"
            aria-label="Worktree unavailable"
          >
            <title>Worktree unavailable; edits are preserved locally</title>
          </AlertTriangle>
        )}
        {gitState && (
          <button
            type="button"
            className={cn(
              "h-4 min-w-4 shrink-0 rounded-[2px] border px-0.5 text-[9px] font-black leading-none",
              gitStatusClassName(gitState),
            )}
            title={`Open diff: ${gitStateTitle(gitState)}`}
            onPointerDown={(event) => {
              if (
                event.pointerType === "touch" ||
                event.pointerType === "pen"
              ) {
                event.stopPropagation();
              }
            }}
            onContextMenu={(event) => {
              const nativeEvent = event.nativeEvent as MouseEvent & {
                pointerType?: string;
              };
              const isNonMouseContextMenu =
                nativeEvent.pointerType !== undefined &&
                nativeEvent.pointerType !== "mouse";
              const isLegacyNonRightButton =
                nativeEvent.pointerType === undefined &&
                nativeEvent.button !== 2;
              if (isNonMouseContextMenu || isLegacyNonRightButton) {
                event.preventDefault();
                event.stopPropagation();
              }
            }}
            onClick={(event) => {
              event.stopPropagation();
              onGitIndicatorClick?.();
            }}
            aria-label={`Open diff for ${name}`}
          >
            {gitStatusShortLabel(gitState)}
          </button>
        )}
        <button
          type="button"
          className={cn(
            "ml-0.5 rounded-sm p-0.5 shrink-0 transition-colors",
            "text-[var(--color-text-muted)] hover:text-[var(--color-text)] hover:bg-[var(--color-surface-2)]",
          )}
          onPointerDown={(event) => {
            if (event.pointerType === "touch" || event.pointerType === "pen") {
              event.stopPropagation();
            }
          }}
          onContextMenu={(event) => {
            const nativeEvent = event.nativeEvent as MouseEvent & {
              pointerType?: string;
            };
            const isNonMouseContextMenu =
              nativeEvent.pointerType !== undefined &&
              nativeEvent.pointerType !== "mouse";
            const isLegacyNonRightButton =
              nativeEvent.pointerType === undefined && nativeEvent.button !== 2;
            if (isNonMouseContextMenu || isLegacyNonRightButton) {
              event.preventDefault();
              event.stopPropagation();
            }
          }}
          onClick={(e) => {
            e.stopPropagation();
            onClose();
          }}
          aria-label={`Close ${name}`}
        >
          <X className="h-3 w-3" />
        </button>
      </div>
    );
  },
);
