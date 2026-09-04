/**
 * Versioned, framework-neutral protocol used by a cooperative target document.
 * Values are semantic UI data only; HTML, form values, and browser secrets never
 * belong in this contract.
 */
export const BROWSER_BRIDGE_VERSION = 1 as const;
export const MAX_NONCE_LENGTH = 128;
export const MAX_REQUEST_ID_LENGTH = 128;
export const MAX_TEXT_LENGTH = 512;
export const MAX_URL_LENGTH = 2_048;
export const MAX_ACCESSIBLE_NAME_LENGTH = 256;
export const MAX_ATTRIBUTE_COUNT = 12;
export const MAX_ATTRIBUTE_VALUE_LENGTH = 128;
export const MAX_LOCATOR_LENGTH = 512;
export const MAX_LOCATOR_DEPTH = 6;
export const MAX_BOUND = 1_000_000;
export const ALLOWED_SELECTION_ATTRIBUTES = [
  "id",
  "class",
  "name",
  "role",
  "aria-label",
  "data-testid",
  "data-test",
  "data-cy",
] as const;

export type BrowserBridgeCommandType =
  | "dam-hopper:connect"
  | "dam-hopper:start-picker"
  | "dam-hopper:stop-picker"
  | "dam-hopper:go-back"
  | "dam-hopper:go-forward"
  | "dam-hopper:reload";

export type BrowserBridgeEventType =
  | "dam-hopper:bridge-ready"
  | "dam-hopper:selection"
  | "dam-hopper:navigation"
  | "dam-hopper:console"
  | "dam-hopper:error";

export type BrowserConsoleLevel = "debug" | "log" | "info" | "warn" | "error";

export type BrowserBridgeCapability = "navigation" | "console";

export type BrowserBridgeErrorCode =
  | "invalid_message"
  | "invalid_nonce"
  | "picker_unavailable"
  | "picker_failed";

export interface BrowserSelectionBoundsV1 {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface BrowserSelectionV1 {
  version: typeof BROWSER_BRIDGE_VERSION;
  tag: string;
  role: string | null;
  accessibleName: string | null;
  text: string | null;
  attributes: Record<string, string>;
  locator: string;
  bounds: BrowserSelectionBoundsV1;
}

interface BrowserBridgeEnvelope {
  version: typeof BROWSER_BRIDGE_VERSION;
  nonce: string;
  requestId: string;
}

export interface BrowserBridgeCommand extends BrowserBridgeEnvelope {
  type: BrowserBridgeCommandType;
}

export interface BrowserBridgeReadyEvent extends BrowserBridgeEnvelope {
  type: "dam-hopper:bridge-ready";
  /** Absent for extensions built before navigation/console support. */
  capabilities?: BrowserBridgeCapability[];
}

export interface BrowserBridgeSelectionEvent extends BrowserBridgeEnvelope {
  type: "dam-hopper:selection";
  selection: BrowserSelectionV1;
}

export interface BrowserBridgeErrorEvent extends BrowserBridgeEnvelope {
  type: "dam-hopper:error";
  code: BrowserBridgeErrorCode;
  message: string;
}

export interface BrowserBridgeNavigationEvent extends BrowserBridgeEnvelope {
  type: "dam-hopper:navigation";
  url: string;
}

export interface BrowserBridgeConsoleEvent extends BrowserBridgeEnvelope {
  type: "dam-hopper:console";
  level: BrowserConsoleLevel;
  message: string;
}

export type BrowserBridgeEvent =
  | BrowserBridgeReadyEvent
  | BrowserBridgeSelectionEvent
  | BrowserBridgeNavigationEvent
  | BrowserBridgeConsoleEvent
  | BrowserBridgeErrorEvent;

function isBoundedString(value: unknown, max: number): value is string {
  return (
    typeof value === "string" &&
    value.length > 0 &&
    value.length <= max &&
    !/[\u0000-\u001F\u007F]/.test(value)
  );
}

function isPlainRecord(value: unknown): value is Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value))
    return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

function hasExactKeys(
  value: Record<string, unknown>,
  keys: readonly string[],
): boolean {
  const actualKeys = Object.keys(value);
  return (
    actualKeys.length === keys.length &&
    keys.every((key) => Object.prototype.hasOwnProperty.call(value, key))
  );
}

function isCoordinate(value: unknown): value is number {
  return (
    typeof value === "number" &&
    Number.isFinite(value) &&
    value >= -MAX_BOUND &&
    value <= MAX_BOUND
  );
}

function isSize(value: unknown): value is number {
  return (
    typeof value === "number" &&
    Number.isFinite(value) &&
    value >= 0 &&
    value <= MAX_BOUND
  );
}

function isAttributes(value: unknown): value is Record<string, string> {
  if (!isPlainRecord(value) || Object.keys(value).length > MAX_ATTRIBUTE_COUNT)
    return false;
  return Object.entries(value).every(
    ([name, attribute]) =>
      (ALLOWED_SELECTION_ATTRIBUTES as readonly string[]).includes(name) &&
      isBoundedString(attribute, MAX_ATTRIBUTE_VALUE_LENGTH),
  );
}

function isBrowserBridgeErrorCode(
  value: unknown,
): value is BrowserBridgeErrorCode {
  return (
    value === "invalid_message" ||
    value === "invalid_nonce" ||
    value === "picker_unavailable" ||
    value === "picker_failed"
  );
}

