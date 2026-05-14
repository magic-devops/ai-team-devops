import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import path from "node:path";

// 开发期：把 /api 和 /ws 反代到本地 Manager（8000）
export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: { "@": path.resolve(__dirname, "src") },
  },
  server: {
    port: 5173,
    strictPort: false,
    proxy: {
      "/api": { target: "http://127.0.0.1:8000", changeOrigin: true },
      "/ws": { target: "ws://127.0.0.1:8000", ws: true },
      "/metrics": { target: "http://127.0.0.1:8000", changeOrigin: true },
    },
  },
  build: {
    sourcemap: true,
    outDir: "dist",
  },
});
