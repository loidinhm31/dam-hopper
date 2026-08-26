import { useEffect, useRef, useState } from "react";
import { ContextMenu } from "@/components/ui/ContextMenu.js";

export function getDeleteBranchMenuState({
  isCurrent,
}: {
  isCurrent: boolean;
}) {
  return {
    disabled: isCurrent,
    title: isCurrent ? "Cannot delete the checked-out branch" : undefined,
  };
}

interface GitBranchContextMenuProps {
  x: number;
  y: number;
  branchName: string;
  isCurrent: boolean;
  onDelete: () => void;
  onClose: () => void;
}

/**
 * Branch items live inside Radix Select, so the context-menu root is lifted
 * beside Select. Its synthetic native event preserves Radix pointer anchoring
 * while allowing Select to close before this menu opens.
 */
export function GitBranchContextMenu({
  x,
  y,
  branchName,
  isCurrent,
  onDelete,
  onClose,
}: GitBranchContextMenuProps) {
  const [open, setOpen] = useState(false);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const deleteState = getDeleteBranchMenuState({ isCurrent });

  useEffect(() => {
    const trigger = triggerRef.current;
    if (!trigger) return;
    trigger.dispatchEvent(
      new MouseEvent("contextmenu", {
        bubbles: true,
        clientX: x,
        clientY: y,
      }),
    );
  }, [x, y]);

  return (
    <ContextMenu.Root
      open={open}
      onOpenChange={(nextOpen) => {
        setOpen(nextOpen);
        if (!nextOpen) onClose();
      }}
    >
      <ContextMenu.Trigger ref={triggerRef}>
        <button
          type="button"
          tabIndex={-1}
          aria-hidden="true"
          className="absolute -left-[9999px] h-px w-px opacity-0"
        />
      </ContextMenu.Trigger>
      <ContextMenu.Portal>
        <ContextMenu.Content className="w-44">
          <ContextMenu.Label>{branchName}</ContextMenu.Label>
          <ContextMenu.Item
            disabled={deleteState.disabled}
            title={deleteState.title}
            onSelect={onDelete}
            className="text-[var(--color-danger)] focus:bg-[var(--color-danger)]/10 focus:text-[var(--color-danger)]"
          >
            Delete branch
          </ContextMenu.Item>
        </ContextMenu.Content>
      </ContextMenu.Portal>
    </ContextMenu.Root>
  );
}