function isBrowserConsoleLevel(value: unknown): value is BrowserConsoleLevel {
  return (
    value === "debug" ||
    value === "log" ||
    value === "info" ||
    value === "warn" ||
    value === "error"
  );
}

function isBrowserBridgeCapabilities(
  value: unknown,
): value is BrowserBridgeCapability[] {
  return (
    Array.isArray(value) &&
    value.length <= 2 &&
    value.every(
      (capability) => capability === "navigation" || capability === "console",
    )
  );
}

export function isBrowserSelectionV1(
  value: unknown,
): value is BrowserSelectionV1 {
  if (!isPlainRecord(value) || value.version !== BROWSER_BRIDGE_VERSION)
    return false;
  if (
    !hasExactKeys(value, [
      "version",
      "tag",
      "role",
      "accessibleName",
      "text",
      "attributes",
      "locator",
      "bounds",
    ])
  ) {
    return false;
  }
  if (
    typeof value.tag !== "string" ||
    !/^[a-z][a-z0-9-]{0,63}$/i.test(value.tag)
  )
    return false;
  if (
    value.role !== null &&
    !isBoundedString(value.role, MAX_ATTRIBUTE_VALUE_LENGTH)
  )
    return false;
  if (
    value.accessibleName !== null &&
    !isBoundedString(value.accessibleName, MAX_ACCESSIBLE_NAME_LENGTH)
  )
    return false;
  if (value.text !== null && !isBoundedString(value.text, MAX_TEXT_LENGTH))
    return false;
  if (
    !isAttributes(value.attributes) ||
    !isBoundedString(value.locator, MAX_LOCATOR_LENGTH)
  )
    return false;
  if (
    !isPlainRecord(value.bounds) ||
    !hasExactKeys(value.bounds, ["x", "y", "width", "height"])
  )
    return false;
  return (
    isCoordinate(value.bounds.x) &&
    isCoordinate(value.bounds.y) &&
    isSize(value.bounds.width) &&
    isSize(value.bounds.height)
  );
}

export function parseBrowserBridgeCommand(
  value: unknown,
): BrowserBridgeCommand | null {
  if (!isPlainRecord(value) || value.version !== BROWSER_BRIDGE_VERSION)
    return null;
  if (!hasExactKeys(value, ["version", "type", "nonce", "requestId"]))
    return null;
  if (
    !isBoundedString(value.nonce, MAX_NONCE_LENGTH) ||
    !isBoundedString(value.requestId, MAX_REQUEST_ID_LENGTH)
  )
    return null;
  if (
    value.type !== "dam-hopper:connect" &&
    value.type !== "dam-hopper:start-picker" &&
    value.type !== "dam-hopper:stop-picker" &&
    value.type !== "dam-hopper:go-back" &&
    value.type !== "dam-hopper:go-forward" &&
    value.type !== "dam-hopper:reload"
  )
    return null;
  return value as unknown as BrowserBridgeCommand;
}

export function parseBrowserBridgeEvent(
  value: unknown,
): BrowserBridgeEvent | null {
  if (!isPlainRecord(value) || value.version !== BROWSER_BRIDGE_VERSION)
    return null;
  if (
    !isBoundedString(value.nonce, MAX_NONCE_LENGTH) ||
    !isBoundedString(value.requestId, MAX_REQUEST_ID_LENGTH)
  )
    return null;
  if (value.type === "dam-hopper:bridge-ready") {
    const legacyReady = hasExactKeys(value, [
      "version",
      "type",
      "nonce",
      "requestId",
    ]);
    const capabilityReady =
      hasExactKeys(value, [
        "version",
        "type",
        "nonce",
        "requestId",
        "capabilities",
      ]) && isBrowserBridgeCapabilities(value.capabilities);
    if (legacyReady || capabilityReady)
      return value as unknown as BrowserBridgeReadyEvent;
  }
  if (
    value.type === "dam-hopper:selection" &&
    hasExactKeys(value, [
      "version",
      "type",
      "nonce",
      "requestId",
      "selection",
    ]) &&
    isBrowserSelectionV1(value.selection)
  )
    return value as unknown as BrowserBridgeSelectionEvent;
  if (
    value.type === "dam-hopper:navigation" &&
    hasExactKeys(value, ["version", "type", "nonce", "requestId", "url"]) &&
    isBoundedString(value.url, MAX_URL_LENGTH)
  )
    return value as unknown as BrowserBridgeNavigationEvent;
  if (
    value.type === "dam-hopper:console" &&
    hasExactKeys(value, [
      "version",
      "type",
      "nonce",
      "requestId",
      "level",
      "message",
    ]) &&
    isBrowserConsoleLevel(value.level) &&
    isBoundedString(value.message, MAX_TEXT_LENGTH)
  )
    return value as unknown as BrowserBridgeConsoleEvent;
  if (
    value.type === "dam-hopper:error" &&
    hasExactKeys(value, [
      "version",
      "type",
      "nonce",
      "requestId",
      "code",
      "message",
    ]) &&
    isBrowserBridgeErrorCode(value.code) &&
    isBoundedString(value.message, MAX_TEXT_LENGTH)
  )
    return value as unknown as BrowserBridgeErrorEvent;
  return null;
}
