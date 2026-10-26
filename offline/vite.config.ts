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
    // Android 10 emulator / older installed System WebView can still be Chromium 74.
    // Vite's default Chrome 111 target leaves syntax that those WebViews cannot parse.
    target: "chrome74",
    outDir: fileURLToPath(new URL("../android/app/src/main/assets", import.meta.url)),
    emptyOutDir: true,
    sourcemap: false,
  },
});
