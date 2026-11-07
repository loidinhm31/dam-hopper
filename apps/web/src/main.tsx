import { createRoot } from "react-dom/client";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { configureLogger, resolveLogLevel } from "@dam-hopper/shared/logger";
import { DamHopperApp } from "@dam-hopper/ui";
import "@dam-hopper/ui/styles";

import {
  getProfiles,
  migrateToProfiles,
  reconcileManagedProfile,
} from "@dam-hopper/ui/api/server-config";
import { connectProfile, getConnectionSnapshot } from "@dam-hopper/ui/api/connections";
import { fetchRuntimeConfig } from "@dam-hopper/ui/api/runtime-config";
import { initializeClientDiagnostics } from "@dam-hopper/ui/diagnostics-client";
import { performFreshStateReset } from "@dam-hopper/ui/lib/fresh-state-reset";
import { initTransport } from "@dam-hopper/ui/api/transport";
import { IdleTransport } from "@dam-hopper/ui/api/idle-transport";

const viteEnv = (import.meta as ImportMeta & { env?: Partial<ImportMetaEnv> })
  .env;

configureLogger({
  level: resolveLogLevel(
    viteEnv?.VITE_DAM_HOPPER_LOG_LEVEL,
    viteEnv?.DEV ? "debug" : "warn",
  ),
});
initializeClientDiagnostics();
if (import.meta.env.DEV) {
  interface GlobalWithConnections extends Window {
    __CONNECTIONS__?: {
      getConnectionSnapshot: typeof getConnectionSnapshot;
    };
  }
  const globalWindow: GlobalWithConnections = window;
  globalWindow.__CONNECTIONS__ = {
    getConnectionSnapshot,
  };
}

async function bootstrap() {
  // Step 2.9: Idempotent fresh-state reset before restoring profiles/connections
  performFreshStateReset();

  // Initialize fallback idle transport before React mounts
  initTransport(new IdleTransport());

  migrateToProfiles();

  const runtimeConfig = await fetchRuntimeConfig();
  if (runtimeConfig) {
    reconcileManagedProfile(runtimeConfig);
  }

  const profiles = getProfiles();
  const activeProfile = profiles.find((p) => p.autoConnect) ?? profiles[0];
  if (activeProfile) {
    try {
      await connectProfile(activeProfile.id);
    } catch {}
  }
  // Standard ordinary QueryClient (no profileScopedQueryKeyHash)
  const queryClient = new QueryClient({
    defaultOptions: {
      queries: {
        staleTime: 10_000,
        retry: 1,
      },
    },
  });
  if (typeof window !== "undefined") {
    (window as unknown as { __DAM_HOPPER_QUERY_CLIENT__?: QueryClient }).__DAM_HOPPER_QUERY_CLIENT__ = queryClient;
  }

  createRoot(document.getElementById("root")!).render(
    <QueryClientProvider client={queryClient}>
      <DamHopperApp />
    </QueryClientProvider>,
  );
}

void bootstrap().catch((err) => {
  console.error("DamHopper web bootstrap failed:", err);
});
