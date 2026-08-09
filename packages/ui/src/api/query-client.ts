import type { QueryKey } from "@tanstack/react-query";
import { getActiveProfileId } from "./server-config.js";

/** Keep TanStack Query caches isolated when the active server profile changes. */
export function profileScopedQueryKeyHash(queryKey: QueryKey): string {
  return JSON.stringify([
    getActiveProfileId() ?? "no-active-profile",
    queryKey,
  ]);
}
