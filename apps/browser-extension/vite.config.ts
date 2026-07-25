import { defineConfig } from "vite";

const defaultDevelopmentParentOrigins = [
  "http://localhost:5173",
  "http://127.0.0.1:5173",
  "http://localhost:4800",
  "http://127.0.0.1:4800",
];

const configuredParentOrigins = (
  process["env"]["VITE_DAM_HOPPER_EXTENSION_PARENT_ORIGINS"] ??
  defaultDevelopmentParentOrigins.join(",")
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
