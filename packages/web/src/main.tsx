import { createRoot } from "react-dom/client";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { App } from "./App.js";
import "./index.css";
import "@xterm/xterm/css/xterm.css";

// ── Transport initialization ──────────────────────────────────────────────────
// Must run before any component renders (they call api.* → getTransport()).
import { initTransport } from "./api/transport.js";
import { IpcTransport } from "./api/ipc-transport.js";
import { WsTransport } from "./api/ws-transport.js";

const isElectron =
  typeof window !== "undefined" && !!(window as { devhub?: unknown }).devhub;
initTransport(isElectron ? new IpcTransport() : new WsTransport());

// ── React app ─────────────────────────────────────────────────────────────────

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
    <App />
  </QueryClientProvider>,
);
