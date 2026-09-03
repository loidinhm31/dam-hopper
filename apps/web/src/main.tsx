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
  reconcileManagedProfile,
} from "@dam-hopper/ui/api/server-config";
import { fetchRuntimeConfig } from "@dam-hopper/ui/api/runtime-config";
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

async function bootstrap() {
  migrateToProfiles();

  const runtimeConfig = await fetchRuntimeConfig();
  if (runtimeConfig) {
    reconcileManagedProfile(runtimeConfig);
  }

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
}

void bootstrap().catch((err) => {
  console.error("DamHopper web bootstrap failed:", err);
});
