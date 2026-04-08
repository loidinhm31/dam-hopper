import { useQuery } from "@tanstack/react-query";
import { api } from "@/api/client.js";

/**
 * Read a feature flag from /api/health features bitfield.
 *
 * staleTime=30s: flags are stable at runtime (server restart required to change).
 * Runtime toggle propagates within ~30s without page refresh.
 */
export function useFeatureFlag(flag: "ide_explorer"): boolean {
  const { data } = useQuery({
    queryKey: ["health"],
    queryFn: () => api.health.get(),
    staleTime: 30_000,
  });
  return data?.features?.[flag] ?? false;
}
