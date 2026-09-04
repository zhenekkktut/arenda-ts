import { fileURLToPath, URL } from "node:url";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

export default defineConfig({
  root: fileURLToPath(new URL(".", import.meta.url)),
  base: "./",
  plugins: [react()],
  resolve: {
    alias: {
      "@": fileURLToPath(new URL("..", import.meta.url)),
    },
  },
  build: {
    outDir: fileURLToPath(new URL("../android/app/src/main/assets", import.meta.url)),
    emptyOutDir: true,
    sourcemap: false,
  },
});
