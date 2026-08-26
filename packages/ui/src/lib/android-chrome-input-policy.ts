const TEXT_INPUT_TYPES = new Set([
  "text",
  "search",
  "email",
  "url",
  "tel",
  "password",
  "number",
]);
const CONTENTEDITABLE_VALUES = new Set(["", "true", "plaintext-only"]);
const MANAGED_ATTRIBUTE = "data-dh-android-chrome-input-lock";
const SCAN_SELECTOR = "input, textarea, [contenteditable]";
const FOCUSABLE_SELECTOR =
  "button, a[href], input, textarea, select, [tabindex]";
const MODAL_SELECTOR = '[role="dialog"], dialog, [aria-modal="true"]';

export type AndroidChromeInputKind = "text-input" | "contenteditable";

/**
 * Conservative UA heuristic; it cannot prove browser identity because UAs can
 * be spoofed and Chrome-compatible shells may reuse Chrome tokens.
 */
export function isAndroidChrome(userAgent?: string): boolean {
  const ua =
    userAgent ??
    (typeof navigator !== "undefined" && typeof navigator.userAgent === "string"
      ? navigator.userAgent
      : "");
  return (
    /\bAndroid\b/i.test(ua) &&
    /\bChrome\/\d+/i.test(ua) &&
    /AppleWebKit\/\d+/i.test(ua) &&
    !/(?:\bwv\b|Version\/4\.0|EdgA\/|EdgiOS\/|Edge\/|OPR\/|Opera(?: Mini| Mobi)?\/|SamsungBrowser\/|Firefox\/|FxiOS\/|CriOS\/|YaBrowser\/|Vivaldi\/|DuckDuckGo\/|Brave\/|Chromium\/|Kiwi\/|HuaweiBrowser\/|MiuiBrowser\/|UCBrowser\/|VivoBrowser\/|OplusBrowser\/|HeyTapBrowser\/)/i.test(
      ua,
    )
  );
}

/** Classify only controls that can accept ordinary text entry. */
export function classifyAndroidChromeInput(
  element: Element,
): AndroidChromeInputKind | null {
  const tagName = element.localName.toLowerCase();
  if (tagName === "textarea") return "text-input";
  if (tagName === "input") {
    const type = element.getAttribute("type")?.trim().toLowerCase() || "text";
    return TEXT_INPUT_TYPES.has(type) ? "text-input" : null;
  }
  const contentEditable = element.getAttribute("contenteditable");
  return contentEditable !== null &&
    CONTENTEDITABLE_VALUES.has(contentEditable.trim().toLowerCase())
    ? "contenteditable"
    : null;
}

interface SavedState {
  kind: AndroidChromeInputKind;
  disabled: string | null;
  tabIndex: string | null;
  contentEditable: string | null;
  policyMutations: PolicyMutation[];
}

interface PolicyMutation {
  attribute: string;
  oldValue: string | null;
  newValue: string | null;
}

interface AndroidChromeInputPolicyInstance {
  release: () => void;
  references: number;
}

export interface AndroidChromeInputPolicyOptions {
  document?: Document;
}

const installedPolicies = new WeakMap<
  Document,
  AndroidChromeInputPolicyInstance
>();

function editableFocusTarget(target: Element): HTMLElement | null {
  if (classifyAndroidChromeInput(target)) return target as HTMLElement;
  if (target.localName === "a" || target.localName === "button") return null;
  for (
    let current = target.parentElement;
    current;
    current = current.parentElement
  ) {
    if (classifyAndroidChromeInput(current) === "contenteditable") {
      return current;
    }
  }
  return null;
}

function isHidden(element: HTMLElement): boolean {
  for (
    let current: HTMLElement | null = element;
    current;
    current = current.parentElement
  ) {
    if (
      current.hidden ||
      current.getAttribute("aria-hidden") === "true" ||
      current.hasAttribute("inert") ||
      ("inert" in current &&
        Boolean((current as HTMLElement & { inert?: boolean }).inert))
    ) {
      return true;
    }
    const style = current.ownerDocument.defaultView?.getComputedStyle(current);
    if (style?.display === "none" || style?.visibility === "hidden")
      return true;
  }
  return false;
}

function isDisabled(element: HTMLElement): boolean {
  if (
    "disabled" in element &&
    Boolean((element as HTMLElement & { disabled?: boolean }).disabled)
  ) {
    return true;
  }
  return (
    element.closest("fieldset[disabled]") !== null ||
    element.closest('[aria-disabled="true"]') !== null
  );
}

function isAllowedFocusable(element: HTMLElement): boolean {
  if (
    !element.isConnected ||
    element === element.ownerDocument.body ||
    isHidden(element) ||
    isDisabled(element) ||
    editableFocusTarget(element)
  ) {
    return false;
  }
  return (
    element.matches(FOCUSABLE_SELECTOR) &&
    (element.localName === "button" ||
      element.localName === "a" ||
      element.tabIndex >= 0)
  );
}

function collectFocusable(scope: Element): HTMLElement[] {
  const candidates: HTMLElement[] = [];
  if (scope instanceof HTMLElement) candidates.push(scope);
  candidates.push(...scope.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTOR));
  return candidates;
}

