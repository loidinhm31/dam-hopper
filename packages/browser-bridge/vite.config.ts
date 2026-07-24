import { defineConfig } from "vite";

export default defineConfig({
  build: {
    lib: {
      entry: "src/index.ts",
      name: "DamHopperBrowserBridge",
      formats: ["es", "iife"],
      fileName: (format) => `index.${format === "es" ? "js" : "iife.js"}`,
    },
    sourcemap: true,
  },
});
