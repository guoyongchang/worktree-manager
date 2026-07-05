import { defineConfig } from "vitest/config";
import react from "@vitejs/plugin-react";
import path from "path";

export default defineConfig({
  plugins: [react()],
  test: {
    globals: true,
    environment: "jsdom",
    setupFiles: ["./src/test/setup.ts"],
    css: false,
    // packages/* are standalone packages with their own test runners
    // (e.g. packages/mcp uses node:test); keep them out of the root vitest run.
    exclude: ["**/node_modules/**", "**/dist/**", "packages/**"],
  },
  resolve: {
    alias: { "@": path.resolve(__dirname, "./src") },
  },
});
