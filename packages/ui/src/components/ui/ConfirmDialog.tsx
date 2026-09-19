import type { ReactNode } from "react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/Dialog.js";
import { Button } from "@/components/atoms/Button.js";

export interface ConfirmDialogProps {
  open: boolean;
  onClose?: () => void;
  onConfirm: () => void | Promise<void>;
  title: ReactNode;
  description?: ReactNode;
  confirmText?: string;
  cancelText?: string;
  variant?: "primary" | "secondary" | "danger" | "ghost";
  loading?: boolean;
  children?: ReactNode;
}

export function ConfirmDialog({
  open,
  onClose,
  onConfirm,
  title,
  description,
  confirmText = "Confirm",
  cancelText = "Cancel",
  variant = "primary",
  loading = false,
  children,
}: ConfirmDialogProps) {
  return (
    <Dialog
      open={open}
      onOpenChange={(nextOpen) => {
        if (!nextOpen && !loading) {
          onClose?.();
        }
      }}
    >
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
          {description && (
            <DialogDescription className="text-xs text-[var(--color-text-muted)] whitespace-pre-line">
              {description}
            </DialogDescription>
          )}
        </DialogHeader>
        {children}
        <DialogFooter className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
          {cancelText && (
            <Button
              type="button"
              variant="ghost"
              size="sm"
              disabled={loading}
              onClick={onClose}
            >
              {cancelText}
            </Button>
          )}
          <Button
            type="button"
            variant={variant}
            size="sm"
            loading={loading}
            disabled={loading}
            onClick={() => void onConfirm()}
          >
            {confirmText}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

export interface AlertDialogProps {
  open: boolean;
  onClose: () => void;
  title: ReactNode;
  description?: ReactNode;
  closeText?: string;
  variant?: "primary" | "secondary" | "danger" | "ghost";
  children?: ReactNode;
}

export function AlertDialog({
  open,
  onClose,
  title,
  description,
  closeText = "OK",
  variant = "primary",
  children,
}: AlertDialogProps) {
  return (
    <Dialog
      open={open}
      onOpenChange={(nextOpen) => {
        if (!nextOpen) {
          onClose();
        }
      }}
    >
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
          {description && (
            <DialogDescription className="text-xs text-[var(--color-text-muted)] whitespace-pre-line">
              {description}
            </DialogDescription>
          )}
        </DialogHeader>
        {children}
        <DialogFooter className="flex justify-end">
          <Button type="button" variant={variant} size="sm" onClick={onClose}>
            {closeText}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
