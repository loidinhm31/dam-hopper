import { fileURLToPath, URL } from "node:url";
import { configDefaults, defineConfig } from "vitest/config";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";

export default defineConfig({
  plugins: [react(), tailwindcss()],
  resolve: {
    alias: {
      "@": fileURLToPath(new URL("./src", import.meta.url)),
    },
    dedupe: ["@tanstack/react-query", "react", "react-dom"],
  },
  worker: {
    format: "es",
  },
  test: {
    exclude: [...configDefaults.exclude, "e2e/**", "browser-tests/**"],
  },
});
