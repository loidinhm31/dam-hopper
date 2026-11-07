import {
  ClipboardCopy,
  Copy,
  Download,
  Eye,
  FilePlus,
  FolderCheck,
  FolderPlus,
  FolderX,
  Pencil,
  Terminal,
  Trash2,
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
  onPreview?: () => void;
  onNewFile: () => void;
  onNewFolder: () => void;
  onRename: () => void;
  onDelete: () => void;
  onDownload: () => void;
  onUpload: () => void;
  onOpenTerminalHere?: () => void;
  onMarkProject?: () => void;
  onUnmarkProject?: () => void;
}

export interface BuildItemsArgs extends TreeContextMenuHandlers {
  isDir: boolean;
  /** When true (e.g. project root unknown), disable the absolute-path copy. */
  absolutePathDisabled?: boolean;
  /** When true (e.g. HTML file), render preview action. */
  isHtml?: boolean;
  /** Whether this directory is a recognized marked project root. */
  isMarkedProject?: boolean;
}
/**
 * Build the ordered list of context-menu actions. Extracted as a pure helper
 * so it can be unit-tested without rendering (mirrors `getEditorTabContextMenuItems`).
 */
export function getTreeContextMenuItems({
  isDir,
  absolutePathDisabled = false,
  isHtml = false,
  onCopyAbsolutePath,
  onCopyRelativePath,
  onPreview,
  onNewFile,
  onNewFolder,
  onRename,
  onDelete,
  onDownload,
  onUpload,
  onOpenTerminalHere,
  onMarkProject,
  onUnmarkProject,
  isMarkedProject = false,
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
    ...(!isDir && isHtml && onPreview
      ? [
          {
            label: "Preview",
            icon: <Eye className="h-3.5 w-3.5" />,
            onClick: onPreview,
          },
        ]
      : []),
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
          ...(onOpenTerminalHere
            ? [
                {
                  label: "Open Terminal Here",
                  icon: <Terminal className="h-3.5 w-3.5" />,
                  onClick: onOpenTerminalHere,
                },
              ]
            : []),
          ...(isMarkedProject && onUnmarkProject
            ? [
                {
                  label: "Unmark Project…",
                  icon: <FolderX className="h-3.5 w-3.5" />,
                  onClick: onUnmarkProject,
                  danger: true,
                },
              ]
            : !isMarkedProject && onMarkProject
              ? [
                  {
                    label: "Mark as Project…",
                    icon: <FolderCheck className="h-3.5 w-3.5" />,
                    onClick: onMarkProject,
                  },
                ]
              : []),
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
