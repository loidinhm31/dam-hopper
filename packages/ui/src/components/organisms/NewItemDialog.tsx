import { useState } from "react";
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
import { useAndroidChromeInputPolicy } from "@/contexts/AndroidChromeInputPolicyContext.js";

interface Props {
  open: boolean;
  type: "file" | "folder";
  onConfirm: (name: string) => void;
  onCancel: () => void;
}

export function NewItemDialog({ open, type, onConfirm, onCancel }: Props) {
  const [name, setName] = useState("");
  const { isAndroidChromeNativeInputSuppressed } =
    useAndroidChromeInputPolicy();

  const handleSubmit = (e?: React.FormEvent) => {
    e?.preventDefault();
    if (isAndroidChromeNativeInputSuppressed) return;
    if (name.trim()) {
      onConfirm(name.trim());
      setName("");
    }
  };

  const handleCancel = () => {
    setName("");
    onCancel();
  };

  return (
    <Dialog open={open} onOpenChange={(v) => !v && handleCancel()}>
      <DialogContent className="sm:max-w-[425px]">
        <DialogHeader>
          <DialogTitle>
            Create New {type === "file" ? "File" : "Folder"}
          </DialogTitle>
          <DialogDescription>
            {isAndroidChromeNativeInputSuppressed
              ? "Text entry is unavailable on Android Chrome. Use a desktop browser to create a new item."
              : `Enter a name for the new ${type === "file" ? "file" : "folder"}.`}
          </DialogDescription>
        </DialogHeader>
        <form onSubmit={handleSubmit} className="grid gap-4 py-4">
          <div className="grid gap-2">
            <Label htmlFor="name">Name</Label>
            <Input
              id="name"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder={type === "file" ? "example.ts" : "src"}
              disabled={isAndroidChromeNativeInputSuppressed}
              autoFocus
            />
          </div>
          <DialogFooter>
            <Button type="button" variant="ghost" onClick={handleCancel}>
              Cancel
            </Button>
            <Button
              type="submit"
              variant="primary"
              disabled={isAndroidChromeNativeInputSuppressed || !name.trim()}
              title={
                isAndroidChromeNativeInputSuppressed
                  ? "Unavailable on Android Chrome"
                  : undefined
              }
            >
              Create {type === "file" ? "File" : "Folder"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
