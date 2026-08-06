export interface MobilePanelTriggerPosition {
  left: number;
  top: number;
}

export interface MobilePanelTriggerSize {
  width: number;
  height: number;
}

export interface MobileSafeAreaInsets {
  top: number;
  right: number;
  bottom: number;
  left: number;
}

const TRIGGER_VIEWPORT_MARGIN = 8;
const TERMINAL_ACCESSORY_MAX_HEIGHT = 400;
const TERMINAL_ACCESSORY_GAP = 56;

export function clampMobilePanelTriggerPosition(
  position: MobilePanelTriggerPosition,
  size: MobilePanelTriggerSize,
  avoidTerminalAccessory: boolean,
  viewport: MobilePanelTriggerSize,
  safeArea: MobileSafeAreaInsets,
): MobilePanelTriggerPosition {
  const topNavHeight = safeArea.top + 48;
  const bottomInset = avoidTerminalAccessory
    ? Math.min(
        TERMINAL_ACCESSORY_MAX_HEIGHT,
        Math.max(
          safeArea.bottom + TRIGGER_VIEWPORT_MARGIN,
          viewport.height - topNavHeight - TERMINAL_ACCESSORY_GAP,
        ),
      )
    : safeArea.bottom + TRIGGER_VIEWPORT_MARGIN;
  const maxLeft = Math.max(
    safeArea.left + TRIGGER_VIEWPORT_MARGIN,
    viewport.width - size.width - safeArea.right - TRIGGER_VIEWPORT_MARGIN,
  );
  const maxTop = Math.max(
    topNavHeight + TRIGGER_VIEWPORT_MARGIN,
    viewport.height - size.height - bottomInset,
  );

  return {
    left: Math.min(
      Math.max(position.left, safeArea.left + TRIGGER_VIEWPORT_MARGIN),
      maxLeft,
    ),
    top: Math.min(
      Math.max(position.top, topNavHeight + TRIGGER_VIEWPORT_MARGIN),
      maxTop,
    ),
  };
}

function parseCssPixel(
  style: CSSStyleDeclaration,
  property: string,
): number | null {
  const parsed = Number.parseFloat(style.getPropertyValue(property));
  return Number.isFinite(parsed) ? parsed : null;
}

function readSafeAreaInset(edge: keyof MobileSafeAreaInsets): number {
  const probe = document.createElement("div");
  const property = `padding-${edge}`;
  probe.style.cssText =
    "position:fixed;visibility:hidden;pointer-events:none;width:0;height:0;";
  probe.style.setProperty(property, `env(safe-area-inset-${edge})`);
  document.body.append(probe);
  const value = Number.parseFloat(
    getComputedStyle(probe).getPropertyValue(property),
  );
  probe.remove();
  return Number.isFinite(value) ? value : 0;
}

function resolveInset(
  style: CSSStyleDeclaration,
  edge: keyof MobileSafeAreaInsets,
): number {
  return parseCssPixel(style, `--safe-area-${edge}`) ?? readSafeAreaInset(edge);
}

export function resolveMobileSafeAreaInsets(): MobileSafeAreaInsets {
  const style = getComputedStyle(document.documentElement);
  return {
    top: resolveInset(style, "top"),
    right: resolveInset(style, "right"),
    bottom: resolveInset(style, "bottom"),
    left: resolveInset(style, "left"),
  };
}
