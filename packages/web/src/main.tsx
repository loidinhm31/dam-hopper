import { createRoot } from "react-dom/client";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { App } from "./App.js";
import "./index.css";
import "@xterm/xterm/css/xterm.css";

import { initTransport } from "./api/transport.js";
import { WsTransport } from "./api/ws-transport.js";
import { getServerUrl } from "./api/server-config.js";

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
    <App />
  </QueryClientProvider>,
);
