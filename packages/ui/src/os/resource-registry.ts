import { useCallback, useEffect, useSyncExternalStore } from "react";
import type { ResourceClaimKey } from "./types.js";

export interface ActiveResourceClaim {
  key: ResourceClaimKey;
  windowId: string;
  claimedAt: number;
}

export function formatClaimKey(key: ResourceClaimKey): string {
  const parts = [
    key.resourceKind,
    key.profileId,
    String(key.generation),
    key.resourceId,
  ];
  if (key.incarnation !== undefined) parts.push(`inc:${key.incarnation}`);
  if (key.epoch !== undefined) parts.push(`ep:${key.epoch}`);
  return parts.join("/");
}

export class ResourceRegistry {
  private claims = new Map<string, ActiveResourceClaim>();
  private subscribers = new Set<(claims: Map<string, ActiveResourceClaim>) => void>();

  claim(
    key: ResourceClaimKey,
    windowId: string,
  ): { success: boolean; existingHolderWindowId?: string } {
    const formatted = formatClaimKey(key);
    const existing = this.claims.get(formatted);
    if (existing && existing.windowId === windowId) {
      return { success: true };
    }
    if (existing && existing.windowId !== windowId) {
      return { success: false, existingHolderWindowId: existing.windowId };
    }
    this.claims.set(formatted, { key, windowId, claimedAt: Date.now() });
    this.notify();
    return { success: true };
  }

  release(key: ResourceClaimKey, windowId: string): void {
    const formatted = formatClaimKey(key);
    const existing = this.claims.get(formatted);
    if (existing && existing.windowId === windowId) {
      this.claims.delete(formatted);
      this.notify();
    }
  }

  releaseAllForWindow(windowId: string): void {
    let changed = false;
    for (const [k, claim] of this.claims.entries()) {
      if (claim.windowId === windowId) {
        this.claims.delete(k);
        changed = true;
      }
    }
    if (changed) {
      this.notify();
    }
  }

  getClaim(key: ResourceClaimKey): ActiveResourceClaim | undefined {
    return this.claims.get(formatClaimKey(key));
  }

  getClaimsForWindow(windowId: string): ActiveResourceClaim[] {
    return Array.from(this.claims.values()).filter((c) => c.windowId === windowId);
  }

  clear(): void {
    this.claims.clear();
    this.notify();
  }

  subscribe(listener: (claims: Map<string, ActiveResourceClaim>) => void): () => void {
    this.subscribers.add(listener);
    return () => {
      this.subscribers.delete(listener);
    };
  }

  private notify(): void {
    for (const sub of this.subscribers) {
      sub(new Map(this.claims));
    }
  }
}

export const globalResourceRegistry = new ResourceRegistry();

export interface ResourceClaimStatus {
  success: boolean;
  existingHolderWindowId?: string;
}

const SUCCESS_STATUS: ResourceClaimStatus = Object.freeze({ success: true });
const PENDING_STATUS: ResourceClaimStatus = Object.freeze({ success: false });
const statusCache = new Map<string, ResourceClaimStatus>();

export function getClaimStatus(
  registry: ResourceRegistry,
  key: ResourceClaimKey | null,
  windowId: string,
): ResourceClaimStatus {
  if (!key) return PENDING_STATUS;
  const claim = registry.getClaim(key);
  if (!claim) return PENDING_STATUS;
  if (claim.windowId === windowId) return SUCCESS_STATUS;
  const cached = statusCache.get(claim.windowId);
  if (cached && cached.existingHolderWindowId === claim.windowId) {
    return cached;
  }
  const status = Object.freeze({
    success: false,
    existingHolderWindowId: claim.windowId,
  });
  statusCache.set(claim.windowId, status);
  return status;
}

export function useResourceClaim(
  key: ResourceClaimKey | null,
  windowId: string,
): ResourceClaimStatus {
  const formattedKey = key ? formatClaimKey(key) : null;

  useEffect(() => {
    if (!key) return;

    // Acquisition on mount / key change
    globalResourceRegistry.claim(key, windowId);

    // If claim was initially held by another window, re-attempt when it is released
    const unsubscribe = globalResourceRegistry.subscribe(() => {
      const current = globalResourceRegistry.getClaim(key);
      if (!current) {
        globalResourceRegistry.claim(key, windowId);
      }
    });
    return () => {
      unsubscribe();
      globalResourceRegistry.release(key, windowId);
    };
  }, [formattedKey, windowId]);

  return useSyncExternalStore(
    useCallback(
      (notify) => globalResourceRegistry.subscribe(notify),
      [],
    ),
    useCallback(
      () => getClaimStatus(globalResourceRegistry, key, windowId),
      [formattedKey, windowId],
    ),
    () => PENDING_STATUS,
  );
}
