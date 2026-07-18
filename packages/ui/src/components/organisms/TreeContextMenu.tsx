import {
  ClipboardCopy,
  Copy,
  FilePlus,
  FolderPlus,
  Pencil,
  Trash2,
  Download,
  Upload,
} from "lucide-react";
import { cn } from "@/lib/utils.js";
import { ContextMenu } from "@/components/ui/ContextMenu.js";

export interface ContextMenuAction {
  label: string;
  icon: React.ReactNode;
  onClick: () => void;
  danger?: boolean;
  disabled?: boolean;
}

export interface TreeContextMenuHandlers {
  onCopyAbsolutePath: () => void;
  onCopyRelativePath: () => void;
  onNewFile: () => void;
  onNewFolder: () => void;
  onRename: () => void;
  onDelete: () => void;
  onDownload: () => void;
  onUpload: () => void;
}

interface BuildItemsArgs extends TreeContextMenuHandlers {
  isDir: boolean;
  /** When true (e.g. project root unknown), disable the absolute-path copy. */
  absolutePathDisabled?: boolean;
}

/**
 * Build the ordered list of context-menu actions. Extracted as a pure helper
 * so it can be unit-tested without rendering (mirrors `getEditorTabContextMenuItems`).
 */
export function getTreeContextMenuItems({
  isDir,
  absolutePathDisabled = false,
  onCopyAbsolutePath,
  onCopyRelativePath,
  onNewFile,
  onNewFolder,
  onRename,
  onDelete,
  onDownload,
  onUpload,
}: BuildItemsArgs): ContextMenuAction[] {
  return [
    {
      label: "Copy Absolute Path",
      icon: <ClipboardCopy className="h-3.5 w-3.5" />,
      onClick: onCopyAbsolutePath,
      disabled: absolutePathDisabled,
    },
    {
      label: "Copy Relative Path",
      icon: <Copy className="h-3.5 w-3.5" />,
      onClick: onCopyRelativePath,
    },
    ...(isDir
      ? [
          {
            label: "New File",
            icon: <FilePlus className="h-3.5 w-3.5" />,
            onClick: onNewFile,
          },
          {
            label: "New Folder",
            icon: <FolderPlus className="h-3.5 w-3.5" />,
            onClick: onNewFolder,
          },
          {
            label: "Upload Here",
            icon: <Upload className="h-3.5 w-3.5" />,
            onClick: onUpload,
          },
        ]
      : []),
    {
      label: "Rename",
      icon: <Pencil className="h-3.5 w-3.5" />,
      onClick: onRename,
    },
    ...(!isDir
      ? [
          {
            label: "Download",
            icon: <Download className="h-3.5 w-3.5" />,
            onClick: onDownload,
          },
        ]
      : []),
    {
      label: "Delete",
      icon: <Trash2 className="h-3.5 w-3.5" />,
      onClick: onDelete,
      danger: true,
    },
  ];
}

interface Props extends BuildItemsArgs {
  children: React.ReactElement;
}

export function TreeContextMenu(props: Props) {
  const items = getTreeContextMenuItems(props);

  return (
    <ContextMenu.Root>
      <ContextMenu.Trigger>{props.children}</ContextMenu.Trigger>
      <ContextMenu.Portal>
        <ContextMenu.Content className="w-44">
          {items.map((item) => (
            <ContextMenu.Item
              key={item.label}
              disabled={item.disabled}
              onSelect={item.onClick}
              className={cn(
                item.danger &&
                  "text-[var(--color-danger)] focus:bg-[var(--color-danger)]/10 focus:text-[var(--color-danger)]",
              )}
            >
              {item.icon}
              {item.label}
            </ContextMenu.Item>
          ))}
        </ContextMenu.Content>
      </ContextMenu.Portal>
    </ContextMenu.Root>
  );
}
