import { fileURLToPath, URL } from "node:url";
import { defineConfig, loadEnv } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import { fixBrokenXtermRequestMode } from "../../packages/ui/build/fix-broken-xterm-request-mode";

const uiSrc = fileURLToPath(new URL("../../packages/ui/src", import.meta.url));
const uiStyles = fileURLToPath(
  new URL("../../packages/ui/src/index.css", import.meta.url),
);

export default defineConfig(({ command, mode }) => {
  const env = loadEnv(mode, process.cwd(), "");
  const configuredBackend = env.VITE_DAM_HOPPER_SERVER_URL?.replace(/\/$/, "");
  if (command === "build" && configuredBackend) {
    throw new Error(
      "VITE_DAM_HOPPER_SERVER_URL must be unset for the production same-origin build; use it only for isolated Vite development on port 4801.",
    );
  }
  const backend = configuredBackend || "http://127.0.0.1:4801";

  return {
    base: "./",
    define: {
      __DAM_HOPPER_RELEASE_VERSION__: JSON.stringify(
        process.env.npm_package_version || "0.1.0",
      ),
    },
    plugins: [react(), tailwindcss(), fixBrokenXtermRequestMode()],
    resolve: {
      alias: {
        "@": uiSrc,
        "@dam-hopper/ui/styles": uiStyles,
      },
      dedupe: ["@tanstack/react-query", "react", "react-dom"],
    },
    server: {
      allowedHosts: true,
      proxy: {
        "/api": { target: backend, changeOrigin: true, secure: false },
        "/ws": { target: backend, changeOrigin: true, ws: true, secure: false },
      },
    },
    build: {
      target: "es2022",
      // Monaco is lazy-loaded, but its editor worker bundle exceeds Vite's web default.
      chunkSizeWarningLimit: 4500,
      rollupOptions: {
        output: {
          manualChunks(id) {
            if (
              id.includes("/monaco-editor/") ||
              id.includes("/@monaco-editor/react/")
            ) {
              return "monaco";
            }
            if (id.includes("/@xterm/")) return "terminal";
            if (
              id.includes("/react-markdown/") ||
              id.includes("/remark-gfm/")
            ) {
              return "markdown";
            }
            if (id.includes("/react-arborist/")) return "tree";
            if (id.includes("/react-qr-code/")) return "qr";
          },
        },
      },
    },
    worker: {
      format: "es",
    },
  };
});
