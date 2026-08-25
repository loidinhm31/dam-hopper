import { createRoot } from "react-dom/client";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { configureLogger, resolveLogLevel } from "@dam-hopper/shared/logger";
import { DamHopperApp } from "@dam-hopper/ui";
import "@dam-hopper/ui/styles";

import { initTransport } from "@dam-hopper/ui/api/transport";
import { WsTransport } from "@dam-hopper/ui/api/ws-transport";
import { IdleTransport } from "@dam-hopper/ui/api/idle-transport";
import { profileScopedQueryKeyHash } from "@dam-hopper/ui/api/query-client";
import {
  getActiveProfile,
  migrateToProfiles,
} from "@dam-hopper/ui/api/server-config";
import {
  initializeClientDiagnostics,
  setClientTransportStatus,
} from "@dam-hopper/ui/diagnostics-client";

const viteEnv = (import.meta as ImportMeta & { env?: Partial<ImportMetaEnv> })
  .env;

configureLogger({
  level: resolveLogLevel(
    viteEnv?.VITE_DAM_HOPPER_LOG_LEVEL,
    viteEnv?.DEV ? "debug" : "warn",
  ),
});
initializeClientDiagnostics();

migrateToProfiles();

const activeProfile = getActiveProfile();
const transport = activeProfile
  ? new WsTransport(activeProfile.url, activeProfile.id)
  : new IdleTransport();
setClientTransportStatus(transport.getStatus());
transport.onStatusChange((status) => setClientTransportStatus(status));
initTransport(transport);

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 10_000,
      retry: 1,
      queryKeyHashFn: profileScopedQueryKeyHash,
    },
  },
});

createRoot(document.getElementById("root")!).render(
  <QueryClientProvider client={queryClient}>
    <DamHopperApp />
  </QueryClientProvider>,
);
