import { defineConfig } from "vite";

const configuredParentOrigins = (
  process["env"]["VITE_DAM_HOPPER_EXTENSION_PARENT_ORIGINS"] ?? ""
)
  .split(",")
  .map((origin) => origin.trim())
  .filter(Boolean);

export default defineConfig({
  define: {
    __DAM_HOPPER_EXTENSION_PARENT_ORIGINS__: JSON.stringify(
      configuredParentOrigins,
    ),
  },
  build: {
    emptyOutDir: true,
    outDir: "dist",
    rollupOptions: {
      input: "src/content.ts",
      output: {
        entryFileNames: "content.js",
        format: "iife",
      },
    },
  },
});
