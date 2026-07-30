import { createRoot } from "react-dom/client";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { configureLogger, resolveLogLevel } from "@dam-hopper/shared/logger";
import { BrowserDebugHostProvider, DamHopperApp } from "@dam-hopper/ui";
import "@dam-hopper/ui/styles";

import { initTransport } from "@dam-hopper/ui/api/transport";
import { WsTransport } from "@dam-hopper/ui/api/ws-transport";
import {
  initializeClientDiagnostics,
  setClientTransportStatus,
} from "@dam-hopper/ui/diagnostics-client";
import { IdleTransport } from "./idle-transport";
import { getNativeServerUrl } from "./native-server-url";
import {
  getNativeBrowserDebugEnvironment,
  NativeBrowserDebugHost,
} from "./native-browser-debug-host";

declare const __DAM_HOPPER_TAURI_PLATFORM__: string;

type DamHopperNativeDeviceKind = "desktop" | "mobile";

function syncNativePlatform(): void {
  const platform = __DAM_HOPPER_TAURI_PLATFORM__ || "";
  if (!platform) {
    return;
  }

  const deviceKind: DamHopperNativeDeviceKind =
    platform === "android" || platform === "ios" ? "mobile" : "desktop";
  const root = document.documentElement;
  const nativeWindow = window as Window & {
    damHopper?: {
      deviceKind?: DamHopperNativeDeviceKind;
      platform?: string;
    };
  };

  root.dataset.appPlatform = platform;
  root.dataset.deviceKind = deviceKind;
  nativeWindow.damHopper = {
    ...nativeWindow.damHopper,
    platform,
    deviceKind,
  };
}

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
initializeClientDiagnostics();

const serverUrl = getNativeServerUrl();
if (serverUrl) {
  const transport = new WsTransport(serverUrl);
  setClientTransportStatus(transport.getStatus());
  transport.onStatusChange(setClientTransportStatus);
  initTransport(transport);
} else {
  initTransport(new IdleTransport());
}
syncNativePlatform();

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 10_000,
      retry: 1,
    },
  },
});

const nativeBrowserDebugHost = new NativeBrowserDebugHost();
const nativeBrowserDebugEnvironment = getNativeBrowserDebugEnvironment(
  typeof __DAM_HOPPER_TAURI_PLATFORM__ === "string"
    ? __DAM_HOPPER_TAURI_PLATFORM__
    : "unknown",
);
window.addEventListener(
  "beforeunload",
  () => nativeBrowserDebugHost.dispose(),
  { once: true },
);

createRoot(document.getElementById("root")!).render(
  <QueryClientProvider client={queryClient}>
    <BrowserDebugHostProvider
      host={nativeBrowserDebugHost}
      environment={nativeBrowserDebugEnvironment}
    >
      <DamHopperApp />
    </BrowserDebugHostProvider>
  </QueryClientProvider>,
);
