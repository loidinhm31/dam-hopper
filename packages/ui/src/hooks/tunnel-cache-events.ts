import type { QueryClient } from "@tanstack/react-query";
import type { TunnelInfo } from "@/api/client.js";
import { isCurrentConnection } from "@/api/connections.js";
import { profileTunnelsQueryKey } from "@/api/query-client.js";
import { subscribeIpc, type IpcEvent } from "./use-sse.js";

/** Patch only the connection that produced the event, never its replacement. */
export function subscribeTunnelCacheEvents(queryClient: QueryClient): () => void {
  const patch = (
    event: IpcEvent,
    update: (tunnels: TunnelInfo[]) => TunnelInfo[],
  ) => {
    if (!event.profileId || event.generation === undefined) return;
    const owner = { profileId: event.profileId, generation: event.generation };
    if (!isCurrentConnection(owner)) return;
    queryClient.setQueryData<TunnelInfo[]>(profileTunnelsQueryKey(owner), (previous = []) =>
      update(previous),
    );
  };

  const unsubscribes = [
    subscribeIpc("tunnel:created", (event) => {
      const tunnel = event.data as TunnelInfo;
      patch(event, (previous) =>
        previous.some((item) => item.id === tunnel.id) ? previous : [...previous, tunnel],
      );
    }),
    subscribeIpc("tunnel:ready", (event) => {
      const { id, url } = event.data as { id: string; url: string };
      patch(event, (previous) =>
        previous.map((item) => item.id === id ? { ...item, status: "ready", url } : item),
      );
    }),
    subscribeIpc("tunnel:failed", (event) => {
      const { id, error } = event.data as { id: string; error: string };
      patch(event, (previous) =>
        previous.map((item) => item.id === id
          ? { ...item, status: "failed", error, reminderDue: false }
          : item),
      );
    }),
    subscribeIpc("tunnel:stopped", async (event) => {
      if (!event.profileId || event.generation === undefined) return;
      const owner = { profileId: event.profileId, generation: event.generation };
      if (!isCurrentConnection(owner)) return;
      const queryKey = profileTunnelsQueryKey(owner);
      await queryClient.cancelQueries({ queryKey, exact: true });
      const { id } = event.data as { id: string };
      patch(event, (previous) => previous.filter((item) => item.id !== id));
      if (isCurrentConnection(owner)) void queryClient.invalidateQueries({ queryKey, exact: true });
    }),
    subscribeIpc("tunnel:reminder", async (event) => {
      if (!event.profileId || event.generation === undefined) return;
      const owner = { profileId: event.profileId, generation: event.generation };
      if (!isCurrentConnection(owner)) return;
      const queryKey = profileTunnelsQueryKey(owner);
      // An older REST snapshot must not overwrite this one-shot transition.
      await queryClient.cancelQueries({ queryKey, exact: true });
      const { id } = event.data as { id: string };
      patch(event, (previous) =>
        previous.map((item) => item.id === id ? { ...item, reminderDue: true } : item),
      );
      if (isCurrentConnection(owner)) void queryClient.invalidateQueries({ queryKey, exact: true });
    }),
  ];
  return () => unsubscribes.forEach((unsubscribe) => unsubscribe());
}
