import {
  ALLOWED_SELECTION_ATTRIBUTES,
  MAX_BOUND,
  MAX_ACCESSIBLE_NAME_LENGTH,
  MAX_ATTRIBUTE_COUNT,
  MAX_ATTRIBUTE_VALUE_LENGTH,
  MAX_LOCATOR_DEPTH,
  MAX_LOCATOR_LENGTH,
  MAX_TEXT_LENGTH,
  type BrowserSelectionV1,
} from "./protocol.js";

export interface PickerOptions {
  onSelection(selection: BrowserSelectionV1): void;
  onError(code: string, message: string): void;
}

export interface PickerController {
  start(): void;
  stop(): void;
  isActive(): boolean;
}

const IMPLICIT_ROLES: Record<string, string> = {
  a: "link",
  button: "button",
  dialog: "dialog",
  img: "img",
  input: "textbox",
  main: "main",
  nav: "navigation",
  select: "combobox",
  textarea: "textbox",
};

function reportError(
  options: PickerOptions,
  code: string,
  message: string,
): void {
  try {
    options.onError(code, message);
  } catch {
    // Error reporting must never break page interaction.
  }
}

function boundedText(
  value: string | null,
  maximum = MAX_TEXT_LENGTH,
): string | null {
  if (!value) return null;

  if (/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F-\u009F]/.test(value))
    return null;
  const normalized = value.replace(/\s+/g, " ").trim();
  if (!normalized) return null;
  return normalized.slice(0, maximum);
}

function isFormValueElement(element: Element): boolean {
  return (
    element instanceof HTMLInputElement ||
    element instanceof HTMLTextAreaElement ||
    element instanceof HTMLSelectElement
  );
}

function elementFromEvent(event: Event): Element | null {
  for (const item of event.composedPath()) {
    if (item instanceof Element) return item;
  }
  return event.target instanceof Element ? event.target : null;
}

function cssEscape(value: string): string {
  if (typeof CSS !== "undefined" && typeof CSS.escape === "function")
    return CSS.escape(value);
  return Array.from(
    value,
    (character) => `\\${character.codePointAt(0)?.toString(16)} `,
  ).join("");
}

function allowedAttributes(element: Element): Record<string, string> {
  const attributes: Record<string, string> = {};

  for (const name of ALLOWED_SELECTION_ATTRIBUTES) {
    if (Object.keys(attributes).length >= MAX_ATTRIBUTE_COUNT) break;
    const value = boundedText(
      element.getAttribute(name),
      MAX_ATTRIBUTE_VALUE_LENGTH,
    );
    if (value) attributes[name] = value;
  }

  return attributes;
}

function locatorPart(element: Element): string {
  const tag = element.tagName.toLowerCase();
  const testAttribute = ["data-testid", "data-test", "data-cy"] as const;
  for (const name of testAttribute) {
    const value = boundedText(
      element.getAttribute(name),
      MAX_ATTRIBUTE_VALUE_LENGTH,
    );
    if (value) return `${tag}[${name}="${cssEscape(value)}"]`;
  }

  const id = boundedText(
    element.getAttribute("id"),
    MAX_ATTRIBUTE_VALUE_LENGTH,
  );
  if (id) return `#${cssEscape(id)}`;

  let part = tag;
  const parent = element.parentElement;
  if (!parent) return part;

  const sameTagSiblings = Array.from(parent.children).filter(
    (child) => child.tagName === element.tagName,
  );
  if (sameTagSiblings.length > 1)
    part += `:nth-of-type(${sameTagSiblings.indexOf(element) + 1})`;
  return part;
}

function locatorFor(element: Element): string {
  const parts: string[] = [];
  let current: Element | null = element;

  while (current && parts.length < MAX_LOCATOR_DEPTH) {
    parts.unshift(locatorPart(current));
    const parent: Element | null = current.parentElement;
    if (parent) {
      current = parent;
      continue;
    }

    const root = current.getRootNode();
    current = root instanceof ShadowRoot ? root.host : null;
  }

  return parts.join(" > ").slice(0, MAX_LOCATOR_LENGTH);
}

function roleFor(element: Element): string | null {
  const explicitRole = boundedText(element.getAttribute("role"), 64);
  if (explicitRole) return explicitRole;

  if (element instanceof HTMLInputElement) {
    return element.type === "checkbox"
      ? "checkbox"
      : element.type === "radio"
        ? "radio"
        : "textbox";
  }

  return IMPLICIT_ROLES[element.tagName.toLowerCase()] ?? null;
}

