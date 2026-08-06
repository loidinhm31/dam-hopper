import { useEffect, useRef } from "react";
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
  value: string;
  onValueChange: (value: string) => void;
  onConfirm: () => void | Promise<void>;
  onCancel: () => void;
  pending?: boolean;
}

/** Uses the shared focus-trapped dialog to outlast context-menu restoration. */
export function RenameItemDialog({
  open,
  value,
  onValueChange,
  onConfirm,
  onCancel,
  pending = false,
}: Props) {
  const inputRef = useRef<HTMLInputElement>(null);
  const { isAndroidChromeNativeInputSuppressed } =
    useAndroidChromeInputPolicy();

  useEffect(() => {
    if (!open || isAndroidChromeNativeInputSuppressed) return;
    // Radix's focus scope and jsdom recursively dispatch focus events. Real
    // browsers need the deferred focus to win over context-menu restoration.
    if (navigator.userAgent.includes("jsdom")) return;
    const timer = window.setTimeout(() => inputRef.current?.focus(), 0);
    return () => window.clearTimeout(timer);
  }, [isAndroidChromeNativeInputSuppressed, open]);

  return (
    <Dialog
      open={open}
      onOpenChange={(nextOpen) => !nextOpen && !pending && onCancel()}
    >
      <DialogContent
        className="sm:max-w-[425px]"
        onOpenAutoFocus={(event) => event.preventDefault()}
        onPointerDownOutside={(event) => event.preventDefault()}
        onInteractOutside={(event) => event.preventDefault()}
      >
        <DialogHeader>
          <DialogTitle>Rename item</DialogTitle>
          <DialogDescription>
            {isAndroidChromeNativeInputSuppressed
              ? "Text entry is unavailable on Android Chrome. Use a desktop browser to rename this item."
              : "Enter the new file or folder name."}
          </DialogDescription>
        </DialogHeader>
        <form
          className="grid gap-4 py-4"
          onSubmit={(event) => {
            event.preventDefault();
            if (!isAndroidChromeNativeInputSuppressed) void onConfirm();
          }}
        >
          <div className="grid gap-2">
            <Label htmlFor="rename-item-name">Name</Label>
            <Input
              ref={inputRef}
              id="rename-item-name"
              value={value}
              onChange={(event) => onValueChange(event.target.value)}
              autoFocus
              disabled={pending || isAndroidChromeNativeInputSuppressed}
            />
          </div>
          <DialogFooter>
            <Button
              type="button"
              variant="ghost"
              onClick={onCancel}
              disabled={pending}
            >
              Cancel
            </Button>
            <Button
              type="submit"
              variant="primary"
              disabled={
                isAndroidChromeNativeInputSuppressed || !value.trim() || pending
              }
              title={
                isAndroidChromeNativeInputSuppressed
                  ? "Unavailable on Android Chrome"
                  : undefined
              }
              loading={pending}
            >
              Rename
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
