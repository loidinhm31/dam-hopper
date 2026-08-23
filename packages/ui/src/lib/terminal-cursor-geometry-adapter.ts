import type { Terminal } from "@xterm/xterm";

export interface CursorGeometry {
  x: number;
  y: number;
  lineHeight: number;
  availableWidth: number;
}

type RectLike = Pick<
  DOMRect,
  "left" | "top" | "right" | "bottom" | "width" | "height"
>;
type HostSize = Pick<HTMLElement, "clientWidth" | "clientHeight">;

function finiteRect(rect: RectLike): boolean {
  return (
    Object.values(rect).every(Number.isFinite) &&
    rect.width > 0 &&
    rect.height > 0
  );
}

function contains(host: RectLike, rect: RectLike): boolean {
  return (
    rect.left >= host.left &&
    rect.top >= host.top &&
    rect.right <= host.right &&
    rect.bottom <= host.bottom
  );
}

export function geometryFromTextarea(
  host: RectLike,
  textarea: RectLike,
): CursorGeometry | null {
  if (!finiteRect(host) || !finiteRect(textarea) || !contains(host, textarea)) {
    return null;
  }
  const availableWidth = host.right - textarea.right;
  if (availableWidth <= 0) return null;
  return {
    x: textarea.right - host.left,
    y: textarea.top - host.top,
    lineHeight: textarea.height,
    availableWidth,
  };
}

export function geometryFromScreenGrid(
  host: RectLike,
  screen: RectLike,
  cols: number,
  rows: number,
  cursorX: number,
  cursorY: number,
): CursorGeometry | null {
  if (
    !finiteRect(host) ||
    !finiteRect(screen) ||
    !contains(host, screen) ||
    !Number.isInteger(cols) ||
    !Number.isInteger(rows) ||
    cols < 2 ||
    rows < 1 ||
    cursorX < 0 ||
    cursorX >= cols ||
    cursorY < 0 ||
    cursorY >= rows
  ) {
    return null;
  }
  const cellWidth = screen.width / cols;
  const cellHeight = screen.height / rows;
  if (
    !Number.isFinite(cellWidth) ||
    !Number.isFinite(cellHeight) ||
    cellWidth < 1 ||
    cellHeight < 1
  ) {
    return null;
  }
  // xterm's cursorX is the cell where the next grapheme will render.
  const right = screen.left + cursorX * cellWidth;
  const top = screen.top + cursorY * cellHeight;
  const availableWidth = host.right - right;
  if (availableWidth <= 0 || top < host.top || top + cellHeight > host.bottom)
    return null;
  return {
    x: right - host.left,
    y: top - host.top,
    lineHeight: cellHeight,
    availableWidth,
  };
}

/**
 * Convert rendered DOM deltas into the CSS-pixel space used by the host.
 *
 * CSS zoom changes getBoundingClientRect() without changing the host's layout
 * client size. Measuring the two lets this adapter normalize geometry once,
 * while keeping the suggestion component independent of zoom implementation.
 */
export function normalizeCursorGeometry(
  geometry: CursorGeometry,
  hostRect: RectLike,
  hostSize: HostSize,
): CursorGeometry | null {
  if (
    !finiteRect(hostRect) ||
    !Number.isFinite(hostSize.clientWidth) ||
    !Number.isFinite(hostSize.clientHeight) ||
    hostSize.clientWidth <= 0 ||
    hostSize.clientHeight <= 0
  ) {
    return null;
  }

  const scaleX = hostRect.width / hostSize.clientWidth;
  const scaleY = hostRect.height / hostSize.clientHeight;
  if (
    !Number.isFinite(scaleX) ||
    !Number.isFinite(scaleY) ||
    scaleX <= 0 ||
    scaleY <= 0
  ) {
    return null;
  }

  const normalized = {
    x: geometry.x / scaleX,
    y: geometry.y / scaleY,
    lineHeight: geometry.lineHeight / scaleY,
    availableWidth: geometry.availableWidth / scaleX,
  };
  return Object.values(normalized).every(Number.isFinite) &&
    normalized.lineHeight > 0 &&
    normalized.availableWidth > 0
    ? normalized
    : null;
}

/**
 * Isolates xterm cursor measurement behind validated public textarea and a
 * single screen-grid fallback. Unknown geometry always reports null.
 */
export class TerminalCursorGeometryAdapter {
  private frame: number | undefined;
  private readonly disposables: Array<{ dispose: () => void }> = [];
  private readonly resizeObserver: ResizeObserver;
  private readonly host: HTMLElement;

  constructor(
    private readonly terminal: Terminal,
    private readonly onGeometry: (geometry: CursorGeometry | null) => void,
  ) {
    const host = terminal.element;
    if (!host)
      throw new Error(
        "Terminal must be opened before measuring cursor geometry",
      );
    this.host = host;
    this.resizeObserver = new ResizeObserver(() => this.invalidate());
    this.resizeObserver.observe(host);
    this.disposables.push(
      terminal.onCursorMove(() => this.invalidate()),
      terminal.onWriteParsed(() => this.invalidate()),
      terminal.onResize(() => this.invalidate()),
      terminal.onScroll(() => this.invalidate()),
      terminal.buffer.onBufferChange(() => this.hide()),
    );
    globalThis.visualViewport?.addEventListener("resize", this.invalidate);
    globalThis.visualViewport?.addEventListener("scroll", this.invalidate);
    document.fonts?.addEventListener("loadingdone", this.invalidate);
    this.invalidate();
  }

  invalidate = (): void => {
    if (this.frame !== undefined) return;
    this.frame = requestAnimationFrame(() => {
      this.frame = undefined;
      this.onGeometry(this.measure());
    });
  };

  hide = (): void => {
    if (this.frame !== undefined) cancelAnimationFrame(this.frame);
    this.frame = undefined;
    this.onGeometry(null);
  };

  dispose(): void {
    this.hide();
    this.resizeObserver.disconnect();
    this.disposables.forEach((disposable) => disposable.dispose());
    globalThis.visualViewport?.removeEventListener("resize", this.invalidate);
    globalThis.visualViewport?.removeEventListener("scroll", this.invalidate);
    document.fonts?.removeEventListener("loadingdone", this.invalidate);
  }

  private measure(): CursorGeometry | null {
    const buffer = this.terminal.buffer.active;
    if (
      !this.host.isConnected ||
      buffer.type !== "normal" ||
      buffer.viewportY !== buffer.baseY
    ) {
      return null;
    }
    const hostRect = this.host.getBoundingClientRect();
    const textareaRect = this.terminal.textarea?.getBoundingClientRect();
    if (textareaRect) {
      const textareaGeometry = geometryFromTextarea(hostRect, textareaRect);
      if (textareaGeometry) {
        return normalizeCursorGeometry(textareaGeometry, hostRect, this.host);
      }
    }
    const screen = this.host.querySelector<HTMLElement>(".xterm-screen");
    if (!screen) return null;
    const screenGeometry = geometryFromScreenGrid(
      hostRect,
      screen.getBoundingClientRect(),
      this.terminal.cols,
      this.terminal.rows,
      buffer.cursorX,
      buffer.cursorY,
    );
    return screenGeometry
      ? normalizeCursorGeometry(screenGeometry, hostRect, this.host)
      : null;
  }
}
