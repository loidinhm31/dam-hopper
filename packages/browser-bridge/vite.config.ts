import { defineConfig } from "vite";

export default defineConfig({
  build: {
    emptyOutDir: true,
    lib: {
      entry: "src/index.ts",
      name: "DamHopperBrowserBridge",
      formats: ["es", "iife"],
      fileName: (format) => `index.${format === "es" ? "js" : "iife.js"}`,
    },
    sourcemap: false,
    rollupOptions: {
      output: {
        assetFileNames: "[name][extname]",
        chunkFileNames: "[name].js",
        inlineDynamicImports: true,
      },
    },
  },
});
