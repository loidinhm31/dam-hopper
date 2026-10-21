import {
  useEffect,
  useState,
} from "react";
import { Grip } from "lucide-react";
import type { ProjectTargetInput } from "@/api/client.js";
import { useConflictResolver } from "@/hooks/use-conflict-resolver.js";
import { useFloatingPanelGeometry } from "@/hooks/use-floating-panel-geometry.js";
import { TERMINAL_FLOATING_PANEL_TOPMOST_Z_INDEX } from "@/lib/terminal-workspace-panel.js";
import {
  clampResolverPanelLayout,
  handleResolverPanelKeyDown,
  INITIAL_RESOLVER_PANEL_LAYOUT,
  type ResolverPanelLayout,
} from "@/lib/conflict-resolver-panel-state.js";
import { ConflictResolverToolbar } from "./ConflictResolverToolbar.js";
import { MergeConflictEditor } from "./MergeConflictEditor.js";

interface ConflictResolverPanelProps {
  open: boolean;
  project: string;
  target?: ProjectTargetInput;
  targetAvailable?: boolean;
  root?: string;
  zIndex?: number;
  isTopmost?: boolean;
  onActivate?: () => void;
  onHide: () => void;
}

export function ConflictResolverPanel({
  open,
  project,
  target,
  targetAvailable = true,
  root,
  zIndex = TERMINAL_FLOATING_PANEL_TOPMOST_Z_INDEX,
  isTopmost = true,
  onActivate,
  onHide,
}: ConflictResolverPanelProps) {
  const resolver = useConflictResolver(target ?? project, root);
  const conflicts = resolver.conflicts;
  const [selectedFilePath, setSelectedFilePath] = useState<string>("");

  const {
    boundsRef,
    panelRef,
    layout,
    handleDragStart,
    handleResizeStart,
    toggleMaximize,
  } = useFloatingPanelGeometry<ResolverPanelLayout>({
    initialLayout: INITIAL_RESOLVER_PANEL_LAYOUT,
    clampLayout: clampResolverPanelLayout,
  });

  useEffect(() => {
    if (conflicts.length > 0 && !conflicts.some((c) => c.path === selectedFilePath)) {
      setSelectedFilePath(conflicts[0].path);
    }
  }, [conflicts, selectedFilePath]);

  useEffect(() => {
    if (!open) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.defaultPrevented) return;
      const activeEl = document.activeElement;

      // Only handle Escape if focus is inside this panel (or at root document/body)
      if (
        panelRef.current &&
        activeEl &&
        activeEl !== document.body &&
        !panelRef.current.contains(activeEl)
      ) {
        return;
      }

      // If Monaco suggest or find widget or context menu is visible, let Monaco consume Escape
      const hasVisibleMonacoWidget = document.querySelector(
        ".monaco-editor .suggest-widget.visible, .monaco-editor .find-widget.visible, .monaco-menu-container",
      );
      if (hasVisibleMonacoWidget) return;

      handleResolverPanelKeyDown(event, onHide, isTopmost);
    };

    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [isTopmost, onHide, open, panelRef]);

  if (!open) return null;

  return (
    <div
      ref={boundsRef}
      className="pointer-events-none fixed inset-0 z-40"
      style={{ zIndex }}
      data-testid="conflict-resolver-overlay"
    >
      <section
        ref={panelRef}
        tabIndex={-1}
        className="pointer-events-auto absolute flex min-h-0 max-w-[calc(100%-24px)] flex-col overflow-hidden rounded-2xl border border-[var(--color-border)] bg-[var(--color-surface)] shadow-2xl backdrop-blur-xl"
        style={{
          top: layout.top,
          left: layout.left ?? undefined,
          right: layout.left === null ? 12 : undefined,
          width: layout.width,
          height: layout.height,
        }}
        onPointerDownCapture={onActivate}
        onFocusCapture={onActivate}
        data-testid="conflict-resolver-panel"
      >
        <ConflictResolverToolbar
          project={project}
          operation={resolver.operation}
          conflicts={conflicts}
          selectedFilePath={selectedFilePath}
          onSelectFilePath={setSelectedFilePath}
          isMaximized={layout.isMaximized}
          onToggleMaximize={toggleMaximize}
          onHide={onHide}
          onDragStart={handleDragStart}
        />

        <div className="min-h-0 flex-1 overflow-hidden">
          {selectedFilePath ? (
            <MergeConflictEditor
              key={`${project}:${selectedFilePath}`}
              project={project}
              target={target}
              targetAvailable={targetAvailable}
              filePath={selectedFilePath}
              root={root}
              onClose={onHide}
              onResolved={() => {
                resolver.refetchAll();
              }}
            />
          ) : (
            <div className="flex h-full items-center justify-center text-xs text-[var(--color-text-muted)]">
              No conflict selected or all conflicts resolved.
            </div>
          )}
        </div>

        {!layout.isMaximized && (
          <button
            type="button"
            onMouseDown={handleResizeStart}
            className="absolute bottom-2 right-2 z-20 rounded-sm p-1 text-[var(--color-text-muted)] transition-colors hover:bg-[var(--color-surface-2)] hover:text-[var(--color-text)]"
            title="Resize conflict resolver"
            aria-label="Resize conflict resolver"
          >
            <Grip className="h-4 w-4" />
          </button>
        )}
      </section>
    </div>
  );
}
