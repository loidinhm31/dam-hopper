import type { TunnelInfo } from "@/api/client.js";

export interface BrowserDebugTarget {
  url: string;
  origin: string;
  source: "loopback" | "tunnel";
}

function parseExactOrigin(value: string): URL | null {
  try {
    const url = new URL(value.trim());
    if (
      url.username ||
      url.password ||
      url.hash ||
      url.search ||
      (url.pathname !== "" && url.pathname !== "/")
    ) {
      return null;
    }
    return url;
  } catch {
    return null;
  }
}

function isLoopbackHost(hostname: string): boolean {
  return hostname === "localhost" || hostname === "127.0.0.1" || hostname === "[::1]";
}

/**
 * Resolves only origins that are safe to embed in the cooperative Browser tool.
 * Loopback targets must use HTTP; public targets must exactly match a ready tunnel.
 */
export function resolveBrowserDebugTarget(
  value: string,
  tunnels: readonly TunnelInfo[],
  parentOrigin?: string,
): BrowserDebugTarget | null {
  const input = parseExactOrigin(value);
  if (!input) return null;
  if (parentOrigin === input.origin) return null;

  if (input.protocol === "http:" && isLoopbackHost(input.hostname)) {
    return { url: input.origin, origin: input.origin, source: "loopback" };
  }

  const matchingTunnel = tunnels.find((tunnel) => {
    if (tunnel.status !== "ready" || !tunnel.url) return false;
    const tunnelUrl = parseExactOrigin(tunnel.url);
    return tunnelUrl?.origin === input.origin;
  });

  return matchingTunnel
    ? { url: input.origin, origin: input.origin, source: "tunnel" }
    : null;
}
