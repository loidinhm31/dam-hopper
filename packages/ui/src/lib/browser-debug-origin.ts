import type { ConnectionRef } from "@/api/ownership.js";
import type { TunnelInfo } from "@/api/client.js";
import { getActiveProfileId } from "@/api/server-config.js";
export interface BrowserDebugTarget {
  owner: ConnectionRef;
  url: string;
  origin: string;
  source: "loopback" | "tunnel";
  tunnelId?: string;
  revision: number;
}

function parseTargetUrl(value: string): URL | null {
  try {
    const url = new URL(value.trim());
    if (url.username || url.password) return null;
    return url;
  } catch {
    return null;
  }
}

function isLoopbackHost(hostname: string): boolean {
  return (
    hostname === "localhost" || hostname === "127.0.0.1" || hostname === "[::1]"
  );
}

/** Returns whether a redirected target origin remains inside its host policy. */
export function isAllowedBrowserDebugNavigationOrigin(
  origin: string,
  target: BrowserDebugTarget,
): boolean {
  if (origin === target.origin) return true;
  try {
    const url = new URL(origin);
    return (
      url.origin === origin &&
      url.protocol === "http:" &&
      isLoopbackHost(url.hostname)
    );
  } catch {
    return false;
  }
}

/**
 * Resolves only URLs whose origin is safe to embed in the cooperative Browser tool.
 * Loopback targets must use HTTP; public targets must match a ready tunnel origin.
 */
export function resolveBrowserDebugTarget(
  value: string,
  tunnels: readonly TunnelInfo[],
  ownerOrParentOrigin?: ConnectionRef | string,
  parentOrigin?: string,
  revision = 0,
): BrowserDebugTarget | null {
  const input = parseTargetUrl(value);
  if (!input) return null;

  let effectiveOwner: ConnectionRef;
  let effectiveParentOrigin: string | undefined;

  if (typeof ownerOrParentOrigin === "string") {
    effectiveParentOrigin = ownerOrParentOrigin;
    effectiveOwner = {
      profileId: getActiveProfileId() ?? "default",
      generation: 0,
    };
  } else {
    effectiveOwner =
      ownerOrParentOrigin ?? {
        profileId: getActiveProfileId() ?? "default",
        generation: 0,
      };
    effectiveParentOrigin = parentOrigin;
  }

  if (effectiveParentOrigin === input.origin) return null;

  if (input.protocol === "http:" && isLoopbackHost(input.hostname)) {
    return {
      owner: effectiveOwner,
      url: input.href,
      origin: input.origin,
      source: "loopback",
      revision,
    };
  }

  const matchingTunnel = tunnels.find((tunnel) => {
    if (tunnel.status !== "ready" || !tunnel.url) return false;
    const tunnelUrl = parseTargetUrl(tunnel.url);
    return tunnelUrl?.origin === input.origin;
  });

  return matchingTunnel
    ? {
        owner: effectiveOwner,
        url: input.href,
        origin: input.origin,
        source: "tunnel",
        tunnelId: matchingTunnel.id,
        revision,
      }
    : null;
}