function createPolicy(
  ownerDocument: Document,
): AndroidChromeInputPolicyInstance {
  const savedStates = new WeakMap<HTMLElement, SavedState>();
  const modalFallbacks = new Map<HTMLElement, string | null>();
  let lastAllowedFocus: HTMLElement | null = null;
  let redirectingFocus = false;
  let documentFallbackAdded = false;

  const restoreAttribute = (
    element: HTMLElement,
    name: string,
    value: string | null,
  ): void => {
    if (value === null) element.removeAttribute(name);
    else element.setAttribute(name, value);
  };

  const writePolicyAttribute = (
    element: HTMLElement,
    saved: SavedState,
    name: string,
    value: string | null,
  ): void => {
    const oldValue = element.getAttribute(name);
    if (oldValue === value) return;
    saved.policyMutations.push({
      attribute: name,
      oldValue,
      newValue: value,
    });
    restoreAttribute(element, name, value);
  };

  const release = (element: HTMLElement): void => {
    const saved = savedStates.get(element);
    if (!saved) return;
    savedStates.delete(element);
    if (saved.kind === "text-input") {
      restoreAttribute(element, "disabled", saved.disabled);
    } else {
      restoreAttribute(element, "contenteditable", saved.contentEditable);
    }
    restoreAttribute(element, "tabindex", saved.tabIndex);
    element.removeAttribute(MANAGED_ATTRIBUTE);
  };

  const lock = (element: HTMLElement, kind: AndroidChromeInputKind): void => {
    let saved = savedStates.get(element);
    if (!saved) {
      saved = {
        kind,
        disabled: element.getAttribute("disabled"),
        tabIndex: element.getAttribute("tabindex"),
        contentEditable: element.getAttribute("contenteditable"),
        policyMutations: [],
      };
      savedStates.set(element, saved);
    } else {
      saved.kind = kind;
    }

    if (element.getAttribute(MANAGED_ATTRIBUTE) !== "true") {
      element.setAttribute(MANAGED_ATTRIBUTE, "true");
    }
    const active = ownerDocument.activeElement;
    if (active === element || (active && element.contains(active))) {
      (active as HTMLElement).blur();
    }
    if (kind === "text-input") {
      writePolicyAttribute(element, saved, "disabled", "");
    } else {
      writePolicyAttribute(element, saved, "contenteditable", "false");
    }
    writePolicyAttribute(element, saved, "tabindex", "-1");
  };

  const apply = (element: Element): void => {
    const htmlElement = element as HTMLElement;
    const kind = classifyAndroidChromeInput(element);
    if (kind) {
      lock(htmlElement, kind);
      return;
    }
    const saved = savedStates.get(htmlElement);
    if (
      saved?.kind === "contenteditable" &&
      element.getAttribute("contenteditable") === "false"
    ) {
      lock(htmlElement, saved.kind);
      return;
    }
    release(htmlElement);
  };

  const scan = (element: Element): void => {
    apply(element);
    element.querySelectorAll(SCAN_SELECTOR).forEach(apply);
  };

  const releaseDetachedTree = (node: Node): void => {
    if (!(node instanceof Element) || node.isConnected) return;
    for (const modal of modalFallbacks.keys()) {
      if (modal === node || node.contains(modal)) restoreModalFallback(modal);
    }
    release(node as HTMLElement);
    node
      .querySelectorAll<HTMLElement>(`[${MANAGED_ATTRIBUTE}="true"]`)
      .forEach(release);
  };

  const recordExternalChange = (
    element: HTMLElement,
    attribute: string | null,
    newValue: string | null,
  ): void => {
    if (!attribute) return;
    const saved = savedStates.get(element);
    if (!saved) return;
    if (attribute === "disabled" && saved.kind === "text-input") {
      saved.disabled = newValue;
    } else if (
      attribute === "contenteditable" &&
      saved.kind === "contenteditable"
    ) {
      saved.contentEditable = newValue;
    } else if (attribute === "tabindex") {
      saved.tabIndex = newValue;
    }
  };

  const consumePolicyMutation = (
    element: HTMLElement,
    attribute: string,
    oldValue: string | null,
    newValue: string | null,
  ): boolean => {
    const saved = savedStates.get(element);
    if (!saved) return false;
    const index = saved.policyMutations.findIndex(
      (mutation) =>
        mutation.attribute === attribute &&
        mutation.oldValue === oldValue &&
        mutation.newValue === newValue,
    );
    if (index === -1) return false;
    saved.policyMutations.splice(index, 1);
    return true;
  };

  const restoreModalFallback = (modal: HTMLElement): void => {
    const previousTabIndex = modalFallbacks.get(modal);
    if (previousTabIndex === undefined) return;
    restoreAttribute(modal, "tabindex", previousTabIndex);
    modalFallbacks.delete(modal);
  };

  const modalFocusFallback = (modal: Element): HTMLElement | null => {
    if (
      !(modal instanceof HTMLElement) ||
      isHidden(modal) ||
      isDisabled(modal)
    ) {
      return null;
    }
    if (!modal.hasAttribute("tabindex")) {
      modalFallbacks.set(modal, null);
      modal.setAttribute("tabindex", "-1");
    }
    return modal;
  };

  const focusableFallback = (
    blockedElement: HTMLElement,
  ): HTMLElement | null => {
    const modal = blockedElement.closest(MODAL_SELECTOR);
    if (modal) {
      const localCandidates = collectFocusable(modal);
      const localFallback = localCandidates.find(isAllowedFocusable);
      return localFallback ?? modalFocusFallback(modal);
    }
    const globalCandidates = collectFocusable(ownerDocument.documentElement);
    const orderedCandidates = [
      ...(lastAllowedFocus ? [lastAllowedFocus] : []),
      ...globalCandidates,
    ];
    return orderedCandidates.find(isAllowedFocusable) ?? null;
  };

  const documentFallback = (): HTMLElement => {
    const root = ownerDocument.documentElement;
    if (!root.hasAttribute("tabindex")) {
      root.setAttribute("tabindex", "-1");
      documentFallbackAdded = true;
    }
    return root;
  };

  const onFocusIn = (event: FocusEvent): void => {
    const target = event.target;
    if (!(target instanceof Element)) return;
    const editable = editableFocusTarget(target);
    if (!editable) {
      if (target instanceof HTMLElement && isAllowedFocusable(target)) {
        lastAllowedFocus = target;
      }
      return;
    }
    if (redirectingFocus) return;
    redirectingFocus = true;
    try {
      apply(editable);
      const active = ownerDocument.activeElement;
      if (active instanceof HTMLElement) active.blur();
      const fallback = focusableFallback(editable) ?? documentFallback();
      try {
        fallback?.focus({ preventScroll: true });
      } catch {
        fallback?.focus();
      }
    } finally {
      redirectingFocus = false;
    }
  };

  const processMutationRecords = (records: MutationRecord[]): void => {
    const attributeTargets = new Set<HTMLElement>();
    records.forEach((record, recordIndex) => {
      if (record.type === "attributes") {
        const target = record.target as HTMLElement;
        const attribute = record.attributeName;
        const newValue = (() => {
          for (const nextRecord of records.slice(recordIndex + 1)) {
            if (
              nextRecord.type === "attributes" &&
              nextRecord.target === target &&
              nextRecord.attributeName === attribute
            ) {
              return nextRecord.oldValue;
            }
          }
          return attribute ? target.getAttribute(attribute) : null;
        })();
        if (
          attribute &&
          !consumePolicyMutation(target, attribute, record.oldValue, newValue)
        ) {
          recordExternalChange(target, attribute, newValue);
        }
        attributeTargets.add(target);
      } else {
        record.removedNodes.forEach(releaseDetachedTree);
        record.addedNodes.forEach((node) => {
          if (node instanceof Element) scan(node);
        });
      }
    });
    attributeTargets.forEach((target) => {
      if (target.isConnected) apply(target);
    });
  };

  ownerDocument.addEventListener("focusin", onFocusIn, true);
  const Observer =
    ownerDocument.defaultView?.MutationObserver ?? MutationObserver;
  const observer = new Observer(processMutationRecords);
  observer.observe(ownerDocument, {
    subtree: true,
    childList: true,
    attributes: true,
    attributeOldValue: true,
    attributeFilter: ["disabled", "contenteditable", "tabindex", "type"],
  });
  scan(ownerDocument.documentElement);

  let released = false;
  return {
    references: 1,
    release: () => {
      if (released) return;
      released = true;
      processMutationRecords(observer.takeRecords());
      observer.disconnect();
      ownerDocument.removeEventListener("focusin", onFocusIn, true);
      ownerDocument
        .querySelectorAll<HTMLElement>(`[${MANAGED_ATTRIBUTE}="true"]`)
        .forEach(release);
      for (const modal of modalFallbacks.keys()) restoreModalFallback(modal);
      if (documentFallbackAdded) {
        ownerDocument.documentElement.removeAttribute("tabindex");
        documentFallbackAdded = false;
      }
      lastAllowedFocus = null;
    },
  };
}

/** Installs one document-level policy and returns a complete DOM-restoring cleanup. */
export function installAndroidChromeInputPolicy({
  document: ownerDocument = typeof document !== "undefined"
    ? document
    : undefined,
}: AndroidChromeInputPolicyOptions = {}): () => void {
  if (!ownerDocument || typeof MutationObserver === "undefined")
    return () => {};

  const existing = installedPolicies.get(ownerDocument);
  if (existing) {
    existing.references += 1;
    return releasePolicyReference(ownerDocument, existing);
  }

  const instance = createPolicy(ownerDocument);
  installedPolicies.set(ownerDocument, instance);
  return releasePolicyReference(ownerDocument, instance);
}

function releasePolicyReference(
  ownerDocument: Document,
  instance: AndroidChromeInputPolicyInstance,
): () => void {
  let released = false;
  return () => {
    if (released) return;
    released = true;
    instance.references -= 1;
    if (instance.references === 0) {
      instance.release();
      installedPolicies.delete(ownerDocument);
    }
  };
}