function accessibleNameFor(element: Element): string | null {
  return (
    boundedText(
      element.getAttribute("aria-label"),
      MAX_ACCESSIBLE_NAME_LENGTH,
    ) ??
    boundedText(element.getAttribute("alt"), MAX_ACCESSIBLE_NAME_LENGTH) ??
    boundedText(element.getAttribute("title"), MAX_ACCESSIBLE_NAME_LENGTH)
  );
}

function selectionFor(element: Element): BrowserSelectionV1 {
  const bounds = element.getBoundingClientRect();
  const text = isFormValueElement(element)
    ? null
    : boundedText(element.textContent);

  return {
    version: 1,
    tag: element.tagName.toLowerCase(),
    role: roleFor(element),
    accessibleName: accessibleNameFor(element),
    text,
    attributes: allowedAttributes(element),
    locator: locatorFor(element),
    bounds: {
      x: boundedCoordinate(bounds.x),
      y: boundedCoordinate(bounds.y),
      width: boundedSize(bounds.width),
      height: boundedSize(bounds.height),
    },
  };
}

function boundedCoordinate(value: number): number {
  if (!Number.isFinite(value)) return 0;
  return Math.max(-MAX_BOUND, Math.min(MAX_BOUND, value));
}

function boundedSize(value: number): number {
  if (!Number.isFinite(value)) return 0;
  return Math.max(0, Math.min(MAX_BOUND, value));
}

function createOutline(document: Document): HTMLDivElement {
  const outline = document.createElement("div");
  outline.setAttribute("aria-hidden", "true");
  outline.setAttribute("data-dam-hopper-picker-outline", "");
  Object.assign(outline.style, {
    background: "rgba(59, 130, 246, 0.10)",
    border: "2px solid #2563eb",
    borderRadius: "2px",
    boxSizing: "border-box",
    display: "none",
    left: "0",
    pointerEvents: "none",
    position: "fixed",
    top: "0",
    zIndex: "2147483647",
  });
  (document.body ?? document.documentElement).append(outline);
  return outline;
}

/** Creates a target-side, DOM-only selection picker. */
export function createPicker(options: PickerOptions): PickerController {
  let active = false;
  let documentRef: Document | null = null;
  let outline: HTMLDivElement | null = null;
  let hovered: Element | null = null;

  const paintOutline = (element: Element | null): void => {
    if (!outline) return;
    if (!element) {
      outline.style.display = "none";
      return;
    }

    const bounds = element.getBoundingClientRect();
    if (
      !Number.isFinite(bounds.x) ||
      !Number.isFinite(bounds.y) ||
      bounds.width < 0 ||
      bounds.height < 0
    ) {
      outline.style.display = "none";
      return;
    }

    outline.style.display = "block";
    outline.style.left = `${bounds.x}px`;
    outline.style.top = `${bounds.y}px`;
    outline.style.width = `${bounds.width}px`;
    outline.style.height = `${bounds.height}px`;
  };

  const onPointerMove = (event: PointerEvent): void => {
    const element = elementFromEvent(event);
    if (element === hovered) return;
    hovered = element;
    paintOutline(element);
  };

  const stop = (): void => {
    if (!documentRef) return;
    documentRef.removeEventListener("pointermove", onPointerMove, true);
    documentRef.removeEventListener("click", onClick, true);
    documentRef.removeEventListener("keydown", onKeyDown, true);
    outline?.remove();
    outline = null;
    hovered = null;
    documentRef = null;
    active = false;
  };

  const onClick = (event: MouseEvent): void => {
    const element = elementFromEvent(event);
    if (!element) return;

    event.preventDefault();
    event.stopImmediatePropagation();
    stop();

    try {
      options.onSelection(selectionFor(element));
    } catch {
      reportError(
        options,
        "selection_failed",
        "Unable to collect a safe element selection.",
      );
    }
  };

  const onKeyDown = (event: KeyboardEvent): void => {
    if (event.key !== "Escape") return;
    event.preventDefault();
    event.stopImmediatePropagation();
    stop();
  };

  return {
    start(): void {
      if (active) return;
      const targetDocument = globalThis.document;
      if (!targetDocument) {
        reportError(
          options,
          "picker_unavailable",
          "The picker requires a browser document.",
        );
        return;
      }

      try {
        documentRef = targetDocument;
        outline = createOutline(targetDocument);
        documentRef.addEventListener("pointermove", onPointerMove, true);
        documentRef.addEventListener("click", onClick, true);
        documentRef.addEventListener("keydown", onKeyDown, true);
        active = true;
      } catch {
        stop();
        reportError(
          options,
          "picker_start_failed",
          "Unable to start the element picker.",
        );
      }
    },
    stop,
    isActive(): boolean {
      return active;
    },
  };
}
