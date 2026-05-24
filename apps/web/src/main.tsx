import { createRoot } from "react-dom/client";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { DamHopperApp } from "@dam-hopper/ui";
import "@dam-hopper/ui/styles";

import { initTransport } from "@dam-hopper/ui/api/transport";
import { WsTransport } from "@dam-hopper/ui/api/ws-transport";
import { getServerUrl } from "@dam-hopper/ui/api/server-config";

initTransport(new WsTransport(getServerUrl()));

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 10_000,
      retry: 1,
    },
  },
});

createRoot(document.getElementById("root")!).render(
  <QueryClientProvider client={queryClient}>
    <DamHopperApp />
  </QueryClientProvider>,
);
