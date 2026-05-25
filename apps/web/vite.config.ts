import { fileURLToPath, URL } from "node:url";
import { defineConfig, loadEnv } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";

const uiSrc = fileURLToPath(new URL("../../packages/ui/src", import.meta.url));
const uiStyles = fileURLToPath(
  new URL("../../packages/ui/src/index.css", import.meta.url),
);

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), "");
  const backend =
    env.VITE_DAM_HOPPER_SERVER_URL?.replace(/\/$/, "") ||
    "http://127.0.0.1:4800";

  return {
    base: "./",
    plugins: [react(), tailwindcss()],
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
