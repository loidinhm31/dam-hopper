import { createRoot } from "react-dom/client";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { configureLogger, resolveLogLevel } from "@dam-hopper/shared/logger";
import { DamHopperApp } from "@dam-hopper/ui";
import "@dam-hopper/ui/styles";

import { initTransport } from "@dam-hopper/ui/api/transport";
import { WsTransport } from "@dam-hopper/ui/api/ws-transport";
import { IdleTransport } from "./idle-transport";
import { getNativeServerUrl } from "./native-server-url";

const viteEnv = (import.meta as ImportMeta & { env?: Record<string, unknown> })
  .env;

configureLogger({
  level: resolveLogLevel(
    typeof viteEnv?.VITE_DAM_HOPPER_LOG_LEVEL === "string"
      ? viteEnv.VITE_DAM_HOPPER_LOG_LEVEL
      : undefined,
    viteEnv?.DEV === true ? "debug" : "warn",
  ),
});

const serverUrl = getNativeServerUrl();
initTransport(serverUrl ? new WsTransport(serverUrl) : new IdleTransport());

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
