import type { TunnelInfo } from "@/api/client.js";

export interface BrowserDebugTarget {
  url: string;
  origin: string;
  source: "loopback" | "tunnel";
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
  return hostname === "localhost" || hostname === "127.0.0.1" || hostname === "[::1]";
}

/**
 * Resolves only URLs whose origin is safe to embed in the cooperative Browser tool.
 * Loopback targets must use HTTP; public targets must match a ready tunnel origin.
 */
export function resolveBrowserDebugTarget(
  value: string,
  tunnels: readonly TunnelInfo[],
  parentOrigin?: string,
): BrowserDebugTarget | null {
  const input = parseTargetUrl(value);
  if (!input) return null;
  if (parentOrigin === input.origin) return null;

  if (input.protocol === "http:" && isLoopbackHost(input.hostname)) {
    return { url: input.href, origin: input.origin, source: "loopback" };
  }

  const matchingTunnel = tunnels.find((tunnel) => {
    if (tunnel.status !== "ready" || !tunnel.url) return false;
    const tunnelUrl = parseTargetUrl(tunnel.url);
    return tunnelUrl?.origin === input.origin;
  });

  return matchingTunnel
    ? { url: input.href, origin: input.origin, source: "tunnel" }
    : null;
}
