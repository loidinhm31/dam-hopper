import { useRef, useState, type ChangeEvent, type ClipboardEvent } from "react";
import { ClipboardPaste, ImagePlus, MonitorUp } from "lucide-react";
import { Button } from "@/components/atoms/Button.js";

export type BrowserCaptureStatus =
  | "idle"
  | "capturing"
  | "captured"
  | "denied"
  | "wrong-surface"
  | "unsupported"
  | "invalid-rect"
  | "too-large"
  | "manual-image"
  | "error";

interface BrowserDebugCaptureControlsProps {
  hasSelection: boolean;
  captureStatus?: BrowserCaptureStatus;
  captureMessage?: string | null;
  manualImageName?: string | null;
  onStartCapture?: () => void;
  onManualImage?: (file: File) => void;
}

const STATUS_COPY: Record<BrowserCaptureStatus, string> = {
  idle: "Capture is optional. Your selected element metadata remains available.",
  capturing: "Choose this DamHopper browser tab in the sharing picker.",
  captured:
    "Selected region captured locally. It has not been attached or sent.",
  denied:
    "Screen capture was not granted. Add a PNG or JPEG instead if needed.",
  "wrong-surface": "Choose a browser tab, or add a PNG or JPEG instead.",
  unsupported:
    "Capture is unavailable in this browser. Add a PNG or JPEG instead.",
  "invalid-rect":
    "The selected region could not be captured. Add a PNG or JPEG instead.",
  "too-large":
    "The captured image is too large. Add a smaller PNG or JPEG instead.",
  "manual-image":
    "Manual image ready locally. It has not been attached or sent.",
  error: "Capture could not be completed. Add a PNG or JPEG instead.",
};

function isSupportedImage(file: File) {
  return file.type === "image/png" || file.type === "image/jpeg";
}

export function BrowserDebugCaptureControls({
  hasSelection,
  captureStatus = "idle",
  captureMessage,
  manualImageName,
  onStartCapture,
  onManualImage,
}: BrowserDebugCaptureControlsProps) {
  const inputRef = useRef<HTMLInputElement>(null);
  const pasteTargetRef = useRef<HTMLDivElement>(null);
  const [fileError, setFileError] = useState<string | null>(null);
  const message = fileError ?? captureMessage ?? STATUS_COPY[captureStatus];
  const disabled = !hasSelection;

  const acceptFile = (file: File | undefined) => {
    if (!file) return;
    if (!isSupportedImage(file)) {
      setFileError("Choose or paste a PNG or JPEG image.");
      return;
    }
    setFileError(null);
    onManualImage?.(file);
  };

  const onFileChange = (event: ChangeEvent<HTMLInputElement>) => {
    acceptFile(event.target.files?.[0]);
    event.target.value = "";
  };

  const onPaste = (event: ClipboardEvent<HTMLDivElement>) => {
    const file = [...event.clipboardData.files].find(isSupportedImage);
    if (!file) return;
    event.preventDefault();
    acceptFile(file);
  };

  return (
    <section
      aria-label="Selected region capture"
      className="shrink-0 border-t border-[var(--color-border)] bg-[var(--color-surface-2)]/50 px-3 py-2"
    >
      <div className="flex flex-wrap items-center gap-2">
        {onStartCapture && (
          <Button
            type="button"
            size="sm"
            onClick={onStartCapture}
            disabled={disabled || captureStatus === "capturing"}
          >
            <MonitorUp className="h-3.5 w-3.5" aria-hidden="true" />
            {captureStatus === "capturing"
              ? "Waiting for tab…"
              : "Capture browser tab"}
          </Button>
        )}
        {onManualImage && (
          <>
            <input
              ref={inputRef}
              className="sr-only"
              type="file"
              accept="image/png,image/jpeg"
              tabIndex={-1}
              aria-label="Choose PNG or JPEG image"
              onChange={onFileChange}
            />
            <Button
              type="button"
              size="sm"
              variant="ghost"
              onClick={() => inputRef.current?.click()}
              disabled={disabled}
            >
              <ImagePlus className="h-3.5 w-3.5" aria-hidden="true" />
              Choose PNG or JPEG
            </Button>
            <Button
              type="button"
              size="sm"
              variant="ghost"
              onClick={() => pasteTargetRef.current?.focus()}
              disabled={disabled}
              aria-describedby="browser-capture-paste-help"
            >
              <ClipboardPaste className="h-3.5 w-3.5" aria-hidden="true" />
              Paste image
            </Button>
          </>
        )}
      </div>
      <div
        ref={pasteTargetRef}
        tabIndex={disabled ? -1 : 0}
        onPaste={onPaste}
        className="mt-1.5 rounded px-1 py-0.5 text-[11px] text-[var(--color-text-muted)] outline-none focus-visible:ring-1 focus-visible:ring-[var(--color-ring)]"
        aria-live="polite"
      >
        <span id="browser-capture-paste-help">{message}</span>
        {manualImageName && (
          <span className="ml-1 font-mono text-[var(--color-text)]">
            {manualImageName}
          </span>
        )}
      </div>
      <p className="mt-1 px-1 text-[11px] text-[var(--color-text-muted)]">
        Local only — nothing is attached or sent from this panel.
      </p>
      {!hasSelection && (
        <p className="mt-1 text-[11px] text-[var(--color-text-muted)]">
          Select an element before capturing or adding an image.
        </p>
      )}
    </section>
  );
}
