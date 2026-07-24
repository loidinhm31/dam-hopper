import type { BrowserSelectionV1 } from "@dam-hopper/browser-bridge";

export interface CaptureRect {
  left: number;
  top: number;
  width: number;
  height: number;
}

export interface CaptureRectInput {
  selection: BrowserSelectionV1["bounds"];
  targetFrame: CaptureRect;
  capturedSize: { width: number; height: number };
  sourceSize: { width: number; height: number };
}

/** Maps a selected target element into physical pixels of a browser-tab frame. */
export function mapBrowserCaptureRect(
  input: CaptureRectInput,
): CaptureRect | null {
  const { selection, targetFrame, capturedSize, sourceSize } = input;
  if (
    ![
      selection.x,
      selection.y,
      selection.width,
      selection.height,
      targetFrame.left,
      targetFrame.top,
      targetFrame.width,
      targetFrame.height,
      capturedSize.width,
      capturedSize.height,
      sourceSize.width,
      sourceSize.height,
    ].every(Number.isFinite) ||
    selection.width <= 0 ||
    selection.height <= 0 ||
    targetFrame.width <= 0 ||
    targetFrame.height <= 0 ||
    capturedSize.width <= 0 ||
    capturedSize.height <= 0 ||
    sourceSize.width <= 0 ||
    sourceSize.height <= 0
  )
    return null;

  const selectionLeft = Math.max(0, selection.x);
  const selectionTop = Math.max(0, selection.y);
  const selectionRight = Math.min(
    targetFrame.width,
    selection.x + selection.width,
  );
  const selectionBottom = Math.min(
    targetFrame.height,
    selection.y + selection.height,
  );
  if (selectionRight <= selectionLeft || selectionBottom <= selectionTop)
    return null;

  const scaleX = capturedSize.width / sourceSize.width;
  const scaleY = capturedSize.height / sourceSize.height;
  const left = Math.max(
    0,
    Math.floor((targetFrame.left + selectionLeft) * scaleX),
  );
  const top = Math.max(
    0,
    Math.floor((targetFrame.top + selectionTop) * scaleY),
  );
  const right = Math.min(
    capturedSize.width,
    Math.ceil((targetFrame.left + selectionRight) * scaleX),
  );
  const bottom = Math.min(
    capturedSize.height,
    Math.ceil((targetFrame.top + selectionBottom) * scaleY),
  );
  if (right <= left || bottom <= top) return null;
  return { left, top, width: right - left, height: bottom - top };
}
