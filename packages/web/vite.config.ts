import { defineConfig, loadEnv } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), "");
  const backend = env.VITE_DEV_HUB_SERVER_URL?.replace(/\/$/, "") || "http://127.0.0.1:4800";

  return {
    base: "./",
    plugins: [react(), tailwindcss()],
    resolve: {
      alias: { "@": "/src" },
    },
    server: {
      proxy: {
        "/api": { target: backend, changeOrigin: true, secure: false },
        "/ws": { target: backend, changeOrigin: true, ws: true, secure: false },
      },
    },
    build: {
      rollupOptions: {
        output: {
          manualChunks: {
            monaco: ["monaco-editor"],
          },
        },
      },
    },
    worker: {
      format: "es",
    },
  };
});
