import { createRoot } from "react-dom/client";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { invoke } from "@tauri-apps/api/core";
import { configureLogger, resolveLogLevel } from "@dam-hopper/shared/logger";
import {
  BrowserDebugHostProvider,
  DamHopperApp,
  SshForwardHostProvider,
  SshForwardScopeBridge,
} from "@dam-hopper/ui";
import "@dam-hopper/ui/styles";

import { initTransport } from "@dam-hopper/ui/api/transport";
import { WsTransport } from "@dam-hopper/ui/api/ws-transport";
import { profileScopedQueryKeyHash } from "@dam-hopper/ui/api/query-client";
import {
  initializeClientDiagnostics,
  setClientTransportStatus,
} from "@dam-hopper/ui/diagnostics-client";
import { IdleTransport } from "./idle-transport";
import { getNativeServerUrl } from "./native-server-url";
import { getActiveProfile } from "@dam-hopper/ui/api/server-config";
import { createNativeSshForwardHost } from "./native-ssh-forward-host";
import {
  getNativeBrowserDebugEnvironment,
  isNativeBrowserDebugEnabled,
  NativeBrowserDebugHost,
} from "./native-browser-debug-host";

declare const __DAM_HOPPER_TAURI_PLATFORM__: string;

type DamHopperNativeDeviceKind = "desktop" | "mobile";

function syncNativePlatform(): void {
  const platform = __DAM_HOPPER_TAURI_PLATFORM__ || "";
  const root = document.documentElement;
  root.dataset.appHost = "native";
  if (!platform) {
    return;
  }

  const deviceKind: DamHopperNativeDeviceKind =
    platform === "android" || platform === "ios" ? "mobile" : "desktop";
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

function installNativeDebugConsoleShortcut(): () => void {
  const platform = __DAM_HOPPER_TAURI_PLATFORM__ || "";
  if (!platform || platform === "android" || platform === "ios") {
    return () => {};
  }

  const onKeyDown = (event: KeyboardEvent) => {
    if (
      event.repeat ||
      event.code !== "F12" ||
      !event.shiftKey ||
      event.ctrlKey ||
      event.altKey ||
      event.metaKey
    ) {
      return;
    }
    event.preventDefault();
    event.stopPropagation();
    void invoke<void>("open_debug_console").catch(() => {});
  };

  window.addEventListener("keydown", onKeyDown, true);
  return () => window.removeEventListener("keydown", onKeyDown, true);
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
syncNativePlatform();
const disposeNativeDebugConsoleShortcut = installNativeDebugConsoleShortcut();

const serverUrl = getNativeServerUrl();
if (serverUrl) {
  const transport = new WsTransport(serverUrl, getActiveProfile()?.id);
  setClientTransportStatus(transport.getStatus());
  transport.onStatusChange(setClientTransportStatus);
  initTransport(transport);
} else {
  initTransport(new IdleTransport());
}

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 10_000,
      retry: 1,
      queryKeyHashFn: profileScopedQueryKeyHash,
    },
  },
});

const nativeSshForwardHost = createNativeSshForwardHost(
  typeof __DAM_HOPPER_TAURI_PLATFORM__ === "string"
    ? __DAM_HOPPER_TAURI_PLATFORM__
    : "unknown",
);
const nativeSshForwardEnvironment = {
  kind: nativeSshForwardHost
    ? ("nativeDesktop" as const)
    : ("nativeMobile" as const),
  platform:
    typeof __DAM_HOPPER_TAURI_PLATFORM__ === "string"
      ? __DAM_HOPPER_TAURI_PLATFORM__
      : "unknown",
};
const nativeBrowserDebugEnabled = isNativeBrowserDebugEnabled(
  viteEnv?.VITE_DAM_HOPPER_NATIVE_BROWSER_DEBUG,
);
const nativePlatform =
  typeof __DAM_HOPPER_TAURI_PLATFORM__ === "string"
    ? __DAM_HOPPER_TAURI_PLATFORM__
    : "unknown";
const nativeBrowserDebugHost =
  nativeBrowserDebugEnabled &&
  nativePlatform !== "android" &&
  nativePlatform !== "ios"
    ? new NativeBrowserDebugHost()
    : null;
const nativeBrowserDebugEnvironment = getNativeBrowserDebugEnvironment(
  nativePlatform,
  nativeBrowserDebugEnabled,
);
window.addEventListener(
  "beforeunload",
  () => {
    disposeNativeDebugConsoleShortcut();
    nativeBrowserDebugHost?.dispose();
    nativeSshForwardHost?.dispose();
  },
  { once: true },
);

createRoot(document.getElementById("root")!).render(
  <QueryClientProvider client={queryClient}>
    <SshForwardHostProvider
      host={nativeSshForwardHost}
      environment={nativeSshForwardEnvironment}
    >
      <SshForwardScopeBridge>
        <BrowserDebugHostProvider
          host={nativeBrowserDebugHost}
          environment={nativeBrowserDebugEnvironment}
        >
          <DamHopperApp />
        </BrowserDebugHostProvider>
      </SshForwardScopeBridge>
    </SshForwardHostProvider>
  </QueryClientProvider>,
);
