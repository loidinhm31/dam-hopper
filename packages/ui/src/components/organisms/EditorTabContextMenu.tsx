import { ContextMenu } from "@/components/ui/ContextMenu.js";

export interface EditorTabContextMenuItem {
  label: string;
  disabled?: boolean;
  onSelect: () => void;
}

interface EditorTabContextMenuProps {
  items: EditorTabContextMenuItem[];
}

export function getEditorTabContextMenuItems(args: {
  tabCount: number;
  onCloseTab: () => void;
  onCloseOthers: () => void;
  onCloseAll: () => void;
}) {
  const { tabCount, onCloseTab, onCloseOthers, onCloseAll } = args;
  return [
    { label: "Close", onSelect: onCloseTab },
    {
      label: "Close Other Tabs",
      disabled: tabCount <= 1,
      onSelect: onCloseOthers,
    },
    { label: "Close All Tabs", onSelect: onCloseAll },
  ] satisfies EditorTabContextMenuItem[];
}

export function EditorTabContextMenu({ items }: EditorTabContextMenuProps) {
  return (
    <ContextMenu.Portal>
      <ContextMenu.Content className="w-44">
        {items.map((item) => (
          <ContextMenu.Item
            key={item.label}
            disabled={item.disabled}
            onSelect={item.onSelect}
          >
            {item.label}
          </ContextMenu.Item>
        ))}
      </ContextMenu.Content>
    </ContextMenu.Portal>
  );
}
