import { useCallback, useEffect, useRef, useState } from "react";
import type { BrowserSelectionV1 } from "@dam-hopper/browser-bridge";
import {
  captureBrowserSelection,
  prepareManualBrowserImage,
  stopCaptureStream,
  type BrowserCaptureOutcome,
  type CaptureRect,
} from "@/lib/browser-capture.js";

export type BrowserCaptureStatus =
  | BrowserCaptureOutcome["kind"]
  | "idle"
  | "capturing";

export interface BrowserCaptureController {
  captureStatus: BrowserCaptureStatus;
  captureMessage: string | null;
  manualImageName: string | null;
  captureImage: Blob | null;
  startCapture: (targetFrame: CaptureRect | null) => Promise<void>;
  setManualImage: (file: Blob) => Promise<void>;
  stopCapture: () => void;
}

/** Keeps optional capture pixels short-lived and separate from bridge state. */
export function useBrowserCapture(
  selection: BrowserSelectionV1 | null,
): BrowserCaptureController {
  const [captureStatus, setCaptureStatus] =
    useState<BrowserCaptureStatus>("idle");
  const [captureMessage, setCaptureMessage] = useState<string | null>(null);
  const [manualImageName, setManualImageName] = useState<string | null>(null);
  const [captureImage, setCaptureImage] = useState<Blob | null>(null);
  const captureStreamRef = useRef<MediaStream | null>(null);
  const captureOperationRef = useRef(0);

  const stopCapture = useCallback(() => {
    captureOperationRef.current += 1;
    stopCaptureStream(captureStreamRef.current);
    captureStreamRef.current = null;
    setCaptureStatus("idle");
    setCaptureMessage(null);
    setManualImageName(null);
    setCaptureImage(null);
  }, []);

  const applyOutcome = useCallback(
    (outcome: BrowserCaptureOutcome, imageName: string | null) => {
      setCaptureStatus(outcome.kind);
      setCaptureImage("png" in outcome ? outcome.png : null);
      setManualImageName(imageName);
      setCaptureMessage(captureMessageFor(outcome));
    },
    [],
  );

  const startCapture = useCallback(
    async (targetFrame: CaptureRect | null) => {
      if (!selection) return;
      stopCapture();
      const operation = captureOperationRef.current;
      setCaptureStatus("capturing");
      setCaptureMessage(
        "Choose this DamHopper browser tab in the picker. Audio is disabled.",
      );
      const outcome = await captureBrowserSelection(
        selection,
        targetFrame,
        (stream) => {
          captureStreamRef.current = stream;
        },
      );
      if (operation !== captureOperationRef.current) return;
      captureStreamRef.current = null;
      applyOutcome(outcome, null);
    },
    [applyOutcome, selection, stopCapture],
  );

  const setManualImage = useCallback(
    async (file: Blob) => {
      stopCapture();
      const operation = captureOperationRef.current;
      setCaptureStatus("capturing");
      setCaptureMessage("Preparing image locally. It will not upload yet.");
      const outcome = await prepareManualBrowserImage(file);
      if (operation !== captureOperationRef.current) return;
      applyOutcome(outcome, file instanceof File ? file.name : "Manual image");
    },
    [applyOutcome, stopCapture],
  );

  useEffect(() => stopCapture, [stopCapture]);

  return {
    captureStatus,
    captureMessage,
    manualImageName,
    captureImage,
    startCapture,
    setManualImage,
    stopCapture,
  };
}

function captureMessageFor(outcome: BrowserCaptureOutcome): string | null {
  switch (outcome.kind) {
    case "captured":
      return "Selected region captured locally. It will not upload until you attach it.";
    case "manual-image":
      return "Manual image prepared locally. It will not upload until you attach it.";
    case "denied":
      return "Capture permission was denied. Your semantic selection is still available.";
    case "wrong-surface":
      return "Choose a browser tab, not a window or screen.";
    case "invalid-rect":
      return "The selected element is outside the captured frame. Try selecting it again.";
    case "too-large":
      return "The image exceeds the safe capture size limit.";
    case "unsupported":
      return "Screen capture is unavailable here. You can attach a PNG or JPEG manually.";
  }
}
