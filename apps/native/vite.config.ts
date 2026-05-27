import { fileURLToPath, URL } from "node:url";
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";

const tauriDevHost = process.env["TAURI_DEV_HOST"];
const tauriPlatform = process.env["TAURI_ENV_PLATFORM"];
const tauriDebug = process.env["TAURI_ENV_DEBUG"];
const uiSrc = fileURLToPath(new URL("../../packages/ui/src", import.meta.url));
const uiStyles = fileURLToPath(
  new URL("../../packages/ui/src/index.css", import.meta.url),
);

export default defineConfig({
  base: "./",
  clearScreen: false,
  define: {
    __DAM_HOPPER_TAURI_PLATFORM__: JSON.stringify(tauriPlatform ?? ""),
  },
  plugins: [react(), tailwindcss()],
  resolve: {
    alias: {
      "@": uiSrc,
      "@dam-hopper/ui/styles": uiStyles,
    },
    dedupe: ["@tanstack/react-query", "react", "react-dom"],
  },
  server: {
    port: 1420,
    strictPort: true,
    host: tauriDevHost || false,
    hmr: tauriDevHost
      ? {
          protocol: "ws",
          host: tauriDevHost,
          port: 1421,
        }
      : undefined,
    watch: {
      ignored: ["**/src-tauri/**"],
    },
  },
  build: {
    target: tauriPlatform === "windows" ? "chrome105" : "safari13",
    minify: tauriDebug ? false : "esbuild",
    sourcemap: Boolean(tauriDebug),
  },
  worker: {
    format: "es",
  },
});
