import {
  BROWSER_RECOVERY_VERSION,
  type BrowserOwnerScope,
  type BrowserRecoveryDisk,
  type BrowserRecoveryOperation,
  type BrowserRecoveryOperationKind,
  type RememberedBrowserGroup,
} from "./browser-tab-types.js";

function isValidScope(s: unknown): s is BrowserOwnerScope {
  if (!s || typeof s !== "object") return false;
  if (!("profileId" in s && typeof s.profileId === "string" && s.profileId.trim().length > 0)) return false;
  if (!("endpoint" in s && typeof s.endpoint === "string" && s.endpoint.trim().length > 0)) return false;
  if (!("principal" in s && typeof s.principal === "string" && s.principal.trim().length > 0)) return false;
  if (!("namespace" in s && (s.namespace === "prod" || s.namespace === "dev"))) return false;
  return true;
}

const ALLOWED_OP_KINDS: Record<string, true> = {
  create: true,
  "close-tab": true,
  "close-window": true,
};

export function validateBrowserRecoveryDisk(parsed: unknown): BrowserRecoveryDisk {
  if (!parsed || typeof parsed !== "object" || !("version" in parsed) || parsed.version !== BROWSER_RECOVERY_VERSION) {
    throw new Error("Invalid browser recovery schema version");
  }

  const obj = parsed as Record<string, unknown>;
  if (!Array.isArray(obj.groups) || !Array.isArray(obj.addressSuppressedScopes) || !Array.isArray(obj.operations)) {
    throw new Error("Invalid browser recovery schema: collections must be arrays");
  }

  const addressSuppressedScopes: BrowserOwnerScope[] = [];
  for (const item of obj.addressSuppressedScopes) {
    if (!isValidScope(item)) throw new Error("Invalid addressSuppressedScopes item in recovery store");
    addressSuppressedScopes.push(Object.freeze({ ...item }));
  }

  const groups: RememberedBrowserGroup[] = [];
  for (const g of obj.groups) {
    if (
      !g || typeof g !== "object" ||
      !("version" in g && g.version === BROWSER_RECOVERY_VERSION) ||
      !("groupId" in g && typeof g.groupId === "string" && g.groupId.trim()) ||
      !("ownerScope" in g && isValidScope(g.ownerScope)) ||
      !("addresses" in g && Array.isArray(g.addresses) && g.addresses.length > 0 && g.addresses.every((a: unknown) => typeof a === "string" && a.trim().length > 0)) ||
      !("activeIndex" in g && typeof g.activeIndex === "number" && Number.isInteger(g.activeIndex) && g.activeIndex >= 0 && g.activeIndex < g.addresses.length)
    ) {
      throw new Error("Invalid remembered group in recovery store");
    }
    groups.push(g as RememberedBrowserGroup);
  }

  const seenOpIds = new Set<string>();
  const operations: BrowserRecoveryOperation[] = [];
  for (const op of obj.operations) {
    if (
      !op || typeof op !== "object" ||
      !("operationId" in op && typeof op.operationId === "string" && op.operationId.trim()) ||
      !("ownerScope" in op && isValidScope(op.ownerScope)) ||
      !("kind" in op && typeof op.kind === "string" && ALLOWED_OP_KINDS[op.kind]) ||
      !("windowId" in op && typeof op.windowId === "string" && op.windowId.trim()) ||
      !("status" in op && (op.status === "pending" || op.status === "unknown"))
    ) {
      throw new Error("Invalid operation record in recovery store");
    }

    if (seenOpIds.has(op.operationId)) {
      throw new Error(`Duplicate operationId in recovery store: ${op.operationId}`);
    }
    seenOpIds.add(op.operationId);

    const kind = op.kind as BrowserRecoveryOperationKind;
    operations.push({
      ...op,
      kind,
      status: op.status === "pending" ? "unknown" : op.status,
    } as BrowserRecoveryOperation);
  }

  return {
    version: BROWSER_RECOVERY_VERSION,
    groups,
    addressSuppressedScopes,
    operations,
  };
}
