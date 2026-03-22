import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";

export default defineConfig({
  base: "./",
  plugins: [react(), tailwindcss()],
  resolve: {
    alias: { "@": "/src" },
  },
  // Proxy used only in @dev-hub/server mode (pnpm dev). Not active in Electron.
  server: {
    proxy: {
      "/api": "http://localhost:4800",
    },
  },
});
