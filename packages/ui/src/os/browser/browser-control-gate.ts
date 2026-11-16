import type { ConnectionRef } from "@/api/ownership.js";

const acquireQueues = new Map<string, Promise<void>>();

export const browserControlGateKey = (
  owner: ConnectionRef,
  sessionId: string,
  viewerId: string,
): string => JSON.stringify([owner.profileId, owner.generation, sessionId, viewerId]);

export const clearBrowserControlGateForTesting = (): void => {
  acquireQueues.clear();
};

/** Serialize browser control acquisitions per verified (owner, sessionId, viewerId) tuple. */
export async function runSerializedBrowserControlAcquire<T>(
  owner: ConnectionRef,
  sessionId: string,
  viewerId: string,
  fn: () => Promise<T>,
): Promise<T> {
  const key = browserControlGateKey(owner, sessionId, viewerId);
  const prev = acquireQueues.get(key) ?? Promise.resolve();
  const next = prev.catch(() => {}).then(fn);
  const tail = next.then(() => undefined, () => undefined);
  acquireQueues.set(key, tail);
  try {
    return await next;
  } finally {
    if (acquireQueues.get(key) === tail) acquireQueues.delete(key);
  }
}
