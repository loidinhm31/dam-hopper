import { useState, useId, useEffect } from "react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/Dialog.js";
import { Input } from "@/components/ui/Input.js";
import { Label } from "@/components/ui/Label.js";
import { Button } from "@/components/atoms/Button.js";
import { AlertCircle, FolderPlus, Loader2 } from "lucide-react";
import { useMarkProject } from "@/api/queries.js";
import { toServerFsTarget, type FsTargetRef } from "@/api/ownership.js";

export interface MarkProjectDialogProps {
  open: boolean;
  folderPath: string;
  target?: FsTargetRef;
  profileId?: string;
  onSuccess?: (projectName: string) => void;
  onCancel: () => void;
}

export function MarkProjectDialog({
  open,
  folderPath,
  target,
  profileId,
  onSuccess,
  onCancel,
}: MarkProjectDialogProps) {
  const defaultName = folderPath.split("/").filter(Boolean).pop() ?? "project";
  const [name, setName] = useState(defaultName);
  const [projectType, setProjectType] = useState<string>("");
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  const nameId = useId();
  const pathId = useId();
  const typeId = useId();

  const markMutation = useMarkProject({ profileId });

  useEffect(() => {
    if (open) {
      setName(folderPath.split("/").filter(Boolean).pop() ?? "project");
      setProjectType("");
      setErrorMessage(null);
    }
  }, [open, folderPath]);

  const handleSubmit = async (e?: React.FormEvent) => {
    e?.preventDefault();
    const trimmed = name.trim();
    if (!trimmed || markMutation.isPending) return;

    setErrorMessage(null);
    try {
      const serverTarget = target
        ? toServerFsTarget(target)
        : { type: "workspace" as const };
      await markMutation.mutateAsync({
        name: trimmed,
        target: serverTarget,
        path: folderPath,
        projectType: projectType.trim() || undefined,
      });
      onSuccess?.(trimmed);
      onCancel();
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      setErrorMessage(msg);
    }
  };

  const handleOpenChange = (isOpen: boolean) => {
    if (!isOpen && !markMutation.isPending) {
      onCancel();
    }
  };

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent className="sm:max-w-[425px]" data-testid="mark-project-dialog">
        <DialogHeader>
          <div className="flex items-center gap-2">
            <FolderPlus className="h-5 w-5 text-[var(--color-primary)] shrink-0" />
            <DialogTitle>Mark as Project</DialogTitle>
          </div>
          <DialogDescription>
            Register this folder as a recognized project. This creates a project mark in configuration without modifying your files.
          </DialogDescription>
        </DialogHeader>

        <form onSubmit={handleSubmit} className="grid gap-4 py-2">
          {errorMessage && (
            <div
              data-testid="mark-project-error"
              className="flex items-start gap-2 p-3 text-xs rounded bg-red-500/10 border border-red-500/20 text-red-400"
            >
              <AlertCircle className="h-4 w-4 shrink-0 mt-0.5" />
              <span>{errorMessage}</span>
            </div>
          )}

          <div className="grid gap-1.5">
            <Label htmlFor={nameId}>Project Name</Label>
            <Input
              id={nameId}
              data-testid="mark-project-name-input"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="my-project"
              disabled={markMutation.isPending}
              autoFocus
            />
          </div>

          <div className="grid gap-1.5">
            <Label htmlFor={pathId}>Folder Path</Label>
            <Input
              id={pathId}
              data-testid="mark-project-path-input"
              value={folderPath}
              readOnly
              disabled
              className="opacity-70 bg-[var(--color-surface-2)]"
            />
          </div>

          <div className="grid gap-1.5">
            <Label htmlFor={typeId}>Project Type (optional)</Label>
            <Input
              id={typeId}
              data-testid="mark-project-type-input"
              value={projectType}
              onChange={(e) => setProjectType(e.target.value)}
              placeholder="e.g. rust, node, web"
              disabled={markMutation.isPending}
            />
          </div>

          <DialogFooter className="mt-2">
            <Button
              type="button"
              variant="ghost"
              onClick={onCancel}
              disabled={markMutation.isPending}
            >
              Cancel
            </Button>
            <Button
              type="submit"
              variant="primary"
              data-testid="mark-project-submit"
              disabled={!name.trim() || markMutation.isPending}
            >
              {markMutation.isPending ? (
                <>
                  <Loader2 className="h-3.5 w-3.5 animate-spin mr-1.5" />
                  Marking…
                </>
              ) : (
                "Mark as Project"
              )}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
